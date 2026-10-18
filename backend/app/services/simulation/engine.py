"""Decision Lab simulation engine.

Baseline: the validated monthly forecast (``forecasting.service.baseline_monthly``) converted to a P&L.
Scenario: the SAME formulas with interventions applied in a fixed order (``levers.APPLY_ORDER``) so that
interactions are explicit (e.g. a price change alters volume, which alters COGS and variable costs).

Determinism vs uncertainty
- Known costs and accounting identities are deterministic (payroll = Δheadcount × cost per employee,
  rent, capex, depreciation, tax at the effective rate, cash = EBITDA − tax − working capital − capex).
- Behavioural responses use relationships estimated from the company's data (with standard errors) or
  explicit, documented user assumptions. Unidentified effects default to ZERO, never to a guess -
  except price elasticity, where a zero response would be dangerous, so an explicitly labelled
  conservative default (−1.0 ± 0.5) is used and flagged.
- Monte Carlo over the uncertain parameters yields P10/P50/P90; a tornado ranks parameter sensitivity;
  the downside case is the 10th percentile of the Monte Carlo distribution (a 1-in-10 outcome).
"""

from __future__ import annotations

import hashlib
import json
import math
from dataclasses import dataclass, field, replace
from typing import Any

import numpy as np
import pandas as pd
from scipy.stats import norm
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.errors import InsufficientDataError, ValidationAppError
from app.models.facts import EXPENSE_CATEGORIES
from app.services.analytics.base import Scope
from app.services.forecasting.service import baseline_monthly
from app.services.simulation import calibration as cal
from app.services.simulation.levers import APPLY_ORDER, LEVER_CATALOG, Lever

ENGINE_VERSION = "1.1.0"  # 1.1.0: payback after trough, consistent MC ROI, opex start_month for variable costs
DEFAULT_ELASTICITY = (-1.0, 0.5)
DEFAULT_RAMP = {"level": 0.85, "gap": 0.45, "tau_months": 4.5}
NON_OPERATING = {"depreciation", "finance_costs", "income_tax"}
VARIABLE_CATEGORIES = ("logistics", "store_supplies")


@dataclass
class Params:
    revenue_error: float = 0.0
    elasticity: dict[str, float] = field(default_factory=dict)
    marketing_elasticity: float = 0.0
    labor_elasticity: float = 0.0
    ramp_level: float = DEFAULT_RAMP["level"]
    ramp_gap: float = DEFAULT_RAMP["gap"]
    ramp_tau: float = DEFAULT_RAMP["tau_months"]
    productivity_mult: float = 1.0
    retention_realization: float = 1.0
    workforce_uplift_realization: float = 1.0
    cost_per_employee_mult: float = 1.0
    capex_mult: float = 1.0
    holding_rate_mult: float = 1.0


@dataclass
class Context:
    """Calibrated, scenario-independent inputs."""

    months: pd.DatetimeIndex
    days: np.ndarray
    base_revenue: np.ndarray
    revenue_sd: float | None
    cat_codes: list[str]
    cat_names: dict[str, str]
    cat_share: np.ndarray
    cat_cogs_ratio: np.ndarray
    gross_margin: float
    variable_ratios: dict[str, float]
    fixed_monthly: dict[str, float]
    tax_rate: float
    evidence: dict[str, Any]
    baseline_meta: dict[str, Any]
    inventory: pd.DataFrame | None = None
    scope_store_count: int = 1
    avg_inventory_per_store: float | None = None


@dataclass
class State:
    rev: np.ndarray            # (C, M) category revenue
    cogs_ratio: np.ndarray     # (C, M)
    var_ratio_mult: dict[str, np.ndarray]  # (M) per variable cost category
    extra_rev: np.ndarray      # (M) revenue not tied to existing categories (new stores) at company margin
    extra_opex: dict[str, np.ndarray]
    capex: np.ndarray
    dep_extra: np.ndarray
    working_capital: np.ndarray  # cash tied up (+ = outflow)
    lever_effects: list[dict[str, Any]] = field(default_factory=list)


def _zeros(n: int) -> np.ndarray:
    return np.zeros(n, dtype=float)


# ---------------------------------------------------------------------------------------------
# Context construction
# ---------------------------------------------------------------------------------------------


def build_context(db: Session, scope: Scope, horizon: int, include_elasticities: bool = True) -> Context:
    baseline = baseline_monthly(db, scope, horizon)
    rows = baseline["months"]
    if not rows:
        raise InsufficientDataError("No baseline could be built for this scope")
    months = pd.DatetimeIndex([pd.Timestamp(r["month"]) for r in rows])
    days = np.array([m.days_in_month for m in months], dtype=float)
    base_revenue = np.array([r["net_sales"] for r in rows], dtype=float)
    q = baseline.get("revenue_interval")
    revenue_sd = ((q["q90"] - q["q10"]) / 2.563) if q else None
    ev = cal.evidence_bundle(db, scope, include_elasticities=include_elasticities)
    cats = ev["categories"]
    assumptions = baseline["assumptions"]
    if assumptions.get("gross_margin") is None:
        raise InsufficientDataError("Gross margin is unknown for this scope (missing or too little product cost data), "
                                    "so profit cannot be simulated. Import costs (sales cost_amount) first.")
    gm = float(assumptions["gross_margin"])
    if cats is not None and len(cats) and cats["share"].sum() > 0:
        codes = cats["code"].tolist()
        share = cats["share"].to_numpy(dtype=float)
        cat_gm = cats["gross_margin"].fillna(gm).to_numpy(dtype=float)
        ratio = 1 - cat_gm
        implied = float((share * ratio).sum())
        if implied > 0:
            ratio = ratio * (1 - gm) / implied  # reconcile with the baseline gross margin
        names = dict(zip(cats["code"], cats["name"], strict=True))
    else:
        codes, share, ratio, names = ["ALL"], np.array([1.0]), np.array([1 - gm]), {"ALL": "All products"}
    inv_per_store = None
    try:
        from app.services.analytics.operations import inventory_value_series

        series = inventory_value_series(db, scope, ev["data_end"] - pd.Timedelta(days=14), ev["data_end"])
        if not series.empty:
            stores = max(1, len(scope.store_ids) if scope.store_ids else
                         int(db.execute(text("SELECT count(*) FROM stores WHERE company_id = :c AND status = 'active'"),
                                        {"c": scope.company_id}).scalar() or 1))
            inv_per_store = float(series["value"].iloc[-1]) / stores
    except Exception:  # noqa: BLE001 - optional input
        inv_per_store = None
    store_count = len(scope.store_ids) if scope.store_ids else int(
        db.execute(text("SELECT count(*) FROM stores WHERE company_id = :c AND status = 'active'"),
                   {"c": scope.company_id}).scalar() or 1)
    return Context(
        months=months, days=days, base_revenue=base_revenue, revenue_sd=revenue_sd, cat_codes=codes, cat_names=names,
        cat_share=share, cat_cogs_ratio=ratio, gross_margin=gm,
        variable_ratios={k: float(v) for k, v in assumptions["variable_cost_ratios"].items()},
        fixed_monthly={k: float(v) for k, v in assumptions["fixed_costs_monthly"].items()},
        tax_rate=float(assumptions["effective_tax_rate"]), evidence=ev,
        baseline_meta={"revenue_source": baseline["revenue_source"], "notes": baseline["notes"],
                       "as_of": baseline["as_of"], "trailing_window": assumptions["trailing_window"]},
        scope_store_count=store_count, avg_inventory_per_store=inv_per_store,
    )


def point_params(ctx: Context) -> Params:
    p = Params()
    for code, est in ctx.evidence["elasticities"].items():
        p.elasticity[code] = est.value if est.identified and est.value is not None else DEFAULT_ELASTICITY[0]
    mk = ctx.evidence["marketing"]["estimate"]
    p.marketing_elasticity = mk["value"] if mk.get("identified") else 0.0
    wf = ctx.evidence["workforce"]
    if wf.get("available"):
        le = wf["labor_elasticity"]
        p.labor_elasticity = le["value"] if le.get("identified") else 0.0
    ramp = (ctx.evidence["new_store"] or {}).get("ramp") or {}
    if ramp.get("identified"):
        p.ramp_level, p.ramp_gap, p.ramp_tau = ramp["level"], ramp["gap"], ramp["tau_months"]
    return p


# ---------------------------------------------------------------------------------------------
# Lever application
# ---------------------------------------------------------------------------------------------


def _months_from(ctx: Context, start: int) -> np.ndarray:
    mask = np.zeros(len(ctx.months), dtype=bool)
    mask[max(0, start - 1):] = True
    return mask


def _cat_mask(ctx: Context, codes: list[str] | None) -> np.ndarray:
    if not codes:
        return np.ones(len(ctx.cat_codes), dtype=bool)
    unknown = [c for c in codes if c not in ctx.cat_codes]
    if unknown:
        raise ValidationAppError("Unknown category codes", details={"categories": unknown, "known": ctx.cat_codes})
    return np.array([c in codes for c in ctx.cat_codes])


_LEVER_LABELS = {entry["type"]: entry["label"] for entry in LEVER_CATALOG}


def _record(state: State, lever: Any, idx: int, **info: Any) -> None:
    label = lever.label or _LEVER_LABELS.get(lever.type, lever.type)
    state.lever_effects.append({"index": idx, "type": lever.type, "label": label, **info})


def apply_supplier_cost(ctx: Context, s: State, lever: Any, p: Params, idx: int) -> None:
    cats = _cat_mask(ctx, lever.category_codes)
    months = _months_from(ctx, lever.start_month)
    before = (s.rev * s.cogs_ratio)[np.ix_(cats, months)].sum()
    s.cogs_ratio[np.ix_(cats, months)] *= 1 + lever.change_pct
    if lever.one_time_cost:
        s.extra_opex["professional_fees"][lever.start_month - 1] += lever.one_time_cost
    _record(s, lever, idx, summary=f"Unit cost {lever.change_pct:+.1%} on {'all' if not lever.category_codes else ', '.join(lever.category_codes)}",
            evidence=[{"name": "COGS affected in horizon (before change)", "value": float(before)}],
            assumptions=[{"name": "Unit cost change", "value": lever.change_pct, "source": "user"},
                         {"name": "Selling prices and volumes", "value": "unchanged", "source": "model"}],
            warnings=[])


def apply_price(ctx: Context, s: State, lever: Any, p: Params, idx: int) -> None:
    cats = _cat_mask(ctx, lever.category_codes)
    months = _months_from(ctx, lever.start_month)
    evidence, assumptions, warnings = [], [], []
    for ci, code in enumerate(ctx.cat_codes):
        if not cats[ci]:
            continue
        est = ctx.evidence["elasticities"].get(code)
        if lever.elasticity_override is not None:
            eps = lever.elasticity_override
            assumptions.append({"name": f"Price elasticity · {ctx.cat_names.get(code, code)}", "value": eps, "source": "user"})
        else:
            eps = p.elasticity.get(code, DEFAULT_ELASTICITY[0])
            if est is not None and est.identified:
                evidence.append({"name": f"Price elasticity · {ctx.cat_names.get(code, code)}", **est.to_dict()})
            else:
                warnings.append(f"Elasticity for {ctx.cat_names.get(code, code)} could not be estimated from your data; "
                                f"using a conservative default of {DEFAULT_ELASTICITY[0]} ± {DEFAULT_ELASTICITY[1]} "
                                "(labelled assumption).")
                assumptions.append({"name": f"Price elasticity · {ctx.cat_names.get(code, code)}",
                                    "value": DEFAULT_ELASTICITY[0], "source": "default"})
        factor = (1 + lever.change_pct) ** (1 + eps)
        s.rev[ci, months] *= factor
        s.cogs_ratio[ci, months] /= 1 + lever.change_pct
    if abs(lever.change_pct) > 0.15:
        warnings.append("Price changes beyond ±15% are outside the range typically observed in the data; elasticity "
                        "extrapolation is uncertain.")
    _record(s, lever, idx, summary=f"Price {lever.change_pct:+.1%} on {'all categories' if not lever.category_codes else ', '.join(lever.category_codes)}",
            evidence=evidence, assumptions=assumptions, warnings=warnings)


def apply_product_mix(ctx: Context, s: State, lever: Any, p: Params, idx: int) -> None:
    for code in (lever.from_category, lever.to_category):
        if code not in ctx.cat_codes:
            raise ValidationAppError("Unknown category code", details={"category": code, "known": ctx.cat_codes})
    a, b = ctx.cat_codes.index(lever.from_category), ctx.cat_codes.index(lever.to_category)
    months = _months_from(ctx, lever.start_month)
    moved = s.rev[a, months] * lever.shift_pct
    s.rev[a, months] -= moved
    s.rev[b, months] += moved
    gm_a, gm_b = 1 - float(ctx.cat_cogs_ratio[a]), 1 - float(ctx.cat_cogs_ratio[b])
    _record(s, lever, idx, summary=f"Shift {lever.shift_pct:.0%} of {ctx.cat_names.get(lever.from_category)} sales to "
                                   f"{ctx.cat_names.get(lever.to_category)}",
            evidence=[{"name": "Gross margin (trailing 12 months)", "from": gm_a, "to": gm_b}],
            assumptions=[{"name": "Total sales", "value": "unchanged (pure mix shift)", "source": "model"},
                         {"name": "Shift share", "value": lever.shift_pct, "source": "user"}],
            warnings=[] if gm_b > gm_a else ["The destination category has a lower gross margin than the source."])


def apply_marketing(ctx: Context, s: State, lever: Any, p: Params, idx: int) -> None:
    months = _months_from(ctx, lever.start_month)
    mk = ctx.evidence["marketing"]
    allocated = not ctx.fixed_monthly.get("marketing") and bool(mk.get("allocation_note"))
    base_spend = ctx.fixed_monthly.get("marketing") or (mk.get("monthly_spend") or 0.0)
    delta_spend = base_spend * lever.change_pct
    s.extra_opex["marketing"][months] += delta_spend
    est = mk["estimate"]
    warnings, assumptions, evidence = [], [], []
    if lever.elasticity_override is not None:
        beta = lever.elasticity_override
        assumptions.append({"name": "Marketing elasticity", "value": beta, "source": "user"})
    elif est.get("identified"):
        beta = p.marketing_elasticity
        evidence.append({"name": "Marketing elasticity", **est})
    else:
        beta = 0.0
        warnings.append("Marketing's effect on sales is not statistically identified in your data, so no revenue "
                        "effect is applied (cost only). Provide an explicit elasticity assumption to model one.")
        evidence.append({"name": "Marketing elasticity (not identified)", **est})
    change = max(lever.change_pct, -0.9)
    if lever.change_pct < -0.9 and beta > 0:
        warnings.append("Spend cuts beyond 90% are evaluated at −90%; the response curve is not identified that far.")
    factor = math.exp(beta * math.log1p(change)) if beta else 1.0
    s.rev[:, months] *= factor
    if allocated:
        warnings.append(mk["allocation_note"])
    _record(s, lever, idx, summary=f"Marketing spend {lever.change_pct:+.0%} ({delta_spend:,.0f} per month)",
            evidence=evidence, assumptions=assumptions + [{"name": "Baseline monthly marketing spend", "value": base_spend,
                                                           "source": "allocated" if allocated else "historical"}],
            warnings=warnings)


def apply_retention(ctx: Context, s: State, lever: Any, p: Params, idx: int) -> None:
    cust = ctx.evidence["customers"]
    if not cust.get("available"):
        raise InsufficientDataError("Customer retention needs customer aggregates (active and returning customers)")
    months = _months_from(ctx, lever.start_month)
    active, r = cust["monthly_active_customers"], cust["retention_rate"]
    spend = lever.spend_per_customer or cust["monthly_spend_per_active_customer"]
    new_inflow = active * (1 - r)
    r_new = min(max(r + lever.retention_change_pp, 0.0), 0.98)
    extra = np.zeros(len(ctx.months))
    a = active
    for i in range(len(ctx.months)):
        if months[i]:
            a = new_inflow + r_new * a
            extra[i] = (a - active) * spend * p.retention_realization
    s.rev += ctx.cat_share[:, None] * extra[None, :]
    if lever.monthly_program_cost:
        s.extra_opex["marketing"][months] += lever.monthly_program_cost
    _record(s, lever, idx, summary=f"Retention {lever.retention_change_pp:+.1%} points",
            evidence=[{"name": "Current monthly retention", "value": r}, {"name": "Monthly active customers", "value": active},
                      {"name": "Monthly spend per active customer", "value": spend}],
            assumptions=[{"name": "Retention change", "value": lever.retention_change_pp, "source": "user",
                          "note": lever.note},
                         {"name": "Customer flow model", "value": "active(t) = new + retention × active(t−1), new "
                          "customer inflow held at its current level", "source": "model"},
                         {"name": "Realization of assumed effect (Monte Carlo)", "value": "60–100%", "source": "model"}],
            warnings=["Assumption-based: the data cannot show whether a programme will achieve this retention change."])


def apply_workforce(ctx: Context, s: State, lever: Any, p: Params, idx: int) -> None:
    wf = ctx.evidence["workforce"]
    if not wf.get("available"):
        raise InsufficientDataError("Workforce scenarios need workforce aggregates (headcount and labor cost)")
    current = float(wf["headcount"])
    delta = (lever.target_headcount - current) if lever.target_headcount is not None else float(lever.headcount_change)
    cost = (lever.monthly_cost_per_employee or wf["monthly_cost_per_employee"]) * p.cost_per_employee_mult
    months = _months_from(ctx, lever.start_month)
    s.extra_opex["payroll"][months] += delta * cost
    start = lever.start_month - 1
    if delta > 0 and lever.hiring_cost_per_hire:
        s.extra_opex["other"][start] += delta * lever.hiring_cost_per_hire
    if delta < 0 and lever.severance_per_exit:
        s.extra_opex["payroll"][start] += -delta * lever.severance_per_exit
    warnings: list[str] = []
    evidence = [{"name": "Current headcount (scope)", "value": current, "as_of": wf["as_of_month"]},
                {"name": "Monthly loaded cost per employee (6-month average)", "value": wf["monthly_cost_per_employee"]},
                {"name": "Transactions per labor hour (last 3 months)", "value": wf["current_transactions_per_labor_hour"]},
                {"name": "Historical 90th percentile transactions per labor hour",
                 "value": wf["historical_p90_transactions_per_labor_hour"]},
                {"name": "Capacity utilization", "value": wf["capacity_utilization"],
                 "interpretation": "constrained" if wf["capacity_constrained"] else "not constrained"}]
    assumptions = [{"name": "Headcount change", "value": delta, "source": "user"},
                   {"name": "Monthly cost per added employee", "value": cost,
                    "source": "user" if lever.monthly_cost_per_employee else "historical"}]
    ramp = np.zeros(len(ctx.months))
    for i in range(start, len(ctx.months)):
        ramp[i] = min(1.0, (i - start + 1) / max(lever.ramp_months, 1)) if lever.ramp_months else 1.0
    revenue_note = "No revenue effect modelled: hiring adds known cost; revenue changes only with capacity evidence or a documented assumption."
    if lever.revenue_effect == "assumption" and delta != 0:
        uplift = (lever.assumed_revenue_uplift_pct or 0.0) * p.workforce_uplift_realization
        s.rev *= (1 + uplift * ramp)[None, :]
        assumptions.append({"name": "Revenue uplift once ramped", "value": lever.assumed_revenue_uplift_pct,
                            "source": "user", "note": lever.note})
        revenue_note = "Revenue effect from the user's documented assumption (Monte Carlo realization 60–100%)."
        warnings.append("The revenue uplift is an assumption, not an estimate from your data.")
    elif lever.revenue_effect == "historical" and delta != 0:
        le = wf["labor_elasticity"]
        if not wf["capacity_constrained"]:
            warnings.append(f"Historical mode requested, but capacity utilization is {wf['capacity_utilization']:.0%} "
                            "(below 95%): stores are not capacity-constrained, so extra hours are not expected to add "
                            "sales. Revenue effect set to zero.")
        elif not le.get("identified"):
            warnings.append("Historical mode requested, but the labor-hours relationship is not statistically "
                            "identified. Revenue effect set to zero.")
        else:
            hours_change = delta / current if current else 0.0
            factor = (1 + hours_change) ** p.labor_elasticity - 1
            s.rev *= (1 + factor * ramp)[None, :]
            evidence.append({"name": "Labor-hours elasticity (correlational)", **le})
            revenue_note = "Revenue effect from the historical labor-hours relationship (correlational; see caveats)."
            warnings.append(le["notes"][0] if le.get("notes") else "Correlational estimate.")
    if delta < 0 and wf["capacity_utilization"] and wf["capacity_utilization"] >= 0.9:
        warnings.append("Reducing staff while utilization is high may hurt service and sales; this risk is not modelled.")
    insights = []
    if wf["capacity_utilization"] is not None:
        insights.append(f"Stores in scope run at {wf['capacity_utilization']:.0%} of their historical peak transactions per "
                        f"labor hour: {'capacity-constrained' if wf['capacity_constrained'] else 'not capacity-constrained'}"
                        + ("; extra staff is unlikely to raise sales without a demand change." if not wf["capacity_constrained"]
                           and delta > 0 else "."))
    new_tplh = (wf["current_transactions_per_labor_hour"] * current / (current + delta)
                if wf["current_transactions_per_labor_hour"] and current + delta > 0 else None)
    _record(s, lever, idx, summary=f"Headcount {current:.0f} → {current + delta:.0f} ({delta:+.0f})",
            evidence=evidence, assumptions=assumptions, warnings=warnings, revenue_effect_note=revenue_note,
            insights=insights, capacity={"current_headcount": current, "new_headcount": current + delta,
                                         "capacity_utilization": wf["capacity_utilization"],
                                         "capacity_constrained": wf["capacity_constrained"],
                      "transactions_per_labor_hour_after": new_tplh,
                      "monthly_staffing_cost_change": delta * cost})


def apply_new_store(ctx: Context, s: State, lever: Any, p: Params, idx: int) -> None:
    ns = ctx.evidence["new_store"] or {}
    costs = ctx.evidence["store_costs"] or {}
    wf = ctx.evidence["workforce"] or {}
    if not ns.get("available"):
        raise InsufficientDataError("New-store modelling needs store sales history")
    warnings, assumptions, evidence = [], [], []
    sqft = lever.selling_area_sqft or ns["median_selling_area_sqft"]
    sps = (lever.mature_sales_per_sqft_day or ns["mature_sales_per_sqft_day"] or 0.0) * p.productivity_mult
    if not sps:
        raise InsufficientDataError("No mature-store productivity available; provide mature_sales_per_sqft_day")
    ramp = ns.get("ramp") or {}
    if ramp.get("identified"):
        evidence.append({"name": "Ramp-up curve fitted to your store openings", **{k: v for k, v in ramp.items()}})
    else:
        warnings.append("No usable history of store openings: a default ramp (start at ~47% of mature productivity, "
                        "reaching 85% with a 4.5-month time constant) is assumed.")
        assumptions.append({"name": "Ramp-up curve", "value": DEFAULT_RAMP, "source": "default"})
    capex = lever.capex_per_store
    if capex is None:
        if ns.get("capex_per_sqft"):
            capex = ns["capex_per_sqft"] * sqft
            evidence.append({"name": "Capex per sq ft from past openings", "value": ns["capex_per_sqft"],
                             "observations": ns.get("capex_observations"), "method": ns.get("capex_method")})
        else:
            raise ValidationAppError("No historical capex for store openings: provide capex_per_store")
    capex *= p.capex_mult
    headcount = lever.headcount_per_store or (round(wf["headcount"] / max(ctx.scope_store_count, 1)) if wf.get("available") else 20)
    cost_emp = (wf.get("monthly_cost_per_employee") or 0.0) * p.cost_per_employee_mult
    rent = (costs.get("rent_per_sqft_month") or 0.0) * sqft
    util = (costs.get("utilities_per_sqft_month") or 0.0) * sqft
    other_fixed = costs.get("fixed_other_per_store_month") or 0.0
    pre_open = lever.pre_opening_cost_per_store if lever.pre_opening_cost_per_store is not None else 2 * rent
    o = lever.open_month - 1
    M = len(ctx.months)
    season = ctx.base_revenue / ctx.base_revenue.mean() if ctx.base_revenue.mean() else np.ones(M)
    revenue = np.zeros(M)
    for i in range(M):
        age = i - o + 1
        if age >= 1:
            rel = p.ramp_level * (1 - p.ramp_gap * math.exp(-age / max(p.ramp_tau, 0.1)))
            revenue[i] = lever.count * sqft * sps * ctx.days[i] * season[i] * rel
    s.extra_rev += revenue
    for i in range(M):
        if i >= o - 2:
            s.extra_opex["rent"][i] += lever.count * rent
        if i >= o - 1:
            s.extra_opex["payroll"][i] += lever.count * headcount * cost_emp
        if i >= o:
            s.extra_opex["utilities"][i] += lever.count * util
            s.extra_opex["maintenance"][i] += lever.count * other_fixed
            s.dep_extra[i] += lever.count * capex / 120.0
    s.extra_opex["other"][max(o - 1, 0)] += lever.count * pre_open
    capex_months = [m for m in range(max(o - 3, 0), max(o, 1))]
    for m in capex_months:
        s.capex[m] += lever.count * capex / len(capex_months)
    if ctx.avg_inventory_per_store:
        s.working_capital[min(o, M - 1)] += lever.count * ctx.avg_inventory_per_store
    if lever.open_month > M:
        warnings.append("The opening falls after the simulation horizon.")
    evidence.append({"name": "Mature store sales per sq ft per day", "value": ns["mature_sales_per_sqft_day"],
                     "sd_across_stores": ns.get("mature_sales_per_sqft_day_sd")})
    assumptions += [
        {"name": "Selling area per store (sq ft)", "value": sqft, "source": "user" if lever.selling_area_sqft else "historical median"},
        {"name": "Capex per store", "value": capex, "source": "user" if lever.capex_per_store is not None else "historical"},
        {"name": "Headcount per store", "value": headcount, "source": "user" if lever.headcount_per_store else "current average"},
        {"name": "Rent per sq ft per month", "value": costs.get("rent_per_sqft_month"), "source": "historical"},
        {"name": "Pre-opening cost per store", "value": pre_open,
         "source": "user" if lever.pre_opening_cost_per_store is not None else "2 months of rent"},
        {"name": "Depreciation", "value": "straight line over 10 years", "source": "model"},
        {"name": "Opening inventory (working capital)", "value": ctx.avg_inventory_per_store, "source": "current average"},
    ]
    _record(s, lever, idx, summary=f"Open {lever.count} store(s) in month {lever.open_month}",
            evidence=evidence, assumptions=assumptions, warnings=warnings,
            new_store={"revenue_in_horizon": float(revenue.sum()), "capex_total": lever.count * capex})


def apply_opex(ctx: Context, s: State, lever: Any, p: Params, idx: int) -> None:
    months = _months_from(ctx, lever.start_month)
    applied = {}
    for category, pct in lever.changes.items():
        if category not in EXPENSE_CATEGORIES or category in NON_OPERATING:
            raise ValidationAppError("Unknown or non-operating expense category", details={"category": category})
        if category in VARIABLE_CATEGORIES:
            mult = s.var_ratio_mult.setdefault(category, np.ones(len(ctx.months)))
            mult[months] *= 1 + pct
            applied[category] = {"type": "variable ratio", "change": pct}
        else:
            base = ctx.fixed_monthly.get(category, 0.0)
            s.extra_opex[category][months] += base * pct
            applied[category] = {"type": "fixed run-rate", "change": pct}  # bases are in the run-rate evidence
    if lever.one_time_cost:
        s.extra_opex["professional_fees"][lever.start_month - 1] += lever.one_time_cost
    _record(s, lever, idx, summary="Operating expense changes: " + ", ".join(f"{k} {v:+.0%}" for k, v in lever.changes.items()),
            evidence=[{"name": "Trailing monthly run-rates", "value": {k: ctx.fixed_monthly.get(k) for k in lever.changes}}],
            assumptions=[{"name": "Changes", "value": applied, "source": "user"},
                         {"name": "One-time implementation cost", "value": lever.one_time_cost, "source": "user"}],
            warnings=[] if not any(v < -0.3 for v in lever.changes.values()) else
            ["Cuts above 30% in a single category are rarely achievable without operational side effects (not modelled)."])


def normal_loss(z: np.ndarray) -> np.ndarray:
    return norm.pdf(z) - z * (1 - norm.cdf(z))


def apply_inventory(ctx: Context, s: State, lever: Any, p: Params, idx: int) -> None:
    inv = ctx.inventory
    if inv is None or inv.empty:
        raise InsufficientDataError("Inventory scenarios need recent inventory snapshots and sales")
    df = inv.dropna(subset=["mean", "sd", "lead_time_days", "unit_cost"]).copy()
    df = df[df["mean"] > 0]
    if lever.category_codes:
        names = [ctx.cat_names.get(c, c) for c in lever.category_codes]
        df = df[df["category"].isin(names)]
    if df.empty:
        raise InsufficientDataError("No products with recent demand in the selected categories")
    L = df["lead_time_days"].clip(lower=1).to_numpy(float)
    mu, sd = df["mean"].to_numpy(float), df["sd"].to_numpy(float)
    sigma_l = np.maximum(sd * np.sqrt(L), 1e-6)
    ss0 = df["safety_stock"].fillna(mu * 5) if "safety_stock" in df else pd.Series(mu * 5)
    ss0 = np.maximum(np.asarray(ss0, float), 0)
    ss1 = np.maximum(ss0 + lever.safety_days_change * mu, 0)
    cycle_days = np.maximum(df["days_of_cover"].replace([np.inf], np.nan).fillna(14).clip(2, 120).to_numpy(float), L + 1)
    cycle1 = np.maximum(cycle_days + lever.cover_days_change, 1.0)
    lost0 = (30.4 / cycle_days) * sigma_l * normal_loss(ss0 / sigma_l)
    lost1 = (30.4 / cycle1) * sigma_l * normal_loss(ss1 / sigma_l)
    price = df["price"].fillna(df["unit_cost"] * 1.3).to_numpy(float)
    unit_cost = df["unit_cost"].to_numpy(float)
    d_revenue_month = float(((lost0 - lost1) * price).sum())
    d_cogs_month = float(((lost0 - lost1) * unit_cost).sum())
    d_inventory = float((((ss1 - ss0) + lever.cover_days_change * mu / 2) * unit_cost).sum())
    rate = lever.holding_cost_rate * p.holding_rate_mult
    M = len(ctx.months)
    s.extra_rev += d_revenue_month * ctx.days / 30.4
    # extra_rev is valued at company margin; correct COGS to the products' actual unit costs
    s.extra_opex["_cogs_adjust"] = s.extra_opex.get("_cogs_adjust", _zeros(M)) + (
        d_cogs_month * ctx.days / 30.4 - d_revenue_month * ctx.days / 30.4 * (1 - ctx.gross_margin))
    s.extra_opex["other"] += d_inventory * rate / 12.0
    s.working_capital[0] += d_inventory
    p_stockout0 = float(np.mean(1 - norm.cdf(ss0 / sigma_l)))
    p_stockout1 = float(np.mean(1 - norm.cdf(ss1 / sigma_l)))
    _record(s, lever, idx, summary=f"Safety stock {lever.safety_days_change:+.0f} days, cover {lever.cover_days_change:+.0f} days",
            evidence=[{"name": "Products modelled", "value": int(len(df))},
                      {"name": "Demand statistics", "value": "daily mean and standard deviation over the last 90 days"},
                      {"name": "Lead times", "value": "average of last 90 days of receipts (else contracted)"}],
            assumptions=[{"name": "Holding cost rate (annual)", "value": lever.holding_cost_rate, "source": "user/default"},
                         {"name": "Demand during lead time", "value": "normal; expected shortage via the standard normal "
                          "loss function", "source": "model"},
                         {"name": "Lost sales", "value": "unmet demand is lost (no backorders)", "source": "model"}],
            warnings=["Expected-shortage estimates assume roughly normal daily demand; slow movers are less precise."],
            inventory={"inventory_investment_change": d_inventory, "expected_lost_sales_change_month": -d_revenue_month,
                       "stockout_probability_per_cycle_before": p_stockout0,
                       "stockout_probability_per_cycle_after": p_stockout1})


APPLIERS = {"supplier_cost": apply_supplier_cost, "price": apply_price, "product_mix": apply_product_mix,
            "marketing": apply_marketing, "retention": apply_retention, "workforce": apply_workforce,
            "new_store": apply_new_store, "opex": apply_opex, "inventory": apply_inventory}


# ---------------------------------------------------------------------------------------------
# Simulation
# ---------------------------------------------------------------------------------------------


def _initial_state(ctx: Context, p: Params) -> State:
    M = len(ctx.months)
    revenue = ctx.base_revenue * (1 + p.revenue_error)
    keys = set(EXPENSE_CATEGORIES) | {"_cogs_adjust"}
    return State(rev=ctx.cat_share[:, None] * revenue[None, :],
                 cogs_ratio=np.repeat(ctx.cat_cogs_ratio[:, None], M, axis=1), var_ratio_mult={},
                 extra_rev=_zeros(M), extra_opex={k: _zeros(M) for k in keys}, capex=_zeros(M), dep_extra=_zeros(M),
                 working_capital=_zeros(M))


def _finalize(ctx: Context, s: State) -> pd.DataFrame:
    revenue = s.rev.sum(axis=0) + s.extra_rev
    cogs = (s.rev * s.cogs_ratio).sum(axis=0) + s.extra_rev * (1 - ctx.gross_margin) + s.extra_opex["_cogs_adjust"]
    gp = revenue - cogs
    variable = sum(ratio * s.var_ratio_mult.get(cat, 1.0) * revenue for cat, ratio in ctx.variable_ratios.items())
    fixed_base = sum(v for k, v in ctx.fixed_monthly.items() if k not in NON_OPERATING)
    extra_fixed = sum(arr for k, arr in s.extra_opex.items() if k not in NON_OPERATING and k != "_cogs_adjust")
    opex = variable + fixed_base + extra_fixed
    ebitda = gp - opex
    dep = ctx.fixed_monthly.get("depreciation", 0.0) + s.dep_extra
    fin = np.full(len(ctx.months), ctx.fixed_monthly.get("finance_costs", 0.0))
    pbt = ebitda - dep - fin
    tax = np.maximum(pbt, 0) * ctx.tax_rate
    net = pbt - tax
    ocf = ebitda - tax - s.working_capital
    fcf = ocf - s.capex
    return pd.DataFrame({"month": [m.date().isoformat() for m in ctx.months], "net_sales": revenue, "cogs": cogs,
                         "gross_profit": gp, "operating_expenses": opex, "ebitda": ebitda, "depreciation": dep,
                         "finance_costs": fin, "profit_before_tax": pbt, "income_tax": tax, "net_profit": net,
                         "working_capital_change": s.working_capital, "operating_cash_flow": ocf, "capex": s.capex,
                         "free_cash_flow": fcf})


def simulate(ctx: Context, levers: list[Lever], p: Params) -> tuple[pd.DataFrame, list[dict[str, Any]]]:
    state = _initial_state(ctx, p)
    order = sorted(enumerate(levers), key=lambda il: (APPLY_ORDER.index(il[1].type), il[0]))
    for idx, lever in order:
        APPLIERS[lever.type](ctx, state, lever, p, idx)
    return _finalize(ctx, state), sorted(state.lever_effects, key=lambda e: e["index"])


def _totals(frame: pd.DataFrame) -> dict[str, float]:
    cols = ["net_sales", "cogs", "gross_profit", "operating_expenses", "ebitda", "depreciation", "finance_costs",
            "profit_before_tax", "income_tax", "net_profit", "working_capital_change", "operating_cash_flow", "capex",
            "free_cash_flow"]
    out = {c: float(frame[c].sum()) for c in cols}
    out["gross_margin"] = out["gross_profit"] / out["net_sales"] if out["net_sales"] else None
    out["net_margin"] = out["net_profit"] / out["net_sales"] if out["net_sales"] else None
    out["ebitda_margin"] = out["ebitda"] / out["net_sales"] if out["net_sales"] else None
    return out


def investment_metrics(delta: pd.DataFrame, discount_rate: float) -> dict[str, Any]:
    """ROI, payback and NPV on incremental cash flows."""
    one_time = delta["capex"].clip(lower=0) + delta["working_capital_change"].clip(lower=0)
    investment = float(one_time.sum())
    fcf = delta["free_cash_flow"].to_numpy(float)
    cumulative = np.cumsum(fcf)
    monthly_rate = (1 + discount_rate) ** (1 / 12) - 1
    npv = float(sum(v / (1 + monthly_rate) ** (i + 1) for i, v in enumerate(fcf)))
    payback, note = None, None
    if investment > 0 or cumulative.min() < 0:
        # Measure from the deepest point of cumulative cash flow, so months before a later investment (cumulative
        # still 0) are not mistaken for payback.
        trough = int(np.argmin(cumulative))
        hits = np.flatnonzero(cumulative[trough:] >= 0)
        if len(hits) and cumulative.min() < 0:
            payback = trough + int(hits[0]) + 1
            first_outflow = int(np.flatnonzero(cumulative < 0)[0]) + 1
            note = (f"Cumulative incremental free cash flow is negative from month {first_outflow} and recovers in month "
                    f"{payback}.")
        elif cumulative.min() >= 0:
            payback, note = 0, "Incremental cash flow is never negative."
        else:
            run_rate = float(np.mean(fcf[-3:]))
            if run_rate > 0:
                extra = math.ceil(-cumulative[-1] / run_rate)
                payback = len(fcf) + extra
                note = (f"Not within the horizon; at the last 3 months' run-rate payback would take about {payback} months "
                        "(extrapolated).")
            else:
                note = "No payback: incremental cash flow is not positive at the end of the horizon."
    else:
        note = "No upfront investment."
    # Working capital (e.g. inventory) is tied up, not consumed: it is treated as recovered at the horizon end.
    operating_gain = float((delta["operating_cash_flow"] + delta["working_capital_change"]).sum())  # EBITDA - tax
    capex_total = float(delta["capex"].clip(lower=0).sum())
    roi = (operating_gain - capex_total) / investment if investment > 0 else None
    return {"investment": investment, "capex": capex_total,
            "working_capital": float(delta["working_capital_change"].clip(lower=0).sum()), "roi": roi,
            "roi_note": "ROI = (incremental EBITDA − tax − capex) ÷ (capex + working capital) over the horizon; "
                        "working capital is assumed recoverable." if investment > 0 else
            "ROI is undefined without upfront investment; see the change in net profit instead.",
            "payback_months": payback, "payback_note": note, "npv": npv, "discount_rate_annual": discount_rate,
            "cumulative_free_cash_flow": [float(v) for v in cumulative]}


def _sample_params(ctx: Context, base: Params, rng: np.random.Generator, levers: list[Lever]) -> Params:
    p = replace(base, elasticity=dict(base.elasticity))
    if ctx.revenue_sd:
        p.revenue_error = float(rng.normal(0, ctx.revenue_sd))
    for code, est in ctx.evidence["elasticities"].items():
        if est.identified and est.std_error:
            p.elasticity[code] = float(np.clip(rng.normal(est.value, est.std_error), -5, -0.05))
        else:
            p.elasticity[code] = float(np.clip(rng.normal(*DEFAULT_ELASTICITY), -3, -0.1))
    mk = ctx.evidence["marketing"]["estimate"]
    if mk.get("identified") and mk.get("std_error"):
        p.marketing_elasticity = float(max(rng.normal(mk["value"], mk["std_error"]), 0))
    le = (ctx.evidence["workforce"] or {}).get("labor_elasticity") or {}
    if le.get("identified") and le.get("std_error"):
        p.labor_elasticity = float(max(rng.normal(le["value"], le["std_error"]), 0))
    ramp = (ctx.evidence["new_store"] or {}).get("ramp") or {}
    if ramp.get("identified"):
        p.ramp_level = float(np.clip(rng.normal(ramp["level"], ramp.get("level_se") or 0.05), 0.3, 1.5))
        p.ramp_tau = float(np.clip(rng.normal(ramp["tau_months"], ramp.get("tau_se") or 1.0), 0.5, 24))
    else:
        p.ramp_level = float(np.clip(rng.normal(DEFAULT_RAMP["level"], 0.1), 0.4, 1.2))
    ns = ctx.evidence["new_store"] or {}
    if ns.get("mature_sales_per_sqft_day") and ns.get("mature_sales_per_sqft_day_sd"):
        cv = ns["mature_sales_per_sqft_day_sd"] / ns["mature_sales_per_sqft_day"]
        p.productivity_mult = float(np.clip(rng.normal(1.0, cv), 0.4, 1.8))
    p.retention_realization = float(rng.uniform(0.6, 1.0))
    p.workforce_uplift_realization = float(rng.uniform(0.6, 1.0))
    return p


def inputs_hash(scope: Scope, horizon: int, levers: list[Lever], options: dict[str, Any]) -> str:
    payload = {"company": str(scope.company_id), "stores": sorted(str(s) for s in scope.store_ids or []),
               "horizon": horizon, "levers": [lv.model_dump() for lv in levers], "options": options,
               "engine": ENGINE_VERSION}
    return hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest()


def _sensitivity(ctx: Context, levers: list[Lever], base: Params, base_net: float) -> list[dict[str, Any]]:
    ev = ctx.evidence
    tests: list[tuple[str, Params, Params]] = []
    types = {lv.type for lv in levers}
    if ctx.revenue_sd:
        tests.append(("Baseline revenue (forecast error, ±1.28σ)", replace(base, revenue_error=-1.2816 * ctx.revenue_sd),
                      replace(base, revenue_error=1.2816 * ctx.revenue_sd)))
    if "price" in types:
        for code, est in ev["elasticities"].items():
            sd = est.std_error if est.identified and est.std_error else DEFAULT_ELASTICITY[1]
            mid = base.elasticity.get(code, DEFAULT_ELASTICITY[0])
            lo, hi = dict(base.elasticity), dict(base.elasticity)
            lo[code], hi[code] = min(mid + 1.2816 * sd, -0.01), mid - 1.2816 * sd
            tests.append((f"Price elasticity · {ctx.cat_names.get(code, code)}", replace(base, elasticity=lo),
                          replace(base, elasticity=hi)))
    if "marketing" in types:
        mk = ev["marketing"]["estimate"]
        if mk.get("identified") and mk.get("std_error"):
            tests.append(("Marketing elasticity", replace(base, marketing_elasticity=max(base.marketing_elasticity - 1.2816 * mk["std_error"], 0)),
                          replace(base, marketing_elasticity=base.marketing_elasticity + 1.2816 * mk["std_error"])))
    if types & {"workforce", "new_store"}:
        tests.append(("Cost per employee (±10%)", replace(base, cost_per_employee_mult=0.9),
                      replace(base, cost_per_employee_mult=1.1)))
    if "new_store" in types:
        ns = ev.get("new_store") or {}
        mean, sd = ns.get("mature_sales_per_sqft_day"), ns.get("mature_sales_per_sqft_day_sd")
        rel = float(np.clip(sd / mean, 0.05, 0.5)) if mean and sd else 0.2
        label = (f"New store productivity (±1 sd across stores, ±{rel:.0%})" if mean and sd
                 else "New store productivity (±20%, no cross-store evidence)")
        tests.append((label, replace(base, productivity_mult=1 - rel), replace(base, productivity_mult=1 + rel)))
        tests.append(("New store capex (±20%)", replace(base, capex_mult=0.8), replace(base, capex_mult=1.2)))
        tests.append(("Ramp-up level (±0.1)", replace(base, ramp_level=base.ramp_level - 0.1),
                      replace(base, ramp_level=base.ramp_level + 0.1)))
    if "retention" in types:
        tests.append(("Retention effect realization (60%–100%)", replace(base, retention_realization=0.6),
                      replace(base, retention_realization=1.0)))
    if "workforce" in types and any(getattr(lv, "revenue_effect", "none") == "assumption" for lv in levers):
        tests.append(("Assumed workforce revenue uplift realization (60%–100%)",
                      replace(base, workforce_uplift_realization=0.6), replace(base, workforce_uplift_realization=1.0)))
    if "inventory" in types:
        tests.append(("Holding cost rate (±25%)", replace(base, holding_rate_mult=0.75), replace(base, holding_rate_mult=1.25)))
    rows = []
    for name, lo_p, hi_p in tests:
        lo_net = _delta_net(ctx, levers, lo_p)
        hi_net = _delta_net(ctx, levers, hi_p)
        rows.append({"parameter": name, "low_case": lo_net, "high_case": hi_net, "base": base_net,
                     "swing": abs(hi_net - lo_net)})
    return sorted(rows, key=lambda r: -r["swing"])


def _delta_net(ctx: Context, levers: list[Lever], p: Params) -> float:
    baseline, _ = simulate(ctx, [], p)
    scenario, _ = simulate(ctx, levers, p)
    return float(scenario["net_profit"].sum() - baseline["net_profit"].sum())


def run_scenario(db: Session, scope: Scope, horizon: int, levers: list[Lever], *, runs: int = 500, seed: int = 7,
                 discount_rate: float = 0.12, include_uncertainty: bool = True,
                 ctx: Context | None = None) -> dict[str, Any]:
    if len(levers) > 20:
        raise ValidationAppError("At most 20 levers per scenario")
    ctx = ctx or build_context(db, scope, horizon, include_elasticities=any(lv.type == "price" for lv in levers))
    if any(lv.type == "inventory" for lv in levers) and ctx.inventory is None:
        ctx.inventory = cal.inventory_demand_profile(db, scope, ctx.evidence["data_end"], None)
    base_p = point_params(ctx)
    baseline, _ = simulate(ctx, [], base_p)
    scenario, effects = simulate(ctx, levers, base_p)
    delta = scenario.copy()
    numeric = [c for c in delta.columns if c != "month"]
    delta[numeric] = scenario[numeric].to_numpy() - baseline[numeric].to_numpy()
    b_tot, s_tot = _totals(baseline), _totals(scenario)
    d_tot = {k: (s_tot[k] - b_tot[k]) if s_tot[k] is not None and b_tot[k] is not None else None for k in s_tot}
    invest = investment_metrics(delta, discount_rate)
    result: dict[str, Any] = {
        "engine_version": ENGINE_VERSION, "horizon_months": horizon,
        "months": [m.date().isoformat() for m in ctx.months],
        "baseline": {"monthly": baseline.to_dict(orient="records"), "totals": b_tot, **ctx.baseline_meta},
        "scenario": {"monthly": scenario.to_dict(orient="records"), "totals": s_tot},
        "delta": {"monthly": delta.to_dict(orient="records"), "totals": d_tot,
                  "gross_margin_pp": (s_tot["gross_margin"] - b_tot["gross_margin"]) if s_tot["gross_margin"] is not None
                  and b_tot["gross_margin"] is not None else None,
                  "net_margin_pp": (s_tot["net_margin"] - b_tot["net_margin"]) if s_tot["net_margin"] is not None
                  and b_tot["net_margin"] is not None else None},
        "investment": invest, "levers": effects,
        "assumptions": [{"lever": e["label"], **a} for e in effects for a in e.get("assumptions", [])]
        + [{"lever": "baseline", "name": "Cost structure", "value": n, "source": "model"} for n in ctx.baseline_meta["notes"]],
        "warnings": [w for e in effects for w in e.get("warnings", [])],
        "evidence_summary": {"baseline_revenue_model": ctx.baseline_meta["revenue_source"],
                             "trailing_window": ctx.baseline_meta["trailing_window"]},
    }
    if include_uncertainty and levers:
        rng = np.random.default_rng(seed)
        nets, revs, rois, fcfs = [], [], [], []
        for _ in range(max(50, min(runs, 5000))):
            sp = _sample_params(ctx, base_p, rng, levers)
            b, _ = simulate(ctx, [], sp)
            sc, _ = simulate(ctx, levers, sp)
            d_net = float(sc["net_profit"].sum() - b["net_profit"].sum())
            nets.append(d_net)
            revs.append(float(sc["net_sales"].sum() - b["net_sales"].sum()))
            fcfs.append(float(sc["free_cash_flow"].sum() - b["free_cash_flow"].sum()))
            if invest["investment"] > 0:
                d = sc[["operating_cash_flow", "working_capital_change", "capex"]] - b[
                    ["operating_cash_flow", "working_capital_change", "capex"]]
                gain = float((d["operating_cash_flow"] + d["working_capital_change"]).sum())
                rois.append((gain - float(d["capex"].clip(lower=0).sum())) / invest["investment"])
        q = lambda xs, p: float(np.quantile(xs, p))  # noqa: E731
        result["uncertainty"] = {
            "runs": len(nets), "seed": seed,
            "net_profit_delta": {"p10": q(nets, 0.1), "p50": q(nets, 0.5), "p90": q(nets, 0.9), "mean": float(np.mean(nets))},
            "net_sales_delta": {"p10": q(revs, 0.1), "p50": q(revs, 0.5), "p90": q(revs, 0.9)},
            "free_cash_flow_delta": {"p10": q(fcfs, 0.1), "p50": q(fcfs, 0.5), "p90": q(fcfs, 0.9)},
            "probability_net_profit_positive": float(np.mean(np.array(nets) > 0)),
            "roi": {"p10": q(rois, 0.1), "p50": q(rois, 0.5), "p90": q(rois, 0.9)} if rois else None,
            "method": "Monte Carlo over estimated parameters (normal with estimated standard errors), the baseline "
                      "forecast error (from monthly backtest errors) and assumption realization ranges. Known costs "
                      "are not sampled.",
        }
        result["sensitivity"] = _sensitivity(ctx, levers, base_p, d_tot["net_profit"] or 0.0)
        result["downside"] = {"net_profit_delta": result["uncertainty"]["net_profit_delta"]["p10"],
                              "net_sales_delta": result["uncertainty"]["net_sales_delta"]["p10"],
                              "free_cash_flow_delta": result["uncertainty"]["free_cash_flow_delta"]["p10"],
                              "definition": "10th percentile of the Monte Carlo distribution (1-in-10 downside)."}
    return result
