"""Business Decision Lab: evidence, simulation, optimization and persistent scenarios."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.api.deps import DbSession, OrgContext, require
from app.core.errors import NotFoundError, PermissionDeniedError, ValidationAppError
from app.core.permissions import Permission
from app.core.ratelimit import rate_limiter
from app.models import Scenario, ScenarioRun
from app.services.analytics.dashboard import build_scope
from app.services.audit import record_audit
from app.services.simulation import calibration as cal
from app.services.simulation import engine as eng
from app.services.simulation.access import (
    REDACTED,
    check_lever_permissions,
    get_visible_scenario,
    hidden_items,
    redact_items,
    scenario_visible,
)
from app.services.simulation.levers import LEVER_CATALOG, Lever
from app.services.simulation.optimize import Constraint, Objective, Variable, optimize

router = APIRouter(tags=["decision-lab"])
P = Permission
ABSOLUTE_KEYS = ("baseline", "scenario")


class SimulateIn(BaseModel):
    company_id: uuid.UUID | None = None
    store_ids: list[uuid.UUID] | None = None
    horizon_months: int = Field(default=12, ge=1, le=36)
    levers: list[Lever] = Field(default_factory=list, max_length=20)
    monte_carlo_runs: int = Field(default=500, ge=50, le=5000)
    discount_rate: float = Field(default=0.12, ge=0.0, le=0.5)
    seed: int = Field(default=7, ge=0, le=2**31 - 1)


class ScenarioIn(SimulateIn):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=4000)
    tags: list[str] = Field(default_factory=list, max_length=10)


class OptimizeIn(BaseModel):
    company_id: uuid.UUID | None = None
    store_ids: list[uuid.UUID] | None = None
    horizon_months: int = Field(default=12, ge=1, le=36)
    levers: list[Lever] = Field(min_length=1, max_length=10)
    variables: list[Variable] = Field(min_length=1, max_length=3)
    objective: Objective = "net_profit"
    constraints: list[Constraint] = Field(default_factory=list, max_length=6)


_hidden_items = hidden_items
_redact_items = redact_items


def _redact(result: dict[str, Any], ctx: OrgContext) -> dict[str, Any]:
    """Roles without finance:read see changes (deltas) but not absolute P&L levels, margins or cost structure."""
    if ctx.has(P.FINANCE_READ):
        return result
    hidden = _hidden_items(ctx)
    out = {k: v for k, v in result.items() if k not in ABSOLUTE_KEYS}
    out["levers"] = [{**lv, "evidence": _redact_items(lv.get("evidence"), hidden),
                      "assumptions": _redact_items(lv.get("assumptions"), hidden)} for lv in result.get("levers") or []]
    out["assumptions"] = _redact_items(result.get("assumptions"), hidden)
    out["redacted"] = ("Absolute baseline and scenario P&L, margins and cost structure require finance access; "
                       "changes are shown.")
    return out


def _redact_evidence(evidence: dict[str, Any], ctx: OrgContext) -> dict[str, Any]:
    if ctx.has(P.FINANCE_READ):
        return evidence
    out = dict(evidence)
    out["categories"] = [{**c, "gross_margin": None} for c in evidence["categories"]]
    out["store_costs"] = {"available": bool((evidence.get("store_costs") or {}).get("available")), "redacted": REDACTED}
    out["marketing"] = {k: v for k, v in (evidence.get("marketing") or {}).items()
                        if k not in ("monthly_spend", "spend_share_of_sales")}
    out["new_store"] = {k: v for k, v in (evidence.get("new_store") or {}).items()
                        if k not in ("capex_per_sqft", "capex_observations", "capex_method")}
    if not ctx.has(P.WORKFORCE_READ):
        out["workforce"] = {k: v for k, v in (evidence.get("workforce") or {}).items()
                            if k not in ("monthly_cost_per_employee", "monthly_labor_cost")}
    out["redacted"] = "Margins, cost structure, spend and capex require finance access."
    return out


def _simulate(db: DbSession, ctx: OrgContext, body: SimulateIn) -> tuple[dict[str, Any], Any]:
    check_lever_permissions(ctx, list(body.levers))
    scope = build_scope(db, ctx, body.company_id, body.store_ids)
    result = eng.run_scenario(db, scope, body.horizon_months, list(body.levers), runs=body.monte_carlo_runs,
                              seed=body.seed, discount_rate=body.discount_rate)
    result["scope"] = {"company_id": str(scope.company_id), "store_ids": [str(s) for s in scope.store_ids or []] or None,
                       "currency": scope.currency, "is_synthetic": scope.company.is_synthetic}
    result["inputs_hash"] = eng.inputs_hash(scope, body.horizon_months, list(body.levers),
                                            {"runs": body.monte_carlo_runs, "seed": body.seed,
                                             "discount_rate": body.discount_rate})
    return result, scope


@router.get("/orgs/{org_id}/decision-lab/catalog")
def catalog(ctx: Annotated[OrgContext, Depends(require(P.SCENARIOS_READ))]) -> dict:
    return {"levers": LEVER_CATALOG, "engine_version": eng.ENGINE_VERSION,
            "principles": [
                "Known costs and accounting identities are calculated deterministically.",
                "Behavioural effects use relationships estimated from your data, with confidence intervals, or "
                "assumptions you document. Effects that are not supported default to zero.",
                "Hiring never increases revenue automatically: it requires capacity evidence or an explicit assumption.",
                "Uncertainty is shown as P10/P50/P90 from Monte Carlo simulation, with a sensitivity ranking."]}


@router.get("/orgs/{org_id}/decision-lab/evidence")
def evidence(ctx: Annotated[OrgContext, Depends(require(P.SCENARIOS_READ))], db: DbSession,
             company_id: uuid.UUID | None = None, store_ids: list[uuid.UUID] | None = Query(default=None),
             include_elasticities: bool = False) -> dict:
    scope = build_scope(db, ctx, company_id, store_ids)
    ev = cal.evidence_bundle(db, scope, include_elasticities=include_elasticities)
    if ev.get("data_end") is None:
        raise NotFoundError("No data for this scope", code="no_data")
    cats = ev["categories"]
    return _redact_evidence({
        "data_end": ev["data_end"].isoformat(), "window": [d.isoformat() for d in ev["window"]],
        "categories": [{"code": r.code, "name": r.name, "share": r.share,
                        "gross_margin": None if r.gross_margin != r.gross_margin else r.gross_margin}
                       for r in cats.itertuples(index=False)] if cats is not None else [],
        "elasticities": {k: v.to_dict() for k, v in ev["elasticities"].items()},
        "marketing": ev["marketing"], "workforce": ev["workforce"], "new_store": ev["new_store"],
        "store_costs": ev["store_costs"], "customers": ev["customers"],
    }, ctx)


@router.post("/orgs/{org_id}/decision-lab/simulate")
def simulate(body: SimulateIn, ctx: Annotated[OrgContext, Depends(require(P.SCENARIOS_WRITE))], db: DbSession,
             request: Request) -> dict:
    rate_limiter.check("simulate", str(ctx.user.id), 60)
    result, _ = _simulate(db, ctx, body)
    return _redact(result, ctx)


@router.post("/orgs/{org_id}/decision-lab/optimize")
def run_optimize(body: OptimizeIn, ctx: Annotated[OrgContext, Depends(require(P.SCENARIOS_WRITE))], db: DbSession) -> dict:
    rate_limiter.check("optimize", str(ctx.user.id), 20)
    if not ctx.has(P.FINANCE_READ) and any(c.basis == "scenario_total" for c in body.constraints):
        raise PermissionDeniedError("Constraints on absolute scenario totals require finance access; "
                                    "use changes (delta_total) instead")
    check_lever_permissions(ctx, list(body.levers))
    scope = build_scope(db, ctx, body.company_id, body.store_ids)
    context = eng.build_context(db, scope, body.horizon_months,
                                include_elasticities=any(lv.type == "price" for lv in body.levers))
    if any(lv.type == "inventory" for lv in body.levers):
        context.inventory = cal.inventory_demand_profile(db, scope, context.evidence["data_end"], None)
    return optimize(context, list(body.levers), body.variables, body.objective, body.constraints)


# ---------------------------------------------------------------------------------------------
# Saved scenarios
# ---------------------------------------------------------------------------------------------


def _scenario_out(s: Scenario, run: ScenarioRun | None, *, full: bool, ctx: OrgContext) -> dict[str, Any]:
    out: dict[str, Any] = {
        "id": str(s.id), "name": s.name, "description": s.description, "status": s.status, "company_id": str(s.company_id),
        "store_ids": s.store_ids, "horizon_months": s.horizon_months, "levers": s.levers, "assumptions": s.assumptions,
        "tags": s.tags, "version": s.version, "created_at": s.created_at.isoformat() if s.created_at else None,
        "updated_at": s.updated_at.isoformat() if s.updated_at else None,
        "created_by": str(s.created_by) if s.created_by else None,
    }
    if run is not None:
        result = run.result
        out["latest_run"] = {"id": str(run.id), "computed_at": run.computed_at.isoformat(),
                             "engine_version": run.engine_version, "scenario_version": run.scenario_version,
                             "inputs_hash": run.inputs_hash,
                             "summary": {"delta": result.get("delta", {}).get("totals"),
                                         "investment": {k: result.get("investment", {}).get(k) for k in
                                                        ("investment", "roi", "payback_months", "npv")},
                                         "uncertainty": result.get("uncertainty", {}).get("net_profit_delta") if
                                         result.get("uncertainty") else None,
                                         "probability_net_profit_positive": (result.get("uncertainty") or {}).get(
                                             "probability_net_profit_positive"),
                                         "warnings": len(result.get("warnings", []))}}
        if full:
            out["result"] = _redact(result, ctx)
    return out


def _latest_run(db: DbSession, scenario_id: uuid.UUID) -> ScenarioRun | None:
    return db.scalar(select(ScenarioRun).where(ScenarioRun.scenario_id == scenario_id)
                     .order_by(ScenarioRun.computed_at.desc()).limit(1))


def _persist_run(db: DbSession, ctx: OrgContext, scenario: Scenario) -> ScenarioRun:
    body = SimulateIn(company_id=scenario.company_id,
                      store_ids=[uuid.UUID(s) for s in scenario.store_ids] if scenario.store_ids else None,
                      horizon_months=scenario.horizon_months, levers=scenario.levers,
                      monte_carlo_runs=int((scenario.assumptions or {}).get("monte_carlo_runs", 500)),
                      discount_rate=float((scenario.assumptions or {}).get("discount_rate", 0.12)),
                      seed=int((scenario.assumptions or {}).get("seed", 7)))
    result, _ = _simulate(db, ctx, body)
    run = ScenarioRun(scenario_id=scenario.id, org_id=ctx.org_id, scenario_version=scenario.version,
                      engine_version=eng.ENGINE_VERSION, inputs_hash=result["inputs_hash"], result=_json_safe(result),
                      computed_by=ctx.user.id)
    db.add(run)
    db.flush()
    return run


def _json_safe(value: Any) -> Any:
    import math

    import numpy as np

    if isinstance(value, dict):
        return {str(k): _json_safe(v) for k, v in value.items()}
    if isinstance(value, list | tuple):
        return [_json_safe(v) for v in value]
    if isinstance(value, float | np.floating):
        f = float(value)
        return None if math.isnan(f) or math.isinf(f) else f
    if isinstance(value, np.integer):
        return int(value)
    return value


@router.get("/orgs/{org_id}/scenarios")
def list_scenarios(ctx: Annotated[OrgContext, Depends(require(P.SCENARIOS_READ))], db: DbSession,
                   company_id: uuid.UUID | None = None, include_archived: bool = False) -> dict:
    query = select(Scenario).where(Scenario.org_id == ctx.org_id)
    if company_id:
        query = query.where(Scenario.company_id == company_id)
    if not include_archived:
        query = query.where(Scenario.status != "archived")
    rows = db.scalars(query.order_by(Scenario.updated_at.desc())).all()
    visible = [s for s in rows if scenario_visible(ctx, s)]
    return {"scenarios": [_scenario_out(s, _latest_run(db, s.id), full=False, ctx=ctx) for s in visible]}


@router.post("/orgs/{org_id}/scenarios", status_code=status.HTTP_201_CREATED)
def create_scenario(body: ScenarioIn, ctx: Annotated[OrgContext, Depends(require(P.SCENARIOS_WRITE))], db: DbSession,
                    request: Request) -> dict:
    scope = build_scope(db, ctx, body.company_id, body.store_ids)
    scenario = Scenario(org_id=ctx.org_id, company_id=scope.company_id, name=body.name, description=body.description,
                        status="saved", horizon_months=body.horizon_months,
                        store_ids=[str(s) for s in scope.store_ids] if scope.store_ids else None,
                        levers=[lv.model_dump() for lv in body.levers],
                        assumptions={"monte_carlo_runs": body.monte_carlo_runs, "discount_rate": body.discount_rate,
                                     "seed": body.seed}, tags=body.tags, created_by=ctx.user.id, updated_by=ctx.user.id)
    db.add(scenario)
    db.flush()
    run = _persist_run(db, ctx, scenario)
    record_audit(db, action="scenario.created", org_id=ctx.org_id, actor=ctx.user, entity_type="scenario",
                 entity_id=scenario.id, request=request, details={"name": body.name, "levers": [lv.type for lv in body.levers]})
    return _scenario_out(scenario, run, full=True, ctx=ctx)


@router.get("/orgs/{org_id}/scenarios/{scenario_id}")
def get_scenario(scenario_id: uuid.UUID, ctx: Annotated[OrgContext, Depends(require(P.SCENARIOS_READ))],
                 db: DbSession) -> dict:
    scenario = get_visible_scenario(db, ctx, scenario_id)
    runs = db.scalars(select(ScenarioRun).where(ScenarioRun.scenario_id == scenario.id)
                      .order_by(ScenarioRun.computed_at.desc()).limit(10)).all()
    out = _scenario_out(scenario, runs[0] if runs else None, full=True, ctx=ctx)
    out["run_history"] = [{"id": str(r.id), "computed_at": r.computed_at.isoformat(), "scenario_version": r.scenario_version,
                           "engine_version": r.engine_version, "inputs_hash": r.inputs_hash,
                           "net_profit_delta": (r.result.get("delta") or {}).get("totals", {}).get("net_profit")}
                          for r in runs]
    return out


@router.put("/orgs/{org_id}/scenarios/{scenario_id}")
def update_scenario(scenario_id: uuid.UUID, body: ScenarioIn,
                    ctx: Annotated[OrgContext, Depends(require(P.SCENARIOS_WRITE))], db: DbSession,
                    request: Request) -> dict:
    scenario = get_visible_scenario(db, ctx, scenario_id)
    scope = build_scope(db, ctx, body.company_id or scenario.company_id, body.store_ids)
    scenario.name, scenario.description, scenario.tags = body.name, body.description, body.tags
    scenario.horizon_months = body.horizon_months
    scenario.store_ids = [str(s) for s in scope.store_ids] if scope.store_ids else None
    scenario.levers = [lv.model_dump() for lv in body.levers]
    scenario.assumptions = {"monte_carlo_runs": body.monte_carlo_runs, "discount_rate": body.discount_rate,
                            "seed": body.seed}
    scenario.version += 1
    scenario.updated_by = ctx.user.id
    scenario.updated_at = datetime.now(UTC)
    if scenario.status == "archived":
        scenario.status = "saved"
    run = _persist_run(db, ctx, scenario)
    record_audit(db, action="scenario.updated", org_id=ctx.org_id, actor=ctx.user, entity_type="scenario",
                 entity_id=scenario.id, request=request, details={"version": scenario.version})
    return _scenario_out(scenario, run, full=True, ctx=ctx)


@router.post("/orgs/{org_id}/scenarios/{scenario_id}/run")
def rerun_scenario(scenario_id: uuid.UUID, ctx: Annotated[OrgContext, Depends(require(P.SCENARIOS_WRITE))],
                   db: DbSession, request: Request) -> dict:
    scenario = get_visible_scenario(db, ctx, scenario_id)
    run = _persist_run(db, ctx, scenario)
    record_audit(db, action="scenario.recomputed", org_id=ctx.org_id, actor=ctx.user, entity_type="scenario",
                 entity_id=scenario.id, request=request)
    return _scenario_out(scenario, run, full=True, ctx=ctx)


@router.delete("/orgs/{org_id}/scenarios/{scenario_id}", status_code=status.HTTP_204_NO_CONTENT)
def archive_scenario(scenario_id: uuid.UUID, ctx: Annotated[OrgContext, Depends(require(P.SCENARIOS_WRITE))],
                     db: DbSession, request: Request) -> Response:
    scenario = get_visible_scenario(db, ctx, scenario_id)
    scenario.status = "archived"
    record_audit(db, action="scenario.archived", org_id=ctx.org_id, actor=ctx.user, entity_type="scenario",
                 entity_id=scenario.id, request=request)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


class CompareIn(BaseModel):
    scenario_ids: list[uuid.UUID] = Field(min_length=2, max_length=6)


@router.post("/orgs/{org_id}/scenarios/compare")
def compare(body: CompareIn, ctx: Annotated[OrgContext, Depends(require(P.SCENARIOS_READ))], db: DbSession) -> dict:
    rows = []
    for sid in body.scenario_ids:
        scenario = get_visible_scenario(db, ctx, sid)
        run = _latest_run(db, scenario.id)
        if run is None:
            raise ValidationAppError("Scenario has not been computed", details={"scenario_id": str(sid)})
        res = run.result
        unc = res.get("uncertainty") or {}
        npd = unc.get("net_profit_delta") or {}
        delta = (res.get("delta") or {}).get("totals") or {}
        rows.append({
            "scenario_id": str(scenario.id), "name": scenario.name, "version": run.scenario_version,
            "computed_at": run.computed_at.isoformat(), "levers": [lv.get("type") for lv in scenario.levers],
            "delta": {k: delta.get(k) for k in ("net_sales", "gross_profit", "operating_expenses", "ebitda", "net_profit",
                                                "free_cash_flow")},
            "net_margin_pp": (res.get("delta") or {}).get("net_margin_pp"),
            "investment": (res.get("investment") or {}).get("investment"), "roi": (res.get("investment") or {}).get("roi"),
            "payback_months": (res.get("investment") or {}).get("payback_months"),
            "npv": (res.get("investment") or {}).get("npv"),
            "net_profit_p10": npd.get("p10"), "net_profit_p50": npd.get("p50"), "net_profit_p90": npd.get("p90"),
            "probability_profit_positive": unc.get("probability_net_profit_positive"),
            "warnings": res.get("warnings", []), "horizon_months": res.get("horizon_months"),
        })
    horizons = {r["horizon_months"] for r in rows}
    ranked = sorted([r for r in rows if r["net_profit_p10"] is not None], key=lambda r: -r["net_profit_p10"])
    return {"scenarios": rows,
            "best_risk_adjusted": ranked[0]["scenario_id"] if ranked else None,
            "ranking_basis": "Highest 10th-percentile change in net profit (downside-protected outcome).",
            "notes": (["Scenarios use different horizons; totals are not directly comparable."] if len(horizons) > 1 else [])
            + ["Each scenario was computed against the baseline current at its own run time; re-run to refresh."]}
