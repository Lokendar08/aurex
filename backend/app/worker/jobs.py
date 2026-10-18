"""Background job handlers (shared by the inline executor and Celery workers)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.session import session_scope
from app.models import Integration, SyncJob
from app.worker.dispatcher import enqueue, job_handler


@job_handler("sync_integration")
def handle_sync(db: Session, payload: dict[str, Any]) -> dict[str, Any]:
    from app.pipeline.runner import run_sync

    job = run_sync(db, uuid.UUID(payload["sync_job_id"]))
    return {"sync_job_id": str(job.id), "status": job.status, "inserted": job.records_inserted,
            "updated": job.records_updated, "unchanged": job.records_unchanged, "rejected": job.records_rejected}


@job_handler("train_forecasts")
def handle_train_forecasts(db: Session, payload: dict[str, Any]) -> dict[str, Any]:
    from app.services.forecasting.service import train_targets

    return train_targets(db, org_id=uuid.UUID(payload["org_id"]), company_id=uuid.UUID(payload["company_id"]),
                         targets=payload.get("targets"), user_id=uuid.UUID(payload["user_id"]) if payload.get("user_id") else None)


@job_handler("generate_report")
def handle_generate_report(db: Session, payload: dict[str, Any]) -> dict[str, Any]:
    from app.services.reports.service import build_report

    return build_report(db, uuid.UUID(payload["report_id"]))


@job_handler("run_recommendation_rules")
def handle_recommendation_rules(db: Session, payload: dict[str, Any]) -> dict[str, Any]:
    from app.services.recommendations import run_rules

    return run_rules(db, org_id=uuid.UUID(payload["org_id"]), company_id=uuid.UUID(payload["company_id"]),
                     user_id=uuid.UUID(payload["user_id"]) if payload.get("user_id") else None)


@job_handler("refresh_news")
def handle_refresh_news(db: Session, payload: dict[str, Any]) -> dict[str, Any]:
    from app.services.news import refresh_all_sources

    return refresh_all_sources(db)


def create_sync_job(db: Session, integration: Integration, *, trigger: str, user_id: uuid.UUID | None = None,
                    entity_types: list[str] | None = None, uploaded_file_id: uuid.UUID | None = None,
                    dispatch: bool = True) -> SyncJob:
    """Create a queued sync job. ``dispatch=False`` lets the caller run it synchronously (seed, CLI)."""
    job = SyncJob(org_id=integration.org_id, integration_id=integration.id, trigger=trigger,
                  entity_types=entity_types or [], created_by=user_id, uploaded_file_id=uploaded_file_id)
    db.add(job)
    db.flush()
    if dispatch:
        enqueue(db, "sync_integration", {"sync_job_id": str(job.id)}, org_id=integration.org_id, user_id=user_id)
    return job


def schedule_due_syncs() -> int:
    """Queue syncs for scheduled integrations whose interval elapsed (called by Celery beat)."""
    now = datetime.now(UTC)
    count = 0
    with session_scope() as db:
        rows = db.scalars(select(Integration).where(Integration.schedule_minutes.is_not(None),
                                                    Integration.status == "connected"))
        for integration in rows:
            due = integration.last_sync_at is None or integration.last_sync_at < now - timedelta(
                minutes=integration.schedule_minutes or 0)
            running = db.scalar(select(SyncJob.id).where(SyncJob.integration_id == integration.id,
                                                         SyncJob.status.in_(("queued", "running"))))
            if due and running is None:
                create_sync_job(db, integration, trigger="schedule")
                count += 1
    return count
