"""Audit trail helpers. Details are redacted before storage; audit rows are append-only."""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import Request
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.logging import redact_value
from app.models import AuditEvent, User


def client_ip(request: Request | None) -> str | None:
    """Client address for audit and rate limiting.

    X-Forwarded-For is honoured only for the configured number of trusted proxy hops (taking the entry the
    outermost trusted proxy wrote); otherwise a client could send any value and evade per-IP limits.
    """
    if request is None:
        return None
    hops = get_settings().trusted_proxy_hops
    if hops:
        forwarded = [part.strip() for part in (request.headers.get("x-forwarded-for") or "").split(",") if part.strip()]
        if len(forwarded) >= hops:
            return forwarded[-hops][:64]
    return request.client.host[:64] if request.client else None


def record_audit(
    db: Session,
    *,
    action: str,
    org_id: uuid.UUID | None = None,
    actor: User | None = None,
    actor_label: str | None = None,
    entity_type: str | None = None,
    entity_id: Any = None,
    details: dict[str, Any] | None = None,
    outcome: str = "success",
    request: Request | None = None,
    summary: str | None = None,
) -> AuditEvent:
    event = AuditEvent(
        org_id=org_id,
        actor_user_id=actor.id if actor else None,
        actor_label=actor.email if actor else actor_label,
        action=action,
        entity_type=entity_type,
        entity_id=str(entity_id) if entity_id is not None else None,
        outcome=outcome,
        ip_address=client_ip(request),
        user_agent=(request.headers.get("user-agent", "")[:400] if request else None),
        request_id=getattr(request.state, "request_id", None) if request else None,
        details=redact_value(details or {}),  # type: ignore[arg-type]
        summary=summary,
    )
    db.add(event)
    return event
