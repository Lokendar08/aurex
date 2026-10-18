"""Persistence after reload, scenario versioning, recommendations/approvals/tasks, reports and notifications."""

from __future__ import annotations

import csv
import hashlib
import io

from fastapi.testclient import TestClient

WORKFORCE = {"type": "workforce", "target_headcount": 30}


def _s04(actor) -> str:  # type: ignore[no-untyped-def]
    return next(s["id"] for s in actor.get("/stores").json()["stores"] if s["code"] == "S04")


def test_saved_scenario_survives_a_new_session(app, demo) -> None:  # type: ignore[no-untyped-def]
    analyst = demo("business_analyst")
    created = analyst.post("/scenarios", json={"name": "Persist me", "store_ids": [_s04(analyst)],
                                               "levers": [WORKFORCE], "monte_carlo_runs": 100})
    assert created.status_code == 201
    scenario_id = created.json()["id"]
    original_hash = created.json()["latest_run"]["inputs_hash"]
    # Simulate a browser reload / new device: brand-new client, fresh sign-in
    again = demo("business_analyst")
    loaded = again.get(f"/scenarios/{scenario_id}").json()
    assert loaded["name"] == "Persist me" and loaded["levers"][0]["target_headcount"] == 30
    assert loaded["latest_run"]["inputs_hash"] == original_hash
    assert loaded["result"]["delta"]["totals"]["net_sales"] == 0
    assert any(s["id"] == scenario_id for s in again.get("/scenarios").json()["scenarios"])


def test_scenario_update_increments_version_and_keeps_history(demo) -> None:  # type: ignore[no-untyped-def]
    analyst = demo("business_analyst")
    sid = analyst.post("/scenarios", json={"name": "Versioned", "store_ids": [_s04(analyst)], "levers": [WORKFORCE],
                                           "monte_carlo_runs": 50}).json()["id"]
    updated = analyst.put(f"/scenarios/{sid}", json={"name": "Versioned", "store_ids": [_s04(analyst)],
                                                     "levers": [{"type": "workforce", "target_headcount": 25}],
                                                     "monte_carlo_runs": 50}).json()
    assert updated["version"] == 2
    detail = analyst.get(f"/scenarios/{sid}").json()
    assert len(detail["run_history"]) == 2 and {r["scenario_version"] for r in detail["run_history"]} == {1, 2}


def test_scenario_comparison_ranks_by_downside(demo) -> None:  # type: ignore[no-untyped-def]
    analyst = demo("business_analyst")
    a = analyst.post("/scenarios", json={"name": "Hire 10", "store_ids": [_s04(analyst)], "levers": [WORKFORCE],
                                         "monte_carlo_runs": 50}).json()["id"]
    b = analyst.post("/scenarios", json={"name": "Cut utilities", "store_ids": [_s04(analyst)],
                                         "levers": [{"type": "opex", "changes": {"utilities": -0.1}}],
                                         "monte_carlo_runs": 50}).json()["id"]
    result = analyst.post("/scenarios/compare", json={"scenario_ids": [a, b]}).json()
    assert result["best_risk_adjusted"] == b


def test_recommendation_approval_workflow_with_separation_of_duties(demo) -> None:  # type: ignore[no-untyped-def]
    analyst, executive, employee = demo("business_analyst"), demo("executive"), demo("employee")
    sid = analyst.post("/scenarios", json={"name": "Utilities programme", "store_ids": [_s04(analyst)],
                                           "levers": [{"type": "opex", "changes": {"utilities": -0.05}}],
                                           "monte_carlo_runs": 50}).json()["id"]
    rec = analyst.post(f"/scenarios/{sid}/recommendation", json={}).json()
    assert rec["status"] == "proposed" and rec["predicted_impact"]["metric"] == "net_profit"
    assert analyst.post(f"/recommendations/{rec['id']}/submit", json={"note": "please"}).json()["status"] == "pending_approval"
    assert analyst.post(f"/recommendations/{rec['id']}/decision", json={"approve": True}).status_code == 403
    assert employee.post(f"/recommendations/{rec['id']}/decision", json={"approve": True}).status_code == 403
    pending = executive.get("/workflows/my-work").json()["approvals_pending"]
    assert any(p["recommendation"]["id"] == rec["id"] for p in pending)
    assert executive.post(f"/recommendations/{rec['id']}/decision", json={"approve": True, "note": "ok"}).json()["status"] == "approved"
    # invalid transition is refused
    assert analyst.post(f"/recommendations/{rec['id']}/submit", json={}).status_code == 409
    notifications = analyst.get("/notifications").json()["notifications"]
    assert any(n["kind"] == "approval_decided" for n in notifications)
    history = [h["action"] for h in analyst.get(f"/recommendations/{rec['id']}").json()["history"]]
    assert history[:3] == ["recommendation.created_from_scenario", "recommendation.submitted", "recommendation.approved"]


def test_tasks_assignment_and_completion(demo) -> None:  # type: ignore[no-untyped-def]
    executive, employee = demo("executive"), demo("employee")
    members = executive.get("/members").json()["members"]
    employee_user = next(m for m in members if m["role"] == "employee")
    task = executive.post("/tasks", json={"title": "Recount aisle 4", "assignee_id": employee_user["user_id"]}).json()
    assert any(t["id"] == task["id"] for t in employee.get("/workflows/my-work").json()["tasks"])
    assert employee.patch(f"/tasks/{task['id']}", json={"title": "renamed"}).status_code == 403
    assert employee.patch(f"/tasks/{task['id']}", json={"status": "done"}).json()["status"] == "done"
    assert employee.post("/tasks", json={"title": "self assigned"}).status_code == 403


def test_outcome_measurement_compares_predicted_and_actual(demo) -> None:  # type: ignore[no-untyped-def]
    analyst, executive = demo("business_analyst"), demo("executive")
    sid = analyst.post("/scenarios", json={"name": "Measured scenario", "store_ids": [_s04(analyst)],
                                           "levers": [{"type": "opex", "changes": {"maintenance": -0.05}}],
                                           "horizon_months": 3, "monte_carlo_runs": 50}).json()["id"]
    rec = analyst.post(f"/scenarios/{sid}/recommendation", json={}).json()
    analyst.post(f"/recommendations/{rec['id']}/submit", json={})
    executive.post(f"/recommendations/{rec['id']}/decision", json={"approve": True})
    # backdated implementation inside the data window so actuals exist
    analyst.post(f"/recommendations/{rec['id']}/implemented", json={"implemented_on": "2026-02-01", "measurement_days": 60})
    result = analyst.post(f"/recommendations/{rec['id']}/measure").json()
    assert result["status"] in ("measured", "partial")
    outcome = result["outcome"]
    assert outcome["actual_value"] is not None and outcome["method"]


def test_reports_generate_in_all_formats_and_downloads_match_checksum(demo) -> None:  # type: ignore[no-untyped-def]
    finance = demo("finance_manager")
    for report_type, fmt in (("executive", "pdf"), ("financial", "xlsx"), ("inventory", "csv")):
        created = finance.post("/reports", json={"report_type": report_type, "format": fmt})
        assert created.status_code == 202
        report = finance.get(f"/reports/{created.json()['id']}").json()
        assert report["status"] == "completed", report.get("error")
        download = finance.get(f"/reports/{report['id']}/download")
        assert download.status_code == 200
        assert hashlib.sha256(download.content).hexdigest() == report["sha256"]
        if fmt == "pdf":
            assert download.content[:5] == b"%PDF-"
        if fmt == "csv":
            text = download.content.decode("utf-8-sig")
            assert "SYNTHETIC DEMONSTRATION DATA" in text
            assert list(csv.reader(io.StringIO(text)))


def test_report_permissions(demo) -> None:  # type: ignore[no-untyped-def]
    hr = demo("hr_manager")
    assert hr.post("/reports", json={"report_type": "financial", "format": "pdf"}).status_code == 403
    assert hr.post("/reports", json={"report_type": "executive", "format": "doc"}).status_code == 422


def test_rule_engine_is_idempotent(demo) -> None:  # type: ignore[no-untyped-def]
    analyst = demo("business_analyst")
    first = analyst.post("/recommendations/generate").json()
    second = analyst.post("/recommendations/generate").json()
    assert second["created"] == 0 and second["skipped_duplicates"] == first["created"] + first["skipped_duplicates"]


def test_audit_trail_records_security_events(app, demo) -> None:  # type: ignore[no-untyped-def]
    TestClient(app).post("/api/v1/auth/login", json={"email": "demo.auditor@novamart.example", "password": "nope-12345"})
    analyst = demo("business_analyst")
    analyst.post("/scenarios", json={"name": "Audited", "store_ids": [_s04(analyst)], "levers": [WORKFORCE],
                                     "monte_carlo_runs": 50})
    auditor = demo("auditor")
    events = auditor.get("/audit-events", params={"limit": 200}).json()["events"]
    actions = {e["action"] for e in events}
    assert {"auth.demo_login", "scenario.created"} <= actions
    assert all("password" not in str(e["details"]).lower() or "[REDACTED]" in str(e["details"]) for e in events)
