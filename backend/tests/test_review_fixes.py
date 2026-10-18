"""Regression tests for defects found in code review (vendor uploads, payback, scenario scope, redaction, ...)."""

from __future__ import annotations

import time

import pytest
from sqlalchemy import select

from app.db.session import session_scope
from app.models import Company, Organization
from app.services.analytics.base import Scope
from app.services.simulation import engine as eng
from app.services.simulation.levers import NewStoreLever

TRAFFIC = "store_code,business_date,transaction_count\nST1,2026-09-01,120\nST1,2026-09-02,95\n"


def test_vendor_profile_accepts_approved_exports_but_stays_not_live(new_org) -> None:  # type: ignore[no-untyped-def]
    owner = new_org()
    company_id = owner.get("/companies").json()["companies"][0]["id"]
    owner.post("/stores", json={"company_id": company_id, "code": "ST1", "name": "Store One"})
    created = owner.post("/integrations", json={"provider_key": "qube_pos", "display_name": f"Qube {time.time_ns()}",
                                                "config": {"entity_type": "traffic"}}).json()
    assert created["status"] == "awaiting_credentials"
    upload = owner.client.post(owner.url(f"/integrations/{created['id']}/uploads"), headers=owner.headers,
                               files={"file": ("export.csv", TRAFFIC.encode(), "text/csv")}, data={"entity_type": "traffic"})
    assert upload.status_code == 202, upload.text
    job = owner.get(f"/sync-jobs/{upload.json()['job']['id']}").json()
    assert job["status"] == "succeeded" and job["records"]["inserted"] == 2
    # The vendor connection itself is still not live: no verified API, no credentials
    assert owner.get(f"/integrations/{created['id']}").json()["status"] == "awaiting_credentials"


def test_payback_is_measured_after_a_delayed_investment() -> None:
    with session_scope() as db:
        org = db.scalar(select(Organization).where(Organization.is_demo.is_(True)))
        company = db.scalar(select(Company).where(Company.org_id == org.id))
        result = eng.run_scenario(db, Scope(org_id=org.id, company=company), 24,
                                  [NewStoreLever(open_month=6, capex_per_store=30_000_000, mature_sales_per_sqft_day=40.0)],
                                  runs=50)
    inv = result["investment"]
    cumulative = inv["cumulative_free_cash_flow"]
    first_negative = next(i for i, v in enumerate(cumulative) if v < 0) + 1
    assert inv["payback_months"] is None or inv["payback_months"] > first_negative


def test_store_scoped_member_cannot_reach_company_wide_scenario(demo) -> None:  # type: ignore[no-untyped-def]
    analyst, ops = demo("business_analyst"), demo("operations_manager")  # ops is limited to S01, S02
    company_wide = analyst.post("/scenarios", json={"name": "Company-wide", "levers": [
        {"type": "opex", "changes": {"utilities": -0.05}}], "monte_carlo_runs": 50}).json()["id"]
    assert ops.get(f"/scenarios/{company_wide}").status_code == 404
    assert ops.post(f"/scenarios/{company_wide}/run").status_code == 404
    assert ops.delete(f"/scenarios/{company_wide}").status_code == 404
    assert all(s["id"] != company_wide for s in ops.get("/scenarios").json()["scenarios"])
    own = ops.post("/scenarios", json={"name": "Mine", "levers": [{"type": "opex", "changes": {"utilities": -0.05}}],
                                       "monte_carlo_runs": 50}).json()["id"]
    assert ops.post("/scenarios/compare", json={"scenario_ids": [own, company_wide]}).status_code == 404


def test_members_without_finance_access_see_changes_not_cost_structure(demo) -> None:  # type: ignore[no-untyped-def]
    inventory = demo("inventory_manager")  # scenarios:write, no finance:read, no workforce:read
    result = inventory.post("/decision-lab/simulate", json={
        "levers": [{"type": "opex", "changes": {"utilities": -0.1}}], "monte_carlo_runs": 50}).json()
    assert "baseline" not in result and "scenario" not in result and result["redacted"]
    evidence = {e["name"]: e for e in result["levers"][0]["evidence"]}
    assert evidence["Trailing monthly run-rates"]["value"] == "requires finance access"
    assert result["delta"]["totals"]["operating_expenses"] < 0  # changes stay visible
    ev = inventory.get("/decision-lab/evidence").json()
    assert all(c["gross_margin"] is None for c in ev["categories"])
    assert ev["store_costs"].get("redacted") and "monthly_cost_per_employee" not in ev["workforce"]
    blocked = inventory.post("/decision-lab/optimize", json={
        "levers": [{"type": "price", "change_pct": 0}],
        "variables": [{"lever_index": 0, "field": "change_pct", "min": -0.02, "max": 0.02, "steps": 3}],
        "objective": "net_sales",
        "constraints": [{"metric": "gross_margin", "basis": "scenario_total", "op": ">=", "value": 0.1}]})
    assert blocked.status_code == 403


def test_new_organization_gets_fiscal_periods(new_org) -> None:  # type: ignore[no-untyped-def]
    owner = new_org()
    company_id = owner.get("/companies").json()["companies"][0]["id"]
    assert owner.get(f"/companies/{company_id}/periods").json()["periods"]


def test_inventory_overview_reports_gmroi(demo) -> None:  # type: ignore[no-untyped-def]
    body = demo("finance_manager").get("/analytics/inventory", params={"period": "last_90d"}).json()
    gmroi = body["overview"]["gmroi"]
    assert gmroi["status"] in ("ok", "missing_data") and (gmroi["value"] is None or gmroi["value"] > 0)


def test_malformed_fiscal_year_period_is_a_validation_error(demo) -> None:  # type: ignore[no-untyped-def]
    r = demo("executive").get("/dashboard/executive", params={"period": "fy:abc"})
    assert r.status_code == 422


def test_platform_admin_cannot_deactivate_self(demo) -> None:  # type: ignore[no-untyped-def]
    admin = demo("platform_admin")
    me = admin.client.get("/api/v1/auth/me").json()["user"]["id"]
    r = admin.client.post(f"/api/v1/platform/users/{me}/status", headers=admin.headers,
                          json={"is_active": False, "reason": "test"})
    assert r.status_code == 409


def test_baseline_month_partly_inside_forecast_horizon_is_scaled(demo) -> None:  # type: ignore[no-untyped-def]
    import pandas as pd

    executive = demo("executive")
    baseline = executive.get("/forecasts/baseline", params={"months": 12}).json()
    forecast = executive.get("/forecasts/active", params={"target": "net_sales"}).json()["forecast"]
    points = pd.DataFrame(forecast)
    points["day"] = pd.to_datetime(points["period_start"])
    last = pd.Timestamp(baseline["months"][-1]["month"])
    in_month = points[points["day"].dt.to_period("M") == last.to_period("M")]
    if len(in_month) == last.days_in_month:
        return  # horizon covers the whole month: nothing to scale
    expected = in_month["yhat"].sum() * last.days_in_month / len(in_month)
    assert baseline["months"][-1]["net_sales"] == pytest.approx(expected, rel=1e-6)
    assert any("partly inside the forecast horizon" in note for note in baseline["notes"])


def test_baseline_beyond_forecast_horizon_repeats_same_month_last_year(demo) -> None:  # type: ignore[no-untyped-def]
    import pandas as pd

    executive = demo("executive")
    forecast = executive.get("/forecasts/active", params={"target": "net_sales"}).json()["forecast"]
    horizon_end = pd.Timestamp(forecast[-1]["period_start"])
    months = executive.get("/forecasts/baseline", params={"months": 24}).json()
    by_month = {pd.Timestamp(m["month"]): m["net_sales"] for m in months["months"]}
    beyond = [m for m in by_month if m > horizon_end]
    assert beyond, "a 24-month baseline must extend past the forecast horizon"
    for month in beyond:
        prior = month - pd.DateOffset(years=1)
        assert by_month[month] == pytest.approx(by_month[prior], rel=1e-9)  # seasonality kept, no growth
    assert any("beyond the forecast horizon" in note for note in months["notes"])


def test_store_scoped_recommendation_counts_match_visible_list(demo) -> None:  # type: ignore[no-untyped-def]
    ops = demo("operations_manager")  # S01, S02: create a multi-store recommendation it can see
    sid = ops.post("/scenarios", json={"name": f"Counts {time.time_ns()}", "levers": [
        {"type": "opex", "changes": {"utilities": -0.05}}], "monte_carlo_runs": 50}).json()["id"]
    assert ops.post(f"/scenarios/{sid}/recommendation", json={}).status_code == 201
    body = ops.get("/recommendations").json()
    assert sum(body["counts"].values()) == len(body["recommendations"]) > 0


def test_workforce_scenarios_hidden_without_workforce_access(demo) -> None:  # type: ignore[no-untyped-def]
    analyst, inventory = demo("business_analyst"), demo("inventory_manager")
    sid = analyst.post("/scenarios", json={"name": f"Hiring {time.time_ns()}", "levers": [
        {"type": "workforce", "headcount_change": 3}], "monte_carlo_runs": 50}).json()["id"]
    rec = analyst.post(f"/scenarios/{sid}/recommendation", json={}).json()
    assert inventory.get(f"/scenarios/{sid}").status_code == 404
    assert all(s["id"] != sid for s in inventory.get("/scenarios").json()["scenarios"])
    assert inventory.get(f"/recommendations/{rec['id']}").status_code == 404
    assert demo("hr_manager").get(f"/scenarios/{sid}").status_code == 200


def test_workforce_scenarios_require_workforce_access(demo) -> None:  # type: ignore[no-untyped-def]
    lever = {"type": "workforce", "headcount_change": 2}
    blocked = demo("inventory_manager").post("/decision-lab/simulate", json={"levers": [lever], "monte_carlo_runs": 50})
    assert blocked.status_code == 403
    assert demo("hr_manager").post("/decision-lab/simulate", json={"levers": [lever], "monte_carlo_runs": 50}).status_code == 200


def test_opex_assumption_carries_no_absolute_run_rate(demo) -> None:  # type: ignore[no-untyped-def]
    result = demo("business_analyst").post("/decision-lab/simulate", json={
        "levers": [{"type": "opex", "changes": {"utilities": -0.1}}], "monte_carlo_runs": 50}).json()
    changes = next(a for a in result["levers"][0]["assumptions"] if a["name"] == "Changes")["value"]
    assert all("monthly_base" not in v for v in changes.values())


def test_recommendation_assumptions_are_redacted_without_finance_access(demo) -> None:  # type: ignore[no-untyped-def]
    analyst, inventory = demo("business_analyst"), demo("inventory_manager")
    sid = analyst.post("/scenarios", json={"name": f"Redaction {time.time_ns()}", "levers": [
        {"type": "opex", "changes": {"maintenance": -0.05}}], "monte_carlo_runs": 50}).json()["id"]
    rec = analyst.post(f"/scenarios/{sid}/recommendation", json={}).json()
    cost_lines = [a for a in rec["assumptions"] if a.startswith("Cost structure:")]
    assert cost_lines and all("requires finance access" not in a for a in cost_lines)
    seen = inventory.get(f"/recommendations/{rec['id']}").json()["assumptions"]
    assert [a for a in seen if a.startswith("Cost structure:")] == ["Cost structure: requires finance access"] * len(
        cost_lines)


def test_multi_store_recommendation_stays_visible_to_its_store_scoped_author(demo) -> None:  # type: ignore[no-untyped-def]
    ops = demo("operations_manager")  # S01, S02
    sid = ops.post("/scenarios", json={"name": f"Two stores {time.time_ns()}", "levers": [
        {"type": "opex", "changes": {"utilities": -0.05}}], "monte_carlo_runs": 50}).json()["id"]
    rec = ops.post(f"/scenarios/{sid}/recommendation", json={}).json()
    assert ops.get(f"/recommendations/{rec['id']}").status_code == 200


def test_payback_is_evaluated_when_cash_dips_without_capex() -> None:
    from app.services.simulation.levers import OpexLever

    with session_scope() as db:
        org = db.scalar(select(Organization).where(Organization.is_demo.is_(True)))
        company = db.scalar(select(Company).where(Company.org_id == org.id))
        scope = Scope(org_id=org.id, company=company)
        ctx = eng.build_context(db, scope, 12)
        saving = ctx.fixed_monthly["utilities"] * 0.2
        result = eng.run_scenario(db, scope, 12, [OpexLever(changes={"utilities": -0.2}, one_time_cost=3 * saving,
                                                              start_month=6)], runs=50, ctx=ctx)
    inv = result["investment"]
    assert inv["payback_note"] != "No upfront investment."
    assert inv["payback_months"] is not None and inv["payback_months"] >= 6


def test_inventory_roles_see_turnover_but_not_gmroi(demo) -> None:  # type: ignore[no-untyped-def]
    overview = demo("inventory_manager").get("/analytics/inventory", params={"period": "last_90d"}).json()["overview"]
    assert "inventory_turnover" in overview and "gmroi" not in overview
    full = demo("finance_manager").get("/analytics/inventory", params={"period": "last_90d"}).json()["overview"]
    assert "gmroi" in full


def test_failed_upload_keeps_vendor_profile_awaiting_credentials(new_org) -> None:  # type: ignore[no-untyped-def]
    owner = new_org()
    created = owner.post("/integrations", json={"provider_key": "ecolite", "display_name": f"EcoGreen {time.time_ns()}",
                                                "config": {"entity_type": "traffic"}}).json()
    upload = owner.client.post(owner.url(f"/integrations/{created['id']}/uploads"), headers=owner.headers,
                               files={"file": ("broken.xlsx", b"not really a workbook", "application/octet-stream")},
                               data={"entity_type": "traffic"})
    assert upload.status_code == 202
    assert owner.get(f"/sync-jobs/{upload.json()['job']['id']}").json()["status"] == "failed"
    assert owner.get(f"/integrations/{created['id']}").json()["status"] == "awaiting_credentials"


def test_platform_wide_reference_rows_cannot_duplicate() -> None:
    import pytest as _pytest
    from sqlalchemy.exc import IntegrityError

    from app.models import NewsSource

    url = f"https://example.invalid/feed-{time.time_ns()}.xml"
    with session_scope() as db:
        db.add(NewsSource(org_id=None, name="Test feed", source_type="rss", url=url, is_active=False))
        db.flush()
        db.add(NewsSource(org_id=None, name="Test feed again", source_type="rss", url=url, is_active=False))
        with _pytest.raises(IntegrityError):
            db.flush()
        db.rollback()
