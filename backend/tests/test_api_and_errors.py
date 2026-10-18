"""API validation, error handling, rate limiting, security headers, health, dashboard contracts."""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient


def test_validation_errors_have_consistent_shape(demo) -> None:  # type: ignore[no-untyped-def]
    owner = demo("org_owner")
    r = owner.post("/stores", json={"company_id": "not-a-uuid", "code": "bad code!", "name": ""})
    assert r.status_code == 422
    body = r.json()
    assert body["error"]["code"] == "validation_error" and body["request_id"]
    fields = {tuple(d["loc"])[-1] for d in body["error"]["details"]}
    assert {"company_id", "code", "name"} <= fields


def test_unknown_period_rejected(demo) -> None:  # type: ignore[no-untyped-def]
    r = demo("executive").get("/dashboard/executive", params={"period": "forever"})
    assert r.status_code == 422 and "allowed" in r.json()["error"]["details"]


def test_custom_period_requires_valid_range(demo) -> None:  # type: ignore[no-untyped-def]
    r = demo("executive").get("/dashboard/executive", params={"period": "custom", "start": "2026-03-01",
                                                               "end": "2026-02-01"})
    assert r.status_code == 422


def test_not_found_and_method_not_allowed(demo) -> None:  # type: ignore[no-untyped-def]
    owner = demo("org_owner")
    assert owner.get(f"/scenarios/{uuid.uuid4()}").json()["error"]["code"] == "not_found"
    assert owner.client.put("/api/v1/health").status_code == 405


def test_unhandled_errors_do_not_leak_internals(app, monkeypatch, demo) -> None:  # type: ignore[no-untyped-def]
    from app.services.analytics import dashboard

    def explode(*args, **kwargs):  # type: ignore[no-untyped-def]
        raise RuntimeError("database password is hunter2")

    monkeypatch.setattr("app.api.routes.dashboard.executive_dashboard", explode)
    client = TestClient(app, raise_server_exceptions=False)
    client.post("/api/v1/auth/demo/login", json={"role": "executive"})
    org = client.get("/api/v1/auth/me").json()["memberships"][0]["org_id"]
    r = client.get(f"/api/v1/orgs/{org}/dashboard/executive")
    assert r.status_code == 500 and r.json()["error"]["code"] == "internal_error"
    assert "hunter2" not in r.text and r.json()["request_id"]
    _ = dashboard


def test_rate_limiting_on_login(app) -> None:  # type: ignore[no-untyped-def]
    client = TestClient(app)
    codes = [client.post("/api/v1/auth/login", json={"email": "rl@acme.example", "password": "x" * 12}).status_code
             for _ in range(12)]
    assert 429 in codes
    limited = client.post("/api/v1/auth/login", json={"email": "rl@acme.example", "password": "x" * 12})
    assert limited.status_code == 429 and limited.headers.get("Retry-After")


def test_security_headers_and_no_store(app) -> None:  # type: ignore[no-untyped-def]
    r = TestClient(app).get("/api/v1/health")
    assert r.headers["X-Content-Type-Options"] == "nosniff"
    assert r.headers["X-Frame-Options"] == "DENY"
    assert r.headers["Cache-Control"] == "no-store"
    assert r.headers["X-Request-ID"]


def test_readiness_reports_database_and_migration(app) -> None:  # type: ignore[no-untyped-def]
    body = TestClient(app).get("/api/v1/health/ready").json()
    assert body["status"] == "ready" and body["checks"]["database"]["migration"]


def test_dashboard_contract_and_missing_values_never_zero(demo) -> None:  # type: ignore[no-untyped-def]
    body = demo("executive").get("/dashboard/executive", params={"period": "last_90d"}).json()
    assert body["synthetic_notice"]
    for kpi in body["kpis"]:
        assert {"value", "status", "definition", "unit"} <= set(kpi)
        if kpi["status"] != "ok":
            assert kpi["value"] is None or kpi["status"] in ("incomplete",)
    freshness = {f["fact"]: f for f in body["freshness"]}
    assert freshness["sales"]["latest_date"] and freshness["sales"]["sources"]


def test_dashboard_matches_independent_sql_total(demo) -> None:  # type: ignore[no-untyped-def]
    from sqlalchemy import text

    from app.db.session import session_scope

    body = demo("executive").get("/dashboard/executive", params={"period": "custom", "start": "2026-01-01",
                                                                  "end": "2026-01-31"}).json()
    net = next(k for k in body["kpis"] if k["key"] == "net_sales")["value"]
    with session_scope() as db:
        expected = db.scalar(text("""SELECT sum(s.net_amount) FROM sales_records s
            JOIN integrations i ON i.id = s.integration_id
            WHERE i.provider_key = 'novamart_synthetic' AND s.business_date BETWEEN '2026-01-01' AND '2026-01-31'"""))
    assert net == pytest.approx(float(expected), abs=0.01)


def test_public_catalog_is_honest(app) -> None:  # type: ignore[no-untyped-def]
    entries = TestClient(app).get("/api/v1/public/integration-catalog").json()["entries"]
    by_key = {e["key"]: e for e in entries}
    assert "novamart_synthetic" not in by_key  # demo feed is internal
    for key in ("yash_systems", "qube_pos", "ecolite"):
        assert by_key[key]["availability"] == "requires_vendor_authorization"
    assert by_key["qube_pos"]["verification_status"] == "verified"
    assert by_key["yash_systems"]["verification_status"] == "unverified"


def test_large_upload_rejected(demo, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    from app.core.config import get_settings

    owner = demo("org_owner")
    integration = owner.post("/integrations", json={"provider_key": "csv_upload", "display_name": f"Big {uuid.uuid4().hex[:5]}",
                                                    "config": {"entity_type": "sales"}}).json()
    monkeypatch.setattr(get_settings(), "max_upload_mb", 0)
    r = owner.client.post(owner.url(f"/integrations/{integration['id']}/uploads"), headers=owner.headers,
                          files={"file": ("big.csv", b"a,b\n1,2\n", "text/csv")}, data={"entity_type": "sales"})
    assert r.status_code == 413


def test_client_ip_ignores_spoofed_forwarded_for(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    from starlette.requests import Request

    from app.core.config import get_settings
    from app.services.audit import client_ip

    def request(forwarded: str | None) -> Request:
        headers = [(b"x-forwarded-for", forwarded.encode())] if forwarded else []
        return Request({"type": "http", "headers": headers, "client": ("10.0.0.5", 4321)})

    monkeypatch.setattr(get_settings(), "trusted_proxy_hops", 0)
    assert client_ip(request("1.2.3.4")) == "10.0.0.5"  # no trusted proxy: header ignored
    monkeypatch.setattr(get_settings(), "trusted_proxy_hops", 1)
    assert client_ip(request("6.6.6.6, 203.0.113.9")) == "203.0.113.9"  # entry written by the trusted edge
    assert client_ip(request(None)) == "10.0.0.5"


def test_integration_config_visibility(demo) -> None:  # type: ignore[no-untyped-def]
    owner, finance = demo("org_owner"), demo("finance_manager")
    rest = owner.post("/integrations", json={
        "provider_key": "generic_rest", "display_name": f"Docs API {uuid.uuid4().hex[:5]}",
        "config": {"base_url": "https://api.vendor.example", "auth_type": "oauth2_client_credentials",
                   "api_key_header": "X-Api-Key", "token_url": "https://auth.vendor.example/token",
                   "test_endpoint": "/me", "entities": {}}}).json()
    shown = owner.get(f"/integrations/{rest['id']}").json()["config"]
    # Declared non-secret fields stay readable even though their names contain "key"/"token"
    assert shown["api_key_header"] == "X-Api-Key" and shown["token_url"] == "https://auth.vendor.example/token"
    csv = owner.post("/integrations", json={
        "provider_key": "csv_upload", "display_name": f"Expenses {uuid.uuid4().hex[:5]}",
        "config": {"entity_type": "expense", "date_format": "%d/%m/%Y", "column_mapping": {"amount": "Amt"}}}).json()
    # Uploaders without integrations:manage see the upload settings, not the full configuration
    assert finance.get(f"/integrations/{csv['id']}").json()["config"] == {"entity_type": "expense",
                                                                         "date_format": "%d/%m/%Y"}
    for created in (rest, csv):
        assert owner.delete(f"/integrations/{created['id']}").status_code in (200, 204)
