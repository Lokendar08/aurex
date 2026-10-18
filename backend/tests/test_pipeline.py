"""Ingestion pipeline: validation, idempotency, duplicate prevention, missing vs zero, double counting,
webhooks, REST connector, retries and error logs."""

from __future__ import annotations

import hashlib
import io
import json
import time
import uuid
from datetime import date

import httpx
import pandas as pd
import pytest
from sqlalchemy import select, text

from app.core.security import sign_webhook_payload
from app.db.session import session_scope
from app.models import Company, Integration, SalesRecord, Store, SyncJob
from app.pipeline.entities import ENTITIES
from app.pipeline.validation import validate_batch


def _setup_company_with_store(owner) -> tuple[str, str]:  # type: ignore[no-untyped-def]
    company_id = owner.get("/companies").json()["companies"][0]["id"]
    assert owner.post("/stores", json={"company_id": company_id, "code": "ST1", "name": "Store One"}).status_code == 201
    return company_id, "ST1"


def _csv_integration(owner, entity: str = "sales") -> str:  # type: ignore[no-untyped-def]
    r = owner.post("/integrations", json={"provider_key": "csv_upload", "display_name": f"CSV {uuid.uuid4().hex[:6]}",
                                          "config": {"entity_type": entity}})
    assert r.status_code == 201, r.text
    assert r.json()["status"] == "configured"  # file imports are never shown as "connected"
    return r.json()["id"]


def _upload(owner, integration_id: str, content: str, entity: str, name: str = "file.csv"):  # type: ignore[no-untyped-def]
    return owner.client.post(owner.url(f"/integrations/{integration_id}/uploads"), headers=owner.headers,
                             files={"file": (name, content.encode(), "text/csv")}, data={"entity_type": entity})


PRODUCTS = "sku,name,list_price,unit_cost\nSKU-1,Rice 5kg,500,400\nSKU-2,Oil 1L,200,150\n"
SALES = ("store_code,sku,business_date,quantity,gross_amount,discount_amount,refund_amount,net_amount,cost_amount\n"
         "ST1,SKU-1,2026-09-01,10,5000,500,0,4500,4000\n"
         "ST1,SKU-2,2026-09-01,5,1000,0,0,1000,\n")


def test_csv_import_loads_rows_and_keeps_missing_cost_as_null(new_org) -> None:  # type: ignore[no-untyped-def]
    owner = new_org()
    _setup_company_with_store(owner)
    products = _csv_integration(owner, "product")
    assert _upload(owner, products, PRODUCTS, "product").status_code == 202
    sales = _csv_integration(owner, "sales")
    r = _upload(owner, sales, SALES, "sales")
    assert r.status_code == 202
    job = owner.get(f"/sync-jobs/{r.json()['job']['id']}").json()
    assert job["status"] == "succeeded" and job["records"]["inserted"] == 2
    with session_scope() as db:
        rows = db.scalars(select(SalesRecord).where(SalesRecord.integration_id == uuid.UUID(sales))).all()
        by_qty = {float(r.quantity): r for r in rows}
        assert by_qty[5.0].cost_amount is None          # blank -> unknown, not zero
        assert float(by_qty[10.0].cost_amount) == 4000.0
        assert float(by_qty[10.0].net_amount) == 4500.0


def test_same_file_twice_is_rejected_and_overlapping_rows_are_not_duplicated(new_org) -> None:  # type: ignore[no-untyped-def]
    owner = new_org()
    _setup_company_with_store(owner)
    _upload(owner, _csv_integration(owner, "product"), PRODUCTS, "product")
    sales = _csv_integration(owner, "sales")
    _upload(owner, sales, SALES, "sales")
    again = _upload(owner, sales, SALES, "sales")
    assert again.status_code == 409 and again.json()["error"]["code"] == "duplicate_file"
    # A different file that overlaps (same natural keys) plus one changed and one new row
    overlap = SALES.replace("ST1,SKU-2,2026-09-01,5,1000,0,0,1000,", "ST1,SKU-2,2026-09-01,6,1200,0,0,1200,900") + \
        "ST1,SKU-1,2026-09-02,1,500,0,0,500,400\n"
    job = owner.get(f"/sync-jobs/{_upload(owner, sales, overlap, 'sales').json()['job']['id']}").json()
    assert job["records"] == {"received": 3, "inserted": 1, "updated": 1, "unchanged": 1, "rejected": 0}
    with session_scope() as db:
        count = db.scalar(text("SELECT count(*) FROM sales_records WHERE integration_id = :i"), {"i": sales})
        assert count == 3


def test_invalid_rows_are_rejected_and_logged_with_reasons(new_org) -> None:  # type: ignore[no-untyped-def]
    owner = new_org()
    _setup_company_with_store(owner)
    _upload(owner, _csv_integration(owner, "product"), PRODUCTS, "product")
    sales = _csv_integration(owner, "sales")
    bad = ("store_code,sku,business_date,quantity,gross_amount,discount_amount,refund_amount,net_amount\n"
           "ST1,SKU-1,2026-09-01,1,100,0,0,100\n"       # valid
           "NOPE,SKU-1,2026-09-01,1,100,0,0,100\n"      # unknown store
           "ST1,SKU-9,2026-09-01,1,100,0,0,100\n"       # unknown product
           "ST1,SKU-1,01/09/2026,1,100,0,0,100\n"       # ambiguous date format
           "ST1,SKU-1,2026-09-01,-1,100,0,0,100\n"      # negative quantity
           "ST1,SKU-2,2026-09-01,1,100,10,0,50\n"       # net identity violated
           "ST1,SKU-2,2099-01-01,1,100,0,0,100\n")      # future date
    job_id = _upload(owner, sales, bad, "sales").json()["job"]["id"]
    job = owner.get(f"/sync-jobs/{job_id}").json()
    assert job["status"] == "partially_succeeded"
    assert job["records"]["inserted"] == 1 and job["records"]["rejected"] == 6
    codes = {e["code"] for e in owner.get(f"/sync-jobs/{job_id}/errors").json()["errors"]}
    assert codes >= {"unknown_store", "unknown_product", "invalid_date", "negative_value", "net_mismatch", "future_date"}
    rows = {e["row_number"] for e in owner.get(f"/sync-jobs/{job_id}/errors").json()["errors"]}
    assert 3 in rows  # file row numbers (header is row 1)


def test_validation_distinguishes_blank_from_zero() -> None:
    frame = pd.DataFrame([{"source_record_id": "a", "store_code": "S", "sku": "P", "business_date": "2026-01-01",
                           "quantity": "1", "gross_amount": "10", "discount_amount": "", "refund_amount": "0",
                           "cost_amount": ""}])
    result = validate_batch(ENTITIES["sales"], frame, base_currency="INR", today=date(2026, 6, 1))
    row = result.valid.iloc[0]
    assert pd.isna(row["discount_amount"]) and row["refund_amount"] == 0.0 and pd.isna(row["cost_amount"])
    assert row["net_amount"] == 10.0


def test_currency_mismatch_is_rejected() -> None:
    frame = pd.DataFrame([{"source_record_id": "a", "store_code": "S", "sku": "P", "business_date": "2026-01-01",
                           "quantity": "1", "gross_amount": "10", "currency": "USD"}])
    result = validate_batch(ENTITIES["sales"], frame, base_currency="INR", today=date(2026, 6, 1))
    assert result.rejected == 1 and result.error_counts.get("currency_mismatch") == 1


def test_two_sources_for_same_store_day_are_not_double_counted(new_org) -> None:  # type: ignore[no-untyped-def]
    owner = new_org()
    _setup_company_with_store(owner)
    _upload(owner, _csv_integration(owner, "product"), PRODUCTS, "product")
    pos, erp = _csv_integration(owner, "sales"), _csv_integration(owner, "sales")
    _upload(owner, pos, SALES, "sales", "pos.csv")
    erp_version = SALES.replace("4500,4000", "4500,4000 ").replace("ST1,SKU-2,2026-09-01,5,1000,0,0,1000,",
                                                                    "ST1,SKU-2,2026-09-01,5,1000,0,0,1000,800")
    _upload(owner, erp, erp_version, "sales", "erp.csv")
    with session_scope() as db:
        company = db.scalar(select(Company).where(Company.org_id == uuid.UUID(owner.org_id)))
        total_rows = db.scalar(text("SELECT sum(net_amount) FROM sales_records WHERE company_id = :c"), {"c": company.id})
        agg = db.execute(text("SELECT net_amount, overlapping_sources, sales_integration_id FROM agg_store_daily "
                              "WHERE company_id = :c"), {"c": company.id}).one()
    assert float(total_rows) == 11000.0          # both sources stored (provenance kept)
    assert float(agg[0]) == 5500.0                # but counted once
    assert agg[1] == 2 and str(agg[2]) == pos     # earliest integration is the system of record
    # An explicit authority rule switches the system of record
    r = owner.put("/integrations-authorities", json={"company_id": str(company.id), "fact_type": "sales",
                                                     "integration_id": erp})
    assert r.status_code == 200
    with session_scope() as db:
        chosen = db.scalar(text("SELECT sales_integration_id FROM agg_store_daily WHERE company_id = :c"),
                           {"c": company.id})
    assert str(chosen) == erp


def test_webhook_signature_replay_and_idempotency(new_org) -> None:  # type: ignore[no-untyped-def]
    owner = new_org()
    _setup_company_with_store(owner)
    created = owner.post("/integrations", json={"provider_key": "webhook_push", "display_name": "Push feed",
                                                "config": {}}).json()
    secret, url = created["webhook"]["signing_secret"], created["webhook"]["url"]
    assert created["status"] == "configured"  # not live before a verified event
    body = json.dumps({"entity": "traffic", "records": [{"source_record_id": "t1", "store_code": "ST1",
                                                         "business_date": "2026-09-01", "transaction_count": 120}]}).encode()
    ts = str(int(time.time()))
    good = {"X-Aurex-Timestamp": ts, "X-Aurex-Signature": sign_webhook_payload(secret, ts, body),
            "X-Aurex-Event-Id": "evt-1", "Content-Type": "application/json"}
    bad = owner.client.post(url, content=body, headers={**good, "X-Aurex-Signature": "sha256=deadbeef"})
    assert bad.status_code == 403
    stale_ts = str(int(time.time()) - 3600)
    stale = owner.client.post(url, content=body, headers={**good, "X-Aurex-Timestamp": stale_ts,
                                                          "X-Aurex-Signature": sign_webhook_payload(secret, stale_ts, body)})
    assert stale.status_code == 403
    ok = owner.client.post(url, content=body, headers=good)
    assert ok.status_code == 200 and ok.json()["records"]["inserted"] == 1
    replay = owner.client.post(url, content=body, headers=good)
    assert replay.json()["status"] == "duplicate"
    detail = owner.get(f"/integrations/{created['id']}").json()
    assert detail["status"] == "connected"


def test_rest_connector_only_connected_after_authenticated_test(monkeypatch, new_org) -> None:  # type: ignore[no-untyped-def]
    from app.connectors.rest_api import RestApiConnector

    owner = new_org()
    _setup_company_with_store(owner)
    config = {"base_url": "https://api.vendor.example", "auth_type": "api_key_header", "api_key_header": "X-Key",
              "test_endpoint": "/me", "entities": {"traffic": {
                  "path": "/traffic", "records_path": "data", "pagination": {"type": "page", "size": 2},
                  "field_mapping": {"source_record_id": "id", "store_code": "store", "business_date": "date",
                                    "transaction_count": "tx"}}}}
    created = owner.post("/integrations", json={"provider_key": "generic_rest", "display_name": "Vendor API",
                                                "config": config}).json()
    assert created["status"] == "awaiting_credentials"
    assert owner.post(f"/integrations/{created['id']}/sync").status_code == 409  # never syncs unverified
    owner.patch(f"/integrations/{created['id']}", json={"credentials": {"api_key": "k-123456"}})
    pages = {1: [{"id": "a", "store": "ST1", "date": "2026-09-01", "tx": 10},
                 {"id": "b", "store": "ST1", "date": "2026-09-02", "tx": 12}],
             2: [{"id": "c", "store": "ST1", "date": "2026-09-03", "tx": 9}]}
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers.get("X-Key") == "k-123456"
        if request.url.path == "/me":
            return httpx.Response(200, json={"ok": True})
        calls["n"] += 1
        if calls["n"] == 1:
            return httpx.Response(503)  # transient: retried inside the connector
        return httpx.Response(200, json={"data": pages.get(int(request.url.params.get("page", 1)), [])})

    monkeypatch.setattr(RestApiConnector, "transport", httpx.MockTransport(handler))
    tested = owner.post(f"/integrations/{created['id']}/test").json()
    assert tested["result"]["status"] == "connected"
    job = owner.post(f"/integrations/{created['id']}/sync").json()
    detail = owner.get(f"/sync-jobs/{job['id']}").json()
    assert detail["status"] == "succeeded" and detail["records"]["inserted"] == 3


def test_failed_authentication_marks_error_not_connected(monkeypatch, new_org) -> None:  # type: ignore[no-untyped-def]
    from app.connectors.rest_api import RestApiConnector

    owner = new_org()
    created = owner.post("/integrations", json={"provider_key": "generic_rest", "display_name": "Bad creds",
                                                "config": {"base_url": "https://api.vendor.example", "auth_type": "bearer",
                                                           "test_endpoint": "/me", "entities": {}},
                                                "credentials": {"token": "wrong"}}).json()
    monkeypatch.setattr(RestApiConnector, "transport", httpx.MockTransport(lambda r: httpx.Response(401)))
    tested = owner.post(f"/integrations/{created['id']}/test").json()
    assert tested["result"]["ok"] is False and tested["integration"]["status"] == "error"


def test_credentials_are_encrypted_and_never_returned(new_org) -> None:  # type: ignore[no-untyped-def]
    owner = new_org()
    created = owner.post("/integrations", json={"provider_key": "generic_rest", "display_name": "Secret holder",
                                                "config": {"base_url": "https://api.vendor.example", "auth_type": "bearer",
                                                           "test_endpoint": "/me", "entities": {}},
                                                "credentials": {"token": "super-secret-token-9876"}}).json()
    assert "super-secret" not in json.dumps(created)
    assert created["credentials"]["token"].endswith("9876") and created["credentials"]["token"].startswith("••••")
    with session_scope() as db:
        row = db.get(Integration, uuid.UUID(created["id"]))
        assert b"super-secret" not in bytes(row.secret_ciphertext)
    leaked = owner.post("/integrations", json={"provider_key": "generic_rest", "display_name": "Leaky",
                                               "config": {"password": "oops"}})
    assert leaked.status_code == 422


def test_vendor_profiles_never_claim_a_live_api(new_org) -> None:  # type: ignore[no-untyped-def]
    owner = new_org()
    for key in ("yash_systems", "qube_pos", "ecolite"):
        created = owner.post("/integrations", json={"provider_key": key, "display_name": f"{key} feed", "config": {}}).json()
        assert created["status"] == "awaiting_credentials"
        tested = owner.post(f"/integrations/{created['id']}/test").json()
        assert tested["result"]["ok"] is False and tested["integration"]["status"] == "awaiting_credentials"


def test_transient_failure_schedules_retry(new_org, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    from app.connectors.base import TransientConnectorError
    from app.connectors.synthetic import SyntheticDemoConnector
    from app.pipeline.runner import run_sync
    from app.worker import dispatcher

    queued = []
    monkeypatch.setattr(dispatcher, "_dispatch", lambda job_id, countdown: queued.append(countdown))

    def boom(self, entity, cursor):  # type: ignore[no-untyped-def]
        raise TransientConnectorError("timeout talking to source")

    monkeypatch.setattr(SyntheticDemoConnector, "fetch", boom)
    with session_scope() as db:
        integration = db.scalar(select(Integration).where(Integration.provider_key == "novamart_synthetic"))
        job = SyncJob(org_id=integration.org_id, integration_id=integration.id, trigger="manual", entity_types=["traffic"])
        db.add(job)
        db.commit()
        result = run_sync(db, job.id)
        assert result.status == "failed" and "retry #2" in result.error_message
        retry = db.scalar(select(SyncJob).where(SyncJob.retry_of_id == job.id))
        assert retry is not None and retry.attempt == 2
    assert queued == [30]


def test_seeded_demo_feeds_ran_through_pipeline() -> None:
    with session_scope() as db:
        jobs = db.scalars(select(SyncJob).join(Integration, Integration.id == SyncJob.integration_id)
                          .where(Integration.provider_key == "novamart_synthetic")).all()
        assert jobs and all(j.status in ("succeeded", "partially_succeeded") for j in jobs if j.trigger == "seed")
        stores = db.scalars(select(Store.code)).all()
        assert {"S01", "S04"} <= set(stores)


@pytest.mark.parametrize("filename", ["sales.xlsx"])
def test_excel_upload(new_org, filename) -> None:  # type: ignore[no-untyped-def]
    owner = new_org()
    _setup_company_with_store(owner)
    _upload(owner, _csv_integration(owner, "product"), PRODUCTS, "product")
    r = owner.post("/integrations", json={"provider_key": "excel_upload", "display_name": "Excel sales",
                                          "config": {"entity_type": "sales"}})
    integration_id = r.json()["id"]
    frame = pd.read_csv(io.StringIO(SALES))
    buffer = io.BytesIO()
    frame.to_excel(buffer, index=False)
    up = owner.client.post(owner.url(f"/integrations/{integration_id}/uploads"), headers=owner.headers,
                           files={"file": (filename, buffer.getvalue(),
                                           "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
                           data={"entity_type": "sales"})
    assert up.status_code == 202
    job = owner.get(f"/sync-jobs/{up.json()['job']['id']}").json()
    assert job["records"]["inserted"] == 2
    assert hashlib.sha256(buffer.getvalue()).hexdigest() == owner.get(f"/sync-jobs/{job['id']}").json()["file"]["sha256"]


def test_overlapping_sales_feed_is_not_double_counted_in_product_analytics() -> None:
    """The demo's CSV corrections overlap the POS feed for S01 on the last-but-one day. Product-level analytics
    (categories, revenue bridge, inventory demand) must count only system-of-record rows, like the aggregates."""
    from datetime import timedelta

    from app.models import Organization
    from app.services.analytics.base import Scope, data_bounds, source_count
    from app.services.analytics.operations import product_sales
    from app.services.analytics.pnl import daily_sales

    with session_scope() as db:
        org = db.scalar(select(Organization).where(Organization.is_demo.is_(True)))
        company = db.scalar(select(Company).where(Company.org_id == org.id))
        _, end = data_bounds(db, company.id)
        scope = Scope(org_id=org.id, company=company)
        assert source_count(db, scope, "sales") >= 2  # the overlap exists
        day = end - timedelta(days=1)
        products = product_sales(db, scope, day, day)
        aggregates = daily_sales(db, scope, day, day)
        assert float(products["net"].sum()) == pytest.approx(float(aggregates["net"].sum()), abs=0.01)


def test_budget_versions_are_never_added_together(new_org) -> None:  # type: ignore[no-untyped-def]
    owner = new_org()
    _setup_company_with_store(owner)
    _upload(owner, _csv_integration(owner, "product"), PRODUCTS, "product")
    _upload(owner, _csv_integration(owner, "sales"), SALES, "sales")
    budgets = _csv_integration(owner, "budget")
    header = "version_name,store_code,period_start,metric,amount\n"
    _upload(owner, budgets, header + "Original,ST1,2026-09-01,net_sales,1000\n", "budget", name="v1.csv")
    _upload(owner, budgets, header + "Reforecast,ST1,2026-09-01,net_sales,1200\n", "budget", name="v2.csv")
    params = {"period": "custom", "start": "2026-09-01", "end": "2026-09-30"}
    factor = 1 / 30  # data ends 2026-09-01: the month is prorated by elapsed days
    latest = owner.get("/analytics/budget-vs-actual", params=params).json()
    row = next(r for r in latest["rows"] if r["metric"] == "net_sales")
    assert row["budget"] == pytest.approx(1200 * factor, abs=0.01) and latest["versions_used"] == ["Reforecast"]
    original = owner.get("/analytics/budget-vs-actual", params={**params, "version": "Original"}).json()
    assert next(r for r in original["rows"] if r["metric"] == "net_sales")["budget"] == pytest.approx(1000 * factor,
                                                                                                    abs=0.01)


def test_invalid_required_date_reports_one_error() -> None:
    frame = pd.DataFrame([{"source_record_id": "T-1", "store_code": "ST1", "business_date": "31/02/2026",
                           "transaction_count": "5"}])
    result = validate_batch(ENTITIES["traffic"], frame, base_currency="INR")
    assert result.error_counts == {"invalid_date": 1}  # not also "missing_required" for the same value
