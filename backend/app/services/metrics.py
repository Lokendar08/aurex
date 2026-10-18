"""Single source of truth for business metric formulas.

Every function returns a ``MetricResult`` so callers can distinguish a real value from
"missing data", "zero denominator" or "not meaningful". Nothing silently becomes 0 or infinity.
These formulas are covered by ``tests/test_metrics.py``. Scalar KPIs (dashboard, P&L, inventory,
benchmarking, forecast accuracy, the AI advisor) call them; vectorized per-row ratios in analytics tables
(e.g. workforce productivity by month and store) apply the same definitions with zero denominators -> null.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import asdict, dataclass
from typing import Literal

Status = Literal["ok", "missing_data", "zero_denominator", "not_meaningful", "insufficient_history"]


@dataclass(frozen=True)
class MetricResult:
    value: float | None
    status: Status = "ok"
    note: str | None = None

    @property
    def ok(self) -> bool:
        return self.status == "ok" and self.value is not None

    def to_dict(self) -> dict:
        return asdict(self)


def _missing(*values: float | None) -> bool:
    return any(v is None or (isinstance(v, float) and math.isnan(v)) for v in values)


def ok(value: float, note: str | None = None) -> MetricResult:
    return MetricResult(float(value), "ok", note)


def safe_ratio(numerator: float | None, denominator: float | None, *, label: str = "ratio") -> MetricResult:
    if _missing(numerator, denominator):
        return MetricResult(None, "missing_data", f"{label}: input not available")
    if abs(denominator) < 1e-12:  # type: ignore[arg-type]
        return MetricResult(None, "zero_denominator", f"{label}: denominator is zero")
    return ok(numerator / denominator)  # type: ignore[operator]


def growth_rate(current: float | None, previous: float | None) -> MetricResult:
    """(current - previous) / |previous|.

    previous == 0 -> zero_denominator (growth from nothing is undefined, not infinite).
    previous < 0 (e.g. a loss) -> computed against |previous| and flagged, because the sign of a
    percentage change is not intuitive when the base is negative.
    """
    if _missing(current, previous):
        return MetricResult(None, "missing_data", "comparison period has no data")
    if abs(previous) < 1e-12:  # type: ignore[arg-type]
        return MetricResult(None, "zero_denominator", "previous period value is zero")
    value = (current - previous) / abs(previous)  # type: ignore[operator]
    if previous < 0:  # type: ignore[operator]
        return ok(value, "previous value was negative; change measured against its absolute value")
    return ok(value)


def gross_profit(net_sales: float | None, cogs: float | None) -> float | None:
    if _missing(net_sales, cogs):
        return None
    return float(net_sales - cogs)  # type: ignore[operator]


def margin(profit: float | None, revenue: float | None) -> MetricResult:
    result = safe_ratio(profit, revenue, label="margin")
    if result.ok and revenue is not None and revenue < 0:
        return MetricResult(None, "not_meaningful", "revenue is negative")
    return result


def net_sales(gross: float | None, discounts: float | None, refunds: float | None) -> float | None:
    if gross is None:
        return None
    return float(gross - (discounts or 0.0) - (refunds or 0.0))


def inventory_turnover(cogs: float | None, average_inventory_value: float | None, period_days: int,
                       annualize: bool = True) -> MetricResult:
    """COGS / average inventory at cost, optionally annualized (x 365 / days)."""
    result = safe_ratio(cogs, average_inventory_value, label="inventory turnover")
    if not result.ok:
        return result
    value = result.value * (365.0 / period_days) if annualize and period_days > 0 else result.value  # type: ignore[operator]
    return ok(value, "annualized" if annualize else None)


def days_inventory_outstanding(average_inventory_value: float | None, cogs: float | None, period_days: int) -> MetricResult:
    result = safe_ratio(average_inventory_value, cogs, label="days of inventory")
    if not result.ok:
        return result
    return ok(result.value * period_days)  # type: ignore[operator]


def gmroi(gross_profit_value: float | None, average_inventory_value: float | None, period_days: int) -> MetricResult:
    """Gross margin return on inventory investment (annualized)."""
    result = safe_ratio(gross_profit_value, average_inventory_value, label="GMROI")
    if not result.ok:
        return result
    return ok(result.value * 365.0 / max(period_days, 1), "annualized")  # type: ignore[operator]


def sell_through(units_sold: float | None, units_available: float | None) -> MetricResult:
    return safe_ratio(units_sold, units_available, label="sell-through")


def average_basket(net_sales_value: float | None, transactions: float | None) -> MetricResult:
    return safe_ratio(net_sales_value, transactions, label="average basket")


def sales_per_labor_hour(net_sales_value: float | None, labor_hours: float | None) -> MetricResult:
    return safe_ratio(net_sales_value, labor_hours, label="sales per labor hour")


def transactions_per_labor_hour(transactions: float | None, labor_hours: float | None) -> MetricResult:
    return safe_ratio(transactions, labor_hours, label="transactions per labor hour")


def labor_cost_ratio(labor_cost: float | None, net_sales_value: float | None) -> MetricResult:
    return safe_ratio(labor_cost, net_sales_value, label="labor cost %")


def revenue_per_sqft(net_sales_value: float | None, sqft: float | None, period_days: int) -> MetricResult:
    """Annualized net sales per square foot of selling area."""
    result = safe_ratio(net_sales_value, sqft, label="sales per sq ft")
    if not result.ok:
        return result
    return ok(result.value * 365.0 / max(period_days, 1), "annualized")  # type: ignore[operator]


def retention_rate(returning_customers: float | None, previous_active_customers: float | None) -> MetricResult:
    result = safe_ratio(returning_customers, previous_active_customers, label="retention")
    if result.ok and result.value > 1:  # type: ignore[operator]
        return MetricResult(result.value, "ok", "above 100%: customer counts are not de-duplicated across periods")
    return result


def cagr(begin: float | None, end: float | None, years: float) -> MetricResult:
    if _missing(begin, end):
        return MetricResult(None, "missing_data")
    if years <= 0:
        return MetricResult(None, "insufficient_history", "needs at least one year between observations")
    if begin <= 0 or end <= 0:  # type: ignore[operator]
        return MetricResult(None, "not_meaningful", "CAGR needs positive start and end values")
    return ok((end / begin) ** (1 / years) - 1)  # type: ignore[operator]


def budget_variance(actual: float | None, budget: float | None) -> dict:
    """Absolute and relative variance; favourable direction is decided by the caller (revenue vs cost)."""
    if _missing(actual, budget):
        return {"actual": actual, "budget": budget, "variance": None, "variance_pct": None, "status": "missing_data"}
    variance = actual - budget  # type: ignore[operator]
    pct = safe_ratio(variance, budget, label="variance %")
    return {"actual": actual, "budget": budget, "variance": variance, "variance_pct": pct.value,
            "status": "ok" if pct.ok else pct.status}


# ---------------------------------------------------------------------------------------------
# Forecast accuracy
# ---------------------------------------------------------------------------------------------


def _clean_pairs(actual: Sequence[float], forecast: Sequence[float]) -> tuple[list[float], list[float]]:
    if len(actual) != len(forecast):
        raise ValueError("actual and forecast must have the same length")
    pairs = [(float(a), float(f)) for a, f in zip(actual, forecast, strict=True)
             if not _missing(a, f)]
    return [a for a, _ in pairs], [f for _, f in pairs]


def mae(actual: Sequence[float], forecast: Sequence[float]) -> MetricResult:
    a, f = _clean_pairs(actual, forecast)
    if not a:
        return MetricResult(None, "missing_data")
    return ok(sum(abs(x - y) for x, y in zip(a, f, strict=True)) / len(a))


def rmse(actual: Sequence[float], forecast: Sequence[float]) -> MetricResult:
    a, f = _clean_pairs(actual, forecast)
    if not a:
        return MetricResult(None, "missing_data")
    return ok(math.sqrt(sum((x - y) ** 2 for x, y in zip(a, f, strict=True)) / len(a)))


def wape(actual: Sequence[float], forecast: Sequence[float]) -> MetricResult:
    """Weighted absolute percentage error: sum|a-f| / sum|a| (robust to individual zero actuals)."""
    a, f = _clean_pairs(actual, forecast)
    if not a:
        return MetricResult(None, "missing_data")
    denominator = sum(abs(x) for x in a)
    if denominator < 1e-12:
        return MetricResult(None, "zero_denominator", "all actual values are zero")
    return ok(sum(abs(x - y) for x, y in zip(a, f, strict=True)) / denominator)


def mape(actual: Sequence[float], forecast: Sequence[float]) -> MetricResult:
    """Mean absolute percentage error over periods with non-zero actuals (zeros are excluded, disclosed)."""
    a, f = _clean_pairs(actual, forecast)
    nonzero = [(x, y) for x, y in zip(a, f, strict=True) if abs(x) > 1e-12]
    if not nonzero:
        return MetricResult(None, "zero_denominator", "no non-zero actuals")
    excluded = len(a) - len(nonzero)
    value = sum(abs((x - y) / x) for x, y in nonzero) / len(nonzero)
    return ok(value, f"{excluded} zero-actual periods excluded" if excluded else None)


def bias(actual: Sequence[float], forecast: Sequence[float]) -> MetricResult:
    """Mean (forecast - actual) / mean(actual): positive = over-forecasting."""
    a, f = _clean_pairs(actual, forecast)
    if not a:
        return MetricResult(None, "missing_data")
    mean_actual = sum(a) / len(a)
    if abs(mean_actual) < 1e-12:
        return MetricResult(None, "zero_denominator")
    return ok((sum(f) - sum(a)) / len(a) / mean_actual)


def interval_coverage(actual: Sequence[float], lower: Sequence[float], upper: Sequence[float]) -> MetricResult:
    rows = [(a, lo, hi) for a, lo, hi in zip(actual, lower, upper, strict=True) if not _missing(a, lo, hi)]
    if not rows:
        return MetricResult(None, "missing_data")
    return ok(sum(1 for a, lo, hi in rows if lo <= a <= hi) / len(rows))


# ---------------------------------------------------------------------------------------------
# Definitions shown in the UI next to every KPI
# ---------------------------------------------------------------------------------------------

METRIC_DEFINITIONS: dict[str, dict[str, str]] = {
    "net_sales": {"label": "Net sales", "unit": "currency", "direction": "up",
                  "formula": "Gross sales − discounts − refunds",
                  "description": "Revenue after discounts and customer refunds, from the system-of-record sales feed. "
                                 "Taxes are excluded."},
    "gross_sales": {"label": "Gross sales", "unit": "currency", "direction": "up",
                    "formula": "Σ units × list price", "description": "Sales before discounts and refunds."},
    "revenue_growth": {"label": "Revenue growth", "unit": "percent", "direction": "up",
                       "formula": "(Net sales − comparison net sales) ÷ |comparison net sales|",
                       "description": "Compared with the same days one year earlier (like-for-like calendar). "
                                      "Undefined when the comparison period is zero or missing."},
    "cogs": {"label": "Cost of goods sold", "unit": "currency", "direction": "down",
             "formula": "Σ (units sold − units refunded) × unit cost",
             "description": "From sales lines where cost is reported. Lines without cost are excluded from margin "
                            "calculations and disclosed as cost coverage."},
    "gross_profit": {"label": "Gross profit", "unit": "currency", "direction": "up",
                     "formula": "Net sales (cost-covered) − COGS",
                     "description": "Computed only on sales whose cost is known."},
    "gross_margin": {"label": "Gross margin", "unit": "percent", "direction": "up",
                     "formula": "Gross profit ÷ cost-covered net sales", "description": ""},
    "operating_expenses": {"label": "Operating expenses", "unit": "currency", "direction": "down",
                           "formula": "Σ expenses excluding depreciation, finance costs and income tax",
                           "description": "Monthly ledger expenses. For periods that are not whole months, each "
                                          "month's expenses are allocated evenly across its days."},
    "ebitda": {"label": "EBITDA", "unit": "currency", "direction": "up",
               "formula": "Gross profit − operating expenses", "description": ""},
    "net_profit": {"label": "Net profit", "unit": "currency", "direction": "up",
                   "formula": "EBITDA − depreciation − finance costs − income tax", "description": ""},
    "net_margin": {"label": "Net margin", "unit": "percent", "direction": "up",
                   "formula": "Net profit ÷ net sales", "description": ""},
    "inventory_turnover": {"label": "Inventory turnover", "unit": "ratio", "direction": "up",
                           "formula": "COGS ÷ average inventory at cost × 365 ÷ days",
                           "description": "Annualized. Average inventory is the mean of the inventory snapshots in "
                                          "the period (weekly or daily, as reported)."},
    "days_of_inventory": {"label": "Days of inventory", "unit": "days", "direction": "down",
                          "formula": "Average inventory ÷ COGS × days", "description": ""},
    "gmroi": {"label": "GMROI", "unit": "ratio", "direction": "up",
              "formula": "Gross profit ÷ average inventory at cost × 365 ÷ days",
              "description": "Gross margin return on inventory investment, annualized: gross profit earned per unit of "
                             "average inventory at cost. Not reported when gross profit is unavailable."},
    "operating_cash_flow": {"label": "Operating cash flow", "unit": "currency", "direction": "up",
                            "formula": "Σ operating cash inflows − outflows", "description": "From the cash-flow feed."},
    "cash_balance": {"label": "Cash balance", "unit": "currency", "direction": "up",
                     "formula": "Latest reported bank balance", "description": ""},
    "average_basket": {"label": "Average basket", "unit": "currency", "direction": "up",
                       "formula": "Net sales ÷ transactions", "description": ""},
    "sales_per_labor_hour": {"label": "Sales per labor hour", "unit": "currency", "direction": "up",
                             "formula": "Net sales ÷ hours worked", "description": ""},
    "labor_cost_ratio": {"label": "Labor cost %", "unit": "percent", "direction": "down",
                         "formula": "Labor cost ÷ net sales", "description": ""},
    "revenue_per_sqft": {"label": "Sales per sq ft", "unit": "currency", "direction": "up",
                         "formula": "Net sales ÷ selling area × 365 ÷ days", "description": "Annualized."},
    "forecast_wape": {"label": "Forecast error (WAPE)", "unit": "percent", "direction": "down",
                      "formula": "Σ|actual − forecast| ÷ Σ|actual|",
                      "description": "Measured on time-based backtests, never on training data."},
    "business_health": {"label": "Business health score", "unit": "score", "direction": "up",
                        "formula": "Weighted average of growth, profitability, liquidity, inventory and data-quality "
                                   "component scores (0-100)",
                        "description": "A heuristic summary, not a credit rating. See the component breakdown and "
                                       "limitations."},
}
