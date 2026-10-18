"""AI Business Advisor endpoints."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.api.deps import DbSession, OrgContext, require
from app.core.config import get_settings
from app.core.errors import NotFoundError
from app.core.permissions import Permission
from app.models import AdvisorConversation, AdvisorMessage
from app.services.advisor import service
from app.services.advisor.tools import available_tools

router = APIRouter(tags=["advisor"])
P = Permission

EXAMPLES = ["Why did revenue decline?", "Which stores contribute most to profit?",
            "What happens if we hire ten additional employees?", "Which products face stockout risks?",
            "What could happen if prices increase by 5%?", "Which business scenario has the best risk-adjusted outcome?"]


class AskIn(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    conversation_id: uuid.UUID | None = None


@router.get("/orgs/{org_id}/advisor/capabilities")
def capabilities(ctx: Annotated[OrgContext, Depends(require(P.ADVISOR_USE))]) -> dict:
    return {"mode": service.mode(), "model": get_settings().advisor_model if service.mode() == "llm" else None,
            "examples": EXAMPLES,
            "tools": [{"name": t.name, "description": t.description} for t in available_tools(ctx)],
            "guarantees": ["Numbers come only from validated AUREX calculations (tool calls), never from the model.",
                           "Every figure is checked against tool outputs; untraceable figures are flagged.",
                           "Tools run with your permissions and store scope.",
                           "Answers list evidence, assumptions, limitations and confidence."]}


@router.post("/orgs/{org_id}/advisor/ask")
def ask(body: AskIn, ctx: Annotated[OrgContext, Depends(require(P.ADVISOR_USE))], db: DbSession) -> dict:
    return service.ask(db, ctx, body.question, body.conversation_id)


@router.get("/orgs/{org_id}/advisor/conversations")
def conversations(ctx: Annotated[OrgContext, Depends(require(P.ADVISOR_USE))], db: DbSession) -> dict:
    rows = db.scalars(select(AdvisorConversation).where(AdvisorConversation.org_id == ctx.org_id,
                                                        AdvisorConversation.user_id == ctx.user.id)
                      .order_by(AdvisorConversation.updated_at.desc()).limit(50)).all()
    return {"conversations": [{"id": str(c.id), "title": c.title, "updated_at": c.updated_at.isoformat()} for c in rows]}


@router.get("/orgs/{org_id}/advisor/conversations/{conversation_id}")
def conversation(conversation_id: uuid.UUID, ctx: Annotated[OrgContext, Depends(require(P.ADVISOR_USE))],
                 db: DbSession) -> dict:
    conv = db.scalar(select(AdvisorConversation).where(AdvisorConversation.id == conversation_id,
                                                       AdvisorConversation.org_id == ctx.org_id,
                                                       AdvisorConversation.user_id == ctx.user.id))
    if conv is None:
        raise NotFoundError("Conversation not found")
    messages = db.scalars(select(AdvisorMessage).where(AdvisorMessage.conversation_id == conv.id)
                          .order_by(AdvisorMessage.id)).all()
    return {"id": str(conv.id), "title": conv.title, "messages": [service.message_out(m) for m in messages]}


@router.delete("/orgs/{org_id}/advisor/conversations/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_conversation(conversation_id: uuid.UUID, ctx: Annotated[OrgContext, Depends(require(P.ADVISOR_USE))],
                        db: DbSession) -> Response:
    conv = db.scalar(select(AdvisorConversation).where(AdvisorConversation.id == conversation_id,
                                                       AdvisorConversation.org_id == ctx.org_id,
                                                       AdvisorConversation.user_id == ctx.user.id))
    if conv is None:
        raise NotFoundError("Conversation not found")
    db.delete(conv)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
