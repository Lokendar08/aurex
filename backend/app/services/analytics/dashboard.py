"""Executive dashboard: KPIs, trends and breakdowns computed from stored data for the selected scope."""

from __future__ import annotations

import uuid
from datetime import date, timedelta
from typing import Any

import pandas as pd
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import OrgContext
from app.core.errors import NotFoundError
from app.core.permissions import Permission
from app.models import CashBalance, CashFlowEntry, ForecastModel, Store
from app.services import metrics as m
from app.services.analytics import operations as ops
from app.services.analytics.base import Scope, chosen_source, data_bounds, freshness
from app.services.analytics.health import health_score
from app.services.analytics.pnl import PnL, compute_pnl, daily_sales
from app.services.periods import ResolvedPeriod, resolve_period

P = Permission


def build_scope(db: Session, ctx: OrgContext, company_id: uuid.UUID | None, store_ids: list[uuid.UUID] | None) -> Scope:
    company = ctx.default_company(db, company_id)
    resolved = ctx.resolve_store_ids(store_ids)
    if resolved:
        valid = set(db.scalars(select(Store.id).where(Store.company_id == company.id, Store.id.in_(resolved))))
        if len(valid) != len(set(resolved)):
            raise NotFoundError("One or more stores do not belong to this company")
    return Scope(org_id=ctx.org_id, company=company, store_ids=resolved, store_scoped=ctx.store_scope is not None)


def resolve_scope_period(db: Session, ctx: OrgContext, company_id: uuid.UUID | None, store_ids: list[uuid.UUID] | None,
                         period: str | None, start: date | None, end: date | None) -> tuple[Scope, ResolvedPeriod, date]:
    scope = build_scope(db, ctx, company_id, store_ids)
    _, data_end = data_bounds(db, scope.company_id)
    if data_end is None:
        raise NotFoundError("No sales data has been ingested for this company yet", code="no_data")
    resolved = resolve_period(period or "last_12m", scope.company.fiscal_year_start_month, data_end, start, end)
    return scope, resolved, data_end


def _kpi(key: str, value: float | None, *, comparison: float | None = None, unit: str | None = None,
         status: str | None = None, note: str | None = None, estimated: bool = False, currency: str | None = None,
         change_kind: str = "relative", source: str | None = None) -> dict[str, Any]:
    definition = m.METRIC_DEFINITIONS.get(key, {})
    change = None
    if value is not None and comparison is not None:
        change = m.growth_rate(value, comparison).value if change_kind == "relative" else value - comparison
    return {"key": key, "label": definition.get("label", key), "value": value, "comparison": comparison,
            "change": change, "change_kind": change_kind, "unit": unit or definition.get("unit"), "currency": currency,
            "status": status or ("ok" if value is not None else "missing_data"), "note": note, "estimated": estimated,
            "direction": definition.get("direction", "up"),
            "definition": {"formula": definition.get("formula"), "description": definition.get("description")},
            "source": source}


def _series(sales: pd.DataFrame, period: ResolvedPeriod) -> list[dict[str, Any]]:
    if sales.empty:
        return []
    frame = sales.copy()
    cur = frame[(frame["business_date"] >= pd.Timestamp(period.start)) & (frame["business_date"] <= pd.Timestamp(period.end))]
    prev = frame[(frame["business_date"] >= pd.Timestamp(period.comparison_start))
                 & (frame["business_date"] <= pd.Timestamp(period.comparison_end))].copy()
    prev["business_date"] = prev["business_date"] + pd.DateOffset(years=1)  # align to current calendar
    rule = {"day": "D", "week": "W-MON", "month": "MS"}[period.granularity]

    def bucket(df: pd.DataFrame) -> pd.DataFrame:
        if df.empty:
            return pd.DataFrame(columns=["net", "gp", "txn"])
        df = df.assign(gp=df["covered"] - df["cost"])
        if period.granularity == "week":
            df = df.assign(bucket=df["business_date"] - pd.to_timedelta(df["business_date"].dt.dayofweek, unit="D"))
        elif period.granularity == "month":
            df = df.assign(bucket=df["business_date"].dt.to_period("M").dt.to_timestamp())
        else:
            df = df.assign(bucket=df["business_date"])
        return df.groupby("bucket").agg(net=("net", "sum"), gp=("gp", lambda s: s.sum(min_count=1)),
                                        txn=("txn", lambda s: s.sum(min_count=1)))

    c, p = bucket(cur), bucket(prev)
    _ = rule
    out = []
    for ts, row in c.iterrows():
        prev_row = p.loc[ts] if ts in p.index else None
        out.append({"period": ts.date().isoformat(), "net_sales": float(row["net"]),
                    "gross_profit": None if pd.isna(row["gp"]) else float(row["gp"]),
                    "transactions": None if pd.isna(row["txn"]) else int(row["txn"]),
                    "comparison_net_sales": float(prev_row["net"]) if prev_row is not None else None})
    return out


def _cash(db: Session, scope: Scope, period: ResolvedPeriod) -> dict[str, Any]:
    if not scope.company_level_visible:
        return {"status": "not_available_at_store_scope"}
    source = chosen_source(db, scope, "cash")
    bal_source = chosen_source(db, scope, "cash_balances")
    latest = None
    if bal_source is not None:
        latest = db.scalar(select(CashBalance).where(CashBalance.company_id == scope.company_id,
                                                     CashBalance.integration_id == bal_source,
                                                     CashBalance.as_of_date <= period.end)
                           .order_by(CashBalance.as_of_date.desc()).limit(1))
    flows = []
    if source is not None:
        flows = db.scalars(select(CashFlowEntry).where(
            CashFlowEntry.company_id == scope.company_id, CashFlowEntry.integration_id == source,
            CashFlowEntry.period_start >= period.start.replace(day=1), CashFlowEntry.period_start <= period.end)).all()
    if not flows and latest is None:
        return {"status": "missing_data"}
    operating = sum(float(f.amount) for f in flows if f.activity == "operating")
    outflows = [float(f.amount) for f in flows if f.activity == "operating" and float(f.amount) < 0]
    months = len({f.period_start for f in flows}) or 1
    monthly_outflow = -sum(outflows) / months if outflows else None
    aligned = period.start.day == 1
    return {"status": "ok", "operating_cash_flow": operating if flows else None,
            "investing_cash_flow": sum(float(f.amount) for f in flows if f.activity == "investing") if flows else None,
            "financing_cash_flow": sum(float(f.amount) for f in flows if f.activity == "financing") if flows else None,
            "cash_balance": float(latest.balance) if latest else None,
            "cash_balance_as_of": latest.as_of_date.isoformat() if latest else None,
            "avg_monthly_operating_outflow": monthly_outflow,
            "cash_months": (float(latest.balance) / monthly_outflow) if latest and monthly_outflow else None,
            "note": None if aligned else "Cash flow is reported monthly; months touched by the period are included in full"}


def _forecast_accuracy(db: Session, scope: Scope) -> dict[str, Any] | None:
    model = db.scalar(select(ForecastModel).where(ForecastModel.company_id == scope.company_id,
                                                  ForecastModel.target == "net_sales", ForecastModel.level == "company",
                                                  ForecastModel.is_active.is_(True))
                      .order_by(ForecastModel.created_at.desc()).limit(1))
    if model is None:
        return None
    return {"model_id": str(model.id), "algorithm": model.algorithm, "version": model.version,
            "wape": model.metrics.get("wape"), "baseline_wape": model.baseline_metrics.get("wape"),
            "skill_vs_baseline": model.skill_vs_baseline, "reliability": model.reliability,
            "trained_through": model.training_end.isoformat(), "frequency": model.frequency}


def executive_dashboard(db: Session, ctx: OrgContext, company_id: uuid.UUID | None, store_ids: list[uuid.UUID] | None,
                        period: str | None, start: date | None, end: date | None) -> dict[str, Any]:
    scope, p, data_end = resolve_scope_period(db, ctx, company_id, store_ids, period, start, end)
    cur_currency = scope.currency
    finance = ctx.has(P.FINANCE_READ)
    sales = daily_sales(db, scope, p.comparison_start, p.end)
    current: PnL = compute_pnl(db, scope, p.start, p.end, data_end, sales=sales)
    previous: PnL = compute_pnl(db, scope, p.comparison_start, p.comparison_end, data_end, sales=sales)
    inv = ops.inventory_overview(db, scope, p.start, p.end, current.cogs, current.gross_profit) if ctx.has(P.INVENTORY_READ) or finance else None
    stock = ops.recent_stockout_days(db, scope, data_end, 30) if inv else None
    cash = _cash(db, scope, p) if finance else {"status": "not_permitted"}
    fc = _forecast_accuracy(db, scope)
    growth = m.growth_rate(current.net_sales, previous.net_sales if previous.days_with_sales else None)
    pos_source = "agg_store_daily (system-of-record sales feed)"

    kpis = [
        _kpi("net_sales", current.net_sales, comparison=previous.net_sales or None, currency=cur_currency, source=pos_source),
        _kpi("revenue_growth", growth.value, unit="percent", status=growth.status, note=growth.note,
             change_kind="absolute"),
    ]
    if finance:
        kpis += [
            _kpi("gross_profit", current.gross_profit, comparison=previous.gross_profit, currency=cur_currency,
                 estimated=current.gross_profit_estimated, note=next((n for n in current.notes if "Cost" in n), None)),
            _kpi("gross_margin", current.gross_margin, comparison=previous.gross_margin, unit="percent", change_kind="absolute"),
            _kpi("operating_expenses", current.operating_expenses, comparison=previous.operating_expenses,
                 currency=cur_currency, status=None if current.expenses_complete else "incomplete",
                 note=None if current.expenses_complete else "; ".join(current.notes)),
            _kpi("ebitda", current.ebitda, comparison=previous.ebitda, currency=cur_currency,
                 estimated=current.gross_profit_estimated),
            _kpi("net_profit", current.net_profit, comparison=previous.net_profit, currency=cur_currency,
                 estimated=current.gross_profit_estimated,
                 note="Store contribution (head-office costs not allocated)" if not scope.company_level_visible else None),
            _kpi("net_margin", current.net_margin, comparison=previous.net_margin, unit="percent", change_kind="absolute"),
            _kpi("operating_cash_flow", cash.get("operating_cash_flow"), currency=cur_currency,
                 status="not_available_at_store_scope" if cash.get("status") == "not_available_at_store_scope" else None,
                 note=cash.get("note")),
            _kpi("cash_balance", cash.get("cash_balance"), currency=cur_currency,
                 note=f"as of {cash.get('cash_balance_as_of')}" if cash.get("cash_balance_as_of") else None,
                 status="not_available_at_store_scope" if cash.get("status") == "not_available_at_store_scope" else None),
        ]
    if inv:
        turnover = inv.get("inventory_turnover") or {}
        kpis.append(_kpi("inventory_turnover", turnover.get("value"), unit="ratio", status=turnover.get("status"),
                         note=f"{inv.get('snapshots_used')} {inv.get('snapshot_cadence')} snapshots" if inv.get("status") == "ok"
                         else inv.get("note")))
    kpis.append(_kpi("forecast_wape", fc["wape"] if fc else None, unit="percent",
                     status="ok" if fc else "not_trained",
                     note=(f"{fc['algorithm']} v{fc['version']} · {fc['reliability'].replace('_', ' ')}" if fc
                           else "No forecast model trained yet (Forecasts → Train)")))

    health = health_score(
        revenue_growth=growth.value, ebitda_margin=current.ebitda_margin if finance else None,
        cash_months=cash.get("cash_months") if finance else None,
        inventory_turnover=((inv or {}).get("inventory_turnover") or {}).get("value"),
        out_of_stock_rate=(stock or {}).get("out_of_stock_rate"), cost_coverage=current.cost_coverage,
        data_age_days=(date.today() - data_end).days if data_end else None) if finance else None
    if health:
        kpis.append(_kpi("business_health", health.get("score"), unit="score", note=health.get("grade")))

    store_rows = ops.store_productivity(db, scope, p.start, p.end, p.comparison_start, p.comparison_end, data_end)
    if not finance:
        for row in store_rows:
            for key in ("gross_margin", "store_contribution", "store_contribution_margin", "contribution_rank"):
                row.pop(key, None)
    categories = ops.category_performance(db, scope, p.start, p.end, p.comparison_start, p.comparison_end)
    if not finance:
        for row in categories:
            row.pop("gross_margin", None)
    return {
        "company": {"id": str(scope.company_id), "name": scope.company.name, "currency": cur_currency,
                    "is_synthetic": scope.company.is_synthetic, "fiscal_year_start_month": scope.company.fiscal_year_start_month},
        "synthetic_notice": "Synthetic demonstration data for the fictional company NovaMart. Not real business data."
        if scope.company.is_synthetic else None,
        "scope": {"store_ids": [str(s) for s in scope.store_ids] if scope.store_ids else None,
                  "member_store_scoped": scope.store_scoped, "company_level_included": scope.company_level_visible},
        "period": {"key": p.key, "label": p.label, "start": p.start.isoformat(), "end": p.end.isoformat(),
                   "comparison_start": p.comparison_start.isoformat(), "comparison_end": p.comparison_end.isoformat(),
                   "comparison_label": p.comparison_label, "granularity": p.granularity, "days": p.days},
        "data_end": data_end.isoformat(),
        "kpis": kpis,
        "pnl": current.to_dict() if finance else None,
        "comparison_pnl": previous.to_dict() if finance else None,
        "series": _series(sales, p) if finance else [
            {k: v for k, v in row.items() if k != "gross_profit"} for row in _series(sales, p)],
        "stores": store_rows,
        "categories": categories,
        "expenses": [{"category": k, "amount": v} for k, v in sorted(current.expenses_by_category.items(),
                                                                         key=lambda kv: -kv[1])] if finance else None,
        "inventory": inv,
        "stockouts_recent": stock,
        "cash": cash if finance else None,
        "forecast": fc,
        "health": health,
        "freshness": freshness(db, scope),
        "notes": current.notes,
    }


def sales_summary(db: Session, ctx: OrgContext, company_id: uuid.UUID | None, store_ids: list[uuid.UUID] | None,
                  period: str | None, start: date | None, end: date | None) -> dict[str, Any]:
    """Sales-only view (no cost or profit) for roles with sales:read but not finance:read (e.g. employees)."""
    scope, p, data_end = resolve_scope_period(db, ctx, company_id, store_ids, period, start, end)
    sales = daily_sales(db, scope, p.comparison_start, p.end)
    cur = sales[(sales["business_date"] >= pd.Timestamp(p.start)) & (sales["business_date"] <= pd.Timestamp(p.end))]
    recent = daily_sales(db, scope, data_end - timedelta(days=6), data_end)
    prev = sales[(sales["business_date"] >= pd.Timestamp(p.comparison_start))
                 & (sales["business_date"] <= pd.Timestamp(p.comparison_end))]
    net, prev_net = float(cur["net"].sum()), float(prev["net"].sum()) if not prev.empty else None
    txn = cur["txn"].sum(min_count=1)
    series = [{k: v for k, v in row.items() if k != "gross_profit"} for row in _series(sales, p)]
    return {
        "company": {"id": str(scope.company_id), "name": scope.company.name, "currency": scope.currency,
                    "is_synthetic": scope.company.is_synthetic},
        "period": {"key": p.key, "label": p.label, "start": p.start.isoformat(), "end": p.end.isoformat(),
                   "granularity": p.granularity},
        "data_end": data_end.isoformat(),
        "kpis": [
            _kpi("net_sales", net, comparison=prev_net, currency=scope.currency),
            _kpi("revenue_growth", m.growth_rate(net, prev_net).value, unit="percent", change_kind="absolute"),
            _kpi("average_basket", m.average_basket(net, float(txn) if pd.notna(txn) else None).value, currency=scope.currency),
        ],
        "transactions": int(txn) if pd.notna(txn) else None,
        "series": series,
        # The latest seven days of data, independent of the selected period (which may end earlier).
        "last_7_days": [{"date": d.date().isoformat(), "net_sales": float(v)} for d, v in
                        recent.groupby("business_date")["net"].sum().items()],
    }
