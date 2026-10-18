"""Sync job execution: fetch -> validate -> resolve references -> load -> aggregate -> record history.

Failure handling
- Row-level problems never fail the job: rows are rejected and logged (``sync_errors``); the job ends
  ``partially_succeeded``.
- Transient connector errors (timeouts, 429/5xx) fail the attempt and schedule a retry with exponential
  backoff until ``max_attempts``; the cursor only advances for entities that completed.
- Configuration/authorization errors fail immediately and set the integration to ``error``.
"""

from __future__ import annotations

import logging
import traceback
import uuid
from dataclasses import asdict, dataclass, field
from datetime import UTC, date, datetime
from typing import Any

import pandas as pd
from sqlalchemy.orm import Session

from app.connectors.base import ConnectorConfigurationError, ConnectorError, TransientConnectorError
from app.core.logging import redact_text
from app.models import Company, Integration, SyncError, SyncJob, UploadedFile
from app.pipeline.aggregates import refresh_store_daily
from app.pipeline.entities import ENTITIES, ordered_entities
from app.pipeline.loader import LoadContext, load_dimensions, load_facts, resolve_references
from app.pipeline.validation import RowError, validate_batch

logger = logging.getLogger("aurex.sync")
MAX_ERRORS_PER_JOB = 2000
LIVE_TEST_PROVIDERS = {"generic_rest", "postgres_readonly", "sftp_export"}


@dataclass
class EntityOutcome:
    entity: str
    received: int = 0
    inserted: int = 0
    updated: int = 0
    unchanged: int = 0
    rejected: int = 0
    warnings: int = 0
    min_date: str | None = None
    max_date: str | None = None
    error_counts: dict[str, int] = field(default_factory=dict)
    notes: list[str] = field(default_factory=list)


def _store_errors(db: Session, job: SyncJob | None, org_id: uuid.UUID, entity: str, errors: list[RowError],
                  already: int) -> int:
    if job is None:
        return 0
    stored = 0
    for err in errors:
        if already + stored >= MAX_ERRORS_PER_JOB:
            break
        db.add(SyncError(org_id=org_id, sync_job_id=job.id, entity_type=entity, source_record_id=err.source_record_id,
                         row_number=err.row_number, field=err.field, error_code=err.code, message=err.message,
                         severity=err.severity, raw_excerpt=err.raw))
        stored += 1
    return stored


def process_frame(ctx: LoadContext, entity: str, frame: pd.DataFrame, job: SyncJob | None,
                  date_format: str | None = None, stored_errors: int = 0) -> tuple[EntityOutcome, int]:
    spec = ENTITIES[entity]
    outcome = EntityOutcome(entity=entity)
    result = validate_batch(spec, frame, base_currency=ctx.company.base_currency, date_format=date_format)
    resolved, ref_errors, ref_rejected = resolve_references(ctx, spec, result.valid)
    stats = load_dimensions(ctx, spec, resolved) if spec.kind == "dimension" else load_facts(ctx, spec, resolved)
    outcome.received = result.received
    outcome.inserted, outcome.updated, outcome.unchanged = stats.inserted, stats.updated, stats.unchanged
    outcome.rejected = result.rejected + ref_rejected
    outcome.warnings = result.warnings
    outcome.error_counts = dict(result.error_counts)
    for err in ref_errors:
        outcome.error_counts[err.code] = outcome.error_counts.get(err.code, 0) + 1
    if ref_rejected and not ref_errors:
        outcome.error_counts["missing_reference"] = ref_rejected
    outcome.notes = result.notes
    if stats.min_date:
        outcome.min_date = stats.min_date.isoformat()
    if stats.max_date:
        outcome.max_date = stats.max_date.isoformat()
    stored = _store_errors(ctx.db, job, ctx.org_id, entity, result.errors + ref_errors, stored_errors)
    return outcome, stored


def _merge(total: EntityOutcome, part: EntityOutcome) -> None:
    for attr in ("received", "inserted", "updated", "unchanged", "rejected", "warnings"):
        setattr(total, attr, getattr(total, attr) + getattr(part, attr))
    for code, n in part.error_counts.items():
        total.error_counts[code] = total.error_counts.get(code, 0) + n
    total.notes.extend(n for n in part.notes if n not in total.notes)
    if part.min_date and (total.min_date is None or part.min_date < total.min_date):
        total.min_date = part.min_date
    if part.max_date and (total.max_date is None or part.max_date > total.max_date):
        total.max_date = part.max_date


def refresh_after_load(db: Session, company_id: uuid.UUID, outcomes: list[EntityOutcome]) -> dict[str, Any]:
    affected = [o for o in outcomes if o.entity in ("sales", "traffic") and (o.inserted or o.updated) and o.min_date]
    if not affected:
        return {"agg_store_daily": 0}
    start = min(date.fromisoformat(o.min_date) for o in affected if o.min_date)
    end = max(date.fromisoformat(o.max_date) for o in affected if o.max_date)
    rows = refresh_store_daily(db, company_id, start, end)
    return {"agg_store_daily": rows, "range": [start.isoformat(), end.isoformat()]}


def connector_spec_vendor(integration: Integration) -> bool:
    from app.connectors.registry import CONNECTORS

    cls = CONNECTORS.get(integration.provider_key)
    return cls is not None and cls.spec.availability == "requires_vendor_authorization"


def _refresh_committed(db: Session, company_id: uuid.UUID | None, outcomes: list[EntityOutcome]) -> None:
    """After a failure, rebuild aggregates for entities that were already committed (checkpointed)."""
    if company_id is None or not any(o.entity in ("sales", "traffic") and (o.inserted or o.updated) for o in outcomes):
        return
    from app.db.session import session_scope

    try:  # separate session: a failure here must not roll back the job's failure bookkeeping
        with session_scope() as refresh_db:
            refresh_after_load(refresh_db, company_id, outcomes)
    except Exception:  # noqa: BLE001 - never mask the original sync error
        logger.error("Aggregate refresh after a failed sync crashed: %s", redact_text(traceback.format_exc()))


def run_sync(db: Session, job_id: uuid.UUID) -> SyncJob:
    from app.connectors.registry import build_connector

    job = db.get(SyncJob, job_id)
    if job is None:
        raise ValueError(f"sync job {job_id} not found")
    if job.status != "queued":  # idempotent: a job runs at most once (retries are new jobs)
        return job
    integration = db.get(Integration, job.integration_id)
    assert integration is not None
    company = db.get(Company, integration.company_id) if integration.company_id else None
    job.status = "running"
    job.started_at = datetime.now(UTC)
    job.cursor_start = dict(integration.sync_cursor or {})
    db.commit()

    outcomes: list[EntityOutcome] = []
    stored_errors = 0
    failure_status = "error"
    test_snapshot: dict[str, Any] | None = None
    try:
        if company is None:
            raise ConnectorConfigurationError("Integration is not linked to a company")
        uploaded = db.get(UploadedFile, job.uploaded_file_id) if job.uploaded_file_id else None
        connector = build_connector(db, integration, uploaded)
        live = integration.provider_key in LIVE_TEST_PROVIDERS or connector.spec.availability == "requires_vendor_authorization"
        if live and uploaded is None:  # uploaded files do not depend on the live connection
            test = connector.test_connection()
            integration.last_tested_at = test.tested_at
            integration.last_test_result = test.to_dict()
            if not test.ok:
                failure_status = test.status if test.status in ("awaiting_credentials", "configured") else "error"
                test_snapshot = test.to_dict()
                raise ConnectorConfigurationError(f"Connection test failed: {test.message}")
        ctx = LoadContext(db=db, company=company, integration=integration, sync_job_id=job.id,
                          source_system=integration.provider_key, is_synthetic=bool(integration.is_demo))
        entities = ordered_entities(job.entity_types or connector.entities_for_sync())
        if not job.entity_types:
            job.entity_types = entities
        for entity in entities:
            total = EntityOutcome(entity=entity)
            cursor = (integration.sync_cursor or {}).get(entity)
            new_cursor = cursor
            for batch in connector.fetch(entity, cursor):
                part, stored = process_frame(ctx, entity, batch.frame, job, connector.date_format, stored_errors)
                stored_errors += stored
                _merge(total, part)
                new_cursor = batch.cursor_after or new_cursor
            outcomes.append(total)
            if new_cursor is not None:
                cursors = dict(integration.sync_cursor or {})
                cursors[entity] = new_cursor
                integration.sync_cursor = cursors
            job.stats = {**(job.stats or {}), entity: asdict(total)}
            db.commit()  # checkpoint: completed entities survive a later failure
        job.stats = {**(job.stats or {}), "_aggregates": refresh_after_load(db, company.id, outcomes)}
        job.status = "partially_succeeded" if any(o.rejected for o in outcomes) else "succeeded"
        integration.last_successful_sync_at = datetime.now(UTC)
        if integration.status in ("draft", "error") and integration.provider_key not in LIVE_TEST_PROVIDERS:
            if connector_spec_vendor(integration):  # approved exports never make a vendor connection "live"
                integration.status = "awaiting_credentials"
            else:
                integration.status = "connected" if integration.is_demo else "configured"
    except TransientConnectorError as exc:
        db.rollback()
        job = db.get(SyncJob, job_id)
        integration = db.get(Integration, job.integration_id)
        job.status = "failed"
        job.error_message = redact_text(str(exc))[:2000]
        if job.attempt < job.max_attempts:
            from app.worker.dispatcher import enqueue

            retry = SyncJob(org_id=job.org_id, integration_id=job.integration_id, trigger=job.trigger,
                            entity_types=job.entity_types, attempt=job.attempt + 1, max_attempts=job.max_attempts,
                            retry_of_id=job.id, uploaded_file_id=job.uploaded_file_id, created_by=job.created_by)
            db.add(retry)
            db.flush()
            delay = 30 * (2 ** (job.attempt - 1))
            job.error_message += f" | retry #{retry.attempt} scheduled in {delay}s"
            enqueue(db, "sync_integration", {"sync_job_id": str(retry.id)}, org_id=job.org_id, countdown=delay)
        else:
            integration.status = "error"
            integration.status_detail = f"Sync failed after {job.attempt} attempts: {job.error_message[:300]}"
        _refresh_committed(db, company.id if company else None, outcomes)
    except (ConnectorConfigurationError, ConnectorError) as exc:
        db.rollback()
        job = db.get(SyncJob, job_id)
        integration = db.get(Integration, job.integration_id)
        job.status = "failed"
        job.error_message = redact_text(str(exc))[:2000]
        # A failed upload to a vendor profile is a job failure; the connection itself stays awaiting credentials.
        integration.status = "awaiting_credentials" if job.uploaded_file_id and connector_spec_vendor(integration) \
            else failure_status
        integration.status_detail = job.error_message[:500]
        if test_snapshot:
            integration.last_test_result = test_snapshot
            integration.last_tested_at = datetime.now(UTC)
        _refresh_committed(db, company.id if company else None, outcomes)
    except Exception as exc:  # noqa: BLE001 - unexpected: record and surface, never silently drop
        db.rollback()
        logger.error("Sync job %s crashed: %s", job_id, redact_text(traceback.format_exc()))
        job = db.get(SyncJob, job_id)
        integration = db.get(Integration, job.integration_id)
        job.status = "failed"
        job.error_message = f"Internal error ({type(exc).__name__}); see server logs"
        integration.status = "awaiting_credentials" if job.uploaded_file_id and connector_spec_vendor(integration)             else "error"
        integration.status_detail = job.error_message
        _refresh_committed(db, company.id if company else None, outcomes)
    finally:
        job.finished_at = datetime.now(UTC)
        job.cursor_end = dict(integration.sync_cursor or {}) if integration else None
        totals = {k: sum(getattr(o, k) for o in outcomes) for k in ("received", "inserted", "updated", "unchanged",
                                                                       "rejected")}
        job.records_received = totals["received"]
        job.records_inserted = totals["inserted"]
        job.records_updated = totals["updated"]
        job.records_unchanged = totals["unchanged"]
        job.records_rejected = totals["rejected"]
        if integration:
            integration.last_sync_at = job.finished_at
        db.commit()
    return job
