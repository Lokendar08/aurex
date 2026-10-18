"""Forecast training, versioning, retrieval and the monthly baseline P&L used by the Decision Lab."""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any

import numpy as np
import pandas as pd
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.core.errors import InsufficientDataError, NotFoundError
from app.models import (
    Company,
    ForecastBacktest,
    ForecastModel,
    ForecastPoint,
    ForecastRun,
    ProductCategory,
    Store,
)
from app.services.analytics.base import Scope, data_bounds
from app.services.analytics.pnl import compute_pnl
from app.services.forecasting import series as series_mod
from app.services.forecasting.engine import ENGINE_VERSION, ForecastResult, evaluate_and_forecast
from app.services.forecasting.features import event_calendar
from app.services.forecasting.models import ModelContext

logger = logging.getLogger("aurex.forecasting")


@dataclass(frozen=True)
class TargetSpec:
    key: str
    label: str
    unit: str
    freq: str
    horizon: int
    eval_horizon: int
    folds: int
    levels: tuple[str, ...]


TARGETS: dict[str, TargetSpec] = {
    "net_sales": TargetSpec("net_sales", "Net sales", "currency", "D", 365, 91, 4, ("company", "store")),
    "transactions": TargetSpec("transactions", "Transactions", "count", "D", 182, 91, 3, ("company", "store")),
    "units": TargetSpec("units", "Units demanded (category)", "units", "W", 26, 13, 3, ("category",)),
    "operating_expenses": TargetSpec("operating_expenses", "Operating expenses", "currency", "M", 12, 6, 2, ("company",)),
    "inventory_value": TargetSpec("inventory_value", "Inventory value at cost", "currency", "W", 26, 13, 3, ("company",)),
}


def _series_for(db: Session, scope: Scope, target: str, level: str, key: str) -> series_mod.TrainingSeries:
    store_id = uuid.UUID(key) if level == "store" else None
    if target == "net_sales":
        return series_mod.net_sales_daily(db, scope, store_id)
    if target == "transactions":
        return series_mod.transactions_daily(db, scope, store_id)
    if target == "units":
        return series_mod.units_weekly(db, scope, None if key == "all" else key)
    if target == "operating_expenses":
        return series_mod.opex_monthly(db, scope)
    if target == "inventory_value":
        return series_mod.inventory_value_weekly(db, scope)
    raise NotFoundError("Unknown forecast target")


def _monthly_interval_quantiles(result: ForecastResult) -> dict[str, float] | None:
    """Relative errors of monthly totals from the selected model's out-of-sample fold predictions."""
    if result.freq != "D" or not result.fold_predictions:
        return None
    errors = []
    for fold in result.fold_predictions:
        frame = fold.copy()
        frame["month"] = frame.index.to_period("M")
        counts = frame.groupby("month").size()
        sums = frame.groupby("month")[["actual", "pred"]].sum()
        for month, row in sums.iterrows():
            if counts[month] >= 25 and row["pred"] > 0:  # (near-)complete months only
                errors.append((row["actual"] - row["pred"]) / row["pred"])
    if len(errors) < 4:
        return None
    arr = np.array(errors)
    return {"n": int(len(arr)), "q025": float(np.quantile(arr, 0.025)), "q10": float(np.quantile(arr, 0.10)),
            "q50": float(np.quantile(arr, 0.5)), "q90": float(np.quantile(arr, 0.90)),
            "q975": float(np.quantile(arr, 0.975))}


def train_target(db: Session, *, org_id: uuid.UUID, company: Company, target: str, level: str = "company",
                 key: str = "all", user_id: uuid.UUID | None = None, store_ids: list[uuid.UUID] | None = None) -> ForecastModel:
    spec = TARGETS[target]
    if level not in spec.levels:
        raise NotFoundError(f"{target} cannot be forecast at {level} level")
    scope = Scope(org_id=org_id, company=company, store_ids=store_ids)
    ts = _series_for(db, scope, target, level, key)
    if ts.series.empty or len(ts.series) < 24:
        raise InsufficientDataError(f"Not enough history to forecast {spec.label} ({len(ts.series)} periods)")
    ctx = ModelContext(freq=spec.freq, events=event_calendar(company.country, (company.settings or {}).get("events")),
                       covariate_fn=ts.covariate_fn)
    result = evaluate_and_forecast(ts.series, freq=spec.freq, horizon=spec.horizon, folds=spec.folds,
                                   eval_horizon=spec.eval_horizon, ctx=ctx)
    version = (db.scalar(select(func.max(ForecastModel.version)).where(
        ForecastModel.company_id == company.id, ForecastModel.target == target, ForecastModel.level == level,
        ForecastModel.level_key == key, ForecastModel.frequency == spec.freq)) or 0) + 1
    db.execute(update(ForecastModel).where(
        ForecastModel.company_id == company.id, ForecastModel.target == target, ForecastModel.level == level,
        ForecastModel.level_key == key, ForecastModel.frequency == spec.freq).values(is_active=False))
    limitations = ts.notes + result.limitations
    if company.is_synthetic:
        limitations.append("Trained on synthetic demonstration data; accuracy says nothing about real businesses.")
    metrics = dict(result.metrics)
    monthly_q = _monthly_interval_quantiles(result)
    if monthly_q:
        metrics["monthly_relative_error_quantiles"] = monthly_q
    model = ForecastModel(
        org_id=org_id, company_id=company.id, target=target, level=level, level_key=key, frequency=spec.freq,
        version=version, algorithm=result.selected, hyperparameters=result.params,
        candidates=[c.__dict__ for c in result.candidates], baseline_algorithm=result.baseline, metrics=metrics,
        baseline_metrics=result.baseline_metrics, skill_vs_baseline=result.skill_vs_baseline,
        reliability=result.reliability, training_start=date.fromisoformat(result.training_start),
        training_end=date.fromisoformat(result.training_end), n_observations=result.n_observations,
        data_fingerprint=result.data_fingerprint, random_seed=42, code_version=ENGINE_VERSION,
        limitations=limitations, is_active=True, created_by=user_id)
    db.add(model)
    db.flush()
    for fold in result.folds:
        db.add(ForecastBacktest(model_id=model.id, algorithm=fold.algorithm, fold=fold.fold,
                                cutoff=date.fromisoformat(fold.cutoff), horizon=fold.horizon, mae=fold.mae,
                                rmse=fold.rmse, wape=fold.wape, mape=fold.mape, bias=fold.bias))
    run = ForecastRun(org_id=org_id, company_id=company.id, model_id=model.id, target=target, level=level, level_key=key,
                      frequency=spec.freq, horizon=spec.horizon, as_of=date.fromisoformat(result.training_end),
                      interval_method=result.interval_method)
    db.add(run)
    db.flush()
    db.add_all([ForecastPoint(run_id=run.id, period_start=ts_.date(), step=i + 1, yhat=float(r.yhat),
                              lower_80=float(r.lower_80), upper_80=float(r.upper_80), lower_95=float(r.lower_95),
                              upper_95=float(r.upper_95))
                for i, (ts_, r) in enumerate(result.forecast.iterrows())])
    db.flush()
    logger.info("Trained %s/%s/%s v%s -> %s (WAPE %.3f, %s)", target, level, key, version, result.selected,
                result.metrics.get("wape") or -1, result.reliability)
    return model


def default_plan(db: Session, company: Company) -> list[tuple[str, str, str]]:
    plan = [("net_sales", "company", "all"), ("transactions", "company", "all"), ("operating_expenses", "company", "all"),
            ("inventory_value", "company", "all")]
    plan += [("net_sales", "store", str(s.id)) for s in db.scalars(select(Store).where(Store.company_id == company.id))]
    plan += [("units", "category", c.code) for c in db.scalars(select(ProductCategory).where(
        ProductCategory.company_id == company.id).order_by(ProductCategory.code))]
    return plan


def train_targets(db: Session, *, org_id: uuid.UUID, company_id: uuid.UUID, targets: list[str] | None = None,
                  user_id: uuid.UUID | None = None) -> dict[str, Any]:
    company = db.get(Company, company_id)
    if company is None or company.org_id != org_id:
        raise NotFoundError("Company not found")
    plan = [p for p in default_plan(db, company) if not targets or p[0] in targets]
    results = []
    for target, level, key in plan:
        try:
            model = train_target(db, org_id=org_id, company=company, target=target, level=level, key=key, user_id=user_id)
            db.commit()
            results.append({"target": target, "level": level, "key": key, "model_id": str(model.id),
                            "algorithm": model.algorithm, "wape": model.metrics.get("wape"),
                            "reliability": model.reliability, "version": model.version})
        except Exception as exc:  # noqa: BLE001 - one series failing must not stop the others
            db.rollback()
            results.append({"target": target, "level": level, "key": key, "error": f"{type(exc).__name__}: {exc}"[:300]})
    return {"trained": sum(1 for r in results if "model_id" in r), "failed": sum(1 for r in results if "error" in r),
            "results": results}


# ---------------------------------------------------------------------------------------------
# Retrieval
# ---------------------------------------------------------------------------------------------


def active_model(db: Session, company_id: uuid.UUID, target: str, level: str = "company", key: str = "all") -> ForecastModel | None:
    return db.scalar(select(ForecastModel).where(
        ForecastModel.company_id == company_id, ForecastModel.target == target, ForecastModel.level == level,
        ForecastModel.level_key == key, ForecastModel.is_active.is_(True)).order_by(ForecastModel.version.desc()).limit(1))


def model_points(db: Session, model: ForecastModel) -> pd.DataFrame:
    run = db.scalar(select(ForecastRun).where(ForecastRun.model_id == model.id).order_by(ForecastRun.generated_at.desc()))
    if run is None:
        return pd.DataFrame()
    rows = db.scalars(select(ForecastPoint).where(ForecastPoint.run_id == run.id).order_by(ForecastPoint.step)).all()
    return pd.DataFrame([{"period_start": r.period_start, "yhat": r.yhat, "lower_80": r.lower_80, "upper_80": r.upper_80,
                          "lower_95": r.lower_95, "upper_95": r.upper_95} for r in rows])


def model_out(model: ForecastModel, label_lookup: dict[str, str] | None = None) -> dict[str, Any]:
    spec = TARGETS.get(model.target)
    return {
        "id": str(model.id), "target": model.target, "target_label": spec.label if spec else model.target,
        "unit": spec.unit if spec else None, "level": model.level, "level_key": model.level_key,
        "level_label": (label_lookup or {}).get(model.level_key, "Company" if model.level_key == "all" else model.level_key),
        "frequency": model.frequency, "version": model.version, "algorithm": model.algorithm,
        "baseline_algorithm": model.baseline_algorithm, "metrics": model.metrics, "baseline_metrics": model.baseline_metrics,
        "skill_vs_baseline": model.skill_vs_baseline, "reliability": model.reliability,
        "training_start": model.training_start.isoformat(), "training_end": model.training_end.isoformat(),
        "n_observations": model.n_observations, "data_fingerprint": model.data_fingerprint,
        "code_version": model.code_version, "random_seed": model.random_seed, "limitations": model.limitations,
        "hyperparameters": model.hyperparameters, "candidates": model.candidates, "is_active": model.is_active,
        "created_at": model.created_at.isoformat() if model.created_at else None,
    }


def history_frame(db: Session, scope: Scope, model: ForecastModel, periods: int) -> list[dict[str, Any]]:
    ts = _series_for(db, scope, model.target, model.level, model.level_key)
    tail = ts.series.iloc[-periods:]
    return [{"period_start": idx.date().isoformat(), "actual": float(v)} for idx, v in tail.items()]


# ---------------------------------------------------------------------------------------------
# Monthly baseline projection (Decision Lab)
# ---------------------------------------------------------------------------------------------


# Below the P&L's 90% reporting threshold the baseline may still estimate the margin from the costed share, but only
# when that share is at least half of sales; otherwise profit cannot be projected.
MIN_COVERAGE_FOR_BASELINE_MARGIN = 0.5


def _trailing(db: Session, scope: Scope, data_end: date, months: int = 12) -> dict[str, Any]:
    """Trailing-12-complete-month ratios used to turn a revenue forecast into a P&L baseline."""
    last_complete = data_end.replace(day=1) - timedelta(days=1)
    start = (last_complete.replace(day=1) - pd.DateOffset(months=months - 1)).date()
    pnl = compute_pnl(db, scope, start, last_complete, data_end)
    by_cat = pnl.expenses_by_category
    variable = {c: (by_cat.get(c, 0.0) / pnl.net_sales if pnl.net_sales else 0.0)
                for c in ("logistics", "store_supplies")}
    fixed_monthly = {c: v / months for c, v in by_cat.items() if c not in variable and c not in ("income_tax",)}
    pbt = pnl.profit_before_tax
    tax_rate = (by_cat.get("income_tax", 0.0) / pbt) if pbt and pbt > 0 else 0.25
    gross_margin, margin_note = pnl.gross_margin, None
    if gross_margin is None and pnl.cogs is not None and (pnl.cost_coverage or 0) >= MIN_COVERAGE_FOR_BASELINE_MARGIN:
        # Below the P&L's 90% reporting threshold: use the margin measured on the sales that do have a cost, and say so.
        gross_margin = (pnl.cost_covered_net_sales - pnl.cogs) / pnl.cost_covered_net_sales
        margin_note = (f"Gross margin {gross_margin:.1%} is estimated from the {pnl.cost_coverage or 0:.0%} of trailing "
                       "sales that have a recorded cost.")
    return {"window": {"start": start.isoformat(), "end": last_complete.isoformat()}, "pnl": pnl,
            "gross_margin": gross_margin, "gross_margin_note": margin_note,
            "variable_cost_ratios": variable, "fixed_costs_monthly": fixed_monthly,
            "effective_tax_rate": min(max(tax_rate, 0.0), 0.35), "net_sales": pnl.net_sales}


def baseline_monthly(db: Session, scope: Scope, months: int = 12) -> dict[str, Any]:
    """Baseline = trained net-sales forecast aggregated by month, converted to a P&L with trailing ratios.

    Revenue uncertainty comes from monthly-aggregated out-of-sample backtest errors. Costs use trailing
    12-month ratios (variable costs) or run-rates (fixed costs); this is disclosed as an assumption.
    """
    _, data_end = data_bounds(db, scope.company_id)
    if data_end is None:
        raise InsufficientDataError("No sales data")
    if scope.store_ids and len(scope.store_ids) == 1:
        model = active_model(db, scope.company_id, "net_sales", "store", str(scope.store_ids[0]))
    elif scope.store_ids:
        model = None
    else:
        model = active_model(db, scope.company_id, "net_sales", "company", "all")
    notes: list[str] = []
    trailing = _trailing(db, scope, data_end)
    first_month = (data_end.replace(day=1) + pd.DateOffset(months=1)).date()
    month_index = pd.date_range(first_month, periods=months, freq="MS")
    if model is not None:
        points = model_points(db, model)
        points["day"] = pd.to_datetime(points["period_start"])
        points["month"] = points["day"].dt.to_period("M").dt.to_timestamp()
        grouped = points.groupby("month").agg(total=("yhat", "sum"), days=("day", "nunique"))
        if model.frequency == "D":
            # A month only partly inside the forecast horizon (e.g. the 12th month of a 365-day forecast) is scaled
            # from its forecast daily average; months less than half covered are treated as beyond the horizon.
            coverage = grouped["days"] / grouped.index.days_in_month
            grouped = grouped[coverage >= 0.5]
            coverage = coverage[coverage >= 0.5]
            monthly = grouped["total"] / coverage
            for month, share in coverage[coverage < 1].items():
                if month in month_index:
                    notes.append(f"{month:%b %Y} is only partly inside the forecast horizon ({share:.0%} of its days); "
                                 "its total is scaled from the forecast daily average.")
        else:
            monthly = grouped["total"]
        revenue = monthly.reindex(month_index)
        q = (model.metrics or {}).get("monthly_relative_error_quantiles")
        source = {"model_id": str(model.id), "algorithm": model.algorithm, "version": model.version,
                  "reliability": model.reliability, "wape_daily": model.metrics.get("wape")}
        if revenue.isna().any():
            # Beyond the horizon: repeat the same calendar month one year earlier (forecast or extended value),
            # keeping seasonality without assuming further growth.
            for month in month_index[revenue.isna().to_numpy()]:
                prior = month - pd.DateOffset(years=1)
                revenue[month] = revenue.get(prior, monthly.get(prior, np.nan))
            notes.append("Months beyond the forecast horizon repeat the forecast for the same month one year earlier "
                         "(seasonality kept, no additional growth assumed).")
            revenue = revenue.ffill()
    else:
        # Fallback: same month last year scaled by trailing YoY growth (explicitly a heuristic).
        from app.services.analytics.pnl import daily_sales

        sales = daily_sales(db, scope, data_end - timedelta(days=760), data_end)
        daily_total = sales.groupby("business_date")["net"].sum()
        sales["month"] = sales["business_date"].dt.to_period("M").dt.to_timestamp()
        hist = sales.groupby("month")["net"].sum()
        last12 = hist.iloc[-13:-1].sum() if len(hist) >= 13 else 0.0
        prev12 = hist.iloc[-25:-13].sum() if len(hist) >= 25 else 0.0
        q = None
        if prev12:
            growth = last12 / prev12 - 1
            revenue = pd.Series([hist.get(m - pd.DateOffset(years=1), np.nan) * (1 + growth) for m in month_index],
                                index=month_index).ffill()
            source = {"model_id": None, "algorithm": "same_month_last_year_x_trailing_growth", "reliability": "unreliable"}
            notes.append("No trained forecast for this scope; baseline uses same month last year × trailing growth "
                         f"({growth:.1%}). Train forecasts for a validated baseline.")
        else:
            run_rate = float(daily_total.iloc[-90:].mean()) if len(daily_total) else 0.0
            revenue = pd.Series([run_rate * m.days_in_month for m in month_index], index=month_index)
            source = {"model_id": None, "algorithm": "trailing_90_day_run_rate", "reliability": "unreliable"}
            notes.append("No trained forecast and less than two years of history: baseline is the trailing 90-day "
                         "average daily sales × days in month (no seasonality). Train forecasts for a validated baseline.")
    if trailing["gross_margin"] is None:
        coverage = trailing["pnl"].cost_coverage
        if coverage:
            raise InsufficientDataError(
                f"Product costs cover only {coverage:.0%} of trailing 12-month sales; at least "
                f"{MIN_COVERAGE_FOR_BASELINE_MARGIN:.0%} is needed to project gross profit. Import the missing costs.")
        raise InsufficientDataError("No product cost data in the trailing 12 months: gross profit cannot be projected. "
                                    "Import costs (sales cost_amount) to use the profit baseline.")
    gm = trailing["gross_margin"]
    if trailing.get("gross_margin_note"):
        notes.append(trailing["gross_margin_note"])
    rows = []
    for ts_, rev in revenue.items():
        rev = float(rev)
        gp = rev * gm
        variable = sum(ratio * rev for ratio in trailing["variable_cost_ratios"].values())
        fixed = {c: v for c, v in trailing["fixed_costs_monthly"].items()}
        opex = variable + sum(v for c, v in fixed.items() if c not in ("depreciation", "finance_costs"))
        ebitda = gp - opex
        dep = fixed.get("depreciation", 0.0)
        fin = fixed.get("finance_costs", 0.0)
        pbt = ebitda - dep - fin
        tax = max(pbt, 0.0) * trailing["effective_tax_rate"]
        row = {"month": ts_.date().isoformat(), "net_sales": rev, "cogs": rev - gp, "gross_profit": gp,
               "variable_opex": variable, "fixed_opex": opex - variable, "operating_expenses": opex, "ebitda": ebitda,
               "depreciation": dep, "finance_costs": fin, "profit_before_tax": pbt, "income_tax": tax,
               "net_profit": pbt - tax, "operating_cash_flow": ebitda - tax}
        if q:
            row.update({"net_sales_p10": rev * (1 + q["q10"]), "net_sales_p90": rev * (1 + q["q90"]),
                        "net_sales_p025": rev * (1 + q["q025"]), "net_sales_p975": rev * (1 + q["q975"])})
        rows.append(row)
    notes.append("Costs: COGS at the trailing 12-month gross margin; logistics and store supplies scale with sales; "
                 "other operating costs, depreciation and finance costs continue at trailing monthly run-rates; tax at "
                 "the trailing effective rate on positive profit.")
    return {"as_of": data_end.isoformat(), "first_month": first_month.isoformat(), "months": rows,
            "revenue_source": source, "revenue_interval": q, "assumptions": {
                "gross_margin": gm, "variable_cost_ratios": trailing["variable_cost_ratios"],
                "fixed_costs_monthly": trailing["fixed_costs_monthly"], "effective_tax_rate": trailing["effective_tax_rate"],
                "trailing_window": trailing["window"]}, "notes": notes}
