"""Recommendations, approvals, tasks, notifications and outcome tracking."""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, select, update

from app.api.deps import DbSession, OrgContext, OrgCtx, require
from app.core.errors import NotFoundError, PermissionDeniedError, ValidationAppError
from app.core.permissions import Permission
from app.models import (
    Approval,
    AuditEvent,
    Notification,
    Recommendation,
    RecommendationOutcome,
    Task,
    User,
)
from app.services import recommendations as recs
from app.services.audit import record_audit
from app.services.simulation.access import get_visible_scenario, hidden_items, redact_assumption_texts

router = APIRouter(tags=["workflows"])
P = Permission


def _impact_for(ctx: OrgContext, impact: dict[str, Any] | None) -> dict[str, Any] | None:
    """Monthly baseline/scenario P&L levels are absolute financials: members without finance:read get the changes."""
    if not impact or ctx.has(P.FINANCE_READ):
        return impact
    return {k: v for k, v in impact.items() if k not in ("baseline_monthly", "scenario_monthly")}


def rec_out(r: Recommendation, codes: dict[uuid.UUID, str] | None = None, *, ctx: OrgContext) -> dict[str, Any]:
    return {"id": str(r.id), "title": r.title, "summary": r.summary, "category": r.category, "source": r.source,
            "source_ref": r.source_ref, "status": r.status, "priority": r.priority, "confidence": r.confidence,
            "company_id": str(r.company_id) if r.company_id else None,
            "store_id": str(r.store_id) if r.store_id else None, "store_code": (codes or {}).get(r.store_id),
            "evidence": r.evidence, "assumptions": redact_assumption_texts(r.assumptions, hidden_items(ctx)),
            "predicted_impact": _impact_for(ctx, r.predicted_impact),
            "created_by": str(r.created_by) if r.created_by else None,
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "decided_at": r.decided_at.isoformat() if r.decided_at else None,
            "implemented_at": r.implemented_at.isoformat() if r.implemented_at else None,
            "measurement_start": r.measurement_start.isoformat() if r.measurement_start else None,
            "measurement_end": r.measurement_end.isoformat() if r.measurement_end else None}


def _get(db: DbSession, ctx: OrgContext, rec_id: uuid.UUID) -> Recommendation:
    rec = ctx.scoped_get(db, Recommendation, rec_id, "Recommendation")
    if not recs.visible_to(ctx, rec):
        raise NotFoundError("Recommendation not found")
    return rec


@router.get("/orgs/{org_id}/recommendations")
def list_recommendations(ctx: Annotated[OrgContext, Depends(require(P.RECOMMENDATIONS_READ))], db: DbSession,
                         status: str | None = Query(default=None, max_length=20),
                         category: str | None = Query(default=None, max_length=40)) -> dict:
    visible = [r for r in db.scalars(select(Recommendation).where(Recommendation.org_id == ctx.org_id)
                                     .order_by(Recommendation.created_at.desc())).all() if recs.visible_to(ctx, r)]
    counts: dict[str, int] = {}
    for r in visible:  # counts cover exactly what this member may see
        counts[r.status] = counts.get(r.status, 0) + 1
    rows = [r for r in visible if (not status or r.status == status) and (not category or r.category == category)][:200]
    codes = recs.store_codes(db, [r.store_id for r in rows if r.store_id])
    return {"recommendations": [rec_out(r, codes, ctx=ctx) for r in rows], "counts": counts}


class RecommendationIn(BaseModel):
    title: str = Field(min_length=5, max_length=300)
    summary: str = Field(min_length=5, max_length=4000)
    category: str = Field(default="general", max_length=40)
    priority: str = Field(default="medium", pattern="^(low|medium|high|critical)$")
    store_id: uuid.UUID | None = None
    company_id: uuid.UUID | None = None
    evidence: list[dict] = Field(default_factory=list, max_length=20)
    assumptions: list[str] = Field(default_factory=list, max_length=20)
    predicted_impact: dict = Field(default_factory=dict)


@router.post("/orgs/{org_id}/recommendations", status_code=201)
def create_recommendation(body: RecommendationIn, ctx: Annotated[OrgContext, Depends(require(P.RECOMMENDATIONS_WRITE))],
                          db: DbSession, request: Request) -> dict:
    company = ctx.default_company(db, body.company_id)
    if body.store_id:
        ctx.get_store(db, body.store_id)
    elif ctx.store_scope is not None:
        raise PermissionDeniedError("Store-scoped members must attach recommendations to one of their stores")
    rec = Recommendation(org_id=ctx.org_id, company_id=company.id, store_id=body.store_id, title=body.title,
                         summary=body.summary, category=body.category, source="manual", priority=body.priority,
                         evidence=body.evidence, assumptions=body.assumptions, predicted_impact=body.predicted_impact,
                         confidence="low", created_by=ctx.user.id)
    db.add(rec)
    db.flush()
    record_audit(db, action="recommendation.created", org_id=ctx.org_id, actor=ctx.user, entity_type="recommendation",
                 entity_id=rec.id, request=request)
    return rec_out(rec, ctx=ctx)


@router.post("/orgs/{org_id}/recommendations/generate")
def generate(ctx: Annotated[OrgContext, Depends(require(P.RECOMMENDATIONS_WRITE))], db: DbSession, request: Request,
             company_id: uuid.UUID | None = None) -> dict:
    if ctx.store_scope is not None:
        raise PermissionDeniedError("Company-wide rule runs need company-wide access")
    company = ctx.default_company(db, company_id)
    result = recs.run_rules(db, org_id=ctx.org_id, company_id=company.id, user_id=ctx.user.id)
    record_audit(db, action="recommendation.rules_run", org_id=ctx.org_id, actor=ctx.user, entity_type="company",
                 entity_id=company.id, request=request, details=result)
    return result


class FromScenarioIn(BaseModel):
    title: str | None = Field(default=None, max_length=300)
    summary: str | None = Field(default=None, max_length=4000)


@router.post("/orgs/{org_id}/scenarios/{scenario_id}/recommendation", status_code=201)
def from_scenario(scenario_id: uuid.UUID, body: FromScenarioIn,
                  ctx: Annotated[OrgContext, Depends(require(P.RECOMMENDATIONS_WRITE, P.SCENARIOS_READ))],
                  db: DbSession) -> dict:
    scenario = get_visible_scenario(db, ctx, scenario_id)
    return rec_out(recs.from_scenario(db, ctx, scenario, body.title, body.summary), ctx=ctx)


@router.get("/orgs/{org_id}/recommendations/{rec_id}")
def get_recommendation(rec_id: uuid.UUID, ctx: Annotated[OrgContext, Depends(require(P.RECOMMENDATIONS_READ))],
                       db: DbSession) -> dict:
    rec = _get(db, ctx, rec_id)
    approvals = db.execute(select(Approval, User.full_name).outerjoin(User, User.id == Approval.approver_user_id)
                           .where(Approval.recommendation_id == rec.id)).all()
    tasks = db.scalars(select(Task).where(Task.recommendation_id == rec.id)).all()
    outcomes = db.scalars(select(RecommendationOutcome).where(RecommendationOutcome.recommendation_id == rec.id)
                          .order_by(RecommendationOutcome.measured_at.desc())).all()
    history = db.scalars(select(AuditEvent).where(AuditEvent.org_id == ctx.org_id, AuditEvent.entity_type == "recommendation",
                                                  AuditEvent.entity_id == str(rec.id)).order_by(AuditEvent.created_at)).all()
    return {**rec_out(rec, recs.store_codes(db, [rec.store_id] if rec.store_id else []), ctx=ctx),
            "approvals": [{"id": str(a.id), "approver": name, "status": a.status, "note": a.note,
                           "requested_at": a.requested_at.isoformat(),
                           "decided_at": a.decided_at.isoformat() if a.decided_at else None} for a, name in approvals],
            "tasks": [task_out(t) for t in tasks], "outcomes": [recs.outcome_out(o) for o in outcomes],
            "history": [{"action": e.action, "actor": e.actor_label, "at": e.created_at.isoformat(), "details": e.details}
                        for e in history],
            "can_approve": ctx.has(P.RECOMMENDATIONS_APPROVE) and rec.created_by != ctx.user.id}


class NoteIn(BaseModel):
    note: str | None = Field(default=None, max_length=2000)


class DecisionIn(NoteIn):
    approve: bool


class ImplementedIn(BaseModel):
    implemented_on: date
    measurement_days: int = Field(default=90, ge=7, le=730)


@router.post("/orgs/{org_id}/recommendations/{rec_id}/submit")
def submit(rec_id: uuid.UUID, body: NoteIn, ctx: Annotated[OrgContext, Depends(require(P.RECOMMENDATIONS_WRITE))],
           db: DbSession) -> dict:
    return rec_out(recs.submit(db, ctx, _get(db, ctx, rec_id), body.note), ctx=ctx)


@router.post("/orgs/{org_id}/recommendations/{rec_id}/decision")
def decision(rec_id: uuid.UUID, body: DecisionIn, ctx: Annotated[OrgContext, Depends(require(P.RECOMMENDATIONS_APPROVE))],
             db: DbSession) -> dict:
    return rec_out(recs.decide(db, ctx, _get(db, ctx, rec_id), body.approve, body.note), ctx=ctx)


@router.post("/orgs/{org_id}/recommendations/{rec_id}/start")
def start(rec_id: uuid.UUID, ctx: Annotated[OrgContext, Depends(require(P.RECOMMENDATIONS_WRITE))], db: DbSession) -> dict:
    return rec_out(recs.start(db, ctx, _get(db, ctx, rec_id)), ctx=ctx)


@router.post("/orgs/{org_id}/recommendations/{rec_id}/implemented")
def implemented(rec_id: uuid.UUID, body: ImplementedIn,
                ctx: Annotated[OrgContext, Depends(require(P.RECOMMENDATIONS_WRITE))], db: DbSession) -> dict:
    return rec_out(recs.implemented(db, ctx, _get(db, ctx, rec_id), body.implemented_on, body.measurement_days), ctx=ctx)


@router.post("/orgs/{org_id}/recommendations/{rec_id}/measure")
def measure(rec_id: uuid.UUID, ctx: Annotated[OrgContext, Depends(require(P.RECOMMENDATIONS_WRITE))], db: DbSession) -> dict:
    return recs.measure(db, ctx, _get(db, ctx, rec_id))


@router.post("/orgs/{org_id}/recommendations/{rec_id}/dismiss")
def dismiss(rec_id: uuid.UUID, body: NoteIn, ctx: Annotated[OrgContext, Depends(require(P.RECOMMENDATIONS_WRITE))],
            db: DbSession, request: Request) -> dict:
    rec = _get(db, ctx, rec_id)
    recs._transition(rec, "dismiss")
    record_audit(db, action="recommendation.dismissed", org_id=ctx.org_id, actor=ctx.user, entity_type="recommendation",
                 entity_id=rec.id, request=request, details={"note": body.note})
    return rec_out(rec, ctx=ctx)


# ---------------------------------------------------------------------------------------------
# Tasks
# ---------------------------------------------------------------------------------------------


def task_out(t: Task) -> dict[str, Any]:
    return {"id": str(t.id), "title": t.title, "description": t.description, "status": t.status, "priority": t.priority,
            "assignee_id": str(t.assignee_id) if t.assignee_id else None,
            "recommendation_id": str(t.recommendation_id) if t.recommendation_id else None,
            "store_id": str(t.store_id) if t.store_id else None, "due_date": t.due_date.isoformat() if t.due_date else None,
            "created_at": t.created_at.isoformat() if t.created_at else None,
            "completed_at": t.completed_at.isoformat() if t.completed_at else None}


class TaskIn(BaseModel):
    title: str = Field(min_length=3, max_length=300)
    description: str | None = Field(default=None, max_length=4000)
    assignee_id: uuid.UUID | None = None
    recommendation_id: uuid.UUID | None = None
    due_date: date | None = None
    priority: str = Field(default="medium", pattern="^(low|medium|high|critical)$")


class TaskUpdateIn(BaseModel):
    status: str | None = Field(default=None, pattern="^(open|in_progress|done|cancelled)$")
    title: str | None = Field(default=None, min_length=3, max_length=300)
    assignee_id: uuid.UUID | None = None
    due_date: date | None = None


@router.get("/orgs/{org_id}/tasks")
def list_tasks(ctx: OrgCtx, db: DbSession, mine: bool = True, status: str | None = Query(default=None, max_length=20)) -> dict:
    query = select(Task).where(Task.org_id == ctx.org_id)
    if mine or not ctx.has(P.TASKS_READ):
        query = query.where(Task.assignee_id == ctx.user.id)
    if status:
        query = query.where(Task.status == status)
    return {"tasks": [task_out(t) for t in db.scalars(query.order_by(Task.due_date.nulls_last(), Task.created_at)).all()]}


@router.post("/orgs/{org_id}/tasks", status_code=201)
def create_task(body: TaskIn, ctx: Annotated[OrgContext, Depends(require(P.TASKS_MANAGE))], db: DbSession) -> dict:
    rec = _get(db, ctx, body.recommendation_id) if body.recommendation_id else None
    return task_out(recs.task_for(db, ctx, rec, body.title, body.assignee_id, body.due_date, body.description,
                                  body.priority))


@router.patch("/orgs/{org_id}/tasks/{task_id}")
def update_task(task_id: uuid.UUID, body: TaskUpdateIn, ctx: OrgCtx, db: DbSession, request: Request) -> dict:
    task = ctx.scoped_get(db, Task, task_id, "Task")
    is_assignee = task.assignee_id == ctx.user.id
    if not (is_assignee or ctx.has(P.TASKS_MANAGE)):
        raise PermissionDeniedError("Only the assignee or a task manager can update this task")
    if (body.title or body.assignee_id or body.due_date) and not ctx.has(P.TASKS_MANAGE):
        raise PermissionDeniedError("Only task managers can edit task details")
    if body.status:
        task.status = body.status
        task.completed_at = datetime.now(UTC) if body.status == "done" else None
    if body.title:
        task.title = body.title
    if body.due_date:
        task.due_date = body.due_date
    if body.assignee_id:
        from app.models import Membership

        if db.scalar(select(Membership.id).where(Membership.org_id == ctx.org_id, Membership.user_id == body.assignee_id)) is None:
            raise ValidationAppError("The assignee is not a member of this organization")
        task.assignee_id = body.assignee_id
        recs.notify(db, ctx.org_id, body.assignee_id, "task_assigned", f"Task assigned: {task.title}", None, "/app/my-work")
    record_audit(db, action="task.updated", org_id=ctx.org_id, actor=ctx.user, entity_type="task", entity_id=task.id,
                 request=request, details=body.model_dump(exclude_none=True, mode="json"))
    return task_out(task)


# ---------------------------------------------------------------------------------------------
# Notifications & my work
# ---------------------------------------------------------------------------------------------


@router.get("/orgs/{org_id}/notifications")
def notifications(ctx: OrgCtx, db: DbSession, unread_only: bool = False, limit: int = Query(default=50, ge=1, le=200)) -> dict:
    query = select(Notification).where(Notification.org_id == ctx.org_id, Notification.user_id == ctx.user.id)
    if unread_only:
        query = query.where(Notification.read_at.is_(None))
    rows = db.scalars(query.order_by(Notification.created_at.desc()).limit(limit)).all()
    unread = db.scalar(select(func.count()).select_from(Notification).where(
        Notification.org_id == ctx.org_id, Notification.user_id == ctx.user.id, Notification.read_at.is_(None)))
    return {"unread": unread, "notifications": [{"id": n.id, "kind": n.kind, "title": n.title, "body": n.body,
                                                 "link": n.link, "read": n.read_at is not None,
                                                 "created_at": n.created_at.isoformat()} for n in rows]}


@router.post("/orgs/{org_id}/notifications/{notification_id}/read")
def mark_read(notification_id: int, ctx: OrgCtx, db: DbSession) -> dict:
    n = db.scalar(select(Notification).where(Notification.id == notification_id, Notification.org_id == ctx.org_id,
                                             Notification.user_id == ctx.user.id))
    if n is None:
        raise NotFoundError("Notification not found")
    n.read_at = datetime.now(UTC)
    return {"id": n.id, "read": True}


@router.post("/orgs/{org_id}/notifications/read-all")
def mark_all_read(ctx: OrgCtx, db: DbSession) -> dict:
    result = db.execute(update(Notification).where(Notification.org_id == ctx.org_id, Notification.user_id == ctx.user.id,
                                                   Notification.read_at.is_(None)).values(read_at=datetime.now(UTC)))
    return {"marked": result.rowcount or 0}


@router.get("/orgs/{org_id}/workflows/my-work")
def my_work(ctx: OrgCtx, db: DbSession) -> dict:
    tasks = db.scalars(select(Task).where(Task.org_id == ctx.org_id, Task.assignee_id == ctx.user.id,
                                          Task.status.in_(("open", "in_progress"))).order_by(Task.due_date.nulls_last())).all()
    pending = db.execute(select(Approval, Recommendation).join(Recommendation, Recommendation.id == Approval.recommendation_id)
                         .where(Approval.org_id == ctx.org_id, Approval.approver_user_id == ctx.user.id,
                                Approval.status == "pending")).all()
    unread = db.scalars(select(Notification).where(Notification.org_id == ctx.org_id, Notification.user_id == ctx.user.id,
                                                   Notification.read_at.is_(None))
                        .order_by(Notification.created_at.desc()).limit(10)).all()
    mine = db.scalars(select(Recommendation).where(Recommendation.org_id == ctx.org_id,
                                                   Recommendation.created_by == ctx.user.id,
                                                   Recommendation.status.in_(recs.OPEN_STATUSES))).all()
    return {"tasks": [task_out(t) for t in tasks],
            "approvals_pending": [{"approval_id": str(a.id), "recommendation": rec_out(r, ctx=ctx)} for a, r in pending],
            "my_open_recommendations": [rec_out(r, ctx=ctx) for r in mine],
            "notifications": [{"id": n.id, "kind": n.kind, "title": n.title, "link": n.link,
                               "created_at": n.created_at.isoformat()} for n in unread]}
