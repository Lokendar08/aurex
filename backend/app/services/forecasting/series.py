"""Training series extracted from stored, authoritative data.

Incomplete trailing periods (the current week/month) are dropped so models are never trained on
partial totals. Short gaps (<= 3 days) in daily series are interpolated and disclosed; longer gaps are
reported as a limitation.
"""

from __future__ import annotations

import calendar
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date, timedelta

import numpy as np
import pandas as pd
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.models.facts import OPERATING_EXPENSE_CATEGORIES
from app.services.analytics.base import Scope, chosen_source, data_bounds, read_frame


@dataclass
class TrainingSeries:
    series: pd.Series
    freq: str
    notes: list[str] = field(default_factory=list)
    covariate_fn: Callable[[pd.DatetimeIndex], pd.DataFrame] | None = None


def _daily(db: Session, scope: Scope, column: str, store_id: uuid.UUID | None) -> TrainingSeries:
    params = scope.params()
    clause = scope.store_clause()
    if store_id is not None:
        clause = "store_id = :sid"
        params["sid"] = store_id
    frame = read_frame(db, f"""SELECT business_date, sum({column}) AS v FROM agg_store_daily
                                WHERE company_id = :company AND {clause} GROUP BY business_date ORDER BY 1""", params)
    notes: list[str] = []
    if frame.empty:
        return TrainingSeries(pd.Series(dtype=float), "D", ["No data"])
    s = pd.Series(pd.to_numeric(frame["v"], errors="coerce").to_numpy(dtype=float),
                  index=pd.to_datetime(frame["business_date"]))
    full = pd.date_range(s.index.min(), s.index.max(), freq="D")
    missing = len(full) - len(s)
    s = s.reindex(full)
    if missing:
        # Interpolate only interior gaps of at most 3 days; longer gaps are dropped, never partly filled.
        gap = s.isna()
        run_length = gap.groupby((gap != gap.shift()).cumsum()).transform("sum")
        short = gap & (run_length <= 3)
        s = s.where(~short, s.interpolate(limit_area="inside"))
        remaining = int(s.isna().sum())
        notes.append(f"{missing} day(s) without data; gaps of up to 3 days were interpolated"
                     + (f", {remaining} longer-gap days dropped" if remaining else ""))
        s = s.dropna()
    return TrainingSeries(s, "D", notes)


def net_sales_daily(db: Session, scope: Scope, store_id: uuid.UUID | None = None) -> TrainingSeries:
    result = _daily(db, scope, "net_amount", store_id)
    if store_id is not None and not result.series.empty:
        opened = db.execute(text("SELECT opened_on FROM stores WHERE id = :s"), {"s": store_id}).scalar()
        if opened:
            # Store age is known in advance for any future date; a generic log transform captures ramp-up.
            opened_ts = pd.Timestamp(opened)

            def store_age(index: pd.DatetimeIndex) -> pd.DataFrame:
                age = np.clip((index - opened_ts).days / 30.44, 0, None)
                return pd.DataFrame({"store_age_log": np.log1p(age)}, index=index)

            result.covariate_fn = store_age
    return result


def transactions_daily(db: Session, scope: Scope, store_id: uuid.UUID | None = None) -> TrainingSeries:
    return _daily(db, scope, "transaction_count", store_id)


def units_weekly(db: Session, scope: Scope, category_code: str | None) -> TrainingSeries:
    _, data_end = data_bounds(db, scope.company_id)
    params = scope.params(cat=category_code)
    frame = read_frame(db, f"""
        SELECT date_trunc('week', s.business_date)::date AS week, sum(s.quantity) AS v
        FROM sales_records s JOIN products p ON p.id = s.product_id
        LEFT JOIN product_categories c ON c.id = p.category_id
        JOIN agg_store_daily a ON a.store_id = s.store_id AND a.business_date = s.business_date
             AND a.sales_integration_id = s.integration_id
        WHERE s.company_id = :company AND {scope.store_clause('s.store_id')}
          {"AND c.code = :cat" if category_code else ""}
        GROUP BY 1 ORDER BY 1""", params)
    if frame.empty or data_end is None:
        return TrainingSeries(pd.Series(dtype=float), "W", ["No data"])
    s = pd.Series(pd.to_numeric(frame["v"]).to_numpy(dtype=float), index=pd.to_datetime(frame["week"]))
    last_full_week_start = pd.Timestamp(data_end - timedelta(days=data_end.weekday()))
    if data_end.weekday() != 6:
        s = s[s.index < last_full_week_start]
    first = s.index.min()
    s = s[s.index > first] if len(s) > 1 else s  # first week may be partial
    return TrainingSeries(s.asfreq("7D", fill_value=0.0), "W", ["Weekly units; the current partial week is excluded"])


def opex_monthly(db: Session, scope: Scope) -> TrainingSeries:
    source = chosen_source(db, scope, "expenses")
    _, data_end = data_bounds(db, scope.company_id)
    if source is None or data_end is None:
        return TrainingSeries(pd.Series(dtype=float), "M", ["No expense data"])
    cats = ", ".join(f"'{c}'" for c in OPERATING_EXPENSE_CATEGORIES)
    frame = read_frame(db, f"""
        SELECT date_trunc('month', expense_date)::date AS month, sum(amount) AS v FROM expenses
        WHERE company_id = :company AND integration_id = :src AND category IN ({cats}) AND {scope.store_clause()}
        GROUP BY 1 ORDER BY 1""", scope.params(src=source))
    s = pd.Series(pd.to_numeric(frame["v"]).to_numpy(dtype=float), index=pd.to_datetime(frame["month"]))
    if data_end.day != calendar.monthrange(data_end.year, data_end.month)[1]:
        s = s[s.index < pd.Timestamp(data_end.replace(day=1))]
    return TrainingSeries(s.asfreq("MS"), "M", ["Monthly operating expenses (excl. depreciation, finance costs, tax); "
                                               "the current month is excluded"])


def inventory_value_weekly(db: Session, scope: Scope) -> TrainingSeries:
    source = chosen_source(db, scope, "inventory")
    if source is None:
        return TrainingSeries(pd.Series(dtype=float), "W", ["No inventory data"])
    frame = read_frame(db, f"""
        SELECT snapshot_date, sum(inventory_value) AS v FROM inventory_snapshots
        WHERE company_id = :company AND integration_id = :src AND {scope.store_clause()}
          AND extract(isodow FROM snapshot_date) = 7
        GROUP BY 1 ORDER BY 1""", scope.params(src=source))
    s = pd.Series(pd.to_numeric(frame["v"]).to_numpy(dtype=float), index=pd.to_datetime(frame["snapshot_date"]))
    s.index = s.index - pd.Timedelta(days=6)  # label each Sunday snapshot by its week's Monday
    s = s.asfreq("7D")
    gap = s.isna()
    run_length = gap.groupby((gap != gap.shift()).cumsum()).transform("sum")
    s = s.where(~(gap & (run_length <= 2)), s.interpolate(limit_area="inside"))  # never part of a longer gap
    return TrainingSeries(s.dropna(), "W", ["Week-end (Sunday) inventory value at cost"])


def month_bounds(d: date) -> tuple[date, date]:
    return d.replace(day=1), d.replace(day=calendar.monthrange(d.year, d.month)[1])
