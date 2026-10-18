"""Financial and operational analytics endpoints (Module 6)."""

from __future__ import annotations

import uuid
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.api.deps import DbSession, OrgContext, OrgCtx, require
from app.core.errors import ValidationAppError
from app.core.permissions import Permission
from app.services import metrics as m
from app.services.analytics import operations as ops
from app.services.analytics.dashboard import resolve_scope_period
from app.services.analytics.pnl import compute_pnl, monthly_pnl_series
from app.services.periods import resolve_period

router = APIRouter(tags=["analytics"])
P = Permission

CompanyQ = Annotated[uuid.UUID | None, Query()]
StoresQ = Annotated[list[uuid.UUID] | None, Query()]
PeriodQ = Annotated[str | None, Query(max_length=20)]

FINANCE_FIELDS = ("gross_margin", "store_contribution", "store_contribution_margin", "contribution_rank")


def _strip_finance(rows: list[dict], ctx: OrgContext) -> list[dict]:
    if ctx.has(P.FINANCE_READ):
        return rows
    return [{k: v for k, v in r.items() if k not in FINANCE_FIELDS} for r in rows]


def _period_payload(p) -> dict:  # type: ignore[no-untyped-def]
    return {"key": p.key, "label": p.label, "start": p.start.isoformat(), "end": p.end.isoformat(),
            "comparison_start": p.comparison_start.isoformat(), "comparison_end": p.comparison_end.isoformat(),
            "granularity": p.granularity}


@router.get("/orgs/{org_id}/analytics/metric-definitions")
def metric_definitions(ctx: OrgCtx) -> dict:
    return {"definitions": m.METRIC_DEFINITIONS}


@router.get("/orgs/{org_id}/analytics/financial")
def financial_report(ctx: Annotated[OrgContext, Depends(require(P.FINANCE_READ))], db: DbSession,
                     company_id: CompanyQ = None, store_ids: StoresQ = None, period: PeriodQ = None,
                     start: date | None = None, end: date | None = None) -> dict:
    scope, p, data_end = resolve_scope_period(db, ctx, company_id, store_ids, period, start, end)
    total = compute_pnl(db, scope, p.start, p.end, data_end)
    prior = compute_pnl(db, scope, p.comparison_start, p.comparison_end, data_end)
    from app.services.analytics.dashboard import _cash

    return {"period": _period_payload(p), "data_end": data_end.isoformat(), "currency": scope.currency,
            "is_synthetic": scope.company.is_synthetic, "total": total.to_dict(), "comparison": prior.to_dict(),
            "monthly": monthly_pnl_series(db, scope, p.start, p.end, data_end), "cash": _cash(db, scope, p),
            "definitions": {k: m.METRIC_DEFINITIONS[k] for k in ("net_sales", "cogs", "gross_profit", "gross_margin",
                                                                  "operating_expenses", "ebitda", "net_profit",
                                                                  "net_margin")}}


@router.get("/orgs/{org_id}/analytics/budget-vs-actual")
def budget_vs_actual(ctx: Annotated[OrgContext, Depends(require(P.FINANCE_READ))], db: DbSession,
                     company_id: CompanyQ = None, store_ids: StoresQ = None, period: PeriodQ = None,
                     start: date | None = None, end: date | None = None,
                     version: Annotated[str | None, Query(max_length=80)] = None) -> dict:
    scope, p, data_end = resolve_scope_period(db, ctx, company_id, store_ids, period or "ytd", start, end)
    return {"period": _period_payload(p), "currency": scope.currency,
            **ops.budget_vs_actual(db, scope, p.start, p.end, data_end, version)}


@router.get("/orgs/{org_id}/analytics/expenses")
def expenses(ctx: Annotated[OrgContext, Depends(require(P.FINANCE_READ))], db: DbSession,
             company_id: CompanyQ = None, store_ids: StoresQ = None, period: PeriodQ = None,
             start: date | None = None, end: date | None = None) -> dict:
    scope, p, data_end = resolve_scope_period(db, ctx, company_id, store_ids, period, start, end)
    return {"period": _period_payload(p), "currency": scope.currency,
            **ops.expense_analysis(db, scope, p.start, p.end, data_end)}


@router.get("/orgs/{org_id}/analytics/inventory")
def inventory(ctx: Annotated[OrgContext, Depends(require(P.INVENTORY_READ))], db: DbSession,
              company_id: CompanyQ = None, store_ids: StoresQ = None, period: PeriodQ = None,
              start: date | None = None, end: date | None = None) -> dict:
    scope, p, data_end = resolve_scope_period(db, ctx, company_id, store_ids, period, start, end)
    pnl = compute_pnl(db, scope, p.start, p.end, data_end)
    overview = ops.inventory_overview(db, scope, p.start, p.end, pnl.cogs, pnl.gross_profit)
    risks = ops.stockout_and_overstock(db, scope, data_end)
    if not ctx.has(P.FINANCE_READ):
        overview.pop("gmroi", None)  # derived from gross profit; turnover and days of inventory use COGS at cost
    return {"period": _period_payload(p), "currency": scope.currency, "data_end": data_end.isoformat(),
            "overview": overview, "risks": risks, "recent_stockouts": ops.recent_stockout_days(db, scope, data_end, 30)}


@router.get("/orgs/{org_id}/analytics/suppliers")
def suppliers(ctx: Annotated[OrgContext, Depends(require(P.SUPPLIERS_READ))], db: DbSession,
              company_id: CompanyQ = None, store_ids: StoresQ = None, period: PeriodQ = None,
              start: date | None = None, end: date | None = None) -> dict:
    scope, p, _ = resolve_scope_period(db, ctx, company_id, store_ids, period, start, end)
    return {"period": _period_payload(p), "currency": scope.currency,
            **ops.supplier_performance(db, scope, p.start, p.end)}


@router.get("/orgs/{org_id}/analytics/workforce")
def workforce(ctx: Annotated[OrgContext, Depends(require(P.WORKFORCE_READ))], db: DbSession,
              company_id: CompanyQ = None, store_ids: StoresQ = None, period: PeriodQ = None,
              start: date | None = None, end: date | None = None) -> dict:
    scope, p, _ = resolve_scope_period(db, ctx, company_id, store_ids, period, start, end)
    return {"period": _period_payload(p), "currency": scope.currency, **ops.workforce_overview(db, scope, p.start, p.end)}


@router.get("/orgs/{org_id}/analytics/stores")
def stores(ctx: Annotated[OrgContext, Depends(require(P.SALES_READ))], db: DbSession,
           company_id: CompanyQ = None, store_ids: StoresQ = None, period: PeriodQ = None,
           start: date | None = None, end: date | None = None) -> dict:
    scope, p, data_end = resolve_scope_period(db, ctx, company_id, store_ids, period, start, end)
    rows = ops.store_productivity(db, scope, p.start, p.end, p.comparison_start, p.comparison_end, data_end)
    return {"period": _period_payload(p), "currency": scope.currency, "stores": _strip_finance(rows, ctx),
            "notes": ["Growth is shown only for comparable stores (open for the whole comparison period).",
                      "Store contribution = store gross profit − store operating expenses (no head-office allocation)."]}


@router.get("/orgs/{org_id}/analytics/categories")
def categories(ctx: Annotated[OrgContext, Depends(require(P.SALES_READ))], db: DbSession,
               company_id: CompanyQ = None, store_ids: StoresQ = None, period: PeriodQ = None,
               start: date | None = None, end: date | None = None) -> dict:
    scope, p, _ = resolve_scope_period(db, ctx, company_id, store_ids, period, start, end)
    rows = ops.category_performance(db, scope, p.start, p.end, p.comparison_start, p.comparison_end)
    products = ops.product_performance(db, scope, p.start, p.end, p.comparison_start, p.comparison_end)
    if not ctx.has(P.FINANCE_READ):
        products = {k: _strip_finance(v, ctx) for k, v in products.items()}
    return {"period": _period_payload(p), "currency": scope.currency, "categories": _strip_finance(rows, ctx),
            "products": products}


@router.get("/orgs/{org_id}/analytics/revenue-bridge")
def revenue_bridge(ctx: Annotated[OrgContext, Depends(require(P.SALES_READ))], db: DbSession,
                   company_id: CompanyQ = None, store_ids: StoresQ = None,
                   base_start: date | None = None, base_end: date | None = None,
                   current_start: date | None = None, current_end: date | None = None,
                   period: PeriodQ = None) -> dict:
    scope, p, data_end = resolve_scope_period(db, ctx, company_id, store_ids, period or "last_30d", None, None)
    if current_start and current_end and base_start and base_end:
        if current_end < current_start or base_end < base_start:
            raise ValidationAppError("Each period needs start <= end")
        a_start, a_end, b_start, b_end = base_start, base_end, current_start, min(current_end, data_end)
    else:
        a_start, a_end, b_start, b_end = p.comparison_start, p.comparison_end, p.start, p.end
    return {"currency": scope.currency, **ops.revenue_bridge(db, scope, a_start, a_end, b_start, b_end)}


@router.get("/orgs/{org_id}/analytics/periods/resolve")
def resolve(ctx: OrgCtx, db: DbSession, period: str = Query(max_length=20), company_id: CompanyQ = None,
            start: date | None = None, end: date | None = None) -> dict:
    company = ctx.default_company(db, company_id)
    from app.services.analytics.base import data_bounds

    _, data_end = data_bounds(db, company.id)
    p = resolve_period(period, company.fiscal_year_start_month, data_end or date.today(), start, end)
    return _period_payload(p)
