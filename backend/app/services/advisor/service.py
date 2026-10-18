"""Advisor orchestration: mode selection, conversation persistence, verification and audit."""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import OrgContext
from app.core.config import get_settings
from app.core.errors import NotFoundError, ValidationAppError
from app.core.ratelimit import rate_limiter
from app.models import AdvisorConversation, AdvisorMessage
from app.services.advisor import deterministic, llm, verify
from app.services.analytics.base import data_bounds
from app.services.audit import record_audit

logger = logging.getLogger("aurex.advisor")
MAX_QUESTION_CHARS = 2000


def mode() -> str:
    return "llm" if get_settings().anthropic_api_key else "deterministic"


def _history(db: Session, conversation: AdvisorConversation) -> list[dict[str, str]]:
    rows = db.scalars(select(AdvisorMessage).where(AdvisorMessage.conversation_id == conversation.id)
                      .order_by(AdvisorMessage.id)).all()
    return [{"role": r.role, "content": r.content} for r in rows]


def ask(db: Session, ctx: OrgContext, question: str, conversation_id: uuid.UUID | None = None) -> dict[str, Any]:
    question = (question or "").strip()
    if not question:
        raise ValidationAppError("Ask a question")
    if len(question) > MAX_QUESTION_CHARS:
        raise ValidationAppError(f"Questions are limited to {MAX_QUESTION_CHARS} characters")
    rate_limiter.check("advisor", str(ctx.user.id), get_settings().rate_limit_advisor_per_minute)
    if conversation_id:
        conversation = db.scalar(select(AdvisorConversation).where(
            AdvisorConversation.id == conversation_id, AdvisorConversation.org_id == ctx.org_id,
            AdvisorConversation.user_id == ctx.user.id))
        if conversation is None:
            raise NotFoundError("Conversation not found")
    else:
        conversation = AdvisorConversation(org_id=ctx.org_id, user_id=ctx.user.id, title=question[:120],
                                           company_id=ctx.default_company(db).id)
        db.add(conversation)
        db.flush()
    history = _history(db, conversation)
    company = ctx.default_company(db)
    _, data_end = data_bounds(db, company.id)
    used_mode = mode()
    notice = None
    usage: dict[str, Any] = {}
    if used_mode == "llm":
        try:
            result, calls, usage = llm.answer(db, ctx, question, history, data_end.isoformat() if data_end else None)
        except llm.AdvisorUnavailable as exc:
            logger.warning("Advisor LLM unavailable (%s); using deterministic mode", exc)
            result, calls = deterministic.answer(db, ctx, question)
            used_mode, notice = "deterministic", "The language model was unavailable, so deterministic analysis was used."
    else:
        result, calls = deterministic.answer(db, ctx, question)
        notice = ("Deterministic analysis mode: no language model is configured, so questions are matched to validated "
                  "analyses. Configure AUREX_ANTHROPIC_API_KEY for free-form questions.")
    # Numbers may legitimately come from tool outputs or from the inputs the tools were called with
    # (e.g. the "5%" of a price question).
    result = verify.verify(result, [c.output for c in calls if c.output is not None] + [c.input for c in calls])
    result["mode"] = used_mode
    result["notice"] = notice
    result["model"] = (usage.get("model") or get_settings().advisor_model) if used_mode == "llm" else None
    result["data_end"] = data_end.isoformat() if data_end else None
    result["is_synthetic"] = company.is_synthetic
    db.add(AdvisorMessage(org_id=ctx.org_id, conversation_id=conversation.id, role="user", content=question))
    message = AdvisorMessage(org_id=ctx.org_id, conversation_id=conversation.id, role="assistant",
                             content=result.get("answer", ""), answer=result,
                             tool_calls=[c.record() for c in calls], mode=used_mode)
    db.add(message)
    conversation.updated_at = datetime.now(UTC)
    record_audit(db, action="advisor.question", org_id=ctx.org_id, actor=ctx.user, entity_type="advisor_conversation",
                 entity_id=conversation.id, request=ctx.request,
                 details={"mode": used_mode, "tools": [c.name for c in calls],
                          "denied": [c.name for c in calls if c.status == "denied"], "usage": usage,
                          "question_chars": len(question)})
    db.flush()
    return {"conversation_id": str(conversation.id), "message": message_out(message)}


def message_out(m: AdvisorMessage) -> dict[str, Any]:
    return {"id": m.id, "role": m.role, "content": m.content, "answer": m.answer, "mode": m.mode,
            "tool_calls": m.tool_calls, "created_at": m.created_at.isoformat() if m.created_at else None}
