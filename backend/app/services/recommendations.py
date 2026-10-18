"""Recommendations: generation (rules, scenarios), approval workflow and predicted-vs-actual tracking.

Lifecycle: proposed -> pending_approval -> approved | rejected -> in_progress -> implemented -> measured
(dismissed from proposed/pending). Every transition is audited; approvers must hold
``recommendations:approve`` and may not approve their own recommendation (separation of duties).
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import OrgContext
from app.core.errors import ConflictError, PermissionDeniedError, ValidationAppError
from app.core.permissions import Permission, permissions_for
from app.models import (
    Approval,
    Company,
    Membership,
    Notification,
    Recommendation,
    RecommendationOutcome,
    RecommendationRuleRun,
    Scenario,
    ScenarioRun,
    Store,
    Task,
)
from app.services import metrics as m
from app.services.advisor.formatting import money, pct
from app.services.analytics import operations as ops
from app.services.analytics.base import Scope, data_bounds
from app.services.analytics.pnl import compute_pnl
from app.services.audit import record_audit

P = Permission
OPEN_STATUSES = ("proposed", "pending_approval", "approved", "in_progress")
TRANSITIONS = {
    "submit": ({"proposed"}, "pending_approval"),
    "approve": ({"pending_approval"}, "approved"),
    "reject": ({"pending_approval"}, "rejected"),
    "start": ({"approved"}, "in_progress"),
    "implemented": ({"approved", "in_progress"}, "implemented"),
    "measured": ({"implemented"}, "measured"),
    "dismiss": ({"proposed", "pending_approval"}, "dismissed"),
}


def notify(db: Session, org_id: uuid.UUID, user_id: uuid.UUID, kind: str, title: str, body: str | None = None,
           link: str | None = None) -> None:
    db.add(Notification(org_id=org_id, user_id=user_id, kind=kind, title=title[:300], body=body, link=link))


def _transition(rec: Recommendation, action: str) -> None:
    allowed, target = TRANSITIONS[action]
    if rec.status not in allowed:
        raise ConflictError(f"Cannot {action} a recommendation that is {rec.status}",
                            details={"status": rec.status, "allowed_from": sorted(allowed)})
    rec.status = target


def _exists(db: Session, org_id: uuid.UUID, key: str) -> bool:
    return db.scalar(select(Recommendation.id).where(Recommendation.org_id == org_id, Recommendation.dedupe_key == key,
                                                     Recommendation.status.in_(OPEN_STATUSES))) is not None


# ---------------------------------------------------------------------------------------------
# Rule engine
# ---------------------------------------------------------------------------------------------


def run_rules(db: Session, *, org_id: uuid.UUID, company_id: uuid.UUID, user_id: uuid.UUID | None = None) -> dict[str, Any]:
    company = db.get(Company, company_id)
    if company is None or company.org_id != org_id:
        raise ValidationAppError("Company not found")
    scope = Scope(org_id=org_id, company=company)
    _, data_end = data_bounds(db, company.id)
    if data_end is None:
        return {"created": 0, "skipped": 0, "note": "No data"}
    cur = company.base_currency
    created, skipped = [], 0

    def propose(key: str, **fields: Any) -> None:
        nonlocal skipped
        if _exists(db, org_id, key):
            skipped += 1
            return
        rec = Recommendation(org_id=org_id, company_id=company.id, source="rule_engine", dedupe_key=key,
                             created_by=user_id, **fields)
        db.add(rec)
        db.flush()
        created.append(rec)

    risks = ops.stockout_and_overstock(db, scope, data_end, limit=30)
    urgent = [r for r in risks.get("stockout_risks", []) if r["risk"] in ("stocked_out", "high")]
    if urgent:
        propose(f"stockout:{company.id}:{data_end.isoformat()}", category="inventory", priority="high",
                title=f"Expedite replenishment for {len(urgent)} product-store positions at risk of stockout",
                summary="Stock on hand plus open orders will not cover demand until the next delivery arrives.",
                evidence=[{"type": "inventory_risk", "as_of": data_end.isoformat(),
                           "items": [{k: r[k] for k in ("store_code", "sku", "product", "days_of_cover", "lead_time_days",
                                                        "risk")} for r in urgent[:15]], "method": risks["method"]}],
                predicted_impact={"metric": "stockout_positions", "baseline_value": len(urgent), "predicted_value": 0,
                                  "direction": "down"}, confidence="medium",
                assumptions=["Demand continues at the last 28 days' average.", "Suppliers can deliver within lead time."])
    over_value = risks.get("overstock_value_total") or 0
    if over_value > 0 and risks.get("overstock"):
        top = risks["overstock"][:10]
        propose(f"overstock:{company.id}:{data_end.strftime('%Y-%m')}", category="inventory", priority="medium",
                title=f"Release {money(over_value, cur)} of excess inventory (reduce orders / targeted markdowns)",
                summary="Inventory cover exceeds twice the target for these items; capital is tied up.",
                evidence=[{"type": "overstock", "items": [{k: r.get(k) for k in ("store_code", "sku", "product",
                                                                                 "days_of_cover", "excess_value")}
                                                          for r in top]}],
                predicted_impact={"metric": "working_capital_release", "predicted_delta": over_value,
                                  "note": "Upper bound; actual release depends on sell-through at reduced orders."},
                confidence="medium", assumptions=["Target cover = lead time + 21 days."])
    suppliers = ops.supplier_performance(db, scope, data_end - timedelta(days=180), data_end)
    for s in suppliers.get("suppliers", []):
        if s.get("alert"):
            propose(f"supplier:{company.id}:{s['supplier_code']}:{data_end.strftime('%Y-%m')}", category="suppliers",
                    priority="high", title=f"Review {s['supplier']}: recent lead time up {pct(s['lead_time_change_recent_vs_prior'])}",
                    summary="Longer lead times raise stockout risk unless reorder points are adjusted.",
                    evidence=[{"type": "supplier", **{k: s[k] for k in ("supplier", "avg_lead_days", "recent_avg_lead_days",
                                                                        "contracted_lead_days", "on_time_rate")}}],
                    predicted_impact={"metric": "lead_time_days", "baseline_value": s["recent_avg_lead_days"],
                                      "predicted_value": s["contracted_lead_days"], "direction": "down"},
                    confidence="medium", assumptions=["The supplier can return to contracted lead times."])
    last_complete = data_end.replace(day=1) - timedelta(days=1)
    start = (last_complete.replace(day=1) - timedelta(days=330)).replace(day=1)
    stores = ops.store_productivity(db, scope, start, last_complete, start.replace(year=start.year - 1),
                                    last_complete.replace(year=last_complete.year - 1), data_end)
    margins = [r["store_contribution_margin"] for r in stores if r.get("store_contribution_margin") is not None]
    if margins:
        avg = sum(margins) / len(margins)
        for r in stores:
            margin, growth = r.get("store_contribution_margin"), r.get("growth")
            if margin is not None and growth is not None and margin < avg - 0.025 and growth < 0.03:
                propose(f"store:{r['store_id']}:{last_complete.strftime('%Y-%m')}", category="stores", priority="medium",
                        store_id=uuid.UUID(r["store_id"]),
                        title=f"Review {r['code']} {r['name']}: contribution margin {pct(margin, signed=False)} vs chain "
                              f"average {pct(avg, signed=False)}, growth {pct(growth)}",
                        summary="Below-average store profitability with stagnant sales. Use the Decision Lab to test "
                                "staffing, opex and pricing options for this store.",
                        evidence=[{"type": "store_performance", **{k: r.get(k) for k in ("code", "net_sales", "growth",
                                                                                         "store_contribution_margin",
                                                                                         "sales_per_labor_hour")}}],
                        predicted_impact={"metric": "store_contribution_margin", "baseline_value": margin,
                                          "predicted_value": avg, "direction": "up"},
                        confidence="low", assumptions=["Chain average is an achievable reference."])
    db.add(RecommendationRuleRun(org_id=org_id, company_id=company.id, created_count=len(created), skipped_duplicates=skipped,
                                 triggered_by=user_id, details={"data_end": data_end.isoformat()}))
    db.flush()
    return {"created": len(created), "skipped_duplicates": skipped, "ids": [str(r.id) for r in created]}


# ---------------------------------------------------------------------------------------------
# From scenarios
# ---------------------------------------------------------------------------------------------


def from_scenario(db: Session, ctx: OrgContext, scenario: Scenario, title: str | None, summary: str | None) -> Recommendation:
    run = db.scalar(select(ScenarioRun).where(ScenarioRun.scenario_id == scenario.id).order_by(ScenarioRun.computed_at.desc()))
    if run is None:
        raise ValidationAppError("Run the scenario before turning it into a recommendation")
    result = run.result
    delta = (result.get("delta") or {}).get("totals") or {}
    unc = (result.get("uncertainty") or {}).get("net_profit_delta") or {}
    baseline_monthly = {r["month"]: r for r in (result.get("baseline") or {}).get("monthly", [])}
    scenario_monthly = {r["month"]: r for r in (result.get("scenario") or {}).get("monthly", [])}
    key = f"scenario:{scenario.id}:v{scenario.version}"
    if _exists(db, ctx.org_id, key):
        raise ConflictError("An open recommendation already exists for this scenario version")
    rec = Recommendation(
        org_id=ctx.org_id, company_id=scenario.company_id,
        store_id=uuid.UUID(scenario.store_ids[0]) if scenario.store_ids and len(scenario.store_ids) == 1 else None,
        title=title or f"Implement scenario: {scenario.name}", summary=summary or (scenario.description or
        "Decision Lab scenario proposed for approval."), category="decision_lab", source="scenario",
        source_ref={"scenario_id": str(scenario.id), "scenario_version": scenario.version, "run_id": str(run.id),
                    "store_ids": list(scenario.store_ids) if scenario.store_ids else None,
                    "lever_types": sorted({lv.get("type") for lv in scenario.levers or [] if isinstance(lv, dict)})},
        dedupe_key=key,
        evidence=[{"type": "lever", "summary": e.get("summary"), "warnings": e.get("warnings", [])}
                  for e in result.get("levers", [])],
        assumptions=[f"{a.get('name')}: {a.get('value')} ({a.get('source')})" for a in result.get("assumptions", [])][:20],
        predicted_impact={"metric": "net_profit", "predicted_delta": delta.get("net_profit"),
                          "net_sales_delta": delta.get("net_sales"), "interval": {"p10": unc.get("p10"), "p90": unc.get("p90")},
                          "horizon_months": result.get("horizon_months"),
                          "baseline_monthly": {k: v.get("net_profit") for k, v in baseline_monthly.items()},
                          "scenario_monthly": {k: v.get("net_profit") for k, v in scenario_monthly.items()},
                          "investment": (result.get("investment") or {}).get("investment"),
                          "payback_months": (result.get("investment") or {}).get("payback_months")},
        confidence="medium" if unc.get("p10") is not None and unc["p10"] > 0 else "low",
        priority="high" if (delta.get("net_profit") or 0) > 0 else "low", created_by=ctx.user.id)
    db.add(rec)
    db.flush()
    record_audit(db, action="recommendation.created_from_scenario", org_id=ctx.org_id, actor=ctx.user,
                 entity_type="recommendation", entity_id=rec.id, request=ctx.request,
                 details={"scenario_id": str(scenario.id)})
    return rec


# ---------------------------------------------------------------------------------------------
# Workflow actions
# ---------------------------------------------------------------------------------------------


def approvers(db: Session, org_id: uuid.UUID, exclude: uuid.UUID | None) -> list[uuid.UUID]:
    rows = db.scalars(select(Membership).where(Membership.org_id == org_id, Membership.status == "active")).all()
    return [mm.user_id for mm in rows if P.RECOMMENDATIONS_APPROVE in permissions_for(mm.role) and mm.user_id != exclude]


def submit(db: Session, ctx: OrgContext, rec: Recommendation, note: str | None) -> Recommendation:
    _transition(rec, "submit")
    users = approvers(db, ctx.org_id, rec.created_by)
    if not users:
        raise ConflictError("No eligible approver (another member with approval rights) exists in this organization")
    rec.required_approver_role = "recommendations:approve"
    for uid in users:
        db.add(Approval(org_id=ctx.org_id, recommendation_id=rec.id, requested_by=ctx.user.id, approver_user_id=uid,
                        status="pending", note=note))
        notify(db, ctx.org_id, uid, "approval_requested", f"Approval requested: {rec.title}", note,
               f"/app/workflows?recommendation={rec.id}")
    record_audit(db, action="recommendation.submitted", org_id=ctx.org_id, actor=ctx.user, entity_type="recommendation",
                 entity_id=rec.id, request=ctx.request, details={"approvers": len(users)})
    return rec


def decide(db: Session, ctx: OrgContext, rec: Recommendation, approve: bool, note: str | None) -> Recommendation:
    ctx.require(P.RECOMMENDATIONS_APPROVE)
    if rec.created_by == ctx.user.id:
        raise PermissionDeniedError("You cannot approve or reject your own recommendation (separation of duties)")
    _transition(rec, "approve" if approve else "reject")
    now = datetime.now(UTC)
    for appr in db.scalars(select(Approval).where(Approval.recommendation_id == rec.id, Approval.status == "pending")).all():
        if appr.approver_user_id == ctx.user.id:
            appr.status = "approved" if approve else "rejected"
            appr.note = note
            appr.decided_at = now
        else:
            appr.status = "cancelled"
    rec.decided_by, rec.decided_at = ctx.user.id, now
    if rec.created_by:
        notify(db, ctx.org_id, rec.created_by, "approval_decided",
               f"{'Approved' if approve else 'Rejected'}: {rec.title}", note, f"/app/workflows?recommendation={rec.id}")
    record_audit(db, action=f"recommendation.{'approved' if approve else 'rejected'}", org_id=ctx.org_id, actor=ctx.user,
                 entity_type="recommendation", entity_id=rec.id, request=ctx.request, details={"note": note})
    return rec


def start(db: Session, ctx: OrgContext, rec: Recommendation) -> Recommendation:
    _transition(rec, "start")
    record_audit(db, action="recommendation.started", org_id=ctx.org_id, actor=ctx.user, entity_type="recommendation",
                 entity_id=rec.id, request=ctx.request)
    return rec


def implemented(db: Session, ctx: OrgContext, rec: Recommendation, implemented_on: date, measurement_days: int) -> Recommendation:
    if measurement_days < 7 or measurement_days > 730:
        raise ValidationAppError("Measurement window must be 7-730 days")
    if implemented_on > date.today():
        raise ValidationAppError("The implementation date cannot be in the future", code="future_date")
    _transition(rec, "implemented")
    rec.implemented_at = datetime(implemented_on.year, implemented_on.month, implemented_on.day, tzinfo=UTC)
    rec.measurement_start = implemented_on
    rec.measurement_end = implemented_on + timedelta(days=measurement_days - 1)
    record_audit(db, action="recommendation.implemented", org_id=ctx.org_id, actor=ctx.user, entity_type="recommendation",
                 entity_id=rec.id, request=ctx.request,
                 details={"implemented_on": implemented_on.isoformat(), "measurement_days": measurement_days})
    return rec


def measure(db: Session, ctx: OrgContext, rec: Recommendation) -> dict[str, Any]:
    if rec.status not in ("implemented", "measured") or rec.measurement_start is None or rec.measurement_end is None:
        raise ConflictError("Mark the recommendation implemented (with a measurement window) before measuring")
    company = db.get(Company, rec.company_id)
    store_ids = [rec.store_id] if rec.store_id else None
    scope = Scope(org_id=ctx.org_id, company=company, store_ids=store_ids)
    _, data_end = data_bounds(db, company.id)
    if data_end is None or data_end < rec.measurement_start:
        return {"status": "pending_data", "message": "No data has arrived for the measurement window yet."}
    end = min(rec.measurement_end, data_end)
    impact = rec.predicted_impact or {}
    metric = impact.get("metric", "net_profit")
    complete = end >= rec.measurement_end
    outcome = RecommendationOutcome(org_id=ctx.org_id, recommendation_id=rec.id, metric=metric,
                                    window_start=rec.measurement_start, window_end=end, measured_by=ctx.user.id,
                                    method="")
    if metric in ("net_profit", "net_sales", "gross_profit", "operating_expenses"):
        pnl = compute_pnl(db, scope, rec.measurement_start, end, data_end)
        actual = getattr(pnl, metric)
        months = sorted(k for k in (impact.get("baseline_monthly") or {})
                        if rec.measurement_start.replace(day=1).isoformat() <= k <= end.isoformat())
        baseline = sum((impact.get("baseline_monthly") or {}).get(k) or 0 for k in months) if months else None
        predicted = sum((impact.get("scenario_monthly") or {}).get(k) or 0 for k in months) if months else None
        outcome.actual_value = actual
        outcome.baseline_value = baseline
        outcome.predicted_value = predicted
        outcome.variance = (actual - predicted) if actual is not None and predicted is not None else None
        outcome.method = (f"Actual {metric} from stored data for {rec.measurement_start} to {end}, compared with the "
                          f"scenario's predicted monthly values for the same months ({len(months)} months). "
                          "Realized effect = actual − baseline forecast.")
        if not months:
            outcome.notes = "The scenario's months do not overlap the measurement window; only the actual is reported."
    elif metric == "stockout_positions":
        risks = ops.stockout_and_overstock(db, scope, end)
        counts = risks.get("risk_counts", {})
        actual = counts.get("stocked_out", 0) + counts.get("high", 0)
        outcome.actual_value, outcome.baseline_value = actual, impact.get("baseline_value")
        outcome.predicted_value = impact.get("predicted_value")
        outcome.variance = actual - (outcome.predicted_value or 0)
        outcome.method = f"Stocked-out plus high-risk positions as of {end} versus the count when recommended."
    else:
        raise ValidationAppError(f"Outcome measurement is not supported for metric '{metric}'")
    if not complete:
        outcome.notes = ((outcome.notes or "") + " Partial window: data ends before the measurement window closes.").strip()
    db.add(outcome)
    if complete and rec.status == "implemented":
        _transition(rec, "measured")
    record_audit(db, action="recommendation.measured", org_id=ctx.org_id, actor=ctx.user, entity_type="recommendation",
                 entity_id=rec.id, request=ctx.request, details={"metric": metric, "complete": complete})
    db.flush()
    return {"status": "measured" if complete else "partial", "outcome": outcome_out(outcome)}


def outcome_out(o: RecommendationOutcome) -> dict[str, Any]:
    realized = (o.actual_value - o.baseline_value) if o.actual_value is not None and o.baseline_value is not None else None
    predicted_effect = (o.predicted_value - o.baseline_value) if o.predicted_value is not None and o.baseline_value is not None else None
    return {"id": str(o.id), "metric": o.metric, "window_start": o.window_start.isoformat(),
            "window_end": o.window_end.isoformat(), "baseline_value": o.baseline_value, "predicted_value": o.predicted_value,
            "actual_value": o.actual_value, "variance_vs_predicted": o.variance, "realized_effect": realized,
            "predicted_effect": predicted_effect,
            "accuracy": m.safe_ratio(realized, predicted_effect).value if realized is not None and predicted_effect else None,
            "method": o.method, "notes": o.notes, "measured_at": o.measured_at.isoformat() if o.measured_at else None}


def visible_to(ctx: OrgContext, rec: Recommendation) -> bool:
    if "workforce" in ((rec.source_ref or {}).get("lever_types") or []) and not ctx.has(Permission.WORKFORCE_READ):
        return False  # derived from a workforce scenario: its impact reveals the cost per employee
    if ctx.store_scope is None:
        return True
    if rec.store_id is not None:
        return rec.store_id in ctx.store_scope
    # Recommendations from multi-store scenarios carry their store selection.
    stores = (rec.source_ref or {}).get("store_ids") or []
    return bool(stores) and all(uuid.UUID(s) in ctx.store_scope for s in stores)


def store_codes(db: Session, ids: list[uuid.UUID]) -> dict[uuid.UUID, str]:
    if not ids:
        return {}
    return {s.id: s.code for s in db.scalars(select(Store).where(Store.id.in_(ids)))}


def task_for(db: Session, ctx: OrgContext, rec: Recommendation | None, title: str, assignee: uuid.UUID | None,
             due: date | None, description: str | None, priority: str) -> Task:
    if assignee is not None:
        member = db.scalar(select(Membership).where(Membership.org_id == ctx.org_id, Membership.user_id == assignee,
                                                    Membership.status == "active"))
        if member is None:
            raise ValidationAppError("The assignee is not an active member of this organization")
    task = Task(org_id=ctx.org_id, recommendation_id=rec.id if rec else None, store_id=rec.store_id if rec else None,
                title=title, description=description, assignee_id=assignee, created_by=ctx.user.id, due_date=due,
                priority=priority)
    db.add(task)
    db.flush()
    if assignee:
        notify(db, ctx.org_id, assignee, "task_assigned", f"New task: {title}", description, "/app/my-work")
    record_audit(db, action="task.created", org_id=ctx.org_id, actor=ctx.user, entity_type="task", entity_id=task.id,
                 request=ctx.request, details={"assignee": str(assignee) if assignee else None})
    return task
