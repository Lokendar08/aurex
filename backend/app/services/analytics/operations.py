"""Operational analytics: inventory, suppliers, workforce, stores, categories, expenses, budgets, bridges."""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

import numpy as np
import pandas as pd
from sqlalchemy.orm import Session

from app.models.facts import OPERATING_EXPENSE_CATEGORIES
from app.services import metrics as m
from app.services.analytics.base import Scope, chosen_source, read_frame, sales_authority_join
from app.services.analytics.pnl import (
    MIN_COST_COVERAGE_FOR_ESTIMATE,
    allocate_expenses,
    compute_pnl,
    daily_sales,
    monthly_expenses,
)

DEMAND_WINDOW_DAYS = 28
OVERSTOCK_MIN_DAYS = 60
TARGET_EXTRA_COVER_DAYS = 21


def _num(frame: pd.DataFrame, cols: list[str]) -> pd.DataFrame:
    for col in cols:
        if col in frame:
            frame[col] = pd.to_numeric(frame[col], errors="coerce").astype("float64")
    return frame


def _clean(value: Any) -> Any:
    if isinstance(value, float | np.floating):
        return None if np.isnan(value) or np.isinf(value) else round(float(value), 4)
    if isinstance(value, np.integer):
        return int(value)
    return value


def records(frame: pd.DataFrame) -> list[dict[str, Any]]:
    return [{k: _clean(v) for k, v in row.items()} for row in frame.to_dict(orient="records")]


# ---------------------------------------------------------------------------------------------
# Sales by product / category (system-of-record rows only)
# ---------------------------------------------------------------------------------------------


def product_sales(db: Session, scope: Scope, start: date, end: date) -> pd.DataFrame:
    # With a single sales source every row is authoritative; otherwise keep only system-of-record rows.
    authority_join = sales_authority_join(db, scope)
    frame = read_frame(db, f"""
        SELECT s.product_id, p.sku, p.name AS product, c.code AS category_code, c.name AS category,
               sum(s.quantity) AS units, sum(s.gross_amount) AS gross, sum(s.discount_amount) AS discount,
               sum(s.net_amount) AS net, sum(s.cost_amount) AS cost,
               sum(CASE WHEN s.cost_amount IS NOT NULL THEN s.net_amount ELSE 0 END) AS covered
        FROM sales_records s {authority_join}
        LEFT JOIN products p ON p.id = s.product_id
        LEFT JOIN product_categories c ON c.id = p.category_id
        WHERE s.company_id = :company AND s.business_date BETWEEN :start AND :end AND {scope.store_clause('s.store_id')}
        GROUP BY s.product_id, p.sku, p.name, c.code, c.name
    """, scope.params(start=start, end=end))
    return _num(frame, ["units", "gross", "discount", "net", "cost", "covered"])


def category_performance(db: Session, scope: Scope, start: date, end: date, cmp_start: date, cmp_end: date) -> list[dict]:
    cur = product_sales(db, scope, start, end)
    prev = product_sales(db, scope, cmp_start, cmp_end)
    if cur.empty:
        return []
    agg = cur.groupby(["category_code", "category"], dropna=False).agg(
        net=("net", "sum"), units=("units", "sum"), cost=("cost", "sum"), covered=("covered", "sum")).reset_index()
    prev_net = prev.groupby("category_code")["net"].sum() if not prev.empty else pd.Series(dtype=float)
    total = agg["net"].sum()
    rows = []
    for r in agg.itertuples(index=False):
        gp = r.covered - r.cost if r.cost == r.cost else None
        rows.append({
            "category_code": r.category_code, "category": r.category or "Uncategorized", "net_sales": r.net,
            "units": r.units, "share": m.safe_ratio(r.net, total).value,
            "gross_margin": m.margin(gp, r.covered).value if gp is not None else None,
            "growth": m.growth_rate(r.net, float(prev_net.get(r.category_code)) if r.category_code in prev_net else None).value,
        })
    return sorted([{k: _clean(v) for k, v in row.items()} for row in rows], key=lambda x: -(x["net_sales"] or 0))


def product_performance(db: Session, scope: Scope, start: date, end: date, cmp_start: date, cmp_end: date,
                        limit: int = 15) -> dict[str, list[dict]]:
    cur = product_sales(db, scope, start, end)
    prev = product_sales(db, scope, cmp_start, cmp_end).set_index("product_id")["net"]
    if cur.empty:
        return {"top": [], "bottom": [], "fastest_growing": [], "declining": []}
    cur["gross_profit"] = cur["covered"] - cur["cost"]
    cur["gross_margin"] = cur["gross_profit"] / cur["covered"].replace(0, np.nan)
    cur["prev_net"] = cur["product_id"].map(prev) if len(prev) else np.nan
    cur["growth"] = (cur["net"] - cur["prev_net"]) / cur["prev_net"].abs().replace(0, np.nan)
    cols = ["sku", "product", "category", "net", "units", "gross_margin", "growth"]
    cur = cur.rename(columns={"net": "net_sales"})
    cols = [c if c != "net" else "net_sales" for c in cols]
    with_growth = cur.dropna(subset=["growth"])
    return {
        "top": records(cur.nlargest(limit, "net_sales")[cols]),
        "bottom": records(cur.nsmallest(limit, "net_sales")[cols]),
        "fastest_growing": records(with_growth.nlargest(limit, "growth")[cols]),
        "declining": records(with_growth.nsmallest(limit, "growth")[cols]),
    }


# ---------------------------------------------------------------------------------------------
# Inventory
# ---------------------------------------------------------------------------------------------


def _snapshot_source(db: Session, scope: Scope) -> Any:
    return chosen_source(db, scope, "inventory")


def inventory_value_series(db: Session, scope: Scope, start: date, end: date) -> pd.DataFrame:
    source = _snapshot_source(db, scope)
    if source is None:
        return pd.DataFrame(columns=["snapshot_date", "value", "units", "items", "stocked_out"])
    frame = read_frame(db, f"""
        SELECT snapshot_date, sum(inventory_value) AS value, sum(on_hand_qty) AS units, count(*) AS items,
               sum(CASE WHEN on_hand_qty <= 0 THEN 1 ELSE 0 END) AS stocked_out
        FROM inventory_snapshots
        WHERE company_id = :company AND integration_id = :source AND snapshot_date BETWEEN :start AND :end
          AND {scope.store_clause()}
        GROUP BY snapshot_date ORDER BY snapshot_date
    """, scope.params(source=source, start=start, end=end))
    return _num(frame, ["value", "units"])


def inventory_overview(db: Session, scope: Scope, start: date, end: date, cogs: float | None,
                       gross_profit: float | None = None) -> dict[str, Any]:
    series = inventory_value_series(db, scope, start, end)
    days = (end - start).days + 1
    if series.empty:
        return {"status": "missing_data", "note": "No inventory snapshots in this period", "series": []}
    avg_value = float(series["value"].mean())
    turnover = m.inventory_turnover(cogs, avg_value, days)
    dio = m.days_inventory_outstanding(avg_value, cogs, days)
    gmroi = m.gmroi(gross_profit, avg_value, days)
    latest = series.iloc[-1]
    cadence = "daily" if len(series) > 1 and (pd.to_datetime(series["snapshot_date"]).diff().dt.days.median() <= 1) \
        else "weekly or mixed"
    return {
        "status": "ok", "average_inventory_value": avg_value, "latest_inventory_value": float(latest["value"]),
        "latest_snapshot_date": str(latest["snapshot_date"]), "snapshots_used": int(len(series)),
        "snapshot_cadence": cadence, "inventory_turnover": turnover.to_dict(), "days_of_inventory": dio.to_dict(),
        "gmroi": gmroi.to_dict(),
        "latest_stockout_items": int(latest["stocked_out"]), "latest_items": int(latest["items"]),
        "series": [{"date": str(r.snapshot_date), "value": float(r.value)} for r in series.itertuples(index=False)],
    }


def inventory_positions(db: Session, scope: Scope, data_end: date) -> pd.DataFrame:
    """Latest snapshot per store x product with recent demand, lead time and days of cover."""
    source = _snapshot_source(db, scope)
    if source is None:
        return pd.DataFrame()
    snap = read_frame(db, f"""
        SELECT DISTINCT ON (i.store_id, i.product_id)
               i.store_id, st.code AS store_code, st.name AS store, i.product_id, p.sku, p.name AS product,
               c.name AS category, sp.code AS supplier_code, sp.name AS supplier, sp.contracted_lead_time_days,
               i.snapshot_date, i.on_hand_qty, i.on_order_qty, i.unit_cost, i.inventory_value, i.reorder_point
        FROM inventory_snapshots i
        JOIN stores st ON st.id = i.store_id
        JOIN products p ON p.id = i.product_id
        LEFT JOIN product_categories c ON c.id = p.category_id
        LEFT JOIN suppliers sp ON sp.id = p.primary_supplier_id
        WHERE i.company_id = :company AND i.integration_id = :source AND i.snapshot_date <= :end
          AND i.snapshot_date >= :min_date AND {scope.store_clause('i.store_id')}
        ORDER BY i.store_id, i.product_id, i.snapshot_date DESC
    """, scope.params(source=source, end=data_end, min_date=data_end - timedelta(days=21)))
    if snap.empty:
        return snap
    demand_start = data_end - timedelta(days=DEMAND_WINDOW_DAYS - 1)
    demand = read_frame(db, f"""
        SELECT s.store_id, s.product_id, sum(s.quantity) AS units_28d,
               count(DISTINCT s.business_date) AS days_with_sales
        FROM sales_records s {sales_authority_join(db, scope)}
        WHERE s.company_id = :company AND s.business_date BETWEEN :start AND :end AND {scope.store_clause('s.store_id')}
        GROUP BY s.store_id, s.product_id
    """, scope.params(start=demand_start, end=data_end))
    leads = read_frame(db, f"""
        SELECT po.supplier_id, sp.code AS supplier_code,
               avg(po.received_date - po.order_date) AS actual_lead_days
        FROM purchase_orders po JOIN suppliers sp ON sp.id = po.supplier_id
        WHERE po.company_id = :company AND po.integration_id = :po_source AND po.received_date IS NOT NULL
          AND po.received_date BETWEEN :start AND :end AND {scope.store_clause('po.store_id')}
        GROUP BY po.supplier_id, sp.code
    """, scope.params(start=data_end - timedelta(days=90), end=data_end,
                      po_source=chosen_source(db, scope, "purchasing")))
    snap = _num(snap, ["on_hand_qty", "on_order_qty", "unit_cost", "inventory_value", "reorder_point",
                       "contracted_lead_time_days"])
    demand = _num(demand, ["units_28d", "days_with_sales"])
    leads = _num(leads, ["actual_lead_days"])
    snap = snap.merge(demand, on=["store_id", "product_id"], how="left")
    snap = snap.merge(leads[["supplier_code", "actual_lead_days"]], on="supplier_code", how="left")
    snap["units_28d"] = snap["units_28d"].fillna(0.0)
    snap["avg_daily_demand"] = snap["units_28d"] / DEMAND_WINDOW_DAYS
    snap["lead_time_days"] = snap["actual_lead_days"].fillna(snap["contracted_lead_time_days"])
    snap["days_of_cover"] = np.where(snap["avg_daily_demand"] > 0, snap["on_hand_qty"] / snap["avg_daily_demand"], np.inf)
    snap["cover_incl_on_order"] = np.where(snap["avg_daily_demand"] > 0,
                                           (snap["on_hand_qty"] + snap["on_order_qty"].fillna(0)) / snap["avg_daily_demand"],
                                           np.inf)
    return snap


def stockout_and_overstock(db: Session, scope: Scope, data_end: date, limit: int = 50) -> dict[str, Any]:
    pos = inventory_positions(db, scope, data_end)
    if pos.empty:
        return {"status": "missing_data", "note": "No recent inventory snapshots", "stockout_risks": [], "overstock": []}
    lead = pos["lead_time_days"].fillna(7)
    buffer = np.maximum(2.0, 0.5 * lead)
    # Risk is judged on stock that will exist before a new order could arrive: on hand + open orders.
    risk = np.select(
        [pos["on_hand_qty"] <= 0, pos["cover_incl_on_order"] < lead, pos["cover_incl_on_order"] < lead + buffer],
        ["stocked_out", "high", "medium"], default="low")
    pos["risk"] = np.where(pos["avg_daily_demand"] <= 0, np.where(pos["on_hand_qty"] <= 0, "no_demand_no_stock", "low"), risk)
    pos["projected_stockout_date"] = [
        (data_end + timedelta(days=int(d))).isoformat() if np.isfinite(d) and d < 120 else None
        for d in pos["days_of_cover"]]
    pos["lost_sales_per_day_value"] = np.where(pos["risk"] == "stocked_out", pos["avg_daily_demand"] * pos["unit_cost"], 0)
    cols = ["store_code", "store", "sku", "product", "category", "supplier", "on_hand_qty", "on_order_qty",
            "avg_daily_demand", "days_of_cover", "lead_time_days", "risk", "projected_stockout_date", "inventory_value"]
    order = {"stocked_out": 0, "high": 1, "medium": 2}
    at_risk = pos[pos["risk"].isin(order)].copy()
    at_risk["_o"] = at_risk["risk"].map(order)
    at_risk = at_risk.sort_values(["_o", "days_of_cover"])
    target_cover = pos["lead_time_days"].fillna(7) + TARGET_EXTRA_COVER_DAYS
    over = pos[(pos["days_of_cover"] > np.maximum(OVERSTOCK_MIN_DAYS, target_cover * 2)) & (pos["on_hand_qty"] > 0)].copy()
    over["excess_units"] = (over["on_hand_qty"] - over["avg_daily_demand"] * target_cover[over.index]).clip(lower=0)
    over["excess_value"] = over["excess_units"] * over["unit_cost"]
    over = over.sort_values("excess_value", ascending=False)
    summary = pos.groupby("risk").size().to_dict()
    return {
        "status": "ok", "as_of": data_end.isoformat(), "positions": int(len(pos)),
        "risk_counts": {k: int(v) for k, v in summary.items()},
        "method": (f"Days of cover = (on hand + open purchase orders) ÷ average daily units sold over the last "
                   f"{DEMAND_WINDOW_DAYS} days. High risk when that cover is shorter than the supplier's lead time "
                   "(average of the last 90 days of receipts, else the contracted lead time); medium when it exceeds the "
                   f"lead time by less than max(2 days, half the lead time). Overstock when on-hand cover exceeds "
                   f"max({OVERSTOCK_MIN_DAYS} days, 2 × (lead time + {TARGET_EXTRA_COVER_DAYS} days))."),
        "limitations": ["Average demand during a stockout is understated because sales are capped by stock.",
                        "Demand from the last 28 days ignores upcoming seasonality; see Forecasts for projections."],
        "stockout_risks": records(at_risk[cols].head(limit).replace([np.inf], np.nan)),
        "overstock": records(over[cols + ["excess_units", "excess_value"]].head(limit).replace([np.inf], np.nan)),
        "overstock_value_total": float(over["excess_value"].sum()),
    }


def recent_stockout_days(db: Session, scope: Scope, data_end: date, days: int = 30) -> dict[str, Any]:
    source = _snapshot_source(db, scope)
    if source is None:
        return {"status": "missing_data"}
    frame = read_frame(db, f"""
        SELECT snapshot_date, count(*) AS items, sum(CASE WHEN on_hand_qty <= 0 THEN 1 ELSE 0 END) AS out_of_stock
        FROM inventory_snapshots WHERE company_id = :company AND integration_id = :source
          AND snapshot_date BETWEEN :start AND :end AND {scope.store_clause()}
        GROUP BY snapshot_date ORDER BY snapshot_date
    """, scope.params(source=source, start=data_end - timedelta(days=days - 1), end=data_end))
    if frame.empty:
        return {"status": "missing_data"}
    daily = len(frame) >= days * 0.9
    rate = float(frame["out_of_stock"].sum()) / float(frame["items"].sum())
    return {"status": "ok" if daily else "insufficient_granularity", "days_observed": int(len(frame)),
            "out_of_stock_rate": rate, "note": None if daily else "Snapshots are not daily in this window; rate is approximate",
            "series": [{"date": str(r.snapshot_date), "rate": int(r.out_of_stock) / max(int(r.items), 1)}
                       for r in frame.itertuples(index=False)]}


# ---------------------------------------------------------------------------------------------
# Suppliers
# ---------------------------------------------------------------------------------------------


def supplier_performance(db: Session, scope: Scope, start: date, end: date) -> dict[str, Any]:
    source = chosen_source(db, scope, "purchasing")
    if source is None:
        return {"status": "missing_data", "suppliers": []}
    frame = read_frame(db, f"""
        SELECT sp.code, sp.name, sp.contracted_lead_time_days AS contracted, po.order_date, po.expected_date,
               po.received_date, po.total_amount
        FROM purchase_orders po JOIN suppliers sp ON sp.id = po.supplier_id
        WHERE po.company_id = :company AND po.integration_id = :source AND po.order_date BETWEEN :start AND :end
          AND po.status <> 'cancelled' AND {scope.store_clause('po.store_id')}
    """, scope.params(source=source, start=start, end=end))
    if frame.empty:
        return {"status": "missing_data", "suppliers": []}
    frame = _num(frame, ["contracted", "total_amount"])
    for col in ("order_date", "expected_date", "received_date"):
        frame[col] = pd.to_datetime(frame[col])
    frame["lead"] = (frame["received_date"] - frame["order_date"]).dt.days
    frame["late"] = frame["received_date"] > frame["expected_date"]
    recent_cut = pd.Timestamp(end - timedelta(days=60))
    out = []
    for (code, name), g in frame.groupby(["code", "name"]):
        received = g.dropna(subset=["lead"])
        recent = received[received["order_date"] >= recent_cut]
        prior = received[received["order_date"] < recent_cut]
        trend = m.growth_rate(recent["lead"].mean() if len(recent) else None, prior["lead"].mean() if len(prior) else None)
        out.append({
            "supplier_code": code, "supplier": name, "orders": int(len(g)), "received": int(len(received)),
            "open_orders": int(g["received_date"].isna().sum()), "spend": float(g["total_amount"].sum()),
            "contracted_lead_days": _clean(g["contracted"].iloc[0]),
            "avg_lead_days": _clean(received["lead"].mean()) if len(received) else None,
            "p90_lead_days": _clean(received["lead"].quantile(0.9)) if len(received) else None,
            "on_time_rate": _clean(1 - received["late"].mean()) if len(received) else None,
            "recent_avg_lead_days": _clean(recent["lead"].mean()) if len(recent) else None,
            "lead_time_change_recent_vs_prior": _clean(trend.value),
            "alert": bool(trend.ok and trend.value > 0.4 and len(recent) >= 5),
        })
    frame["month"] = frame["order_date"].dt.to_period("M").dt.to_timestamp()
    monthly = frame.dropna(subset=["lead"]).groupby(["month", "code"])["lead"].mean().reset_index()
    return {"status": "ok", "suppliers": sorted(out, key=lambda r: -r["spend"]),
            "monthly_lead_time": [{"month": r.month.date().isoformat(), "supplier_code": r.code, "avg_lead_days": round(r.lead, 2)}
                                  for r in monthly.itertuples(index=False)],
            "method": "Lead time = received date − order date for received purchase orders. On time = received on or "
                      "before the expected date. Alert when the last 60 days' average exceeds the earlier average by >40%."}


# ---------------------------------------------------------------------------------------------
# Workforce & stores
# ---------------------------------------------------------------------------------------------


def workforce_monthly(db: Session, scope: Scope, start: date, end: date) -> pd.DataFrame:
    source = chosen_source(db, scope, "workforce")
    if source is None:
        return pd.DataFrame()
    frame = read_frame(db, f"""
        SELECT w.period_start AS month, w.store_id, st.code AS store_code, sum(w.headcount) AS headcount,
               sum(w.hours_worked) AS hours, sum(w.overtime_hours) AS overtime, sum(w.labor_cost) AS labor_cost,
               sum(w.hires) AS hires, sum(w.separations) AS separations
        FROM workforce_aggregates w LEFT JOIN stores st ON st.id = w.store_id
        WHERE w.company_id = :company AND w.integration_id = :source AND w.period_type = 'month'
          AND w.period_start BETWEEN :start AND :end AND {scope.store_clause('w.store_id')}
        GROUP BY w.period_start, w.store_id, st.code ORDER BY 1
    """, scope.params(source=source, start=start.replace(day=1), end=end))
    return _num(frame, ["headcount", "hours", "overtime", "labor_cost", "hires", "separations"])


def workforce_overview(db: Session, scope: Scope, start: date, end: date) -> dict[str, Any]:
    wf = workforce_monthly(db, scope, start, end)
    if wf.empty:
        return {"status": "missing_data", "note": "No workforce data", "monthly": [], "stores": []}
    sales = daily_sales(db, scope, start.replace(day=1), end)
    sales["month"] = sales["business_date"].dt.to_period("M").dt.to_timestamp().dt.date
    s_month = sales.groupby(["month", "store_id"]).agg(net=("net", "sum"), txn=("txn", "sum")).reset_index()
    wf["month"] = pd.to_datetime(wf["month"]).dt.date
    merged = wf.merge(s_month, on=["month", "store_id"], how="left")
    store_rows = merged[merged["store_id"].notna()]
    monthly = merged.groupby("month").agg(headcount=("headcount", "sum"), hours=("hours", "sum"),
                                          overtime=("overtime", "sum"), labor_cost=("labor_cost", "sum"),
                                          separations=("separations", "sum")).reset_index()
    store_month = store_rows.groupby("month").agg(store_hours=("hours", "sum"), store_labor=("labor_cost", "sum"),
                                                  net=("net", "sum"), txn=("txn", "sum")).reset_index()
    monthly = monthly.merge(store_month, on="month", how="left")
    monthly["sales_per_labor_hour"] = monthly["net"] / monthly["store_hours"].replace(0, np.nan)
    monthly["transactions_per_labor_hour"] = monthly["txn"] / monthly["store_hours"].replace(0, np.nan)
    monthly["labor_cost_ratio"] = monthly["store_labor"] / monthly["net"].replace(0, np.nan)
    monthly["overtime_share"] = monthly["overtime"] / monthly["hours"].replace(0, np.nan)
    monthly["attrition_rate"] = monthly["separations"] / monthly["headcount"].replace(0, np.nan)
    last_month = store_rows["month"].max()
    latest = store_rows[store_rows["month"] == last_month]
    per_store = store_rows.groupby("store_code").agg(hours=("hours", "sum"), labor_cost=("labor_cost", "sum"),
                                                     net=("net", "sum"), txn=("txn", "sum")).reset_index()
    per_store = per_store.merge(latest[["store_code", "headcount"]], on="store_code", how="left")
    per_store["sales_per_labor_hour"] = per_store["net"] / per_store["hours"].replace(0, np.nan)
    per_store["transactions_per_labor_hour"] = per_store["txn"] / per_store["hours"].replace(0, np.nan)
    per_store["labor_cost_ratio"] = per_store["labor_cost"] / per_store["net"].replace(0, np.nan)
    per_store["avg_monthly_cost_per_employee"] = per_store["labor_cost"] / store_rows.groupby("store_code")[
        "headcount"].sum().reindex(per_store["store_code"]).to_numpy()
    monthly["month"] = monthly["month"].astype(str)
    return {"status": "ok", "latest_month": str(last_month), "monthly": records(monthly),
            "stores": records(per_store.rename(columns={"net": "net_sales", "txn": "transactions"})),
            "note": "Aggregated workforce data only (no individual employee records). Labor % uses store payroll ÷ store sales."}


def store_productivity(db: Session, scope: Scope, start: date, end: date, cmp_start: date, cmp_end: date,
                       data_end: date) -> list[dict[str, Any]]:
    stores = read_frame(db, f"""SELECT id AS store_id, code, name, city, opened_on, selling_area_sqft FROM stores
                                WHERE company_id = :company AND {scope.store_clause('id')} ORDER BY code""",
                        scope.params())
    sales = daily_sales(db, scope, cmp_start, end)
    expenses = monthly_expenses(db, scope, start, end)
    wf = workforce_monthly(db, scope, start, end)
    out = []
    days = (end - start).days + 1
    for st in stores.itertuples(index=False):
        s_cur = sales[(sales["store_id"] == st.store_id) & (sales["business_date"] >= pd.Timestamp(start))
                      & (sales["business_date"] <= pd.Timestamp(end))]
        s_prev = sales[(sales["store_id"] == st.store_id) & (sales["business_date"] >= pd.Timestamp(cmp_start))
                       & (sales["business_date"] <= pd.Timestamp(cmp_end))]
        net = float(s_cur["net"].sum())
        covered = float(s_cur["covered"].sum())
        cost = s_cur["cost"].sum(min_count=1)
        gp = covered - float(cost) if pd.notna(cost) else None
        store_exp = expenses[expenses["store_id"] == st.store_id]
        by_cat, _ = allocate_expenses(store_exp, start, end, data_end)
        store_opex = sum(v for k, v in by_cat.items() if k in OPERATING_EXPENSE_CATEGORIES)
        gm = m.margin(gp, covered)
        coverage = covered / net if net else None
        if gp is None or coverage is None or not gm.ok:
            gp_full = None
        elif coverage >= 0.9995:
            gp_full = gp
        elif coverage >= MIN_COST_COVERAGE_FOR_ESTIMATE:  # same rule as the P&L: estimate the uncovered share
            gp_full = gp + (net - covered) * gm.value
        else:
            gp_full = None  # too little cost data to report a contribution
        hours = float(wf[wf["store_id"] == st.store_id]["hours"].sum()) if not wf.empty else None
        txn = s_cur["txn"].sum(min_count=1)
        prev_net = float(s_prev["net"].sum()) if not s_prev.empty else None
        comparable = bool(st.opened_on and st.opened_on <= cmp_start)
        out.append({k: _clean(v) for k, v in {
            "store_id": str(st.store_id), "code": st.code, "name": st.name, "city": st.city,
            "opened_on": st.opened_on.isoformat() if st.opened_on else None, "net_sales": net,
            "growth": m.growth_rate(net, prev_net).value if comparable else None,
            "comparable_store": comparable, "gross_margin": gm.value, "cost_coverage": coverage,
            "contribution_estimated": gp_full is not None and coverage is not None and coverage < 0.9995,
            "store_contribution": (gp_full - store_opex) if gp_full is not None else None,
            "store_contribution_margin": m.margin((gp_full - store_opex) if gp_full is not None else None, net).value,
            "sales_per_sqft_annualized": m.revenue_per_sqft(net, float(st.selling_area_sqft) if st.selling_area_sqft
                                                            else None, days).value,
            "sales_per_labor_hour": m.sales_per_labor_hour(net, hours).value if hours else None,
            "transactions": int(txn) if pd.notna(txn) else None,
            "average_basket": m.average_basket(net, float(txn) if pd.notna(txn) else None).value,
        }.items()})
    ranked = sorted(out, key=lambda r: -(r["store_contribution"] or -1e18))
    for i, row in enumerate(ranked, 1):
        row["contribution_rank"] = i
    return ranked


# ---------------------------------------------------------------------------------------------
# Expenses, budgets
# ---------------------------------------------------------------------------------------------


def expense_analysis(db: Session, scope: Scope, start: date, end: date, data_end: date) -> dict[str, Any]:
    expenses = monthly_expenses(db, scope, start - timedelta(days=400), end)
    if expenses.empty:
        return {"status": "missing_data", "categories": [], "anomalies": [], "monthly": []}
    by_cat, months = allocate_expenses(expenses, start, end, data_end)
    total = sum(by_cat.values())
    stores = read_frame(db, "SELECT id AS store_id, code FROM stores WHERE company_id = :company", scope.params())
    code = dict(zip(stores["store_id"], stores["code"], strict=False))
    expenses["month"] = pd.to_datetime(expenses["month"])
    in_period = expenses[(expenses["month"] >= pd.Timestamp(start.replace(day=1))) & (expenses["month"] <= pd.Timestamp(end))]
    monthly = in_period.groupby(["month", "category"])["amount"].sum().reset_index()
    anomalies = []
    for (store_id, category), g in expenses.groupby(["store_id", "category"], dropna=False):
        g = g.sort_values("month")
        for idx in range(len(g)):
            row = g.iloc[idx]
            if row["month"] < pd.Timestamp(start.replace(day=1)) or category in ("income_tax",):
                continue
            history = g.iloc[max(0, idx - 12):idx]["amount"]
            if len(history) < 6:
                continue
            mean, std = float(history.mean()), float(history.std(ddof=1))
            month_date = row["month"].date()
            partial = month_date.year == data_end.year and month_date.month == data_end.month
            if std > 0 and not partial:
                amount = float(row["amount"])
                z = (amount - mean) / std
                last_year = g[g["month"] == row["month"] - pd.DateOffset(years=1)]["amount"]
                ly_change = m.growth_rate(amount, float(last_year.iloc[0]) if len(last_year) else None)
                # Seasonality-aware: a recurring seasonal level (e.g. festive staffing) is not an anomaly if
                # the same month last year was similar.
                seasonal_normal = ly_change.ok and abs(ly_change.value) <= 0.15
                if abs(z) >= 3 and abs(amount - mean) / max(mean, 1) > 0.15 and not seasonal_normal:
                    anomalies.append({"month": month_date.isoformat(), "category": category,
                                      "store": code.get(store_id, "Head office") if store_id is not None else "Head office",
                                      "amount": amount, "trailing_mean": mean, "z_score": round(z, 2),
                                      "change_vs_same_month_last_year": ly_change.value})
    return {
        "status": "ok", "total": total,
        "categories": sorted([{"category": k, "amount": v, "share": m.safe_ratio(v, total).value,
                               "section": "operating" if k in OPERATING_EXPENSE_CATEGORIES else k}
                              for k, v in by_cat.items()], key=lambda r: -r["amount"]),
        "monthly": [{"month": r.month.date().isoformat(), "category": r.category, "amount": float(r.amount)}
                    for r in monthly.itertuples(index=False)],
        "anomalies": sorted(anomalies, key=lambda a: -abs(a["z_score"]))[:25],
        "method": "Anomaly = a month whose amount is ≥3 standard deviations from the trailing 12-month mean for the same "
                  "store and category, differs from that mean by more than 15%, and is also more than 15% away from the "
                  "same month last year (so recurring seasonal levels are not flagged). The month in progress is not tested.",
    }


def budget_vs_actual(db: Session, scope: Scope, start: date, end: date, data_end: date,
                     version: str | None = None) -> dict[str, Any]:
    source = chosen_source(db, scope, "budgets")
    if source is None:
        return {"status": "missing_data", "note": "No budget data has been imported for this company.", "rows": []}
    versions = read_frame(db, "SELECT DISTINCT version_name FROM budgets WHERE company_id = :company AND integration_id = :s",
                          scope.params(s=source))["version_name"].tolist()
    window = scope.params(s=source, start=start.replace(day=1), end=end)
    if version:
        budgets = read_frame(db, f"""
            SELECT period_start AS month, metric, store_id, sum(amount) AS amount, version_name
            FROM budgets WHERE company_id = :company AND integration_id = :s AND period_start BETWEEN :start AND :end
              AND version_name = :v AND {scope.store_clause()}
            GROUP BY 1, 2, 3, 5
        """, {**window, "v": version})
    else:
        # Versions are alternative plans for the same month and are never added together. For each month use the
        # most recently imported version that covers it (fiscal-year budgets usually differ by year).
        budgets = read_frame(db, f"""
            WITH per_month AS (
                SELECT period_start, version_name, max(ingested_at) AS ingested FROM budgets
                WHERE company_id = :company AND integration_id = :s AND period_start BETWEEN :start AND :end
                GROUP BY 1, 2
            ), pick AS (
                SELECT DISTINCT ON (period_start) period_start, version_name FROM per_month
                ORDER BY period_start, ingested DESC, version_name DESC
            )
            SELECT b.period_start AS month, b.metric, b.store_id, sum(b.amount) AS amount, b.version_name
            FROM budgets b JOIN pick ON pick.period_start = b.period_start AND pick.version_name = b.version_name
            WHERE b.company_id = :company AND b.integration_id = :s AND b.period_start BETWEEN :start AND :end
              AND {scope.store_clause('b.store_id')}
            GROUP BY 1, 2, 3, 5
        """, window)
    if budgets.empty:
        return {"status": "missing_data", "note": "No budget lines for this period.", "versions": versions, "rows": []}
    versions_used = sorted({str(v) for v in budgets["version_name"].dropna()})
    budgets = _num(budgets, ["amount"])
    rows = []
    for month, g in budgets.groupby("month"):
        month_date = month if isinstance(month, date) else pd.Timestamp(month).date()
        m_end = (pd.Timestamp(month_date) + pd.offsets.MonthEnd(0)).date()
        actual_end = min(m_end, end, data_end)
        if actual_end < month_date:
            continue
        pnl = compute_pnl(db, scope, month_date, actual_end, data_end)
        full_month = actual_end == m_end
        factor = 1.0 if full_month else ((actual_end - month_date).days + 1) / ((m_end - month_date).days + 1)
        # With partial cost coverage the P&L estimates gross profit for uncosted sales; derive COGS from it so the
        # COGS variance is not flattered by the missing costs.
        cogs_actual = (pnl.net_sales - pnl.gross_profit) if pnl.gross_profit is not None else None
        actuals = {"net_sales": pnl.net_sales, "cogs": cogs_actual, "gross_profit": pnl.gross_profit,
                   **{f"opex:{k}": v for k, v in pnl.expenses_by_category.items()}}
        for metric, mg in g.groupby("metric"):
            budget = float(mg["amount"].sum()) * factor
            actual = actuals.get(metric)
            var = m.budget_variance(actual, budget)
            cost_like = metric == "cogs" or metric.startswith("opex:")
            favourable = None if var["variance"] is None else (var["variance"] <= 0 if cost_like else var["variance"] >= 0)
            rows.append({"month": month_date.isoformat(), "metric": metric, "budget": budget, "actual": actual,
                         "variance": var["variance"], "variance_pct": var["variance_pct"], "favourable": favourable,
                         "prorated": not full_month})
    return {"status": "ok", "versions": versions, "version": version, "versions_used": versions_used,
            "version_note": None if version else "Each month uses its most recently imported budget version ("
                                                 + ", ".join(versions_used) + "); versions are never added together.",
            "rows": [{k: _clean(v) for k, v in r.items()} for r in rows],
            "method": "Budget lines are compared with actuals computed by the same P&L engine. A month in progress "
                      "compares actuals to date with the budget prorated by elapsed days."}


# ---------------------------------------------------------------------------------------------
# Revenue bridge (explains change between two periods)
# ---------------------------------------------------------------------------------------------


def revenue_bridge(db: Session, scope: Scope, a_start: date, a_end: date, b_start: date, b_end: date) -> dict[str, Any]:
    """Decompose the net sales change from period A (base) to period B by store, category and price/volume/mix."""
    a = product_sales(db, scope, a_start, a_end)
    b = product_sales(db, scope, b_start, b_end)
    total_a, total_b = float(a["net"].sum()), float(b["net"].sum())
    sales_a, sales_b = daily_sales(db, scope, a_start, a_end), daily_sales(db, scope, b_start, b_end)
    stores = read_frame(db, "SELECT id AS store_id, code, name FROM stores WHERE company_id = :company", scope.params())
    by_store = []
    sa = sales_a.groupby("store_id").agg(net=("net", "sum"), txn=("txn", "sum"))
    sb = sales_b.groupby("store_id").agg(net=("net", "sum"), txn=("txn", "sum"))
    for st in stores.itertuples(index=False):
        na = float(sa["net"].get(st.store_id, 0.0))
        nb = float(sb["net"].get(st.store_id, 0.0))
        if na == 0 and nb == 0:
            continue
        ta, tb = sa["txn"].get(st.store_id), sb["txn"].get(st.store_id)
        by_store.append({"store": st.code, "name": st.name, "base": na, "current": nb, "change": nb - na,
                         "change_pct": m.growth_rate(nb, na).value,
                         "transactions_change_pct": m.growth_rate(float(tb) if tb == tb and tb is not None else None,
                                                                  float(ta) if ta == ta and ta is not None else None).value,
                         "basket_change_pct": m.growth_rate(
                             m.average_basket(nb, float(tb) if tb else None).value,
                             m.average_basket(na, float(ta) if ta else None).value).value})
    cat_a = a.groupby("category")["net"].sum()
    cat_b = b.groupby("category")["net"].sum()
    by_category = [{"category": c, "base": float(cat_a.get(c, 0.0)), "current": float(cat_b.get(c, 0.0)),
                    "change": float(cat_b.get(c, 0.0)) - float(cat_a.get(c, 0.0)),
                    "change_pct": m.growth_rate(float(cat_b.get(c, 0.0)), float(cat_a.get(c, 0.0))).value}
                   for c in sorted(set(cat_a.index) | set(cat_b.index), key=str)]
    # Price / volume / mix on products present in both periods (per-unit net price).
    merged = a[["product_id", "units", "net"]].merge(b[["product_id", "units", "net"]], on="product_id",
                                                    suffixes=("_a", "_b"), how="outer").fillna(0.0)
    both = merged[(merged["units_a"] > 0) & (merged["units_b"] > 0)]
    price_a = both["net_a"] / both["units_a"]
    price_b = both["net_b"] / both["units_b"]
    total_units_a, total_units_b = float(both["units_a"].sum()), float(both["units_b"].sum())
    avg_price_a = float(both["net_a"].sum()) / total_units_a if total_units_a else 0.0
    volume = (total_units_b - total_units_a) * avg_price_a
    mix = float(((both["units_b"] / total_units_b - both["units_a"] / total_units_a) * total_units_b
                 * (price_a - avg_price_a)).sum()) if total_units_a and total_units_b else 0.0
    price = float(((price_b - price_a) * both["units_b"]).sum())
    new_lost = (total_b - total_a) - (volume + mix + price)
    return {
        "base_period": {"start": a_start.isoformat(), "end": a_end.isoformat(), "net_sales": total_a},
        "current_period": {"start": b_start.isoformat(), "end": b_end.isoformat(), "net_sales": total_b},
        "change": total_b - total_a, "change_pct": m.growth_rate(total_b, total_a).value,
        "by_store": sorted([{k: _clean(v) for k, v in r.items()} for r in by_store], key=lambda r: r["change"]),
        "by_category": sorted([{k: _clean(v) for k, v in r.items()} for r in by_category], key=lambda r: r["change"]),
        "price_volume_mix": {"volume": volume, "mix": mix, "price": price, "new_or_discontinued_products": new_lost},
        "method": "Store and category effects are exact differences. Price/volume/mix is a standard decomposition on "
                  "products sold in both periods using net price per unit; the remainder is new or discontinued products.",
    }
