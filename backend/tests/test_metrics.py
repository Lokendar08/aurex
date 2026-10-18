"""Financial formula tests: growth, margins, turnover, zero denominators and missing values."""

from __future__ import annotations

import math

import pytest

from app.services import metrics as m


def test_growth_rate_normal_and_decline() -> None:
    assert m.growth_rate(110, 100).value == pytest.approx(0.10)
    assert m.growth_rate(90, 100).value == pytest.approx(-0.10)


def test_growth_rate_zero_base_is_undefined_not_infinite() -> None:
    result = m.growth_rate(50, 0)
    assert result.value is None and result.status == "zero_denominator"


def test_growth_rate_missing_comparison() -> None:
    assert m.growth_rate(50, None).status == "missing_data"
    assert m.growth_rate(None, 50).status == "missing_data"
    assert m.growth_rate(float("nan"), 50).status == "missing_data"


def test_growth_rate_negative_base_is_flagged() -> None:
    result = m.growth_rate(-50, -100)  # loss narrowed from -100 to -50
    assert result.value == pytest.approx(0.5)
    assert result.note and "negative" in result.note


def test_margin_and_gross_profit() -> None:
    assert m.gross_profit(1000.0, 770.0) == pytest.approx(230.0)
    assert m.gross_profit(1000.0, None) is None  # unknown cost -> unknown gross profit, not 1000
    assert m.margin(230, 1000).value == pytest.approx(0.23)
    assert m.margin(10, 0).status == "zero_denominator"
    assert m.margin(None, 100).status == "missing_data"


def test_net_sales_identity_treats_missing_discount_as_unreported_zero() -> None:
    assert m.net_sales(100.0, 10.0, 5.0) == pytest.approx(85.0)
    assert m.net_sales(100.0, None, None) == pytest.approx(100.0)
    assert m.net_sales(None, 1, 1) is None


def test_inventory_turnover_and_days() -> None:
    # COGS 365 over 365 days on average inventory 36.5 -> 10x per year, 36.5 days
    assert m.inventory_turnover(365.0, 36.5, 365).value == pytest.approx(10.0)
    assert m.inventory_turnover(30.0, 36.5, 30).value == pytest.approx(30 / 36.5 * 365 / 30)
    assert m.inventory_turnover(10.0, 0.0, 30).status == "zero_denominator"
    assert m.days_inventory_outstanding(36.5, 365.0, 365).value == pytest.approx(36.5)


def test_productivity_ratios() -> None:
    assert m.average_basket(1000, 4).value == pytest.approx(250)
    assert m.sales_per_labor_hour(1000, 0).status == "zero_denominator"
    assert m.revenue_per_sqft(36500, 1000, 365).value == pytest.approx(36.5)
    assert m.labor_cost_ratio(60, 1000).value == pytest.approx(0.06)


def test_cagr() -> None:
    assert m.cagr(100, 121, 2).value == pytest.approx(0.10)
    assert m.cagr(-1, 121, 2).status == "not_meaningful"
    assert m.cagr(100, 121, 0).status == "insufficient_history"


def test_budget_variance() -> None:
    v = m.budget_variance(110, 100)
    assert v["variance"] == pytest.approx(10) and v["variance_pct"] == pytest.approx(0.10)
    assert m.budget_variance(None, 100)["status"] == "missing_data"
    assert m.budget_variance(10, 0)["status"] == "zero_denominator"


def test_forecast_accuracy_metrics() -> None:
    actual, forecast = [100, 200, 0, 100], [110, 180, 10, 100]
    assert m.mae(actual, forecast).value == pytest.approx((10 + 20 + 10 + 0) / 4)
    assert m.rmse(actual, forecast).value == pytest.approx(math.sqrt((100 + 400 + 100 + 0) / 4))
    assert m.wape(actual, forecast).value == pytest.approx(40 / 400)
    mape = m.mape(actual, forecast)
    assert mape.value == pytest.approx((0.1 + 0.1 + 0.0) / 3) and "excluded" in (mape.note or "")
    assert m.bias(actual, forecast).value == pytest.approx(0.0)
    assert m.wape([0, 0], [1, 1]).status == "zero_denominator"
    assert m.interval_coverage([1, 5, 10], [0, 0, 0], [2, 6, 9]).value == pytest.approx(2 / 3)


def test_forecast_metric_length_mismatch_raises() -> None:
    with pytest.raises(ValueError):
        m.mae([1, 2], [1])


def test_every_kpi_has_a_definition() -> None:
    for key in ("net_sales", "revenue_growth", "gross_margin", "net_profit", "inventory_turnover", "business_health"):
        definition = m.METRIC_DEFINITIONS[key]
        assert definition["formula"] and definition["label"]


def test_gmroi_is_annualized_and_never_invents_values() -> None:
    assert m.gmroi(30_000.0, 100_000.0, 365).value == pytest.approx(0.30)
    assert m.gmroi(30_000.0, 100_000.0, 73).value == pytest.approx(1.5)  # 73 days annualized: x5
    missing = m.gmroi(None, 100_000.0, 30)
    assert missing.value is None and missing.status != "ok"
    zero = m.gmroi(10.0, 0.0, 30)
    assert zero.value is None and zero.status == "zero_denominator"
