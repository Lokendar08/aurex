"""Evidence for the Decision Lab: relationships estimated from the company's own stored data.

Every estimate carries its sample size, standard error, confidence interval, p-value and an explicit
``identified`` flag. When an effect is not statistically identified the engine does NOT invent one: it
either applies zero effect or a user-supplied assumption, and says so.
"""

from __future__ import annotations

import logging
import math
import threading
import time
import warnings
from dataclasses import asdict, dataclass, field
from datetime import date, timedelta
from typing import Any

import numpy as np
import pandas as pd
from sqlalchemy.orm import Session

from app.services.analytics.base import Scope, chosen_source, data_bounds, read_frame, sales_authority_join
from app.services.analytics.pnl import compute_pnl
from app.services.forecasting.features import event_calendar

logger = logging.getLogger("aurex.simulation")
_CACHE: dict[tuple, tuple[float, Any]] = {}
_LOCK = threading.Lock()
CACHE_TTL_S = 1800


@dataclass
class Estimate:
    name: str
    value: float | None
    std_error: float | None = None
    ci_low: float | None = None
    ci_high: float | None = None
    p_value: float | None = None
    n: int = 0
    identified: bool = False
    method: str = ""
    notes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {k: (round(v, 6) if isinstance(v, float) and math.isfinite(v) else v) for k, v in asdict(self).items()}


def _cached(key: tuple, fn):  # type: ignore[no-untyped-def]
    now = time.time()
    with _LOCK:
        hit = _CACHE.get(key)
        if hit and now - hit[0] < CACHE_TTL_S:
            return hit[1]
    value = fn()
    with _LOCK:
        _CACHE[key] = (now, value)
        if len(_CACHE) > 256:
            for k in sorted(_CACHE, key=lambda k: _CACHE[k][0])[:64]:
                _CACHE.pop(k, None)
    return value


def clear_cache() -> None:
    with _LOCK:
        _CACHE.clear()


def _ols(y: np.ndarray, X: np.ndarray, names: list[str]) -> Any:
    import statsmodels.api as sm

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        return sm.OLS(y, X).fit(cov_type="HC1")


def _fourier(index: pd.DatetimeIndex, k: int = 3) -> pd.DataFrame:
    doy = index.dayofyear.to_numpy()
    out = {}
    for i in range(1, k + 1):
        out[f"s{i}"] = np.sin(2 * np.pi * i * doy / 365.25)
        out[f"c{i}"] = np.cos(2 * np.pi * i * doy / 365.25)
    return pd.DataFrame(out, index=index)


def _event_weekly(index: pd.DatetimeIndex, company: Any) -> pd.DataFrame:
    # Same calendar as forecasting: the country's festivals plus any events configured for the company.
    events = event_calendar(company.country, (company.settings or {}).get("events"))
    out = pd.DataFrame(index=index)
    for name, dates in events.items():
        out[f"evt_{name}"] = [max((1 - abs((ts + pd.Timedelta(days=3) - pd.Timestamp(d)).days) / 21) if
                                   abs((ts + pd.Timedelta(days=3) - pd.Timestamp(d)).days) <= 21 else 0 for d in dates)
                              for ts in index]
    return out


# ---------------------------------------------------------------------------------------------
# Category structure
# ---------------------------------------------------------------------------------------------


def category_profile(db: Session, scope: Scope, start: date, end: date) -> pd.DataFrame:
    frame = read_frame(db, f"""
        SELECT c.code, c.name, sum(s.net_amount) AS net, sum(s.quantity) AS units,
               sum(s.cost_amount) AS cost, sum(CASE WHEN s.cost_amount IS NOT NULL THEN s.net_amount ELSE 0 END) AS covered
        FROM sales_records s JOIN products p ON p.id = s.product_id JOIN product_categories c ON c.id = p.category_id
        JOIN agg_store_daily a ON a.store_id = s.store_id AND a.business_date = s.business_date
             AND a.sales_integration_id = s.integration_id
        WHERE s.company_id = :company AND s.business_date BETWEEN :start AND :end AND {scope.store_clause('s.store_id')}
        GROUP BY c.code, c.name ORDER BY net DESC""", scope.params(start=start, end=end))
    for col in ("net", "units", "cost", "covered"):
        frame[col] = pd.to_numeric(frame[col], errors="coerce").astype(float)
    total = frame["net"].sum()
    frame["share"] = frame["net"] / total if total else 0.0
    frame["gross_margin"] = (frame["covered"] - frame["cost"]) / frame["covered"].replace(0, np.nan)
    frame["avg_price"] = frame["net"] / frame["units"].replace(0, np.nan)
    return frame


# ---------------------------------------------------------------------------------------------
# Price elasticity (per category)
# ---------------------------------------------------------------------------------------------


def price_elasticities(db: Session, scope: Scope, data_end: date) -> dict[str, Estimate]:
    key = ("elasticity", scope.company_id, tuple(scope.store_ids or []), data_end)
    return _cached(key, lambda: _price_elasticities(db, scope, data_end))


def _price_elasticities(db: Session, scope: Scope, data_end: date) -> dict[str, Estimate]:
    frame = read_frame(db, f"""
        SELECT c.code AS category, s.product_id, date_trunc('week', s.business_date)::date AS week,
               sum(s.quantity) AS units, sum(s.net_amount) AS net
        FROM sales_records s JOIN products p ON p.id = s.product_id JOIN product_categories c ON c.id = p.category_id
             {sales_authority_join(db, scope)}
        WHERE s.company_id = :company AND s.business_date >= :start AND s.business_date <= :end
          AND {scope.store_clause('s.store_id')}
        GROUP BY 1, 2, 3""", scope.params(start=data_end - timedelta(days=3 * 365), end=data_end - timedelta(days=7)))
    out: dict[str, Estimate] = {}
    if frame.empty:
        return out
    frame["units"] = pd.to_numeric(frame["units"]).astype(float)
    frame["net"] = pd.to_numeric(frame["net"]).astype(float)
    frame = frame[(frame["units"] > 0) & (frame["net"] > 0)].copy()
    frame["week"] = pd.to_datetime(frame["week"])
    frame["log_q"] = np.log(frame["units"])
    frame["log_p"] = np.log(frame["net"] / frame["units"])
    weeks = pd.DatetimeIndex(sorted(frame["week"].unique()))
    controls = _fourier(weeks).join(_event_weekly(weeks, scope.company))
    controls["trend"] = (weeks - weeks[0]).days / 365.25
    for category, g in frame.groupby("category"):
        g = g.join(controls, on="week")
        # Product fixed effects via within-transformation (demeaning by product).
        cols = ["log_q", "log_p", *controls.columns]
        demeaned = g[cols] - g.groupby("product_id")[cols].transform("mean")
        y = demeaned["log_q"].to_numpy()
        X_cols = ["log_p", *controls.columns]
        X = demeaned[X_cols].to_numpy()
        n = len(y)
        if n < 80 or np.std(demeaned["log_p"]) < 1e-4:
            out[category] = Estimate(f"price_elasticity:{category}", None, n=n, method="insufficient price variation",
                                     notes=["Not enough price variation or observations to estimate elasticity."])
            continue
        res = _ols(y, X, X_cols)
        beta, se, p = float(res.params[0]), float(res.bse[0]), float(res.pvalues[0])
        identified = p < 0.05 and beta < 0 and se < abs(beta)
        notes = ["Within-product log-log regression of weekly units on net price per unit, controlling for annual "
                 "seasonality, festivals and trend. Observational estimate: promotions may coincide with demand "
                 "shifts, and stockouts cap observed sales."]
        if beta >= 0:
            notes.append("Estimated elasticity is non-negative, which is implausible; not used.")
        out[category] = Estimate(f"price_elasticity:{category}", beta, se, beta - 1.96 * se, beta + 1.96 * se, p, n,
                                 identified, "fixed-effects OLS (HC1 robust SE)", notes)
    return out


# ---------------------------------------------------------------------------------------------
# Marketing response
# ---------------------------------------------------------------------------------------------


def marketing_response(db: Session, scope: Scope, data_end: date) -> dict[str, Any]:
    key = ("marketing", scope.company_id, tuple(scope.store_ids or []), data_end)
    return _cached(key, lambda: _marketing_response(db, scope, data_end))


def _marketing_response(db: Session, scope: Scope, data_end: date) -> dict[str, Any]:
    source = chosen_source(db, scope, "marketing")
    if source is None:
        return {"estimate": Estimate("marketing_elasticity", None, method="no marketing data").to_dict(),
                "monthly_spend": None}
    spend = read_frame(db, """SELECT period_start AS week, sum(spend) AS spend FROM marketing_spend
                              WHERE company_id = :company AND integration_id = :src AND period_type = 'week'
                              GROUP BY 1 ORDER BY 1""", scope.params(src=source))
    # Marketing is typically booked and decided at company level (NovaMart: head office), so the response is
    # estimated on company sales against company spend; a store selection receives an allocated share below.
    sales = read_frame(db, """SELECT date_trunc('week', business_date)::date AS week, sum(net_amount) AS net,
                                     count(DISTINCT store_id) AS stores, count(DISTINCT business_date) AS days
                              FROM agg_store_daily WHERE company_id = :company
                              GROUP BY 1 ORDER BY 1""", scope.params())
    if spend.empty or sales.empty:
        return {"estimate": Estimate("marketing_elasticity", None, method="no marketing data").to_dict(),
                "monthly_spend": None}
    spend["week"] = pd.to_datetime(spend["week"])
    sales["week"] = pd.to_datetime(sales["week"])
    df = sales.merge(spend, on="week", how="inner")
    df = df[df["days"] == 7].copy()
    df["spend"] = pd.to_numeric(df["spend"]).astype(float)
    df["net"] = pd.to_numeric(df["net"]).astype(float)
    if len(df) < 52:
        return {"estimate": Estimate("marketing_elasticity", None, n=len(df), method="insufficient history",
                                     notes=["Needs at least 52 complete weeks."]).to_dict(), "monthly_spend": None}
    idx = pd.DatetimeIndex(df["week"])
    controls = _fourier(idx).join(_event_weekly(idx, scope.company))
    controls["trend"] = (idx - idx[0]).days / 365.25
    controls["log_stores"] = np.log(df["stores"].to_numpy(dtype=float))
    best = None
    import statsmodels.api as sm

    for decay in (0.0, 0.2, 0.4, 0.55, 0.7):
        ad = np.zeros(len(df))
        for i, s in enumerate(df["spend"].to_numpy()):
            ad[i] = s + (decay * ad[i - 1] if i else s * decay / max(1 - decay, 1e-6))
        X = sm.add_constant(np.column_stack([np.log1p(ad), controls.to_numpy()]))
        y = np.log(df["net"].to_numpy())
        res = _ols(y, X, [])
        if best is None or res.aic < best[1].aic:
            best = (decay, res)
    decay, res = best  # type: ignore[misc]
    beta, se, p = float(res.params[1]), float(res.bse[1]), float(res.pvalues[1])
    identified = p < 0.05 and beta > 0
    notes = [f"Weekly log(net sales) on log(adstocked spend) with seasonality, festival, trend and store-count controls; "
             f"adstock decay {decay} chosen by AIC. Elasticity = % sales change per 1% spend change."]
    if not identified:
        notes.append("Effect not statistically identified at 5%; the Decision Lab applies no revenue effect unless an "
                     "explicit assumption is provided.")
    est = Estimate("marketing_elasticity", beta, se, beta - 1.96 * se, beta + 1.96 * se, p, len(df), identified,
                   "OLS with HC1 robust SE", notes)
    recent = df.tail(13)
    out: dict[str, Any] = {
        "estimate": est.to_dict(), "adstock_decay": decay, "monthly_spend": float(recent["spend"].sum()) / 3.0,
        "spend_share_of_sales": float(recent["spend"].sum() / recent["net"].sum()) if recent["net"].sum() else None,
        "level": "company"}
    if scope.store_ids:
        first, last = recent["week"].min().date(), (recent["week"].max() + pd.Timedelta(days=6)).date()
        scoped = read_frame(db, f"""SELECT sum(net_amount) AS net FROM agg_store_daily
                                    WHERE company_id = :company AND business_date BETWEEN :s AND :e
                                      AND {scope.store_clause()}""", scope.params(s=first, e=last))
        scoped_net = float(pd.to_numeric(scoped["net"]).fillna(0).iloc[0]) if not scoped.empty else 0.0
        share = scoped_net / float(recent["net"].sum()) if recent["net"].sum() else 0.0
        out["monthly_spend"] = out["monthly_spend"] * share
        out["allocation_share"] = share
        out["allocation_note"] = (f"Marketing response is estimated at company level; this store selection's base "
                                  f"spend is allocated by its share of net sales ({share:.1%}).")
    return out


# ---------------------------------------------------------------------------------------------
# Workforce
# ---------------------------------------------------------------------------------------------


def workforce_profile(db: Session, scope: Scope, data_end: date) -> dict[str, Any]:
    source = chosen_source(db, scope, "workforce")
    if source is None:
        return {"available": False}
    frame = read_frame(db, f"""
        SELECT w.period_start AS month, w.store_id, sum(w.headcount) AS headcount, sum(w.hours_worked) AS hours,
               sum(w.labor_cost) AS labor_cost
        FROM workforce_aggregates w
        WHERE w.company_id = :company AND w.integration_id = :src AND w.period_type = 'month' AND w.store_id IS NOT NULL
          AND {scope.store_clause('w.store_id')}
        GROUP BY 1, 2 ORDER BY 1""", scope.params(src=source))
    if frame.empty:
        return {"available": False}
    for col in ("headcount", "hours", "labor_cost"):
        frame[col] = pd.to_numeric(frame[col]).astype(float)
    frame["month"] = pd.to_datetime(frame["month"])
    current_month = pd.Timestamp(data_end.replace(day=1))
    complete = frame[frame["month"] < current_month]
    last_month = complete["month"].max()
    latest = complete[complete["month"] == last_month]
    recent = complete[complete["month"] > last_month - pd.DateOffset(months=6)]
    txn = read_frame(db, f"""SELECT date_trunc('month', business_date)::date AS month, store_id,
                                    sum(transaction_count) AS txn, sum(net_amount) AS net
                             FROM agg_store_daily WHERE company_id = :company AND {scope.store_clause()}
                             GROUP BY 1, 2""", scope.params())
    txn["month"] = pd.to_datetime(txn["month"])
    txn["txn"] = pd.to_numeric(txn["txn"]).astype(float)
    txn["net"] = pd.to_numeric(txn["net"]).astype(float)
    panel = complete.merge(txn, on=["month", "store_id"], how="inner")
    panel["tplh"] = panel["txn"] / panel["hours"].replace(0, np.nan)
    headcount = float(latest["headcount"].sum())
    cost_per_employee = float(recent["labor_cost"].sum() / recent["headcount"].sum()) if recent["headcount"].sum() else None
    hours_per_employee = float(recent["hours"].sum() / recent["headcount"].sum()) if recent["headcount"].sum() else None
    recent_panel = panel[panel["month"] > last_month - pd.DateOffset(months=3)]
    current_tplh = float(recent_panel["txn"].sum() / recent_panel["hours"].sum()) if recent_panel["hours"].sum() else None
    peak_tplh = float(panel.groupby("store_id")["tplh"].quantile(0.9).mean()) if not panel.empty else None
    utilization = current_tplh / peak_tplh if current_tplh and peak_tplh else None
    labor_elasticity = _labor_elasticity(panel)
    return {
        "available": True, "as_of_month": last_month.date().isoformat(), "headcount": headcount,
        "monthly_cost_per_employee": cost_per_employee, "monthly_hours_per_employee": hours_per_employee,
        "monthly_labor_cost": float(latest["labor_cost"].sum()),
        "current_transactions_per_labor_hour": current_tplh, "historical_p90_transactions_per_labor_hour": peak_tplh,
        "capacity_utilization": utilization,
        "capacity_constrained": bool(utilization is not None and utilization >= 0.95),
        "labor_elasticity": labor_elasticity.to_dict(),
        "method": "Cost per employee = labor cost ÷ headcount over the last 6 complete months. Capacity utilization = "
                  "transactions per labor hour over the last 3 months ÷ the stores' historical 90th percentile; at or "
                  "above 95% the scope is treated as capacity-constrained.",
    }


def _labor_elasticity(panel: pd.DataFrame) -> Estimate:
    if panel.empty or panel["store_id"].nunique() < 2 or len(panel) < 24:
        return Estimate("labor_hours_elasticity", None, n=len(panel), method="insufficient panel")
    df = panel.dropna(subset=["hours", "net"]).copy()
    df = df[(df["hours"] > 0) & (df["net"] > 0)]
    df["ly"] = np.log(df["net"])
    df["lh"] = np.log(df["hours"])
    month_dummies = pd.get_dummies(df["month"].dt.month, prefix="m", drop_first=True, dtype=float)
    cols = ["ly", "lh"]
    demeaned = df[cols] - df.groupby("store_id")[cols].transform("mean")
    X = np.column_stack([demeaned["lh"].to_numpy(), month_dummies.to_numpy()])
    res = _ols(demeaned["ly"].to_numpy(), X, [])
    beta, se, p = float(res.params[0]), float(res.bse[0]), float(res.pvalues[0])
    return Estimate("labor_hours_elasticity", beta, se, beta - 1.96 * se, beta + 1.96 * se, p, len(df),
                    p < 0.05 and beta > 0, "store fixed-effects OLS of log sales on log hours with month dummies",
                    ["Correlational: stores schedule more hours when they expect more sales, so this does NOT show "
                     "that hiring causes sales. It is used only when the scope is capacity-constrained and the user "
                     "explicitly selects the historical mode."])


# ---------------------------------------------------------------------------------------------
# New stores
# ---------------------------------------------------------------------------------------------


def new_store_profile(db: Session, scope: Scope, data_end: date) -> dict[str, Any]:
    key = ("newstore", scope.company_id, data_end)
    return _cached(key, lambda: _new_store_profile(db, scope, data_end))


def _new_store_profile(db: Session, scope: Scope, data_end: date) -> dict[str, Any]:
    from scipy.optimize import curve_fit

    stores = read_frame(db, "SELECT id, code, opened_on, selling_area_sqft FROM stores WHERE company_id = :company",
                        scope.params())
    stores["selling_area_sqft"] = pd.to_numeric(stores["selling_area_sqft"]).astype(float)
    sales = read_frame(db, """SELECT date_trunc('month', business_date)::date AS month, store_id, sum(net_amount) AS net,
                                     count(DISTINCT business_date) AS days
                              FROM agg_store_daily WHERE company_id = :company GROUP BY 1, 2""", scope.params())
    if sales.empty:
        return {"available": False}
    sales["month"] = pd.to_datetime(sales["month"])
    sales["net"] = pd.to_numeric(sales["net"]).astype(float)
    sales = sales.merge(stores.rename(columns={"id": "store_id"}), on="store_id")
    sales["sales_per_sqft_day"] = sales["net"] / sales["selling_area_sqft"] / sales["days"]
    first_data = sales["month"].min()
    sales["age_months"] = ((sales["month"] - pd.to_datetime(sales["opened_on"])).dt.days / 30.44)
    mature = sales[sales["age_months"] >= 24]
    mature_ref = mature.groupby("month")["sales_per_sqft_day"].mean()
    new_ids = stores[pd.to_datetime(stores["opened_on"]) > first_data]["id"].tolist()
    points = []
    for sid in new_ids:
        s = sales[(sales["store_id"] == sid) & (sales["days"] >= 25)].sort_values("month")
        for row in s.itertuples(index=False):
            k = int(round(row.age_months))
            ref = mature_ref.get(row.month)
            if k >= 1 and ref:
                points.append((k, row.sales_per_sqft_day / ref))
    trailing = sales[sales["month"] > pd.Timestamp(data_end) - pd.DateOffset(months=12)]
    mature_now = trailing[trailing["age_months"] >= 24].groupby("store_id")["sales_per_sqft_day"].mean()
    result: dict[str, Any] = {
        "available": True, "new_stores_observed": len(new_ids), "ramp_points": len(points),
        "mature_sales_per_sqft_day": float(mature_now.mean()) if len(mature_now) else None,
        "mature_sales_per_sqft_day_sd": float(mature_now.std(ddof=1)) if len(mature_now) > 1 else None,
        "median_selling_area_sqft": float(stores["selling_area_sqft"].median()),
    }
    if len(points) >= 6:
        k = np.array([p[0] for p in points], dtype=float)
        r = np.array([p[1] for p in points], dtype=float)

        def ramp(x: np.ndarray, level: float, gap: float, tau: float) -> np.ndarray:
            return level * (1 - gap * np.exp(-x / tau))

        try:
            params, cov = curve_fit(ramp, k, r, p0=(0.9, 0.4, 4.0), bounds=([0.3, 0.0, 0.5], [1.5, 0.95, 24.0]),
                                    maxfev=10000)
            se = np.sqrt(np.diag(cov))
            result["ramp"] = {"level": float(params[0]), "gap": float(params[1]), "tau_months": float(params[2]),
                              "level_se": float(se[0]), "gap_se": float(se[1]), "tau_se": float(se[2]),
                              "identified": True,
                              "method": "Non-linear least squares fit of relative productivity (new store sales per "
                                        "sq ft ÷ mature stores' in the same month) = L × (1 − g·e^(−months/τ))."}
        except (RuntimeError, ValueError) as exc:
            result["ramp"] = {"identified": False, "error": type(exc).__name__}
    else:
        result["ramp"] = {"identified": False,
                          "note": "Fewer than 6 monthly observations of stores opened within the data history."}
    capex = read_frame(db, """SELECT period_start, sum(-amount) AS capex FROM cash_flow_entries
                              WHERE company_id = :company AND integration_id = :cash_source
                                AND category = 'capital_expenditure' GROUP BY 1""",
                       scope.params(cash_source=chosen_source(db, scope, "cash")))
    if not capex.empty and new_ids:
        capex["period_start"] = pd.to_datetime(capex["period_start"])
        per_store = []
        for sid in new_ids:
            opened = pd.Timestamp(stores.loc[stores["id"] == sid, "opened_on"].iloc[0])
            window = capex[(capex["period_start"] >= opened - pd.DateOffset(months=3)) & (capex["period_start"] < opened)]
            if not window.empty:
                sqft = float(stores.loc[stores["id"] == sid, "selling_area_sqft"].iloc[0])
                per_store.append(float(pd.to_numeric(window["capex"]).sum()) / sqft)
        if per_store:
            result["capex_per_sqft"] = float(np.mean(per_store))
            result["capex_observations"] = len(per_store)
            result["capex_method"] = "Capital expenditure recorded in the 3 months before each new store opened."
    return result


# ---------------------------------------------------------------------------------------------
# Store cost structure, inventory demand, customers
# ---------------------------------------------------------------------------------------------


def store_cost_profile(db: Session, scope: Scope, data_end: date) -> dict[str, Any]:
    last = data_end.replace(day=1) - timedelta(days=1)
    start = (last.replace(day=1) - pd.DateOffset(months=11)).date()
    stores = read_frame(db, f"""SELECT id, code, selling_area_sqft FROM stores WHERE company_id = :company
                                AND opened_on <= :cut AND {scope.store_clause('id')}""",
                        scope.params(cut=start))
    exp = read_frame(db, f"""SELECT store_id, category, sum(amount) AS amount FROM expenses
                             WHERE company_id = :company AND integration_id = :exp_source AND store_id IS NOT NULL
                               AND expense_date BETWEEN :s AND :e AND {scope.store_clause()}
                             GROUP BY 1, 2""", scope.params(s=start, e=last, exp_source=chosen_source(db, scope, "expenses")))
    if stores.empty or exp.empty:
        return {"available": False}
    exp["amount"] = pd.to_numeric(exp["amount"]).astype(float)
    exp = exp[exp["store_id"].isin(stores["id"])]
    sqft = float(pd.to_numeric(stores["selling_area_sqft"]).sum())
    n = len(stores)
    by_cat = exp.groupby("category")["amount"].sum() / 12
    return {"available": True, "stores": n, "window": [start.isoformat(), last.isoformat()],
            "rent_per_sqft_month": float(by_cat.get("rent", 0) / sqft) if sqft else None,
            "utilities_per_sqft_month": float(by_cat.get("utilities", 0) / sqft) if sqft else None,
            "fixed_other_per_store_month": float(sum(by_cat.get(c, 0) for c in ("maintenance", "technology", "insurance"))
                                                 / n),
            "depreciation_per_store_month": float(by_cat.get("depreciation", 0) / n),
            "payroll_per_store_month": float(by_cat.get("payroll", 0) / n)}


def inventory_demand_profile(db: Session, scope: Scope, data_end: date, categories: list[str] | None) -> pd.DataFrame:
    from app.services.analytics.operations import inventory_positions

    positions = inventory_positions(db, scope, data_end)
    if positions.empty:
        return positions
    if categories:
        cats = read_frame(db, "SELECT name FROM product_categories WHERE company_id = :company AND code = ANY(:codes)",
                          scope.params(codes=categories))["name"].tolist()
        positions = positions[positions["category"].isin(cats)]
    daily = read_frame(db, f"""
        SELECT s.store_id, s.product_id, s.business_date, sum(s.quantity) AS units, sum(s.net_amount) AS net
        FROM sales_records s {sales_authority_join(db, scope)}
        WHERE s.company_id = :company AND s.business_date BETWEEN :start AND :end AND {scope.store_clause('s.store_id')}
        GROUP BY 1, 2, 3""", scope.params(start=data_end - timedelta(days=89), end=data_end))
    daily["units"] = pd.to_numeric(daily["units"]).astype(float)
    daily["net"] = pd.to_numeric(daily["net"]).astype(float)
    stats = daily.groupby(["store_id", "product_id"]).agg(units=("units", "sum"), net=("net", "sum"),
                                                          sumsq=("units", lambda s: float((s ** 2).sum())))
    stats["mean"] = stats["units"] / 90.0
    stats["sd"] = np.sqrt(np.maximum(stats["sumsq"] / 90.0 - stats["mean"] ** 2, 0))
    stats["price"] = stats["net"] / stats["units"].replace(0, np.nan)
    merged = positions.merge(stats[["mean", "sd", "price"]].reset_index(), on=["store_id", "product_id"], how="left")
    return merged


def customer_profile(db: Session, scope: Scope, data_end: date) -> dict[str, Any]:
    source = chosen_source(db, scope, "customers")
    if source is None:
        return {"available": False}
    frame = read_frame(db, f"""SELECT period_start AS month, sum(active_customers) AS active,
                                      sum(returning_customers) AS returning
                               FROM customer_metrics WHERE company_id = :company AND integration_id = :src
                                 AND {scope.store_clause()} GROUP BY 1 ORDER BY 1""", scope.params(src=source))
    if len(frame) < 4:
        return {"available": False}
    frame["month"] = pd.to_datetime(frame["month"])
    frame = frame[frame["month"] < pd.Timestamp(data_end.replace(day=1))]
    frame["active"] = pd.to_numeric(frame["active"]).astype(float)
    frame["returning"] = pd.to_numeric(frame["returning"]).astype(float)
    frame["retention"] = frame["returning"] / frame["active"].shift(1)
    recent = frame.tail(6)
    last_complete = data_end.replace(day=1) - timedelta(days=1)
    pnl = compute_pnl(db, scope, (last_complete.replace(day=1) - pd.DateOffset(months=5)).date(), last_complete, data_end)
    active_avg = float(recent["active"].mean())
    return {"available": True, "monthly_active_customers": active_avg,
            "retention_rate": float(recent["retention"].mean()),
            "monthly_spend_per_active_customer": pnl.net_sales / 6 / active_avg if active_avg else None,
            "method": "Retention = returning customers ÷ previous month's active customers (6-month average). Spend "
                      "per customer = net sales ÷ active customers. Customer counts are aggregates from the loyalty feed."}


def evidence_bundle(db: Session, scope: Scope, include_elasticities: bool = False) -> dict[str, Any]:
    """All calibration needed by the engine (cached). Price elasticities (the slowest estimate, a few
    seconds on three years of product-week data) are added only when a scenario needs them."""
    bundle = _base_bundle(db, scope)
    if include_elasticities and bundle.get("data_end") is not None:
        bundle = {**bundle, "elasticities": price_elasticities(db, scope, bundle["data_end"])}
    return bundle


def _base_bundle(db: Session, scope: Scope) -> dict[str, Any]:
    _, data_end = data_bounds(db, scope.company_id)
    if data_end is None:
        return {"data_end": None}
    last_complete = data_end.replace(day=1) - timedelta(days=1)
    start = (last_complete.replace(day=1) - pd.DateOffset(months=11)).date()
    key = ("bundle", scope.company_id, tuple(scope.store_ids or []), data_end)

    def build() -> dict[str, Any]:
        cats = category_profile(db, scope, start, last_complete)
        return {
            "data_end": data_end, "window": (start, last_complete), "categories": cats, "elasticities": {},
            "marketing": marketing_response(db, scope, data_end),
            "workforce": workforce_profile(db, scope, data_end),
            "new_store": new_store_profile(db, scope, data_end),
            "store_costs": store_cost_profile(db, scope, data_end),
            "customers": customer_profile(db, scope, data_end),
        }

    return _cached(key, build)
