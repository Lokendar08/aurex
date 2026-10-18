"""Fiscal calendars and reporting-period resolution.

Fiscal years are named by the calendar year in which they END (Indian convention: the year
April 2025 - March 2026 is FY2026). With ``fiscal_year_start_month = 1`` the fiscal year equals the
calendar year.
"""

from __future__ import annotations

import calendar
from dataclasses import dataclass
from datetime import date, timedelta

from dateutil.relativedelta import relativedelta
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import ValidationAppError
from app.models import Company, FinancialPeriod


def month_start(d: date) -> date:
    return d.replace(day=1)


def month_end(d: date) -> date:
    return d.replace(day=calendar.monthrange(d.year, d.month)[1])


def fiscal_year_of(d: date, fy_start_month: int) -> int:
    if fy_start_month == 1:
        return d.year
    return d.year + 1 if d.month >= fy_start_month else d.year


def fiscal_month_of(d: date, fy_start_month: int) -> int:
    return ((d.month - fy_start_month) % 12) + 1


def fiscal_quarter_of(d: date, fy_start_month: int) -> int:
    return (fiscal_month_of(d, fy_start_month) - 1) // 3 + 1


def fiscal_year_start(fiscal_year: int, fy_start_month: int) -> date:
    if fy_start_month == 1:
        return date(fiscal_year, 1, 1)
    return date(fiscal_year - 1, fy_start_month, 1)


def fiscal_year_range(fiscal_year: int, fy_start_month: int) -> tuple[date, date]:
    start = fiscal_year_start(fiscal_year, fy_start_month)
    return start, start + relativedelta(years=1) - timedelta(days=1)


def fiscal_quarter_range(fiscal_year: int, quarter: int, fy_start_month: int) -> tuple[date, date]:
    start = fiscal_year_start(fiscal_year, fy_start_month) + relativedelta(months=3 * (quarter - 1))
    return start, start + relativedelta(months=3) - timedelta(days=1)


def ensure_financial_periods(db: Session, company: Company, first_fy: int, last_fy: int) -> int:
    existing = set(db.scalars(select(FinancialPeriod.period_start).where(FinancialPeriod.company_id == company.id)))
    created = 0
    fy_month = company.fiscal_year_start_month
    for fy in range(first_fy, last_fy + 1):
        start = fiscal_year_start(fy, fy_month)
        for i in range(12):
            p_start = start + relativedelta(months=i)
            if p_start in existing:
                continue
            db.add(FinancialPeriod(
                org_id=company.org_id, company_id=company.id, period_start=p_start, period_end=month_end(p_start),
                fiscal_year=fy, fiscal_quarter=fiscal_quarter_of(p_start, fy_month),
                fiscal_month=fiscal_month_of(p_start, fy_month), label=p_start.strftime("%b %Y"),
            ))
            created += 1
    return created


@dataclass(frozen=True)
class ResolvedPeriod:
    key: str
    label: str
    start: date
    end: date
    comparison_start: date
    comparison_end: date
    comparison_label: str
    granularity: str  # day | week | month

    @property
    def days(self) -> int:
        return (self.end - self.start).days + 1


def _granularity_for(days: int) -> str:
    if days <= 45:
        return "day"
    if days <= 200:
        return "week"
    return "month"


def resolve_period(period: str, fy_start_month: int, data_end: date, start: date | None = None,
                   end: date | None = None) -> ResolvedPeriod:
    """Resolve a reporting-period key relative to the latest available data date (not the wall clock).

    Comparison periods are like-for-like: the same number of days one year earlier, so a partial
    month is compared with the same partial month of the previous year.
    """
    anchor = data_end
    key = period or "last_12m"
    if key == "custom":
        if start is None or end is None or end < start:
            raise ValidationAppError("Custom periods need start <= end")
        p_start, p_end, label = start, end, f"{start.isoformat()} – {end.isoformat()}"
    elif key == "last_30d":
        p_start, p_end, label = anchor - timedelta(days=29), anchor, "Last 30 days"
    elif key == "last_90d":
        p_start, p_end, label = anchor - timedelta(days=89), anchor, "Last 90 days"
    elif key == "mtd":
        p_start, p_end, label = month_start(anchor), anchor, f"Month to date ({anchor:%b %Y})"
    elif key == "qtd":
        fy = fiscal_year_of(anchor, fy_start_month)
        q = fiscal_quarter_of(anchor, fy_start_month)
        p_start, _ = fiscal_quarter_range(fy, q, fy_start_month)
        p_end, label = anchor, f"FY{fy} Q{q} to date"
    elif key == "ytd":
        fy = fiscal_year_of(anchor, fy_start_month)
        p_start, p_end, label = fiscal_year_start(fy, fy_start_month), anchor, f"FY{fy} to date"
    elif key == "last_fy":
        fy = fiscal_year_of(anchor, fy_start_month) - 1
        p_start, p_end = fiscal_year_range(fy, fy_start_month)
        label = f"FY{fy}"
    elif key.startswith("fy:"):
        raw = key.split(":", 1)[1]
        if not raw.isdigit() or not 1900 <= int(raw) <= 2200:
            raise ValidationAppError("Fiscal-year periods look like fy:2026", details={"period": period})
        fy = int(raw)
        p_start, p_end = fiscal_year_range(fy, fy_start_month)
        p_end = min(p_end, anchor)
        label = f"FY{fy}" + (" (to date)" if p_end == anchor else "")
    elif key == "last_12m":
        # Twelve complete months ending with the last complete month of data.
        last_complete = anchor if anchor == month_end(anchor) else month_start(anchor) - timedelta(days=1)
        p_end = last_complete
        p_start = month_start(last_complete) - relativedelta(months=11)
        label = f"Last 12 months ({p_start:%b %Y} – {p_end:%b %Y})"
    else:
        raise ValidationAppError("Unknown period", details={"period": period,
                                 "allowed": ["last_30d", "last_90d", "mtd", "qtd", "ytd", "last_fy", "last_12m",
                                             "fy:<year>", "custom"]})
    if p_start > p_end:
        raise ValidationAppError("The selected period has no days with data")
    c_start = p_start - relativedelta(years=1)
    c_end = p_end - relativedelta(years=1)
    days = (p_end - p_start).days + 1
    return ResolvedPeriod(key=key, label=label, start=p_start, end=p_end, comparison_start=c_start,
                          comparison_end=c_end, comparison_label="Same period last year",
                          granularity=_granularity_for(days))
