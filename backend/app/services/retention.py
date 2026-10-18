"""Data retention: purge operational records older than the configured windows.

Business facts are never purged automatically (they belong to the customer). Purged classes:
audit events, sync error excerpts (which may contain raw source values), read notifications and
generated report files. Windows are configured with AUREX_RETENTION_*_DAYS (0 disables a class).
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import AuditEvent, Notification, Report, SyncError


def purge_expired(db: Session, now: datetime | None = None) -> dict[str, int]:
    settings = get_settings()
    now = now or datetime.now(UTC)
    result: dict[str, int] = {}
    if settings.retention_audit_days > 0:
        cutoff = now - timedelta(days=settings.retention_audit_days)
        result["audit_events"] = db.execute(delete(AuditEvent).where(AuditEvent.created_at < cutoff)).rowcount or 0
    if settings.retention_sync_error_days > 0:
        cutoff = now - timedelta(days=settings.retention_sync_error_days)
        result["sync_errors"] = db.execute(delete(SyncError).where(SyncError.created_at < cutoff)).rowcount or 0
    if settings.retention_notification_days > 0:
        cutoff = now - timedelta(days=settings.retention_notification_days)
        result["notifications"] = db.execute(delete(Notification).where(
            Notification.created_at < cutoff, Notification.read_at.is_not(None))).rowcount or 0
    if settings.retention_report_days > 0:
        cutoff = now - timedelta(days=settings.retention_report_days)
        old = db.scalars(select(Report).where(Report.created_at < cutoff)).all()
        for report in old:
            if report.file_path:
                Path(report.file_path).unlink(missing_ok=True)
            db.delete(report)
        result["reports"] = len(old)
    return result
