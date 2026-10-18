"""Integration Hub: connections, tests, syncs, uploads, history, errors, authority rules and webhooks."""

from __future__ import annotations

import hashlib
import io
import json
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated, Any

import pandas as pd
from fastapi import APIRouter, Depends, File, Form, Query, Request, Response, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select, text

from app.api.deps import DbSession, OrgContext, require
from app.connectors.registry import CONNECTORS, build_connector, catalog_entries, get_spec
from app.core.config import get_settings
from app.core.crypto import decrypt_secrets, encrypt_secrets, secret_fingerprint
from app.core.errors import AppError, ConflictError, NotFoundError, PermissionDeniedError, ValidationAppError
from app.core.logging import redact_value
from app.core.permissions import Permission
from app.core.ratelimit import rate_limiter
from app.core.security import generate_token, verify_webhook_signature
from app.db.session import session_scope
from app.models import (
    Company,
    EntityAuthority,
    Integration,
    SyncError,
    SyncJob,
    UploadedFile,
    WebhookEvent,
)
from app.pipeline.entities import AUTHORITY_FACT_TYPES, ENTITIES, entity_catalog
from app.pipeline.loader import LoadContext
from app.pipeline.runner import process_frame, refresh_after_load
from app.services.audit import client_ip, record_audit
from app.services.storage import store_upload
from app.worker.jobs import create_sync_job

router = APIRouter(tags=["integrations"])
P = Permission
FILE_PROVIDERS = {"csv_upload", "excel_upload"}
LIVE_PROVIDERS = {"generic_rest", "postgres_readonly", "sftp_export"}
MAX_WEBHOOK_RECORDS = 5000


# ---------------------------------------------------------------------------------------------
# Serialization
# ---------------------------------------------------------------------------------------------


# Non-secret settings every member who can see the integration needs (e.g. the default record type for uploads).
UPLOAD_SETTINGS = ("entity_type", "date_format", "delimiter", "sheet_name")


def _visible_config(i: Integration, spec: Any, include_config: bool) -> dict[str, Any]:
    config = dict(i.config or {})
    if not include_config:
        return {k: config[k] for k in UPLOAD_SETTINGS if k in config}
    # Config never holds credentials (rejected on write). Fields the connector declares as non-secret are shown
    # as-is (value-level redaction only), so names such as `api_key_header` or `token_url` stay readable; any
    # other key is masked when its name looks sensitive.
    declared = {f.name for f in spec.config_fields if not f.secret} if spec else set()
    return {k: redact_value(v) if k in declared else redact_value(v, k) for k, v in config.items()}


def integration_out(i: Integration, *, include_config: bool = True) -> dict[str, Any]:
    spec = CONNECTORS[i.provider_key].spec if i.provider_key in CONNECTORS else None
    config = _visible_config(i, spec, include_config)
    return {
        "id": str(i.id), "provider_key": i.provider_key, "provider_name": spec.name if spec else i.provider_key,
        "display_name": i.display_name, "company_id": str(i.company_id) if i.company_id else None,
        "status": i.status, "status_detail": i.status_detail, "is_live": i.status == "connected",
        "is_demo": i.is_demo, "auth_type": i.auth_type, "methods": list(spec.methods) if spec else [],
        "availability": spec.availability if spec else None, "config": config,
        "credentials": i.secret_fingerprint or {}, "has_webhook_secret": i.webhook_secret_ciphertext is not None,
        "schedule_minutes": i.schedule_minutes, "sync_cursor": i.sync_cursor,
        "last_tested_at": i.last_tested_at.isoformat() if i.last_tested_at else None, "last_test_result": i.last_test_result,
        "last_sync_at": i.last_sync_at.isoformat() if i.last_sync_at else None,
        "last_successful_sync_at": i.last_successful_sync_at.isoformat() if i.last_successful_sync_at else None,
        "supported_entities": list(spec.supported_entities) if spec else [],
        "created_at": i.created_at.isoformat() if i.created_at else None,
    }


def job_out(j: SyncJob, integration_name: str | None = None) -> dict[str, Any]:
    duration = (j.finished_at - j.started_at).total_seconds() if j.finished_at and j.started_at else None
    return {
        "id": str(j.id), "integration_id": str(j.integration_id), "integration": integration_name,
        "trigger": j.trigger, "status": j.status, "attempt": j.attempt, "max_attempts": j.max_attempts,
        "retry_of_id": str(j.retry_of_id) if j.retry_of_id else None, "entity_types": j.entity_types,
        "queued_at": j.queued_at.isoformat() if j.queued_at else None,
        "started_at": j.started_at.isoformat() if j.started_at else None,
        "finished_at": j.finished_at.isoformat() if j.finished_at else None, "duration_seconds": duration,
        "records": {"received": j.records_received, "inserted": j.records_inserted, "updated": j.records_updated,
                    "unchanged": j.records_unchanged, "rejected": j.records_rejected},
        "stats": j.stats, "cursor_start": j.cursor_start, "cursor_end": j.cursor_end, "error_message": j.error_message,
        "uploaded_file_id": str(j.uploaded_file_id) if j.uploaded_file_id else None,
    }


# ---------------------------------------------------------------------------------------------
# Catalog & entity schema
# ---------------------------------------------------------------------------------------------


@router.get("/public/integration-catalog", tags=["public"])
def public_catalog(request: Request) -> dict:
    rate_limiter.check("public", client_ip(request) or "unknown", 120)
    entries = [{k: e[k] for k in ("key", "name", "categories", "methods", "availability", "verification_status",
                                  "summary", "docs_url")} for e in catalog_entries()]
    return {"generated_at": datetime.now(UTC).isoformat(), "entries": entries}


@router.get("/orgs/{org_id}/integrations/catalog")
def org_catalog(ctx: Annotated[OrgContext, Depends(require(P.INTEGRATIONS_READ))]) -> dict:
    entries = catalog_entries(include_internal=ctx.org.is_demo)
    for entry in entries:
        cls = CONNECTORS.get(entry["key"])
        entry["config_fields"] = [
            {"name": f.name, "label": f.label, "kind": f.kind, "required": f.required, "secret": f.secret,
             "help": f.help, "options": list(f.options)} for f in (cls.spec.config_fields if cls else ())]
        entry["supported_entities"] = list(cls.spec.supported_entities) if cls else []
    return {"entries": entries}


@router.get("/orgs/{org_id}/integrations/entities")
def entities(ctx: Annotated[OrgContext, Depends(require(P.INTEGRATIONS_READ))]) -> dict:
    return {"entities": entity_catalog(), "authority_fact_types": sorted(set(AUTHORITY_FACT_TYPES.values()))}


@router.get("/orgs/{org_id}/integrations/templates/{entity}.csv")
def csv_template(entity: str, ctx: Annotated[OrgContext, Depends(require(P.INTEGRATIONS_READ))]) -> Response:
    spec = ENTITIES.get(entity)
    if spec is None:
        raise NotFoundError("Unknown entity")
    header = ",".join(spec.field_names()) + "\n"
    return Response(header, media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="aurex_{entity}_template.csv"'})


# ---------------------------------------------------------------------------------------------
# Connections
# ---------------------------------------------------------------------------------------------


class IntegrationIn(BaseModel):
    provider_key: str = Field(max_length=60)
    display_name: str = Field(min_length=1, max_length=200)
    company_id: uuid.UUID | None = None
    config: dict[str, Any] = Field(default_factory=dict)
    credentials: dict[str, str] = Field(default_factory=dict)
    schedule_minutes: int | None = Field(default=None, ge=15, le=10080)


class IntegrationUpdateIn(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=200)
    config: dict[str, Any] | None = None
    credentials: dict[str, str] | None = None
    schedule_minutes: int | None = Field(default=None, ge=15, le=10080)
    clear_schedule: bool = False
    disabled: bool | None = None


def _validate_config(provider_key: str, config: dict[str, Any], credentials: dict[str, str]) -> None:
    spec = get_spec(provider_key)
    if spec.is_demo:
        raise ValidationAppError("Synthetic demo feeds cannot be created by users")
    secret_names = set(spec.secret_field_names())
    unknown_secrets = [k for k in credentials if k not in secret_names]
    if unknown_secrets:
        raise ValidationAppError("Unknown credential fields", details={"fields": unknown_secrets})
    leaked = [k for k in config if k in secret_names or "secret" in k.lower() or "password" in k.lower()]
    if leaked:
        raise ValidationAppError("Credentials must be sent in 'credentials', never in 'config'",
                                 details={"fields": leaked})
    if len(json.dumps(config)) > 100_000:
        raise ValidationAppError("Configuration too large")
    entity_type = config.get("entity_type")
    if entity_type and entity_type not in ENTITIES:
        raise ValidationAppError("Unknown entity_type", details={"entity_type": entity_type})


def _initial_status(provider_key: str, credentials: dict[str, str]) -> tuple[str, str]:
    spec = get_spec(provider_key)
    if spec.availability == "requires_vendor_authorization":
        return "awaiting_credentials", "Requires retailer authorization and vendor-provided API access; upload approved exports meanwhile."
    if provider_key in FILE_PROVIDERS:
        return "configured", "File-based import: no live endpoint. Upload files to sync."
    if provider_key == "webhook_push":
        return "configured", "Waiting for the first correctly signed event."
    if provider_key in LIVE_PROVIDERS:
        if not any(credentials.values()):
            return "awaiting_credentials", "Add credentials, then run a connection test."
        return "configured", "Credentials stored. Run a connection test before syncing."
    return "draft", ""


@router.get("/orgs/{org_id}/integrations")
def list_integrations(ctx: Annotated[OrgContext, Depends(require(P.INTEGRATIONS_READ))], db: DbSession) -> dict:
    rows = db.scalars(select(Integration).where(Integration.org_id == ctx.org_id).order_by(Integration.created_at)).all()
    counts = dict(db.execute(select(SyncJob.integration_id, func.count()).where(SyncJob.org_id == ctx.org_id)
                             .group_by(SyncJob.integration_id)).all())
    out = []
    for i in rows:
        item = integration_out(i, include_config=ctx.has(P.INTEGRATIONS_MANAGE))
        item["sync_job_count"] = counts.get(i.id, 0)
        out.append(item)
    return {"integrations": out}


@router.post("/orgs/{org_id}/integrations", status_code=status.HTTP_201_CREATED)
def create_integration(body: IntegrationIn, ctx: Annotated[OrgContext, Depends(require(P.INTEGRATIONS_MANAGE))],
                       db: DbSession, request: Request) -> dict:
    _validate_config(body.provider_key, body.config, body.credentials)
    company = ctx.default_company(db, body.company_id)
    if db.scalar(select(Integration.id).where(Integration.org_id == ctx.org_id,
                                              Integration.display_name == body.display_name)):
        raise ConflictError("An integration with this name already exists")
    status_value, detail = _initial_status(body.provider_key, body.credentials)
    credentials = {k: v for k, v in body.credentials.items() if v}
    integration = Integration(
        org_id=ctx.org_id, company_id=company.id, provider_key=body.provider_key, display_name=body.display_name,
        status=status_value, status_detail=detail, auth_type=str(body.config.get("auth_type") or get_spec(
            body.provider_key).auth_type), config=body.config, schedule_minutes=body.schedule_minutes,
        secret_ciphertext=encrypt_secrets(credentials) if credentials else None,
        secret_fingerprint=secret_fingerprint(credentials), created_by=ctx.user.id)
    webhook_secret = None
    if body.provider_key == "webhook_push":
        webhook_secret = generate_token(32)
        integration.webhook_secret_ciphertext = encrypt_secrets({"secret": webhook_secret})
    db.add(integration)
    db.flush()
    record_audit(db, action="integration.created", org_id=ctx.org_id, actor=ctx.user, entity_type="integration",
                 entity_id=integration.id, request=request,
                 details={"provider_key": body.provider_key, "credential_fields": sorted(credentials)})
    out = integration_out(integration)
    if webhook_secret:
        out["webhook"] = {"url": f"{get_settings().api_prefix}/webhooks/{integration.id}", "signing_secret": webhook_secret,
                          "note": "Shown once. Sign requests as described in docs/INTEGRATIONS.md."}
    return out


@router.get("/orgs/{org_id}/integrations/{integration_id}")
def get_integration(integration_id: uuid.UUID, ctx: Annotated[OrgContext, Depends(require(P.INTEGRATIONS_READ))],
                    db: DbSession) -> dict:
    integration = ctx.scoped_get(db, Integration, integration_id, "Integration")
    jobs = db.scalars(select(SyncJob).where(SyncJob.integration_id == integration.id)
                      .order_by(SyncJob.queued_at.desc()).limit(20)).all()
    research = next((e for e in catalog_entries(include_internal=True) if e["key"] == integration.provider_key), None)
    return {**integration_out(integration, include_config=ctx.has(P.INTEGRATIONS_MANAGE)),
            "recent_jobs": [job_out(j, integration.display_name) for j in jobs],
            "provider": {k: research[k] for k in ("summary", "verification_status", "activation_requirements",
                                                  "docs_url", "research")} if research else None}


@router.patch("/orgs/{org_id}/integrations/{integration_id}")
def update_integration(integration_id: uuid.UUID, body: IntegrationUpdateIn,
                       ctx: Annotated[OrgContext, Depends(require(P.INTEGRATIONS_MANAGE))], db: DbSession,
                       request: Request) -> dict:
    integration = ctx.scoped_get(db, Integration, integration_id, "Integration")
    if integration.is_demo and (body.config is not None or body.credentials is not None):
        raise ValidationAppError("Synthetic demo feed configuration is managed by the seed")
    changes: list[str] = []
    if body.display_name:
        integration.display_name = body.display_name
        changes.append("display_name")
    reset_status = False
    if body.config is not None:
        _validate_config(integration.provider_key, body.config, body.credentials or {})
        integration.config = body.config
        changes.append("config")
        reset_status = True
    if body.credentials is not None:
        _validate_config(integration.provider_key, integration.config or {}, body.credentials)
        current = decrypt_secrets(integration.secret_ciphertext)
        for key, value in body.credentials.items():
            if value == "":
                current.pop(key, None)
            else:
                current[key] = value
        integration.secret_ciphertext = encrypt_secrets(current) if current else None
        integration.secret_fingerprint = secret_fingerprint(current)
        changes.append("credentials")
        reset_status = True
    if body.clear_schedule:
        integration.schedule_minutes = None
        changes.append("schedule")
    elif body.schedule_minutes is not None:
        integration.schedule_minutes = body.schedule_minutes
        changes.append("schedule")
    if body.disabled is True:
        integration.status = "disabled"
        changes.append("disabled")
    elif body.disabled is False and integration.status == "disabled":
        reset_status = True
        changes.append("enabled")
    if (reset_status and integration.status != "disabled") or body.disabled is False:
        new_status, detail = _initial_status(integration.provider_key, decrypt_secrets(integration.secret_ciphertext))
        if integration.is_demo:
            new_status, detail = "connected", integration.status_detail or ""
        integration.status, integration.status_detail = new_status, detail
    record_audit(db, action="integration.updated", org_id=ctx.org_id, actor=ctx.user, entity_type="integration",
                 entity_id=integration.id, request=request, details={"changed": changes})
    return integration_out(integration)


@router.delete("/orgs/{org_id}/integrations/{integration_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_integration(integration_id: uuid.UUID, ctx: Annotated[OrgContext, Depends(require(P.INTEGRATIONS_MANAGE))],
                       db: DbSession, request: Request) -> Response:
    integration = ctx.scoped_get(db, Integration, integration_id, "Integration")
    for table in ("sales_records", "store_traffic", "inventory_snapshots", "inventory_movements", "purchase_orders",
                  "purchase_order_lines", "expenses", "cash_flow_entries", "cash_balances", "budgets",
                  "workforce_aggregates", "marketing_spend", "customer_metrics"):
        if db.execute(text(f"SELECT 1 FROM {table} WHERE integration_id = :i LIMIT 1"), {"i": integration.id}).first():  # noqa: S608
            raise ConflictError("This integration has supplied business data. Disable it instead of deleting it, so the "
                                "data keeps its provenance.", code="integration_has_data")
    record_audit(db, action="integration.deleted", org_id=ctx.org_id, actor=ctx.user, entity_type="integration",
                 entity_id=integration.id, request=request, details={"name": integration.display_name})
    db.delete(integration)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/orgs/{org_id}/integrations/{integration_id}/test")
def test_integration(integration_id: uuid.UUID, ctx: Annotated[OrgContext, Depends(require(P.INTEGRATIONS_MANAGE))],
                     db: DbSession, request: Request) -> dict:
    integration = ctx.scoped_get(db, Integration, integration_id, "Integration")
    if integration.status == "disabled":
        raise ConflictError("Enable the integration before testing it")
    connector = build_connector(db, integration)
    result = connector.test_connection()
    integration.last_tested_at = result.tested_at
    integration.last_test_result = {**(integration.last_test_result or {}), **result.to_dict()}
    integration.status = result.status
    integration.status_detail = result.message
    record_audit(db, action="integration.tested", org_id=ctx.org_id, actor=ctx.user, entity_type="integration",
                 entity_id=integration.id, request=request, outcome="success" if result.ok else "failure",
                 details={"status": result.status})
    return {"result": result.to_dict(), "integration": integration_out(integration)}


class SyncIn(BaseModel):
    entity_types: list[str] | None = None


@router.post("/orgs/{org_id}/integrations/{integration_id}/sync", status_code=status.HTTP_202_ACCEPTED)
def sync_integration(integration_id: uuid.UUID, ctx: Annotated[OrgContext, Depends(require(P.INTEGRATIONS_MANAGE))],
                     db: DbSession, request: Request, body: SyncIn | None = None) -> dict:
    integration = ctx.scoped_get(db, Integration, integration_id, "Integration")
    if integration.provider_key in FILE_PROVIDERS:
        raise ValidationAppError("File-based integrations sync by uploading a file", code="use_upload")
    if integration.provider_key == "webhook_push":
        raise ValidationAppError("Webhook integrations receive pushed events; there is nothing to pull", code="push_only")
    if integration.status != "connected":
        raise ConflictError("Only connections with a successful connection test can sync. Run a test first.",
                            code="not_connected", details={"status": integration.status})
    entity_types = (body.entity_types if body else None) or []
    unknown = [e for e in entity_types if e not in ENTITIES]
    if unknown:
        raise ValidationAppError("Unknown entity types", details={"entity_types": unknown})
    running = db.scalar(select(SyncJob.id).where(SyncJob.integration_id == integration.id,
                                                 SyncJob.status.in_(("queued", "running"))))
    if running:
        raise ConflictError("A sync is already queued or running for this integration", details={"job_id": str(running)})
    job = create_sync_job(db, integration, trigger="manual", user_id=ctx.user.id, entity_types=entity_types)
    record_audit(db, action="integration.sync_requested", org_id=ctx.org_id, actor=ctx.user, entity_type="sync_job",
                 entity_id=job.id, request=request)
    return job_out(job, integration.display_name)


@router.post("/orgs/{org_id}/integrations/{integration_id}/uploads", status_code=status.HTTP_202_ACCEPTED)
async def upload_file(integration_id: uuid.UUID, ctx: Annotated[OrgContext, Depends(require(P.DATA_IMPORT))],
                      db: DbSession, request: Request, file: Annotated[UploadFile, File()],
                      entity_type: Annotated[str | None, Form()] = None) -> dict:
    integration = ctx.scoped_get(db, Integration, integration_id, "Integration")
    if integration.provider_key not in FILE_PROVIDERS and get_spec(integration.provider_key).availability != \
            "requires_vendor_authorization":
        raise ValidationAppError("This integration does not accept file uploads")
    entity = entity_type or (integration.config or {}).get("entity_type")
    if not entity or entity not in ENTITIES:
        raise ValidationAppError("Choose a valid record type for this file", details={"entity_type": entity})
    filename = Path(file.filename or "upload").name[:255]
    suffix = Path(filename).suffix.lower()
    if suffix not in (".csv", ".xlsx", ".xlsm", ".txt"):
        raise ValidationAppError("Only .csv and .xlsx files are accepted")
    limit = get_settings().max_upload_mb * 1024 * 1024
    content = await file.read(limit + 1)
    if len(content) > limit:
        raise AppError(f"File exceeds {get_settings().max_upload_mb} MB", code="file_too_large", status_code=413)
    if not content.strip():
        raise ValidationAppError("The file is empty")
    sha = hashlib.sha256(content).hexdigest()
    previous = db.scalar(select(UploadedFile).where(UploadedFile.integration_id == integration.id,
                                                    UploadedFile.entity_type == entity, UploadedFile.sha256 == sha))
    if previous:
        prev_job = db.scalar(select(SyncJob).where(SyncJob.uploaded_file_id == previous.id))
        raise ConflictError("This exact file was already imported for this record type",
                            code="duplicate_file", details={"uploaded_file_id": str(previous.id),
                                                             "sync_job_id": str(prev_job.id) if prev_job else None})
    path = store_upload(ctx.org_id, sha, suffix if suffix != ".txt" else ".csv", io.BytesIO(content))
    uploaded = UploadedFile(org_id=ctx.org_id, integration_id=integration.id, entity_type=entity, filename=filename,
                            content_type=file.content_type, size_bytes=len(content), sha256=sha,
                            storage_path=str(path), uploaded_by=ctx.user.id)
    db.add(uploaded)
    db.flush()
    job = create_sync_job(db, integration, trigger="upload", user_id=ctx.user.id, entity_types=[entity],
                          uploaded_file_id=uploaded.id)
    record_audit(db, action="data.file_uploaded", org_id=ctx.org_id, actor=ctx.user, entity_type="uploaded_file",
                 entity_id=uploaded.id, request=request,
                 details={"filename": filename, "entity_type": entity, "bytes": len(content), "sha256": sha})
    return {"uploaded_file_id": str(uploaded.id), "job": job_out(job, integration.display_name)}


@router.get("/orgs/{org_id}/integrations/{integration_id}/jobs")
def integration_jobs(integration_id: uuid.UUID, ctx: Annotated[OrgContext, Depends(require(P.INTEGRATIONS_READ))],
                     db: DbSession, limit: int = Query(default=25, ge=1, le=200), offset: int = Query(default=0, ge=0)) -> dict:
    integration = ctx.scoped_get(db, Integration, integration_id, "Integration")
    total = db.scalar(select(func.count()).select_from(SyncJob).where(SyncJob.integration_id == integration.id))
    rows = db.scalars(select(SyncJob).where(SyncJob.integration_id == integration.id)
                      .order_by(SyncJob.queued_at.desc()).limit(limit).offset(offset)).all()
    return {"total": total, "jobs": [job_out(j, integration.display_name) for j in rows]}


@router.get("/orgs/{org_id}/sync-jobs")
def all_jobs(ctx: Annotated[OrgContext, Depends(require(P.INTEGRATIONS_READ))], db: DbSession,
             limit: int = Query(default=30, ge=1, le=200)) -> dict:
    rows = db.execute(select(SyncJob, Integration.display_name).join(Integration, Integration.id == SyncJob.integration_id)
                      .where(SyncJob.org_id == ctx.org_id).order_by(SyncJob.queued_at.desc()).limit(limit)).all()
    return {"jobs": [job_out(j, name) for j, name in rows]}


@router.get("/orgs/{org_id}/sync-jobs/{job_id}")
def get_job(job_id: uuid.UUID, ctx: Annotated[OrgContext, Depends(require(P.INTEGRATIONS_READ))], db: DbSession) -> dict:
    job = ctx.scoped_get(db, SyncJob, job_id, "Sync job")
    integration = db.get(Integration, job.integration_id)
    error_count = db.scalar(select(func.count()).select_from(SyncError).where(SyncError.sync_job_id == job.id))
    uploaded = db.get(UploadedFile, job.uploaded_file_id) if job.uploaded_file_id else None
    return {**job_out(job, integration.display_name if integration else None), "logged_errors": error_count,
            "file": {"filename": uploaded.filename, "bytes": uploaded.size_bytes, "sha256": uploaded.sha256}
            if uploaded else None}


@router.get("/orgs/{org_id}/sync-jobs/{job_id}/errors")
def job_errors(job_id: uuid.UUID, ctx: Annotated[OrgContext, Depends(require(P.INTEGRATIONS_READ))], db: DbSession,
               code: str | None = Query(default=None, max_length=60), limit: int = Query(default=100, ge=1, le=500),
               offset: int = Query(default=0, ge=0)) -> dict:
    job = ctx.scoped_get(db, SyncJob, job_id, "Sync job")
    query = select(SyncError).where(SyncError.sync_job_id == job.id)
    if code:
        query = query.where(SyncError.error_code == code)
    total = db.scalar(select(func.count()).select_from(query.subquery()))
    rows = db.scalars(query.order_by(SyncError.id).limit(limit).offset(offset)).all()
    return {"total": total, "errors": [
        {"id": e.id, "entity_type": e.entity_type, "row_number": e.row_number, "source_record_id": e.source_record_id,
         "field": e.field, "code": e.error_code, "message": e.message, "severity": e.severity,
         "raw_excerpt": e.raw_excerpt if ctx.has(P.INTEGRATIONS_MANAGE) or ctx.has(P.DATA_IMPORT) else None}
        for e in rows]}


@router.post("/orgs/{org_id}/sync-jobs/{job_id}/retry", status_code=status.HTTP_202_ACCEPTED)
def retry_job(job_id: uuid.UUID, ctx: Annotated[OrgContext, Depends(require(P.INTEGRATIONS_MANAGE))], db: DbSession,
              request: Request) -> dict:
    job = ctx.scoped_get(db, SyncJob, job_id, "Sync job")
    if job.status not in ("failed", "partially_succeeded"):
        raise ConflictError("Only failed or partially succeeded jobs can be retried")
    integration = db.get(Integration, job.integration_id)
    retry = create_sync_job(db, integration, trigger="manual", user_id=ctx.user.id, entity_types=job.entity_types,
                            uploaded_file_id=job.uploaded_file_id)
    retry.retry_of_id = job.id
    retry.attempt = job.attempt + 1
    retry.max_attempts = max(job.max_attempts, retry.attempt)
    record_audit(db, action="integration.sync_retried", org_id=ctx.org_id, actor=ctx.user, entity_type="sync_job",
                 entity_id=retry.id, request=request, details={"retry_of": str(job.id)})
    return job_out(retry, integration.display_name)


# ---------------------------------------------------------------------------------------------
# System-of-record rules
# ---------------------------------------------------------------------------------------------


class AuthorityIn(BaseModel):
    company_id: uuid.UUID
    fact_type: str = Field(max_length=40)
    integration_id: uuid.UUID
    store_id: uuid.UUID | None = None


@router.get("/orgs/{org_id}/integrations-authorities")
def list_authorities(ctx: Annotated[OrgContext, Depends(require(P.INTEGRATIONS_READ))], db: DbSession) -> dict:
    rows = db.scalars(select(EntityAuthority).where(EntityAuthority.org_id == ctx.org_id)).all()
    return {"rules": [{"id": str(r.id), "company_id": str(r.company_id), "fact_type": r.fact_type,
                       "store_id": str(r.store_id) if r.store_id else None, "integration_id": str(r.integration_id)}
                      for r in rows],
            "fact_types": sorted(set(AUTHORITY_FACT_TYPES.values())),
            "default_rule": "Without a rule, the earliest-created integration that supplied the fact is authoritative."}


@router.put("/orgs/{org_id}/integrations-authorities")
def set_authority(body: AuthorityIn, ctx: Annotated[OrgContext, Depends(require(P.INTEGRATIONS_MANAGE))], db: DbSession,
                  request: Request) -> dict:
    if body.fact_type not in set(AUTHORITY_FACT_TYPES.values()):
        raise ValidationAppError("Unknown fact type")
    company = ctx.get_company(db, body.company_id)
    integration = ctx.scoped_get(db, Integration, body.integration_id, "Integration")
    if integration.company_id != company.id:
        raise ValidationAppError("The integration belongs to another company")
    if body.store_id:
        store = ctx.get_store(db, body.store_id)
        if store.company_id != company.id:
            raise ValidationAppError("The store belongs to another company")
    rule = db.scalar(select(EntityAuthority).where(EntityAuthority.company_id == company.id,
                                                   EntityAuthority.fact_type == body.fact_type,
                                                   EntityAuthority.store_id.is_(None) if body.store_id is None
                                                   else EntityAuthority.store_id == body.store_id))
    if rule is None:
        rule = EntityAuthority(org_id=ctx.org_id, company_id=company.id, fact_type=body.fact_type,
                               store_id=body.store_id, integration_id=integration.id, created_by=ctx.user.id)
        db.add(rule)
    else:
        rule.integration_id = integration.id
    db.flush()
    if body.fact_type in ("sales", "traffic"):
        from app.pipeline.aggregates import refresh_all_store_daily

        refresh_all_store_daily(db, company.id)
    record_audit(db, action="integration.authority_set", org_id=ctx.org_id, actor=ctx.user,
                 entity_type="entity_authority", entity_id=rule.id, request=request,
                 details={"fact_type": body.fact_type, "integration_id": str(integration.id)})
    return {"id": str(rule.id), "fact_type": rule.fact_type, "integration_id": str(rule.integration_id)}


# ---------------------------------------------------------------------------------------------
# Webhooks (public endpoint, HMAC-signed)
# ---------------------------------------------------------------------------------------------


@router.post("/orgs/{org_id}/integrations/{integration_id}/webhook-secret", status_code=status.HTTP_201_CREATED)
def rotate_webhook_secret(integration_id: uuid.UUID, ctx: Annotated[OrgContext, Depends(require(P.INTEGRATIONS_MANAGE))],
                          db: DbSession, request: Request) -> dict:
    integration = ctx.scoped_get(db, Integration, integration_id, "Integration")
    if integration.provider_key != "webhook_push":
        raise ValidationAppError("Only webhook integrations have signing secrets")
    secret = generate_token(32)
    integration.webhook_secret_ciphertext = encrypt_secrets({"secret": secret})
    record_audit(db, action="integration.webhook_secret_rotated", org_id=ctx.org_id, actor=ctx.user,
                 entity_type="integration", entity_id=integration.id, request=request)
    return {"signing_secret": secret, "note": "Shown once. The previous secret stops working immediately."}


@router.post("/webhooks/{integration_id}", tags=["webhooks"])
async def receive_webhook(integration_id: uuid.UUID, request: Request) -> dict:
    """Signed push endpoint. Headers: X-Aurex-Timestamp (unix seconds), X-Aurex-Signature
    (sha256=HMAC_SHA256(secret, timestamp + '.' + body)), X-Aurex-Event-Id. Body: {"entity": ..., "records": [...]}."""
    rate_limiter.check("webhook", str(integration_id), 600)
    body = await request.body()
    if len(body) > 10 * 1024 * 1024:
        raise AppError("Payload too large", code="payload_too_large", status_code=413)
    timestamp = request.headers.get("x-aurex-timestamp", "")
    signature = request.headers.get("x-aurex-signature", "")
    event_id = (request.headers.get("x-aurex-event-id") or "")[:200]
    with session_scope() as db:
        integration = db.get(Integration, integration_id)
        if integration is None or integration.provider_key != "webhook_push" or integration.status == "disabled":
            raise NotFoundError("Unknown webhook endpoint")
        secret = decrypt_secrets(integration.webhook_secret_ciphertext).get("secret")
        if not secret or not verify_webhook_signature(secret, timestamp, body, signature):
            record_audit(db, action="webhook.rejected", org_id=integration.org_id, actor_label="webhook",
                         entity_type="integration", entity_id=integration.id, outcome="failure", request=request,
                         details={"reason": "invalid_signature_or_timestamp"})
            db.commit()
            raise PermissionDeniedError("Invalid signature or stale timestamp", code="invalid_signature")
        if not event_id:
            raise ValidationAppError("X-Aurex-Event-Id header is required for idempotency")
        if db.scalar(select(WebhookEvent.id).where(WebhookEvent.integration_id == integration.id,
                                                   WebhookEvent.event_id == event_id)):
            return {"status": "duplicate", "event_id": event_id, "processed": False}
        try:
            payload = json.loads(body)
        except ValueError as exc:
            raise ValidationAppError("Body must be JSON") from exc
        entity = payload.get("entity")
        records = payload.get("records")
        if entity not in ENTITIES or not isinstance(records, list):
            raise ValidationAppError("Body must contain 'entity' (a known record type) and a 'records' list")
        if len(records) > MAX_WEBHOOK_RECORDS:
            raise AppError(f"At most {MAX_WEBHOOK_RECORDS} records per event", code="too_many_records", status_code=413)
        event = WebhookEvent(org_id=integration.org_id, integration_id=integration.id, event_id=event_id,
                             event_type=entity, payload_sha256=hashlib.sha256(body).hexdigest())
        db.add(event)
        job = create_sync_job(db, integration, trigger="webhook", entity_types=[entity], dispatch=False)
        job.status = "running"
        job.started_at = datetime.now(UTC)
        company = db.get(Company, integration.company_id)
        ctx = LoadContext(db=db, company=company, integration=integration, sync_job_id=job.id,
                          source_system="webhook_push")
        from app.connectors.file_import import apply_mapping

        frame = apply_mapping(pd.DataFrame(records), (integration.config or {}).get("field_mapping"), entity)
        outcome, _ = process_frame(ctx, entity, frame, job)
        job.stats = {entity: outcome.__dict__, "_aggregates": refresh_after_load(db, company.id, [outcome])}
        job.records_received, job.records_inserted = outcome.received, outcome.inserted
        job.records_updated, job.records_unchanged, job.records_rejected = outcome.updated, outcome.unchanged, outcome.rejected
        job.status = "partially_succeeded" if outcome.rejected else "succeeded"
        job.finished_at = datetime.now(UTC)
        event.status = "processed"
        event.processed_at = job.finished_at
        event.sync_job_id = job.id
        now = datetime.now(UTC).isoformat()
        integration.last_test_result = {**(integration.last_test_result or {}), "last_verified_event_at": now}
        integration.status = "connected"
        integration.status_detail = f"Last verified signed event at {now}"
        integration.last_sync_at = integration.last_successful_sync_at = job.finished_at
        return {"status": job.status, "event_id": event_id, "processed": True, "sync_job_id": str(job.id),
                "records": {"received": outcome.received, "inserted": outcome.inserted, "updated": outcome.updated,
                            "unchanged": outcome.unchanged, "rejected": outcome.rejected},
                "errors": outcome.error_counts}
