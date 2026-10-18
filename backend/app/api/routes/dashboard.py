"""Executive dashboard, sales summary, filters and data-quality endpoints."""

from __future__ import annotations

import uuid
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select

from app.api.deps import DbSession, OrgContext, OrgCtx, require
from app.core.permissions import Permission
from app.models import Company, FinancialPeriod, Integration, Store, SyncError, SyncJob
from app.services import metrics as m
from app.services.analytics.base import data_bounds, freshness
from app.services.analytics.dashboard import build_scope, executive_dashboard, sales_summary
from app.services.analytics.pnl import daily_sales

router = APIRouter(tags=["dashboard"])
P = Permission

CompanyQ = Annotated[uuid.UUID | None, Query(description="Company id (defaults to the first company)")]
StoresQ = Annotated[list[uuid.UUID] | None, Query(description="Restrict to these stores")]
PeriodQ = Annotated[str | None, Query(max_length=20, description="last_30d | last_90d | mtd | qtd | ytd | last_fy | "
                                                                  "last_12m | fy:<year> | custom")]


@router.get("/orgs/{org_id}/dashboard/executive")
def get_executive_dashboard(ctx: Annotated[OrgContext, Depends(require(P.DASHBOARD_READ))], db: DbSession,
                            company_id: CompanyQ = None, store_ids: StoresQ = None, period: PeriodQ = None,
                            start: date | None = None, end: date | None = None) -> dict:
    return executive_dashboard(db, ctx, company_id, store_ids, period, start, end)


@router.get("/orgs/{org_id}/dashboard/sales-summary")
def get_sales_summary(ctx: Annotated[OrgContext, Depends(require(P.SALES_READ))], db: DbSession,
                      company_id: CompanyQ = None, store_ids: StoresQ = None, period: PeriodQ = None,
                      start: date | None = None, end: date | None = None) -> dict:
    return sales_summary(db, ctx, company_id, store_ids, period, start, end)


@router.get("/orgs/{org_id}/dashboard/filters")
def get_filters(ctx: OrgCtx, db: DbSession, company_id: CompanyQ = None) -> dict:
    companies = db.scalars(select(Company).where(Company.org_id == ctx.org_id).order_by(Company.name)).all()
    company = ctx.default_company(db, company_id) if companies else None
    stores = []
    bounds = (None, None)
    fiscal_years: list[int] = []
    if company:
        query = select(Store).where(Store.company_id == company.id)
        if ctx.store_scope is not None:
            query = query.where(Store.id.in_(ctx.store_scope))
        stores = db.scalars(query.order_by(Store.code)).all()
        bounds = data_bounds(db, company.id)
        if bounds[0]:
            fiscal_years = sorted(set(db.scalars(select(FinancialPeriod.fiscal_year).where(
                FinancialPeriod.company_id == company.id, FinancialPeriod.period_start <= bounds[1],
                FinancialPeriod.period_end >= bounds[0]))))
    return {
        "companies": [{"id": str(c.id), "name": c.name, "currency": c.base_currency, "is_synthetic": c.is_synthetic,
                       "fiscal_year_start_month": c.fiscal_year_start_month} for c in companies],
        "company_id": str(company.id) if company else None,
        "stores": [{"id": str(s.id), "code": s.code, "name": s.name, "city": s.city, "opened_on":
                    s.opened_on.isoformat() if s.opened_on else None} for s in stores],
        "store_scoped": ctx.store_scope is not None,
        "data_start": bounds[0].isoformat() if bounds[0] else None,
        "data_end": bounds[1].isoformat() if bounds[1] else None,
        "periods": [{"key": "last_30d", "label": "Last 30 days"}, {"key": "last_90d", "label": "Last 90 days"},
                    {"key": "mtd", "label": "Month to date"}, {"key": "qtd", "label": "Quarter to date"},
                    {"key": "ytd", "label": "Fiscal year to date"}, {"key": "last_12m", "label": "Last 12 months"},
                    {"key": "last_fy", "label": "Last fiscal year"}]
        + [{"key": f"fy:{fy}", "label": f"FY{fy}"} for fy in fiscal_years] + [{"key": "custom", "label": "Custom range"}],
        "metric_definitions": m.METRIC_DEFINITIONS,
    }


@router.get("/orgs/{org_id}/data/quality")
def get_data_quality(ctx: Annotated[OrgContext, Depends(require(P.DATA_QUALITY_READ))], db: DbSession,
                     company_id: CompanyQ = None) -> dict:
    scope = build_scope(db, ctx, company_id, None)
    start, end = data_bounds(db, scope.company_id)
    coverage = None
    days_missing: list[dict] = []
    overlaps = 0
    if start and end:
        sales = daily_sales(db, scope, start, end)
        coverage = m.safe_ratio(float(sales["covered"].sum()), float(sales["net"].sum())).value
        overlaps = int((sales["overlapping_sources"] > 1).sum())
        stores = db.scalars(select(Store).where(Store.company_id == scope.company_id)).all()
        if scope.store_ids is not None:  # store-scoped members only see their own stores
            allowed = set(scope.store_ids)
            stores = [s for s in stores if s.id in allowed]
        for store in stores:
            first = max(start, store.opened_on) if store.opened_on else start
            present = set(sales.loc[sales["store_id"] == store.id, "business_date"].dt.date)
            expected = (end - first).days + 1
            missing = expected - len([d for d in present if d >= first])
            if expected > 0:
                days_missing.append({"store": store.code, "expected_days": expected, "days_with_sales": len(present),
                                     "missing_days": max(missing, 0),
                                     "completeness": round(1 - max(missing, 0) / expected, 4)})
    recent_jobs = db.execute(
        select(SyncJob, Integration.display_name).join(Integration, Integration.id == SyncJob.integration_id)
        .where(SyncJob.org_id == ctx.org_id).order_by(SyncJob.queued_at.desc()).limit(10)).all()
    error_counts = db.execute(select(SyncError.error_code, func.count()).where(SyncError.org_id == ctx.org_id)
                              .group_by(SyncError.error_code).order_by(func.count().desc()).limit(15)).all()
    return {
        "company_id": str(scope.company_id), "data_start": start.isoformat() if start else None,
        "data_end": end.isoformat() if end else None, "cost_coverage": coverage,
        "store_days_with_multiple_sources": overlaps, "store_completeness": days_missing,
        "freshness": freshness(db, scope),
        "recent_jobs": [{"id": str(j.id), "integration": name, "status": j.status, "trigger": j.trigger,
                         "received": j.records_received, "inserted": j.records_inserted, "updated": j.records_updated,
                         "unchanged": j.records_unchanged, "rejected": j.records_rejected,
                         "finished_at": j.finished_at.isoformat() if j.finished_at else None} for j, name in recent_jobs],
        "rejection_reasons": [{"code": code, "count": n} for code, n in error_counts],
        "rules": [
            "Blank values are stored as NULL (not reported); only explicit zeros are zero.",
            "Each fact row is unique per (integration, source record id); re-imports update or skip, never duplicate.",
            "When several integrations report the same store-day, only the system of record is counted.",
            "Rows failing validation are rejected and logged with row number, field and reason.",
        ],
    }
