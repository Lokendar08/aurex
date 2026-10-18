"""Platform administration. Platform admins manage tenants and operations but CANNOT read tenant
business data: these endpoints expose metadata and operational health only (counts, statuses, timings)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, select, text

from app.api.deps import DbSession, PlatformAdmin
from app.core.config import get_settings
from app.core.errors import ConflictError, NotFoundError
from app.models import AuditEvent, BackgroundJob, Integration, Membership, Organization, SyncJob, User
from app.services.audit import record_audit
from app.services.auth import revoke_all_sessions

router = APIRouter(prefix="/platform", tags=["platform"])


@router.get("/overview")
def overview(admin: PlatformAdmin, db: DbSession) -> dict:
    since = datetime.now(UTC) - timedelta(days=1)
    jobs = dict(db.execute(select(SyncJob.status, func.count()).where(SyncJob.queued_at >= since)
                           .group_by(SyncJob.status)).all())
    bg = dict(db.execute(select(BackgroundJob.status, func.count()).where(BackgroundJob.created_at >= since)
                         .group_by(BackgroundJob.status)).all())
    db_size = db.execute(text("SELECT pg_database_size(current_database())")).scalar()
    return {
        "organizations": db.scalar(select(func.count()).select_from(Organization)),
        "users": db.scalar(select(func.count()).select_from(User)),
        "integrations": db.scalar(select(func.count()).select_from(Integration)),
        "integrations_by_status": dict(db.execute(select(Integration.status, func.count()).group_by(Integration.status)).all()),
        "sync_jobs_24h": jobs, "background_jobs_24h": bg, "database_bytes": db_size,
        "task_backend": get_settings().task_backend, "environment": get_settings().env,
        "data_access_note": "Platform administrators see tenant metadata only. Business data requires a membership "
                            "granted by the organization.",
    }


@router.get("/organizations")
def organizations(admin: PlatformAdmin, db: DbSession, limit: int = Query(default=100, ge=1, le=500)) -> dict:
    rows = db.scalars(select(Organization).order_by(Organization.created_at.desc()).limit(limit)).all()
    members = dict(db.execute(select(Membership.org_id, func.count()).group_by(Membership.org_id)).all())
    integrations = dict(db.execute(select(Integration.org_id, func.count()).group_by(Integration.org_id)).all())
    last_sync = dict(db.execute(select(Integration.org_id, func.max(Integration.last_successful_sync_at))
                                .group_by(Integration.org_id)).all())
    return {"organizations": [
        {"id": str(o.id), "name": o.name, "slug": o.slug, "status": o.status, "is_demo": o.is_demo,
         "created_at": o.created_at.isoformat() if o.created_at else None, "members": members.get(o.id, 0),
         "integrations": integrations.get(o.id, 0),
         "last_successful_sync_at": last_sync[o.id].isoformat() if last_sync.get(o.id) else None}
        for o in rows]}


class OrgStatusIn(BaseModel):
    status: str = Field(pattern="^(active|suspended)$")
    reason: str = Field(min_length=3, max_length=500)


@router.post("/organizations/{org_id}/status")
def set_org_status(org_id: uuid.UUID, body: OrgStatusIn, admin: PlatformAdmin, db: DbSession, request: Request) -> dict:
    org = db.get(Organization, org_id)
    if org is None:
        raise NotFoundError("Organization not found")
    org.status = body.status
    record_audit(db, action=f"platform.organization_{body.status}", org_id=None, actor=admin,
                 entity_type="organization", entity_id=org.id, request=request, details={"reason": body.reason})
    return {"id": str(org.id), "status": org.status}


@router.get("/users")
def users(admin: PlatformAdmin, db: DbSession, q: str | None = Query(default=None, max_length=120),
          limit: int = Query(default=100, ge=1, le=500)) -> dict:
    query = select(User)
    if q:
        query = query.where(User.email.ilike(f"%{q.lower()}%"))
    rows = db.scalars(query.order_by(User.created_at.desc()).limit(limit)).all()
    counts = dict(db.execute(select(Membership.user_id, func.count()).group_by(Membership.user_id)).all())
    return {"users": [{"id": str(u.id), "email": u.email, "full_name": u.full_name, "is_active": u.is_active,
                       "is_platform_admin": u.is_platform_admin, "is_demo": u.is_demo,
                       "memberships": counts.get(u.id, 0),
                       "locked_until": u.locked_until.isoformat() if u.locked_until else None,
                       "last_login_at": u.last_login_at.isoformat() if u.last_login_at else None} for u in rows]}


class UserStatusIn(BaseModel):
    is_active: bool
    reason: str = Field(min_length=3, max_length=500)


@router.post("/users/{user_id}/status")
def set_user_status(user_id: uuid.UUID, body: UserStatusIn, admin: PlatformAdmin, db: DbSession, request: Request) -> dict:
    user = db.get(User, user_id)
    if user is None:
        raise NotFoundError("User not found")
    if user.id == admin.id and not body.is_active:
        raise ConflictError("You cannot deactivate your own account", code="self_deactivation")
    user.is_active = body.is_active
    if not body.is_active:
        revoke_all_sessions(db, user.id, "deactivated_by_platform_admin")
    else:
        user.locked_until = None
        user.failed_login_count = 0
    record_audit(db, action="platform.user_status_changed", actor=admin, entity_type="user", entity_id=user.id,
                 request=request, details={"is_active": body.is_active, "reason": body.reason})
    return {"id": str(user.id), "is_active": user.is_active}


@router.get("/jobs")
def jobs(admin: PlatformAdmin, db: DbSession, status: str | None = Query(default=None, max_length=20),
         limit: int = Query(default=50, ge=1, le=200)) -> dict:
    query = select(BackgroundJob)
    if status:
        query = query.where(BackgroundJob.status == status)
    rows = db.scalars(query.order_by(BackgroundJob.created_at.desc()).limit(limit)).all()
    return {"jobs": [{"id": str(j.id), "org_id": str(j.org_id) if j.org_id else None, "job_type": j.job_type,
                      "status": j.status, "attempts": j.attempts, "error": j.error,
                      "created_at": j.created_at.isoformat(), "finished_at": j.finished_at.isoformat()
                      if j.finished_at else None} for j in rows]}


@router.get("/audit-events")
def platform_audit(admin: PlatformAdmin, db: DbSession, limit: int = Query(default=100, ge=1, le=500)) -> dict:
    rows = db.scalars(select(AuditEvent).where(AuditEvent.org_id.is_(None))
                      .order_by(AuditEvent.created_at.desc()).limit(limit)).all()
    return {"events": [{"id": e.id, "action": e.action, "actor": e.actor_label, "entity_type": e.entity_type,
                        "entity_id": e.entity_id, "outcome": e.outcome, "created_at": e.created_at.isoformat(),
                        "details": e.details} for e in rows]}


# ---------------------------------------------------------------------------------------------
# Market data (listed securities are shared reference data, so refreshing them is a platform task)
# ---------------------------------------------------------------------------------------------


class MarketRefreshIn(BaseModel):
    # "EXCHANGE:TICKER" -> provider symbol, e.g. {"NSE:DMART": "DMART.BSE"}; tickers are never guessed.
    symbols: dict[str, str] = Field(min_length=1, max_length=100)


@router.get("/market-data")
def market_data_status(admin: PlatformAdmin, db: DbSession) -> dict:
    from app.models import ListedSecurity
    from app.services import market_data

    securities = db.scalars(select(ListedSecurity).order_by(ListedSecurity.exchange, ListedSecurity.ticker)).all()
    return {**market_data.status(),
            "securities": [{"key": f"{s.exchange}:{s.ticker}", "currency": s.currency,
                            "verification_status": s.verification_status} for s in securities]}


@router.post("/market-data/refresh")
def market_data_refresh(body: MarketRefreshIn, admin: PlatformAdmin, db: DbSession, request: Request) -> dict:
    from app.services import market_data

    result = market_data.refresh_prices(db, body.symbols)
    record_audit(db, action="platform.market_data_refreshed", actor=admin, request=request,
                 details={"symbols": sorted(body.symbols), "stored": result["stored"],
                          "errors": len(result["errors"])})
    return result
