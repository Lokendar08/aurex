"""Decision Lab: deterministic costs, evidence-gated revenue effects, the 20 -> 30 workforce test,
uncertainty, sensitivity and optimization."""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.core.errors import ValidationAppError
from app.db.session import session_scope
from app.models import Company, Organization, Store
from app.services.analytics.base import Scope
from app.services.simulation import engine as eng
from app.services.simulation.levers import (
    InventoryLever,
    NewStoreLever,
    OpexLever,
    PriceLever,
    SupplierCostLever,
    WorkforceLever,
)
from app.services.simulation.optimize import Constraint, Variable, optimize


@pytest.fixture(scope="module")
def s04_context():  # type: ignore[no-untyped-def]
    with session_scope() as db:
        org = db.scalar(select(Organization).where(Organization.is_demo.is_(True)))
        company = db.scalar(select(Company).where(Company.org_id == org.id))
        s04 = db.scalar(select(Store).where(Store.company_id == company.id, Store.code == "S04"))
        scope = Scope(org_id=org.id, company=company, store_ids=[s04.id])
        ctx = eng.build_context(db, scope, 12, include_elasticities=True)
        yield db, scope, ctx


def test_s04_has_twenty_employees(s04_context) -> None:  # type: ignore[no-untyped-def]
    _, _, ctx = s04_context
    assert ctx.evidence["workforce"]["headcount"] == 20


def test_workforce_20_to_30_adds_known_cost_and_no_automatic_revenue(s04_context) -> None:  # type: ignore[no-untyped-def]
    """REQUIRED TEST: increase from 20 employees to 30."""
    db, scope, ctx = s04_context
    result = eng.run_scenario(db, scope, 12, [WorkforceLever(target_headcount=30)], runs=200, ctx=ctx)
    wf = ctx.evidence["workforce"]
    cost_per_employee = wf["monthly_cost_per_employee"]
    lever = result["levers"][0]
    # 1. Additional staffing cost is deterministic: 10 people x historical loaded cost x 12 months
    assert lever["capacity"]["current_headcount"] == 20 and lever["capacity"]["new_headcount"] == 30
    assert lever["capacity"]["monthly_staffing_cost_change"] == pytest.approx(10 * cost_per_employee)
    delta = result["delta"]["totals"]
    assert delta["operating_expenses"] == pytest.approx(10 * cost_per_employee * 12, rel=1e-9)
    # 2. Hiring does NOT automatically increase revenue
    assert delta["net_sales"] == pytest.approx(0.0, abs=1e-6)
    assert all(abs(m["net_sales"]) < 1e-6 for m in result["delta"]["monthly"])
    assert "No revenue effect" in lever["revenue_effect_note"]
    # 3. Profit and cash flow fall by the staffing cost net of any tax saving (identity: Δnet = −Δcost − Δtax)
    assert delta["net_profit"] < 0
    assert delta["income_tax"] <= 1e-6  # extra cost can only reduce tax
    assert delta["net_profit"] == pytest.approx(-10 * cost_per_employee * 12 - delta["income_tax"], rel=1e-9)
    assert delta["free_cash_flow"] == pytest.approx(delta["net_profit"], rel=1e-6)
    # 4. Capacity is analysed and reported, but not converted into revenue without evidence
    assert lever["capacity"]["capacity_utilization"] is not None
    assert lever["capacity"]["transactions_per_labor_hour_after"] < wf["current_transactions_per_labor_hour"]
    # 5. Known cost => no uncertainty band
    unc = result["uncertainty"]["net_profit_delta"]
    assert unc["p10"] == pytest.approx(unc["p90"], rel=1e-9)


def test_hiring_revenue_effect_requires_documented_assumption(s04_context) -> None:  # type: ignore[no-untyped-def]
    with pytest.raises(ValueError):
        WorkforceLever(target_headcount=30, revenue_effect="assumption", assumed_revenue_uplift_pct=0.05)  # no note
    db, scope, ctx = s04_context
    lever = WorkforceLever(target_headcount=30, revenue_effect="assumption", assumed_revenue_uplift_pct=0.05,
                           note="Pilot store showed queue abandonment falling after adding cashiers", ramp_months=0)
    result = eng.run_scenario(db, scope, 12, [lever], runs=100, ctx=ctx)
    assert result["delta"]["totals"]["net_sales"] > 0
    assert any(a["source"] == "user" and "uplift" in a["name"].lower() for a in result["levers"][0]["assumptions"])
    assert any("assumption" in w.lower() for w in result["warnings"])


def test_historical_mode_gives_zero_revenue_when_not_capacity_constrained(s04_context) -> None:  # type: ignore[no-untyped-def]
    db, scope, ctx = s04_context
    if ctx.evidence["workforce"]["capacity_constrained"]:
        pytest.skip("S04 is capacity constrained in this dataset")
    result = eng.run_scenario(db, scope, 12, [WorkforceLever(target_headcount=30, revenue_effect="historical")],
                              runs=50, ctx=ctx)
    assert result["delta"]["totals"]["net_sales"] == pytest.approx(0.0, abs=1e-6)
    assert any("not capacity-constrained" in w for w in result["warnings"])


def test_price_increase_uses_elasticity_and_reports_uncertainty(s04_context) -> None:  # type: ignore[no-untyped-def]
    db, scope, ctx = s04_context
    result = eng.run_scenario(db, scope, 12, [PriceLever(change_pct=0.05)], runs=200, ctx=ctx)
    lever = result["levers"][0]
    assert lever["evidence"] or lever["assumptions"]  # elasticities are cited (estimated or labelled default)
    unc = result["uncertainty"]["net_profit_delta"]
    assert unc["p10"] <= unc["p50"] <= unc["p90"]
    assert result["sensitivity"] and result["sensitivity"][0]["swing"] >= result["sensitivity"][-1]["swing"]


def test_price_change_with_explicit_elasticity_matches_formula(s04_context) -> None:  # type: ignore[no-untyped-def]
    db, scope, ctx = s04_context
    base, _ = eng.simulate(ctx, [], eng.point_params(ctx))
    scen, _ = eng.simulate(ctx, [PriceLever(change_pct=0.10, elasticity_override=-1.5)], eng.point_params(ctx))
    expected_factor = 1.10 ** (1 - 1.5)
    assert scen["net_sales"].sum() == pytest.approx(base["net_sales"].sum() * expected_factor, rel=1e-9)
    # unit cost unchanged -> COGS scales with volume only
    assert scen["cogs"].sum() == pytest.approx(base["cogs"].sum() * 1.10 ** -1.5, rel=1e-9)


def test_supplier_cost_reduction_is_deterministic(s04_context) -> None:  # type: ignore[no-untyped-def]
    db, scope, ctx = s04_context
    base, _ = eng.simulate(ctx, [], eng.point_params(ctx))
    scen, _ = eng.simulate(ctx, [SupplierCostLever(change_pct=-0.03)], eng.point_params(ctx))
    assert scen["net_sales"].sum() == pytest.approx(base["net_sales"].sum())
    assert scen["cogs"].sum() == pytest.approx(base["cogs"].sum() * 0.97, rel=1e-9)
    assert scen["gross_profit"].sum() - base["gross_profit"].sum() == pytest.approx(base["cogs"].sum() * 0.03, rel=1e-9)


def test_opex_reduction(s04_context) -> None:  # type: ignore[no-untyped-def]
    db, scope, ctx = s04_context
    base, _ = eng.simulate(ctx, [], eng.point_params(ctx))
    scen, _ = eng.simulate(ctx, [OpexLever(changes={"utilities": -0.10})], eng.point_params(ctx))
    expected = ctx.fixed_monthly.get("utilities", 0) * 0.10 * 12
    assert base["operating_expenses"].sum() - scen["operating_expenses"].sum() == pytest.approx(expected, rel=1e-9)
    with pytest.raises(ValidationAppError):
        eng.simulate(ctx, [OpexLever(changes={"income_tax": -0.5})], eng.point_params(ctx))


def test_new_store_has_capex_payback_and_depreciation() -> None:
    with session_scope() as db:
        org = db.scalar(select(Organization).where(Organization.is_demo.is_(True)))
        company = db.scalar(select(Company).where(Company.org_id == org.id))
        scope = Scope(org_id=org.id, company=company)
        result = eng.run_scenario(db, scope, 24, [NewStoreLever(open_month=3, capex_per_store=30_000_000,
                                                                mature_sales_per_sqft_day=40.0)], runs=100)
        delta = result["delta"]["totals"]
        assert delta["capex"] == pytest.approx(30_000_000)
        assert delta["depreciation"] == pytest.approx(30_000_000 / 120 * 22, rel=1e-6)  # months 3..24
        assert delta["net_sales"] > 0
        assert result["investment"]["investment"] >= 30_000_000
        assert result["investment"]["payback_note"]


def test_inventory_safety_stock_trades_working_capital_for_lost_sales(s04_context) -> None:  # type: ignore[no-untyped-def]
    db, scope, ctx = s04_context
    result = eng.run_scenario(db, scope, 12, [InventoryLever(safety_days_change=3)], runs=50, ctx=ctx)
    inv = result["levers"][0]["inventory"]
    assert inv["inventory_investment_change"] > 0
    assert inv["stockout_probability_per_cycle_after"] <= inv["stockout_probability_per_cycle_before"]
    assert result["delta"]["totals"]["working_capital_change"] == pytest.approx(inv["inventory_investment_change"])


def test_combined_levers_are_applied_in_documented_order(s04_context) -> None:  # type: ignore[no-untyped-def]
    db, scope, ctx = s04_context
    levers = [WorkforceLever(headcount_change=2), PriceLever(change_pct=0.02, elasticity_override=-1.0),
              SupplierCostLever(change_pct=-0.02)]
    _, effects = eng.simulate(ctx, levers, eng.point_params(ctx))
    assert [e["type"] for e in effects] == ["workforce", "price", "supplier_cost"]  # reported in input order
    # applying in a different input order yields the same result (canonical apply order)
    a, _ = eng.simulate(ctx, levers, eng.point_params(ctx))
    b, _ = eng.simulate(ctx, list(reversed(levers)), eng.point_params(ctx))
    assert a["net_profit"].sum() == pytest.approx(b["net_profit"].sum(), rel=1e-12)


def test_monte_carlo_is_reproducible_with_seed(s04_context) -> None:  # type: ignore[no-untyped-def]
    db, scope, ctx = s04_context
    a = eng.run_scenario(db, scope, 12, [PriceLever(change_pct=0.03)], runs=100, seed=5, ctx=ctx)
    b = eng.run_scenario(db, scope, 12, [PriceLever(change_pct=0.03)], runs=100, seed=5, ctx=ctx)
    assert a["uncertainty"]["net_profit_delta"] == b["uncertainty"]["net_profit_delta"]


def test_optimizer_respects_bounds_and_constraints(s04_context) -> None:  # type: ignore[no-untyped-def]
    _, _, ctx = s04_context
    levers = [PriceLever(change_pct=0.0, elasticity_override=-2.5)]
    result = optimize(ctx, levers, [Variable(lever_index=0, field="change_pct", min=-0.10, max=0.10, steps=21)],
                      "net_sales", [Constraint(metric="gross_margin", basis="scenario_total", op=">=", value=0.0)])
    assert result["status"] == "ok"
    best = result["best"]["values"]["0.change_pct"]
    assert -0.10 <= best <= 0.10
    # With |elasticity| > 1, revenue rises as prices fall: the revenue-maximising price is the lower bound
    assert best == pytest.approx(-0.10)
    infeasible = optimize(ctx, levers, [Variable(lever_index=0, field="change_pct", min=-0.1, max=0.1, steps=5)],
                          "net_profit", [Constraint(metric="net_sales", basis="delta_total", op=">=", value=1e12)])
    assert infeasible["status"] == "infeasible"


def test_simulate_api_validates_levers(demo) -> None:  # type: ignore[no-untyped-def]
    analyst = demo("business_analyst")
    r = analyst.post("/decision-lab/simulate", json={"levers": [{"type": "price", "change_pct": 3}]})
    assert r.status_code == 422
    r = analyst.post("/decision-lab/simulate", json={"levers": [{"type": "teleport"}]})
    assert r.status_code == 422
