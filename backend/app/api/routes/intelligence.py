"""Company intelligence, market news and benchmarking endpoints (Modules 10-12)."""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request, status
from pydantic import BaseModel, Field, HttpUrl
from sqlalchemy import select

from app.api.deps import DbSession, OrgContext, require
from app.core.config import get_settings
from app.core.errors import ConflictError, NotFoundError, ValidationAppError
from app.core.permissions import Permission
from app.models import MarketEntity, NewsArticle, NewsSource
from app.services import intelligence as intel
from app.services import market_data
from app.services.audit import record_audit
from app.services.news import add_article, article_out, search_articles
from app.worker.dispatcher import enqueue

router = APIRouter(tags=["intelligence"])
P = Permission


def _entity(db: DbSession, ctx: OrgContext, key: str) -> MarketEntity:
    entity = db.scalar(select(MarketEntity).where(MarketEntity.key == key,
                                                  (MarketEntity.org_id.is_(None)) | (MarketEntity.org_id == ctx.org_id)))
    if entity is None:
        raise NotFoundError("Company profile not found")
    return entity


@router.get("/orgs/{org_id}/intelligence/companies")
def list_companies(ctx: Annotated[OrgContext, Depends(require(P.INTELLIGENCE_READ))], db: DbSession) -> dict:
    return {"companies": [intel.company_profile(db, e, compact=True) for e in intel.visible_entities(db, ctx.org_id)],
            "market_data": market_data.status(),
            "disclaimer": "Profiles use verified public filings and cited secondary sources. No private company data is "
                          "estimated. NovaMart (the demo company) is fictional and is not part of these profiles."}


@router.get("/orgs/{org_id}/intelligence/companies/{key}")
def get_company(key: str, ctx: Annotated[OrgContext, Depends(require(P.INTELLIGENCE_READ))], db: DbSession) -> dict:
    return {**intel.company_profile(db, _entity(db, ctx, key)), "market_data": market_data.status()}


class TrackedCompanyIn(BaseModel):
    key: str = Field(pattern=r"^[a-z0-9_]{3,60}$")
    display_name: str = Field(min_length=1, max_length=200)
    legal_name: str | None = Field(default=None, max_length=250)
    aliases: list[str] = Field(default_factory=list, max_length=10)
    country: str | None = Field(default=None, pattern=r"^[A-Z]{2}$")
    sector: str | None = Field(default=None, max_length=200)
    website: HttpUrl | None = None
    is_listed: bool | None = None
    fiscal_year_end_month: int | None = Field(default=None, ge=1, le=12)
    reporting_currency: str | None = Field(default=None, pattern=r"^[A-Z]{3}$")


@router.post("/orgs/{org_id}/intelligence/companies", status_code=status.HTTP_201_CREATED)
def add_company(body: TrackedCompanyIn, ctx: Annotated[OrgContext, Depends(require(P.INTELLIGENCE_MANAGE))],
                db: DbSession, request: Request) -> dict:
    if db.scalar(select(MarketEntity.id).where(MarketEntity.key == body.key,
                                               (MarketEntity.org_id.is_(None)) | (MarketEntity.org_id == ctx.org_id))):
        raise ConflictError("A company with this key already exists")
    entity = MarketEntity(org_id=ctx.org_id, key=body.key, display_name=body.display_name, legal_name=body.legal_name,
                          aliases=body.aliases, country=body.country, sector=body.sector,
                          website=str(body.website) if body.website else None, is_listed=body.is_listed,
                          fiscal_year_end_month=body.fiscal_year_end_month, reporting_currency=body.reporting_currency,
                          data_gaps=["No observations yet - add figures with their source."],
                          source_note="Added by organization members")
    db.add(entity)
    db.flush()
    record_audit(db, action="intelligence.company_added", org_id=ctx.org_id, actor=ctx.user, entity_type="market_entity",
                 entity_id=entity.id, request=request, details={"key": body.key})
    return intel.company_profile(db, entity)


class ObservationIn(BaseModel):
    fiscal_year: str = Field(min_length=2, max_length=40)
    period_end: date
    metric: str = Field(pattern=r"^[a-z_]{3,60}$")
    value: float
    unit: str = Field(max_length=40)
    basis: str = Field(default="consolidated", max_length=40)
    source_url: HttpUrl
    source_name: str | None = Field(default=None, max_length=300)
    source_type: str | None = Field(default=None, max_length=40)
    notes: str | None = Field(default=None, max_length=2000)


@router.post("/orgs/{org_id}/intelligence/companies/{key}/observations", status_code=status.HTTP_201_CREATED)
def add_observation(key: str, body: ObservationIn, ctx: Annotated[OrgContext, Depends(require(P.INTELLIGENCE_MANAGE))],
                    db: DbSession, request: Request) -> dict:
    entity = _entity(db, ctx, key)
    if entity.org_id is None:
        raise ValidationAppError("Platform reference profiles are curated centrally; add observations to your own "
                                 "tracked companies")
    from app.seed.reference import UNIT_SCALE

    if body.unit not in UNIT_SCALE:
        raise ValidationAppError("Unknown unit", details={"allowed": sorted(UNIT_SCALE)})
    obs = intel.add_observation(db, entity, {**body.model_dump(), "source_url": str(body.source_url)})
    record_audit(db, action="intelligence.observation_added", org_id=ctx.org_id, actor=ctx.user,
                 entity_type="financial_observation", entity_id=obs.id, request=request,
                 details={"company": key, "metric": body.metric, "fiscal_year": body.fiscal_year})
    return {"id": obs.id, "verification_status": obs.verification_status}


@router.get("/orgs/{org_id}/benchmarking")
def benchmarking(ctx: Annotated[OrgContext, Depends(require(P.INTELLIGENCE_READ))], db: DbSession,
                 company_keys: list[str] | None = Query(default=None), include_own: bool = True) -> dict:
    company = ctx.default_company(db) if include_own and ctx.has(P.FINANCE_READ) and ctx.store_scope is None else None
    result = intel.benchmark(db, ctx.org_id, company, company_keys)
    if company is None and include_own:
        result["comparability_notes"].append("Your own company is shown only to members with company-wide finance access.")
    return result


# ---------------------------------------------------------------------------------------------
# News
# ---------------------------------------------------------------------------------------------


@router.get("/orgs/{org_id}/news")
def news(ctx: Annotated[OrgContext, Depends(require(P.INTELLIGENCE_READ))], db: DbSession,
         q: str | None = Query(default=None, max_length=120), company: str | None = Query(default=None, max_length=80),
         start: date | None = None, end: date | None = None, official_only: bool = False,
         include_duplicates: bool = False, limit: int = Query(default=30, ge=1, le=100),
         offset: int = Query(default=0, ge=0)) -> dict:
    return search_articles(db, ctx.org_id, q=q, entity_key=company,
                           start=datetime(start.year, start.month, start.day, tzinfo=UTC) if start else None,
                           end=datetime(end.year, end.month, end.day, 23, 59, tzinfo=UTC) if end else None,
                           official_only=official_only, include_duplicates=include_duplicates, limit=limit, offset=offset)


class ArticleIn(BaseModel):
    url: HttpUrl
    title: str = Field(min_length=5, max_length=1000)
    source_name: str = Field(min_length=2, max_length=200)
    published_at: date | None = None
    companies: list[str] = Field(default_factory=list, max_length=10)
    facts_summary: str | None = Field(default=None, max_length=1200)
    is_official_announcement: bool = False


@router.post("/orgs/{org_id}/news", status_code=status.HTTP_201_CREATED)
def add_news(body: ArticleIn, ctx: Annotated[OrgContext, Depends(require(P.INTELLIGENCE_MANAGE))], db: DbSession,
             request: Request) -> dict:
    published = datetime(body.published_at.year, body.published_at.month, body.published_at.day, tzinfo=UTC) \
        if body.published_at else None
    result = add_article(db, org_id=ctx.org_id, url=str(body.url), title=body.title, source_name=body.source_name,
                         published_at=published, entity_keys=body.companies or None, facts_summary=body.facts_summary,
                         facts_summary_method="curated" if body.facts_summary else None,
                         is_official=body.is_official_announcement, verified=False)
    if result["status"] == "exists":
        raise ConflictError("This article is already in the feed", code="duplicate_article", details=result)
    record_audit(db, action="news.article_added", org_id=ctx.org_id, actor=ctx.user, entity_type="news_article",
                 entity_id=result.get("id"), request=request, details={"status": result["status"]})
    return result


@router.get("/orgs/{org_id}/news/sources")
def news_sources(ctx: Annotated[OrgContext, Depends(require(P.INTELLIGENCE_READ))], db: DbSession) -> dict:
    rows = db.scalars(select(NewsSource).where((NewsSource.org_id.is_(None)) | (NewsSource.org_id == ctx.org_id))
                      .order_by(NewsSource.name)).all()
    return {"fetch_enabled": get_settings().news_fetch_enabled, "sources": [
        {"id": str(s.id), "name": s.name, "type": s.source_type, "url": s.url, "companies": s.entity_keys,
         "active": s.is_active, "verified_working": s.verified_working,
         "last_fetched_at": s.last_fetched_at.isoformat() if s.last_fetched_at else None, "last_status": s.last_status,
         "notes": s.notes} for s in rows]}


@router.post("/orgs/{org_id}/news/refresh", status_code=status.HTTP_202_ACCEPTED)
def refresh_news(ctx: Annotated[OrgContext, Depends(require(P.INTELLIGENCE_MANAGE))], db: DbSession,
                 request: Request) -> dict:
    if not get_settings().news_fetch_enabled:
        raise ConflictError("News fetching is disabled on this deployment (AUREX_NEWS_FETCH_ENABLED=false)",
                            code="news_fetch_disabled")
    job = enqueue(db, "refresh_news", {"org_id": str(ctx.org_id)}, org_id=ctx.org_id, user_id=ctx.user.id)
    record_audit(db, action="news.refresh_requested", org_id=ctx.org_id, actor=ctx.user, entity_type="background_job",
                 entity_id=job.id, request=request)
    return {"job_id": str(job.id)}


@router.post("/orgs/{org_id}/news/{article_id}/interpret")
def interpret(article_id: uuid.UUID, ctx: Annotated[OrgContext, Depends(require(P.INTELLIGENCE_MANAGE))],
              db: DbSession) -> dict:
    article = db.scalar(select(NewsArticle).where(NewsArticle.id == article_id,
                                                  (NewsArticle.org_id.is_(None)) | (NewsArticle.org_id == ctx.org_id)))
    if article is None:
        raise NotFoundError("Article not found")
    from app.services.news_ai import interpret_article

    interpret_article(db, article)
    return article_out(article)
