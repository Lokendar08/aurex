"""Profit & loss for arbitrary periods, built only from stored, authoritative data.

Rules
- Revenue, COGS and units come from ``agg_store_daily`` (one system of record per store-day).
- Gross profit uses only sales whose cost is known. If cost coverage is below 100%, gross profit for
  the uncovered remainder is *estimated* at the covered gross margin and the result is flagged; below
  90% coverage gross profit is reported as unavailable instead of being estimated.
- Expenses are monthly ledger amounts. For periods that cut through a month, each month's amount is
  allocated evenly across the days that month's data covers (documented assumption).
- A month inside the period that has sales but no expense rows makes everything below gross profit
  "incomplete" rather than silently overstating profit.
"""

from __future__ import annotations

import calendar
from dataclasses import asdict, dataclass, field
from datetime import date, timedelta
from typing import Any

import pandas as pd
from sqlalchemy.orm import Session

from app.models.facts import OPERATING_EXPENSE_CATEGORIES
from app.services import metrics as m
from app.services.analytics.base import Scope, chosen_source, read_frame

MIN_COST_COVERAGE_FOR_ESTIMATE = 0.90


@dataclass
class PnL:
    start: date
    end: date
    gross_sales: float = 0.0
    discounts: float | None = None
    refunds: float | None = None
    net_sales: float = 0.0
    cogs: float | None = None
    cost_covered_net_sales: float = 0.0
    cost_coverage: float | None = None
    units: float | None = None
    transactions: int | None = None
    days_with_sales: int = 0
    gross_profit: float | None = None
    gross_margin: float | None = None
    gross_profit_estimated: bool = False
    expenses_by_category: dict[str, float] = field(default_factory=dict)
    operating_expenses: float | None = None
    depreciation: float | None = None
    finance_costs: float | None = None
    income_tax: float | None = None
    ebitda: float | None = None
    ebit: float | None = None
    profit_before_tax: float | None = None
    net_profit: float | None = None
    ebitda_margin: float | None = None
    net_margin: float | None = None
    expenses_complete: bool = True
    missing_expense_months: list[str] = field(default_factory=list)
    company_level_included: bool = True
    notes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        out = asdict(self)
        out["start"], out["end"] = self.start.isoformat(), self.end.isoformat()
        return out


def daily_sales(db: Session, scope: Scope, start: date, end: date) -> pd.DataFrame:
    frame = read_frame(db, f"""
        SELECT business_date, store_id, gross_amount AS gross, discount_amount AS discount, refund_amount AS refund,
               net_amount AS net, cost_amount AS cost, cost_covered_net_amount AS covered, quantity AS units,
               transaction_count AS txn, line_count, overlapping_sources
        FROM agg_store_daily
        WHERE company_id = :company AND business_date BETWEEN :start AND :end AND {scope.store_clause()}
    """, scope.params(start=start, end=end))
    for col in ("gross", "discount", "refund", "net", "cost", "covered", "units"):
        frame[col] = pd.to_numeric(frame[col], errors="coerce").astype("float64")
    frame["txn"] = pd.to_numeric(frame["txn"], errors="coerce")
    frame["business_date"] = pd.to_datetime(frame["business_date"])
    return frame


def monthly_expenses(db: Session, scope: Scope, start: date, end: date) -> pd.DataFrame:
    source = chosen_source(db, scope, "expenses")
    if source is None:
        return pd.DataFrame(columns=["month", "category", "store_id", "amount", "latest"])
    frame = read_frame(db, f"""
        SELECT date_trunc('month', expense_date)::date AS month, category, store_id, sum(amount) AS amount,
               max(expense_date) AS latest
        FROM expenses
        WHERE company_id = :company AND integration_id = :source
          AND expense_date BETWEEN :start AND :end AND {scope.store_clause()}
        GROUP BY 1, 2, 3
    """, scope.params(source=source, start=start.replace(day=1),
                      end=end.replace(day=calendar.monthrange(end.year, end.month)[1])))
    frame["amount"] = pd.to_numeric(frame["amount"], errors="coerce").astype("float64")
    return frame


def _month_coverage(month: date, data_end: date) -> tuple[date, date]:
    last = month.replace(day=calendar.monthrange(month.year, month.month)[1])
    return month, min(last, data_end)


def allocate_expenses(expenses: pd.DataFrame, start: date, end: date, data_end: date) -> tuple[dict[str, float], list[str]]:
    """Allocate monthly expense totals to [start, end] by day overlap. Returns (by_category, months_with_expenses)."""
    by_category: dict[str, float] = {}
    months = []
    if expenses.empty:
        return by_category, months
    grouped = expenses.groupby(["month", "category"], as_index=False)["amount"].sum()
    for row in grouped.itertuples(index=False):
        month = row.month if isinstance(row.month, date) else pd.Timestamp(row.month).date()
        cov_start, cov_end = _month_coverage(month, data_end)
        covered_days = (cov_end - cov_start).days + 1
        overlap_start, overlap_end = max(start, cov_start), min(end, cov_end)
        overlap = (overlap_end - overlap_start).days + 1
        if overlap <= 0 or covered_days <= 0:
            continue
        by_category[row.category] = by_category.get(row.category, 0.0) + float(row.amount) * overlap / covered_days
        months.append(month.isoformat())
    return by_category, sorted(set(months))


def compute_pnl(db: Session, scope: Scope, start: date, end: date, data_end: date,
                sales: pd.DataFrame | None = None, expenses: pd.DataFrame | None = None) -> PnL:
    end = min(end, data_end)
    pnl = PnL(start=start, end=end, company_level_included=scope.company_level_visible)
    if end < start:
        pnl.notes.append("No data in this period")
        pnl.expenses_complete = False
        return pnl
    if sales is None:
        sales = daily_sales(db, scope, start, end)
    else:
        sales = sales[(sales["business_date"] >= pd.Timestamp(start)) & (sales["business_date"] <= pd.Timestamp(end))]
    if sales.empty:
        pnl.notes.append("No sales recorded in this period")
        pnl.expenses_complete = False
        return pnl
    pnl.gross_sales = float(sales["gross"].sum())
    pnl.discounts = float(sales["discount"].sum()) if sales["discount"].notna().any() else None
    pnl.refunds = float(sales["refund"].sum()) if sales["refund"].notna().any() else None
    pnl.net_sales = float(sales["net"].sum())
    pnl.units = float(sales["units"].sum()) if sales["units"].notna().any() else None
    pnl.transactions = int(sales["txn"].sum()) if sales["txn"].notna().any() else None
    pnl.days_with_sales = int(sales["business_date"].nunique())
    pnl.cost_covered_net_sales = float(sales["covered"].sum())
    cost_total = sales["cost"].sum(min_count=1)
    pnl.cogs = float(cost_total) if pd.notna(cost_total) else None
    coverage = m.safe_ratio(pnl.cost_covered_net_sales, pnl.net_sales)
    pnl.cost_coverage = coverage.value
    if pnl.discounts is None:
        pnl.notes.append("The sales source does not report discounts separately")
    if int((sales["overlapping_sources"] > 1).sum()):
        pnl.notes.append("Some store-days were reported by more than one source; only the system of record was counted")

    # --- gross profit --------------------------------------------------------------------
    if pnl.cogs is not None and pnl.cost_coverage:
        covered_gp = pnl.cost_covered_net_sales - pnl.cogs
        covered_margin = m.margin(covered_gp, pnl.cost_covered_net_sales)
        if pnl.cost_coverage >= 0.9995:
            pnl.gross_profit = covered_gp
            pnl.gross_margin = covered_margin.value
        elif pnl.cost_coverage >= MIN_COST_COVERAGE_FOR_ESTIMATE and covered_margin.ok:
            uncovered = pnl.net_sales - pnl.cost_covered_net_sales
            pnl.gross_profit = covered_gp + uncovered * covered_margin.value  # type: ignore[operator]
            pnl.gross_margin = covered_margin.value
            pnl.gross_profit_estimated = True
            pnl.notes.append(f"Cost is missing for {1 - pnl.cost_coverage:.1%} of net sales; gross profit for that share "
                             f"is estimated at the measured margin of {covered_margin.value:.1%}")
        else:
            pnl.notes.append(f"Cost data covers only {pnl.cost_coverage:.1%} of sales; gross profit is not reported")
    else:
        pnl.notes.append("No cost of goods data: gross profit cannot be computed")

    # --- expenses ------------------------------------------------------------------------
    if expenses is None:
        expenses = monthly_expenses(db, scope, start, end)
    by_category, months_with_expenses = allocate_expenses(expenses, start, end, data_end)
    pnl.expenses_by_category = {k: round(v, 2) for k, v in sorted(by_category.items())}
    sales_months = sorted({d.replace(day=1).isoformat() for d in sales["business_date"].dt.date})
    missing = [mo for mo in sales_months if mo not in months_with_expenses]
    if missing:
        pnl.expenses_complete = False
        pnl.missing_expense_months = missing
        pnl.notes.append("No expenses recorded for " + ", ".join(missing) + "; profit below gross profit is incomplete")
    if not scope.company_level_visible:
        pnl.notes.append("Store view: head-office costs, finance costs and tax are not allocated to stores")

    opex = sum(v for k, v in by_category.items() if k in OPERATING_EXPENSE_CATEGORIES)
    pnl.operating_expenses = opex if by_category else None
    pnl.depreciation = by_category.get("depreciation", 0.0) if by_category else None
    pnl.finance_costs = by_category.get("finance_costs", 0.0) if by_category else None
    pnl.income_tax = by_category.get("income_tax", 0.0) if by_category else None
    if pnl.gross_profit is not None and pnl.operating_expenses is not None and pnl.expenses_complete:
        pnl.ebitda = pnl.gross_profit - pnl.operating_expenses
        pnl.ebit = pnl.ebitda - (pnl.depreciation or 0.0)
        pnl.profit_before_tax = pnl.ebit - (pnl.finance_costs or 0.0)
        pnl.net_profit = pnl.profit_before_tax - (pnl.income_tax or 0.0)
        pnl.ebitda_margin = m.margin(pnl.ebitda, pnl.net_sales).value
        pnl.net_margin = m.margin(pnl.net_profit, pnl.net_sales).value
        if not scope.company_level_visible:
            pnl.notes.append("Store-level 'net profit' is store contribution after store depreciation, before head office")
    return pnl


def monthly_pnl_series(db: Session, scope: Scope, start: date, end: date, data_end: date) -> list[dict[str, Any]]:
    """P&L for each calendar month in [start, end] (partial months clipped to the period)."""
    sales = daily_sales(db, scope, start, end)
    expenses = monthly_expenses(db, scope, start, end)
    out = []
    month = start.replace(day=1)
    while month <= end:
        m_end = month.replace(day=calendar.monthrange(month.year, month.month)[1])
        p_start, p_end = max(start, month), min(end, m_end, data_end)
        if p_start <= p_end:
            pnl = compute_pnl(db, scope, p_start, p_end, data_end, sales=sales, expenses=expenses)
            out.append({"month": month.isoformat(), "label": month.strftime("%b %Y"),
                        "partial": p_start != month or p_end != m_end, **{k: v for k, v in pnl.to_dict().items()
                                                                          if k not in ("start", "end")}})
        month = m_end + timedelta(days=1)
    return out
