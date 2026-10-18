"""Goal optimization over Decision Lab levers.

The user chooses 1-3 lever fields to vary within explicit bounds, an objective and optional
constraints. The search is an exhaustive grid (transparent, reproducible, no local-optimum surprises);
for the risk-adjusted objective the best deterministic candidates are re-scored by Monte Carlo P10.
Every evaluated point is returned so the trade-off can be inspected, not just the winner.
"""

from __future__ import annotations

import itertools
from typing import Any, Literal

import numpy as np
from pydantic import BaseModel, Field, TypeAdapter, ValidationError

from app.core.errors import ValidationAppError
from app.services.simulation import engine as eng
from app.services.simulation.levers import Lever

OPTIMIZABLE_FIELDS = {"change_pct", "headcount_change", "target_headcount", "safety_days_change", "cover_days_change",
                      "retention_change_pp", "shift_pct", "open_month", "count", "monthly_program_cost"}
INTEGER_FIELDS = {"headcount_change", "target_headcount", "open_month", "count"}
MAX_EVALUATIONS = 2500


class Variable(BaseModel):
    lever_index: int = Field(ge=0, le=19)
    field: str
    min: float
    max: float
    steps: int = Field(default=11, ge=2, le=51)


class Constraint(BaseModel):
    metric: Literal["net_sales", "gross_profit", "gross_margin", "net_margin", "ebitda", "net_profit", "free_cash_flow",
                    "investment"]
    basis: Literal["scenario_total", "delta_total"] = "delta_total"
    op: Literal[">=", "<="]
    value: float


Objective = Literal["net_profit", "ebitda", "net_sales", "free_cash_flow", "gross_profit", "risk_adjusted_net_profit"]
_lever_list = TypeAdapter(list[Lever])


def _metric(result: dict[str, Any], delta: dict[str, Any], scenario: dict[str, Any], investment: float, c: Constraint) -> float | None:
    if c.metric == "investment":
        return investment
    source = delta if c.basis == "delta_total" else scenario
    return source.get(c.metric)


def optimize(ctx: eng.Context, levers: list[Lever], variables: list[Variable], objective: Objective,
             constraints: list[Constraint], discount_rate: float = 0.12) -> dict[str, Any]:
    if not 1 <= len(variables) <= 3:
        raise ValidationAppError("Choose between one and three variables to optimize")
    for v in variables:
        if v.lever_index >= len(levers):
            raise ValidationAppError("Variable refers to a lever that does not exist", details={"lever_index": v.lever_index})
        if v.field not in OPTIMIZABLE_FIELDS or not hasattr(levers[v.lever_index], v.field):
            raise ValidationAppError("This lever field cannot be optimized", details={"field": v.field})
        if v.max <= v.min:
            raise ValidationAppError("Each variable needs max > min")
    grids = []
    for v in variables:
        values = np.linspace(v.min, v.max, v.steps)
        if v.field in INTEGER_FIELDS:
            values = np.unique(np.round(values).astype(int))
        grids.append([float(x) if v.field not in INTEGER_FIELDS else int(x) for x in values])
    combos = list(itertools.product(*grids))
    if len(combos) > MAX_EVALUATIONS:
        raise ValidationAppError(f"Too many combinations ({len(combos)}); reduce steps (max {MAX_EVALUATIONS})")
    base_p = eng.point_params(ctx)
    baseline, _ = eng.simulate(ctx, [], base_p)
    b_tot = eng._totals(baseline)
    evaluations = []
    skipped = 0  # combinations rejected by lever validation or the engine (reported, not hidden)
    raw = [lv.model_dump() for lv in levers]
    for combo in combos:
        trial = [dict(r) for r in raw]
        for v, value in zip(variables, combo, strict=True):
            trial[v.lever_index][v.field] = value
        try:
            trial_levers = _lever_list.validate_python(trial)
        except ValidationError:
            skipped += 1
            continue
        try:
            scenario, _ = eng.simulate(ctx, trial_levers, base_p)
        except Exception:  # noqa: BLE001 - infeasible combination (e.g. data requirement) is counted and skipped
            skipped += 1
            continue
        s_tot = eng._totals(scenario)
        d_tot = {k: (s_tot[k] - b_tot[k]) if s_tot[k] is not None and b_tot[k] is not None else None for k in s_tot}
        delta = scenario.copy()
        cols = [c for c in delta.columns if c != "month"]
        delta[cols] = scenario[cols].to_numpy() - baseline[cols].to_numpy()
        inv = eng.investment_metrics(delta, discount_rate)
        checks = []
        feasible = True
        for c in constraints:
            value = _metric({}, d_tot, s_tot, inv["investment"], c)
            ok = value is not None and (value >= c.value if c.op == ">=" else value <= c.value)
            feasible &= ok
            checks.append({"metric": c.metric, "basis": c.basis, "op": c.op, "limit": c.value, "value": value, "ok": ok})
        key = "net_profit" if objective == "risk_adjusted_net_profit" else objective
        evaluations.append({"values": {f"{v.lever_index}.{v.field}": val for v, val in zip(variables, combo, strict=True)},
                            "objective": d_tot.get(key), "feasible": feasible, "constraints": checks,
                            "delta": {k: d_tot[k] for k in ("net_sales", "gross_profit", "ebitda", "net_profit",
                                                            "free_cash_flow")},
                            "_levers": trial_levers})
    feasible_points = [e for e in evaluations if e["feasible"] and e["objective"] is not None]
    if not feasible_points:
        return {"status": "infeasible", "evaluations": len(evaluations), "skipped_combinations": skipped, "best": None,
                "points": [{k: v for k, v in e.items() if k != "_levers"} for e in evaluations[:200]],
                "message": "No combination satisfies all constraints within the bounds."}
    feasible_points.sort(key=lambda e: -e["objective"])
    best = feasible_points[0]
    if objective == "risk_adjusted_net_profit":
        rng = np.random.default_rng(11)
        for cand in feasible_points[:8]:
            nets = []
            for _ in range(120):
                sp = eng._sample_params(ctx, base_p, rng, cand["_levers"])
                b, _ = eng.simulate(ctx, [], sp)
                sc, _ = eng.simulate(ctx, cand["_levers"], sp)
                nets.append(float(sc["net_profit"].sum() - b["net_profit"].sum()))
            cand["p10_net_profit"] = float(np.quantile(nets, 0.1))
        best = max(feasible_points[:8], key=lambda e: e["p10_net_profit"])
    points = [{k: v for k, v in e.items() if k != "_levers"} for e in evaluations]
    return {
        "status": "ok", "objective": objective, "evaluations": len(evaluations), "skipped_combinations": skipped,
        "best": {k: v for k, v in best.items() if k != "_levers"},
        "best_levers": [lv.model_dump() for lv in best["_levers"]],
        "points": points if len(points) <= 400 else points[:: max(1, len(points) // 400)],
        "method": "Exhaustive grid over the chosen bounds; deterministic point estimates for every combination"
                  + ("; the 8 best feasible combinations re-scored by the 10th percentile of 120 Monte Carlo runs."
                     if objective == "risk_adjusted_net_profit" else "."),
        "caveat": "Optimal within the model and its assumptions only; check the evidence and warnings of the chosen "
                  "scenario before acting.",
    }
