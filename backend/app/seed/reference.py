"""Load verified public reference data (company intelligence, market snapshots, news) from JSON files.

Only figures present in ``app/data/reference/*.json`` are loaded; each carries its source URL,
source type and verification status. Nothing is estimated or filled in.
"""

from __future__ import annotations

import json
from datetime import date, datetime
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    FinancialObservation,
    ListedSecurity,
    MarketEntity,
    MarketObservation,
    NewsSource,
)

REFERENCE_DIR = Path(__file__).resolve().parents[1] / "data" / "reference"

UNIT_SCALE = {
    "INR_crore": (1e7, "INR"), "INR_lakh": (1e5, "INR"), "INR_million": (1e6, "INR"), "INR_billion": (1e9, "INR"),
    "INR": (1.0, "INR"), "MYR_million": (1e6, "MYR"), "MYR_thousand": (1e3, "MYR"), "MYR_billion": (1e9, "MYR"),
    "MYR": (1.0, "MYR"), "count": (1.0, None), "sqft_million": (1e6, None), "sqft": (1.0, None),
    "INR_per_sqft": (1.0, "INR"), "MYR_per_sqft": (1.0, "MYR"), "percent": (1.0, None),
}


def _read(name: str) -> dict[str, Any] | None:
    path = REFERENCE_DIR / name
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _date(value: Any) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def load_companies(db: Session) -> dict[str, int]:
    data = _read("companies.json")
    if not data:
        return {"entities": 0, "observations": 0}
    entities = observations = snapshots = 0
    for item in data.get("companies", []):
        key = item.get("key")
        if not key:
            continue
        entity = db.scalar(select(MarketEntity).where(MarketEntity.org_id.is_(None), MarketEntity.key == key))
        if entity is None:
            entity = MarketEntity(org_id=None, key=key, display_name=item.get("display_name") or key)
            db.add(entity)
        entity.display_name = item.get("display_name") or key
        entity.legal_name = item.get("legal_name")
        entity.aliases = [str(a)[:120] for a in item.get("aliases") or []]
        entity.country = item.get("country")
        entity.sector = item.get("sector")
        entity.website = item.get("website")
        entity.description = item.get("description")
        entity.is_listed = item.get("is_listed")
        entity.fiscal_year_end_month = item.get("fiscal_year_end_month")
        entity.reporting_currency = item.get("reporting_currency")
        entity.reporting_basis = item.get("reporting_basis")
        entity.data_gaps = item.get("data_gaps") or []
        entity.market_share_estimates = item.get("market_share_estimates") or []
        entity.source_note = f"Loaded from verified reference file generated {data.get('generated_at')}"
        db.flush()
        entities += 1
        for sec in item.get("securities") or []:
            if not sec.get("exchange") or not sec.get("ticker"):
                continue
            security = db.scalar(select(ListedSecurity).where(ListedSecurity.exchange == sec["exchange"],
                                                              ListedSecurity.ticker == str(sec["ticker"])))
            if security is None:
                security = ListedSecurity(entity_id=entity.id, exchange=sec["exchange"], ticker=str(sec["ticker"]),
                                          currency=sec.get("currency") or entity.reporting_currency or "INR",
                                          verification_status=sec.get("verification_status") or "unverified")
                db.add(security)
            security.isin = sec.get("isin")
            security.listing_date = _date(sec.get("listing_date"))
            security.source_url = sec.get("source_url")
            security.verification_status = sec.get("verification_status") or "unverified"
            db.flush()
        for snap in item.get("market_data_snapshot") or []:
            security = db.scalar(select(ListedSecurity).where(ListedSecurity.exchange == snap.get("exchange"),
                                                              ListedSecurity.ticker == str(snap.get("ticker"))))
            as_of = _date(snap.get("as_of"))
            if security is None or as_of is None:
                continue
            source = (snap.get("source_url") or "reference snapshot")[:200]
            if db.scalar(select(MarketObservation.id).where(MarketObservation.security_id == security.id,
                                                            MarketObservation.as_of == as_of,
                                                            MarketObservation.source == source)) is None:
                db.add(MarketObservation(security_id=security.id, as_of=as_of, close_price=snap.get("close_price"),
                                         market_cap=snap.get("market_cap"), market_cap_unit=snap.get("market_cap_unit"),
                                         currency=snap.get("currency") or security.currency, source=source,
                                         source_url=snap.get("source_url"), is_snapshot=True, notes=snap.get("notes")))
                snapshots += 1
        for obs in item.get("observations") or []:
            try:
                value = float(obs["value"])
            except (KeyError, TypeError, ValueError):
                continue
            period_end = _date(obs.get("period_end"))
            if period_end is None or not obs.get("metric") or not obs.get("fiscal_year"):
                continue
            basis = obs.get("basis") or "consolidated"
            scale, currency = UNIT_SCALE.get(obs.get("unit") or "", (None, None))
            row = db.scalar(select(FinancialObservation).where(
                FinancialObservation.entity_id == entity.id, FinancialObservation.fiscal_year == obs["fiscal_year"],
                FinancialObservation.basis == basis, FinancialObservation.metric == obs["metric"]))
            if row is None:
                row = FinancialObservation(entity_id=entity.id, fiscal_year=obs["fiscal_year"], basis=basis,
                                           metric=obs["metric"], period_end=period_end, value=value,
                                           unit=obs.get("unit") or "unknown",
                                           verification_status=obs.get("verification_status") or "unverified")
                db.add(row)
            row.period_end = period_end
            row.value = value
            row.unit = obs.get("unit") or "unknown"
            row.value_base_units = value * scale if scale is not None else None
            row.currency = currency or entity.reporting_currency
            row.source_url = obs.get("source_url")
            row.source_name = obs.get("source_name")
            row.source_type = obs.get("source_type")
            row.verification_status = obs.get("verification_status") or "unverified"
            row.notes = obs.get("notes")
            row.retrieved_at = _date(data.get("generated_at"))
            observations += 1
    db.flush()
    return {"entities": entities, "observations": observations, "market_snapshots": snapshots}


def load_news(db: Session) -> dict[str, int]:
    from app.services.news import add_article

    sources_data = _read("news_sources.json") or {}
    sources = 0
    for src in sources_data.get("sources", []):
        if not src.get("url"):
            continue
        row = db.scalar(select(NewsSource).where(NewsSource.org_id.is_(None), NewsSource.url == src["url"]))
        if row is None:
            row = NewsSource(org_id=None, name=src.get("name") or src["url"], source_type=src.get("type") or "rss",
                             url=src["url"])
            db.add(row)
        row.entity_keys = src.get("companies") or []
        row.verified_working = src.get("verified_working")
        row.is_active = bool(src.get("verified_working"))
        row.notes = src.get("notes")
        sources += 1
    articles = duplicates = 0
    for art in (_read("news_seed.json") or {}).get("articles", []):
        if not art.get("url") or not art.get("title") or not art.get("verified"):
            continue
        published = _date(art.get("published_at"))
        result = add_article(
            db, org_id=None, url=art["url"], title=art["title"], source_name=art.get("source_name") or "Unknown",
            published_at=datetime(published.year, published.month, published.day) if published else None,
            entity_keys=art.get("companies") or [], facts_summary=art.get("facts_summary"),
            facts_summary_method="curated", is_official=bool(art.get("is_official_announcement")), verified=True)
        if result["status"] == "created":
            articles += 1
        elif result["status"] == "duplicate":
            duplicates += 1
    db.flush()
    return {"sources": sources, "articles": articles, "duplicates": duplicates}


def load_reference_data(db: Session) -> dict[str, Any]:
    return {"companies": load_companies(db), "news": load_news(db)}
