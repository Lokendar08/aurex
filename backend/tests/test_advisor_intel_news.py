"""AI advisor grounding, company intelligence, benchmarking, news dedupe, retention, log redaction."""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from app.core.logging import redact_text, redact_value
from app.db.session import session_scope
from app.models import AuditEvent, MarketEntity
from app.services.advisor.verify import numbers_in_text, verify
from app.services.news import add_article, canonicalize_url

QUESTIONS = ["Why did revenue decline?", "Which stores contribute most to profit?",
             "What happens if we hire ten additional employees?", "Which products face stockout risks?",
             "What could happen if prices increase by 5%?", "Which business scenario has the best risk-adjusted outcome?"]


@pytest.mark.parametrize("question", QUESTIONS)
def test_advisor_answers_example_questions_with_traced_numbers(demo, question) -> None:  # type: ignore[no-untyped-def]
    executive = demo("executive")
    r = executive.post("/advisor/ask", json={"question": question})
    assert r.status_code == 200, r.text
    answer = r.json()["message"]["answer"]
    assert answer["mode"] == "deterministic"
    assert answer["verification"]["all_numbers_traced"], answer["verification"]
    for field in ("evidence", "assumptions", "limitations", "confidence", "key_figures"):
        assert field in answer
    assert r.json()["message"]["tool_calls"], "answers must come from tool calls"


def test_advisor_hiring_answer_does_not_invent_revenue(demo) -> None:  # type: ignore[no-untyped-def]
    answer = demo("executive").post("/advisor/ask", json={"question": "What happens if we hire 10 additional employees at S04?"}).json()
    figures = {f["label"]: f["value"] for f in answer["message"]["answer"]["key_figures"]}
    assert figures["Revenue change over horizon"] == 0
    assert figures["Monthly staffing cost increase"] > 0


def test_advisor_models_20_to_30_question_as_a_change_on_recorded_headcount(demo) -> None:  # type: ignore[no-untyped-def]
    r = demo("executive").post("/advisor/ask", json={
        "question": "What happens if we increase employees from 20 to 30 at store S04?"}).json()
    message = r["message"]
    call = message["tool_calls"][0]
    assert call["name"] == "simulate_scenario"
    assert call["input"]["levers"][0]["headcount_change"] == 10 and call["input"]["store_codes"] == ["S04"]
    capacity = call["output"]["levers"][0]["capacity"]
    assert (capacity["current_headcount"], capacity["new_headcount"]) == (20, 30)
    answer = message["answer"]
    figures = {f["label"]: f["value"] for f in answer["key_figures"]}
    assert figures["Revenue change over horizon"] == 0
    assert "20 → 30" in answer["answer"] and answer["verification"]["all_numbers_traced"]


@pytest.mark.parametrize(("question", "expected"), [
    ("Increase headcount to 30 employees at S04", (None, 30, None)),
    ("What if we cut staff by 3 at S02?", (-3, None, None)),
    ("Hire ten more cashiers", (10, None, None)),
    ("Raise prices by 5% and hire 2 people", (2, None, None)),
])
def test_headcount_question_parsing(question, expected) -> None:  # type: ignore[no-untyped-def]
    from app.services.advisor.deterministic import headcount_request

    assert headcount_request(question) == expected


def test_advisor_respects_permissions(demo) -> None:  # type: ignore[no-untyped-def]
    employee = demo("employee")
    answer = employee.post("/advisor/ask", json={"question": "What happens if we hire 10 more staff?"}).json()
    assert "permission" in answer["message"]["answer"]["answer"].lower()
    stores = employee.post("/advisor/ask", json={"question": "Which stores contribute most to profit?"}).json()
    text = stores["message"]["answer"]["answer"]
    assert "S01" not in text and "S04" in text


def test_advisor_conversation_persists(demo) -> None:  # type: ignore[no-untyped-def]
    analyst = demo("business_analyst")
    first = analyst.post("/advisor/ask", json={"question": "Which products face stockout risks?"}).json()
    conversation = first["conversation_id"]
    analyst.post("/advisor/ask", json={"question": "Show me the forecast for next months", "conversation_id": conversation})
    loaded = demo("business_analyst").get(f"/advisor/conversations/{conversation}").json()
    assert [m["role"] for m in loaded["messages"]] == ["user", "assistant", "user", "assistant"]
    other = demo("executive").get(f"/advisor/conversations/{conversation}")
    assert other.status_code == 404  # conversations are private to their user


def test_verification_flags_fabricated_numbers() -> None:
    answer = {"answer": "Revenue grew 12.5% to ₹4.20 crore.", "key_figures": [
        {"label": "growth", "value": 0.125, "display": "12.5%", "source_ref": "T1"}], "confidence": "high", "limitations": []}
    checked = verify(answer, [{"growth": 0.031, "net_sales": 42_000_000}])
    assert checked["verification"]["all_numbers_traced"] is False
    assert 12.5 in checked["verification"]["unverified_numbers_in_text"]
    assert checked["confidence"] == "medium"
    ok = verify({"answer": "Revenue was ₹4.20 crore, up 3.1%.", "key_figures": [], "confidence": "high", "limitations": []},
                [{"growth": 0.031, "net_sales": 42_000_000}])
    assert ok["verification"]["all_numbers_traced"] is True


def test_number_extraction_ignores_dates_codes_and_product_sizes() -> None:
    found = numbers_in_text("On 2026-10-17 store S04 sold Curd 400g and 1,234.5 units; top 3 items.")
    assert found == [1234.5]


def test_company_profiles_show_sources_and_no_price_for_unlisted(demo) -> None:  # type: ignore[no-untyped-def]
    analyst = demo("business_analyst")
    companies = {c["key"]: c for c in analyst.get("/intelligence/companies").json()["companies"]}
    assert "avenue_supermarts" in companies and "wellness_forever" in companies
    wellness = analyst.get("/intelligence/companies/wellness_forever").json()
    assert wellness["is_listed"] is False and wellness["market_snapshot"] is None
    dmart = analyst.get("/intelligence/companies/avenue_supermarts").json()
    revenue = dmart["financials"]["revenue_from_operations"]
    assert revenue and all(r["source_url"] for r in revenue)
    assert dmart["market_snapshot"]["is_snapshot"] is True
    assert "different measures" in dmart["measures_note"]


def test_derived_growth_matches_reported_figures() -> None:
    from app.services.intelligence import _series, derived_metrics

    with session_scope() as db:
        entity = db.scalar(select(MarketEntity).where(MarketEntity.key == "avenue_supermarts"))
        from app.models import FinancialObservation

        obs = db.scalars(select(FinancialObservation).where(FinancialObservation.entity_id == entity.id)).all()
        series = _series(obs)
        derived = derived_metrics(series)
        revenue = series["revenue_from_operations"]
        assert derived[-1]["revenue_growth"] == pytest.approx(revenue[-1].value / revenue[-2].value - 1, rel=1e-9)


def test_benchmark_labels_synthetic_company_and_comparability(demo) -> None:  # type: ignore[no-untyped-def]
    bench = demo("finance_manager").get("/benchmarking").json()
    own = next(r for r in bench["rows"] if r["own"])
    assert own["is_synthetic"] is True
    assert any("SYNTHETIC" in n for n in bench["comparability_notes"])
    assert any("Fiscal years differ" in n for n in bench["comparability_notes"])


def test_news_dedupe_exact_and_near_duplicate() -> None:
    assert canonicalize_url("https://www.Example.com/a/b/?utm_source=x&id=2#frag") == "https://example.com/a/b?id=2"
    with session_scope() as db:
        published = datetime(2026, 9, 1, tzinfo=UTC)
        first = add_article(db, org_id=None, url="https://news.example/retail/1?utm_campaign=z",
                            title="NovaTest Retail opens 10 new stores in Pune region", source_name="Test Wire",
                            published_at=published)
        same_url = add_article(db, org_id=None, url="https://news.example/retail/1",
                               title="Different title", source_name="Test Wire", published_at=published)
        near = add_article(db, org_id=None, url="https://other.example/story",
                           title="NovaTest Retail opens 10 new stores in the Pune region",
                           source_name="Other", published_at=published + timedelta(days=1))
        assert first["status"] == "created" and same_url["status"] == "exists" and near["status"] == "duplicate"
        assert near["duplicate_of"] == first["id"]


def test_news_search_and_labels(demo) -> None:  # type: ignore[no-untyped-def]
    feed = demo("business_analyst").get("/news", params={"company": "avenue_supermarts"}).json()
    assert feed["articles"]
    article = feed["articles"][0]
    assert article["reported_facts"]["label"] and article["ai_interpretation"] is None


def test_interpretation_requires_llm(demo) -> None:  # type: ignore[no-untyped-def]
    analyst = demo("business_analyst")
    article = analyst.get("/news").json()["articles"][0]
    r = analyst.post(f"/news/{article['id']}/interpret")
    assert r.status_code == 409 and r.json()["error"]["code"] == "llm_not_configured"


def test_log_redaction() -> None:
    assert "hunter2" not in redact_text("password=hunter2 and token: abc.def")
    jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJlLXNpZw"
    assert "eyJ" not in redact_text(f"Authorization: Bearer {jwt}")
    assert "[REDACTED_JWT]" in redact_text(f"token was {jwt} in a URL")
    assert redact_value({"api_key": "k", "nested": {"client_secret": "s", "ok": 1}}) == \
        {"api_key": "[REDACTED]", "nested": {"client_secret": "[REDACTED]", "ok": 1}}
    assert "aurex:[REDACTED]@" in redact_text("postgresql+psycopg://aurex:secretpw@db:5432/x")


def test_log_filter_applies_to_records(caplog) -> None:  # type: ignore[no-untyped-def]
    from app.core.logging import RedactingFilter

    logger = logging.getLogger("aurex.test.redaction")
    logger.addFilter(RedactingFilter())
    with caplog.at_level(logging.INFO, logger="aurex.test.redaction"):
        logger.info("connecting with api_key=sk-live-1234567890abcdef")
    assert "1234567890abcdef" not in caplog.text


def test_retention_purges_only_expired_records() -> None:
    from app.services.retention import purge_expired

    with session_scope() as db:
        old = AuditEvent(action="test.old", details={})
        new = AuditEvent(action="test.new", details={})
        db.add_all([old, new])
        db.flush()
        old.created_at = datetime.now(UTC) - timedelta(days=4000)
        db.commit()
        result = purge_expired(db)
        db.commit()
        assert result["audit_events"] >= 1
        assert db.scalar(select(AuditEvent).where(AuditEvent.action == "test.new")) is not None
        assert db.scalar(select(AuditEvent).where(AuditEvent.action == "test.old")) is None


def test_market_data_refresh_is_platform_only_and_honest_when_unconfigured(demo) -> None:  # type: ignore[no-untyped-def]
    admin = demo("platform_admin")
    status = admin.client.get("/api/v1/platform/market-data").json()
    assert status["configured"] is False and status["note"]
    assert any(s["key"].endswith(":DMART") for s in status["securities"])
    refused = admin.client.post("/api/v1/platform/market-data/refresh", headers=admin.headers,
                                json={"symbols": {"NSE:DMART": "DMART.BSE"}})
    assert refused.status_code == 409 and refused.json()["error"]["code"] == "market_data_not_configured"
    owner = demo("org_owner")
    assert owner.client.get("/api/v1/platform/market-data").status_code == 403
