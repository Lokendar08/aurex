"""Organization isolation and server-side role-based access control."""

from __future__ import annotations

import pytest


def test_member_cannot_see_another_organization(new_org, demo) -> None:  # type: ignore[no-untyped-def]
    outsider = new_org()
    novamart = demo("org_owner")
    # Organization endpoints answer 404 for non-members (existence is not revealed)
    for path in ("", "/companies", "/stores", "/dashboard/executive", "/integrations", "/scenarios", "/reports"):
        r = outsider.client.get(f"/api/v1/orgs/{novamart.org_id}{path}")
        assert r.status_code == 404, path


def test_resource_ids_from_another_org_are_not_found(new_org, demo) -> None:  # type: ignore[no-untyped-def]
    owner_a = new_org()
    novamart = demo("org_owner")
    integration_id = novamart.get("/integrations").json()["integrations"][0]["id"]
    # Same id, attacker's own org path: still not found (queries always filter by org)
    r = owner_a.get(f"/integrations/{integration_id}")
    assert r.status_code == 404
    store_id = novamart.get("/stores").json()["stores"][0]["id"]
    assert owner_a.patch(f"/stores/{store_id}", json={"name": "hijack"}).status_code == 404


def test_platform_admin_has_no_tenant_data_access(demo) -> None:  # type: ignore[no-untyped-def]
    admin = demo("platform_admin")
    novamart = demo("org_owner")
    assert admin.org_id is None  # no memberships
    r = admin.client.get(f"/api/v1/orgs/{novamart.org_id}/dashboard/executive")
    assert r.status_code == 404
    overview = admin.client.get("/api/v1/platform/overview")
    assert overview.status_code == 200 and "metadata only" in overview.json()["data_access_note"]


def test_platform_endpoints_require_platform_admin(demo) -> None:  # type: ignore[no-untyped-def]
    owner = demo("org_owner")
    assert owner.client.get("/api/v1/platform/organizations").status_code == 403


@pytest.mark.parametrize("role,path,expected", [
    ("employee", "/analytics/financial", 403),
    ("employee", "/dashboard/executive", 403),
    ("employee", "/dashboard/sales-summary", 200),
    ("employee", "/integrations", 403),
    ("inventory_manager", "/analytics/inventory", 200),
    ("inventory_manager", "/analytics/financial", 403),
    ("hr_manager", "/analytics/workforce", 200),
    ("hr_manager", "/analytics/inventory", 403),
    ("finance_manager", "/analytics/budget-vs-actual", 200),
    ("auditor", "/audit-events", 200),
    ("executive", "/audit-events", 403),
    ("business_analyst", "/analytics/categories", 200),
])
def test_role_permission_matrix(demo, role, path, expected) -> None:  # type: ignore[no-untyped-def]
    assert demo(role).get(path).status_code == expected


def test_auditor_is_read_only(demo) -> None:  # type: ignore[no-untyped-def]
    auditor = demo("auditor")
    assert auditor.get("/scenarios").status_code == 200
    assert auditor.post("/decision-lab/simulate", json={"levers": []}).status_code == 403
    assert auditor.post("/reports", json={"report_type": "executive", "format": "pdf"}).status_code == 403
    assert auditor.post("/recommendations/generate").status_code == 403
    assert auditor.post("/advisor/ask", json={"question": "How are we doing?"}).status_code == 403


def test_store_scoped_manager_sees_only_assigned_stores(demo) -> None:  # type: ignore[no-untyped-def]
    ops = demo("operations_manager")  # scoped to S01 (S02 does not exist in the compact dataset)
    stores = ops.get("/stores").json()
    assert stores["scoped"] is True and {s["code"] for s in stores["stores"]} == {"S01"}
    owner = demo("org_owner")
    s04 = next(s["id"] for s in owner.get("/stores").json()["stores"] if s["code"] == "S04")
    r = ops.get("/dashboard/executive", params={"store_ids": [s04]})
    assert r.status_code == 403
    rows = ops.get("/analytics/stores").json()["stores"]
    assert {r["code"] for r in rows} == {"S01"}


def test_employee_sales_summary_is_limited_to_their_store_and_has_no_costs(demo) -> None:  # type: ignore[no-untyped-def]
    employee = demo("employee")  # scoped to S04
    owner = demo("org_owner")
    s01 = next(s["id"] for s in owner.get("/stores").json()["stores"] if s["code"] == "S01")
    assert employee.get("/dashboard/sales-summary", params={"store_ids": [s01]}).status_code == 403
    body = employee.get("/dashboard/sales-summary").json()
    keys = {k["key"] for k in body["kpis"]}
    assert "gross_profit" not in keys and "net_profit" not in keys
    assert all("gross_profit" not in point for point in body["series"])


def test_finance_fields_are_stripped_for_roles_without_finance(demo) -> None:  # type: ignore[no-untyped-def]
    inv = demo("inventory_manager")
    rows = inv.get("/analytics/stores").json()["stores"]
    assert rows and all("store_contribution" not in r for r in rows)


def test_backend_enforces_member_management(demo) -> None:  # type: ignore[no-untyped-def]
    analyst = demo("business_analyst")
    members = analyst.get("/members")
    assert members.status_code == 200
    target = members.json()["members"][0]["id"]
    assert analyst.patch(f"/members/{target}", json={"role": "org_owner"}).status_code == 403


def test_roles_endpoint_matches_server_matrix(demo) -> None:  # type: ignore[no-untyped-def]
    from app.core.permissions import ROLE_PERMISSIONS, Role

    roles = demo("org_owner").get("/roles").json()["roles"]
    for entry in roles:
        assert set(entry["permissions"]) == {p.value for p in ROLE_PERMISSIONS[Role(entry["role"])]}
    assert len(roles) == 9  # the nine membership roles (platform admin is platform-level)
