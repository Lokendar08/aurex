"""Company intelligence and benchmarking from cited public data.

Rules
- Only stored observations with a source are shown; nothing is estimated. Derived metrics (growth,
  margins, revenue per store) are computed with ``app.services.metrics`` from those observations and
  labelled as derived.
- Revenue growth, share-price performance and market-share change are separate measures and are never
  presented as one another.
- Share prices / market caps exist only for verified listed securities, always with as-of date and source.
"""

from __future__ import annotations

import uuid
from collections import defaultdict
from datetime import date
from typing import Any

from sqlalchemy import any_, or_, select
from sqlalchemy.orm import Session

from app.models import (
    Company,
    FinancialObservation,
    ListedSecurity,
    MarketEntity,
    MarketObservation,
    NewsArticle,
)
from app.services import metrics as m
from app.services.analytics.base import Scope, data_bounds
from app.services.analytics.health import health_score
from app.services.analytics.pnl import compute_pnl
from app.services.periods import fiscal_year_of, fiscal_year_range

REVENUE_METRIC = "revenue_from_operations"
BASIS_PREFERENCE = ("consolidated", "standalone")


def _series(observations: list[FinancialObservation]) -> dict[str, list[FinancialObservation]]:
    """Per metric, one observation per fiscal year, preferring consolidated figures."""
    grouped: dict[tuple[str, str], list[FinancialObservation]] = defaultdict(list)
    for o in observations:
        grouped[(o.metric, o.fiscal_year)].append(o)
    out: dict[str, list[FinancialObservation]] = defaultdict(list)
    for (metric, _), rows in grouped.items():
        rows.sort(key=lambda r: BASIS_PREFERENCE.index(r.basis) if r.basis in BASIS_PREFERENCE else 9)
        out[metric].append(rows[0])
    for metric in out:
        out[metric].sort(key=lambda r: r.period_end)
    return out


def _obs_out(o: FinancialObservation) -> dict[str, Any]:
    return {"fiscal_year": o.fiscal_year, "period_end": o.period_end.isoformat(), "basis": o.basis, "value": o.value,
            "unit": o.unit, "value_base_units": o.value_base_units, "currency": o.currency, "source_url": o.source_url,
            "source_name": o.source_name, "source_type": o.source_type, "verification_status": o.verification_status,
            "notes": o.notes}


_SYMBOLS = {"INR": "₹", "MYR": "RM ", "USD": "$"}


def _display(o: FinancialObservation) -> str:
    if o.unit == "count":
        return f"{o.value:,.0f}"
    if "_" in o.unit and o.unit.split("_", 1)[0] in _SYMBOLS:
        currency, scale = o.unit.split("_", 1)
        if scale.startswith("per_"):
            return f"{_SYMBOLS[currency]}{o.value:,.0f} {scale.replace('_', ' ')}"
        return f"{_SYMBOLS[currency]}{o.value:,.2f} {scale}"
    if o.unit in _SYMBOLS:
        return f"{_SYMBOLS[o.unit]}{o.value:,.0f}"
    return f"{o.value:,.2f} {o.unit.replace('_', ' ')}"


def derived_metrics(series: dict[str, list[FinancialObservation]]) -> list[dict[str, Any]]:
    """Year-by-year growth and margins computed from reported figures (same basis and units only)."""
    rows = []
    revenue = {o.fiscal_year: o for o in series.get(REVENUE_METRIC, [])}
    years = sorted(revenue, key=lambda y: revenue[y].period_end)
    for i, fy in enumerate(years):
        rev = revenue[fy]
        row: dict[str, Any] = {"fiscal_year": fy, "period_end": rev.period_end.isoformat(), "basis": rev.basis,
                               "revenue": rev.value_base_units, "currency": rev.currency}
        if i > 0:
            prev = revenue[years[i - 1]]
            comparable = prev.basis == rev.basis and prev.value_base_units and rev.value_base_units
            g = m.growth_rate(rev.value_base_units, prev.value_base_units) if comparable else m.MetricResult(
                None, "not_meaningful", "different bases or units")
            row["revenue_growth"] = g.value
            row["revenue_growth_note"] = g.note
        for metric, key in (("ebitda", "ebitda_margin"), ("net_profit", "net_margin"), ("gross_profit", "gross_margin")):
            obs = next((o for o in series.get(metric, []) if o.fiscal_year == fy), None)
            if obs and obs.value_base_units is not None and rev.value_base_units:
                row[key] = m.margin(obs.value_base_units, rev.value_base_units).value
        stores = next((o for o in series.get("store_count", []) if o.fiscal_year == fy), None)
        if stores and stores.value and rev.value_base_units:
            row["store_count"] = stores.value
            row["revenue_per_store"] = rev.value_base_units / stores.value
        inv = {o.fiscal_year: o for o in series.get("inventories", [])}
        purchases = next((o for o in series.get("purchases_of_stock_in_trade", []) if o.fiscal_year == fy), None)
        change = next((o for o in series.get("changes_in_inventories", []) if o.fiscal_year == fy), None)
        if purchases and change and purchases.value_base_units is not None and change.value_base_units is not None:
            cogs = purchases.value_base_units + change.value_base_units
            row["cogs_derived"] = cogs
            row["gross_margin_derived"] = m.margin(rev.value_base_units - cogs, rev.value_base_units).value
            if fy in inv and i > 0 and years[i - 1] in inv and inv[fy].value_base_units and inv[years[i - 1]].value_base_units:
                avg_inv = (inv[fy].value_base_units + inv[years[i - 1]].value_base_units) / 2
                row["inventory_turnover"] = m.safe_ratio(cogs, avg_inv).value
        rows.append(row)
    return rows


def _latest_snapshot(db: Session, entity: MarketEntity) -> dict[str, Any] | None:
    securities = db.scalars(select(ListedSecurity).where(ListedSecurity.entity_id == entity.id)).all()
    best = None
    for sec in securities:
        obs = db.scalar(select(MarketObservation).where(MarketObservation.security_id == sec.id)
                        .order_by(MarketObservation.as_of.desc()).limit(1))
        if obs and (best is None or obs.as_of > best[1].as_of):
            best = (sec, obs)
    if best is None:
        return None
    sec, obs = best
    return {"exchange": sec.exchange, "ticker": sec.ticker, "as_of": obs.as_of.isoformat(), "close_price": obs.close_price,
            "currency": obs.currency, "market_cap": obs.market_cap, "market_cap_unit": obs.market_cap_unit,
            "source": obs.source, "source_url": obs.source_url, "is_snapshot": obs.is_snapshot, "notes": obs.notes}


def _price_performance(db: Session, entity: MarketEntity) -> dict[str, Any] | None:
    """Share-price change between the two most distant stored observations (if at least two exist)."""
    sec = db.scalar(select(ListedSecurity).where(ListedSecurity.entity_id == entity.id).limit(1))
    if sec is None:
        return None
    obs = db.scalars(select(MarketObservation).where(MarketObservation.security_id == sec.id)
                     .order_by(MarketObservation.as_of)).all()
    priced = [o for o in obs if o.close_price]
    if len(priced) < 2:
        return {"status": "insufficient_observations", "observations": len(priced),
                "note": "Price performance needs at least two dated price observations from a market-data source."}
    g = m.growth_rate(priced[-1].close_price, priced[0].close_price)
    return {"status": "ok", "from": priced[0].as_of.isoformat(), "to": priced[-1].as_of.isoformat(), "change": g.value,
            "note": "Share-price change only; it is not revenue growth or market-share change."}


def company_profile(db: Session, entity: MarketEntity, compact: bool = False) -> dict[str, Any]:
    observations = db.scalars(select(FinancialObservation).where(FinancialObservation.entity_id == entity.id)).all()
    series = _series(observations)
    derived = derived_metrics(series)
    securities = db.scalars(select(ListedSecurity).where(ListedSecurity.entity_id == entity.id)).all()
    snapshot = _latest_snapshot(db, entity) if entity.is_listed else None
    highlights: dict[str, Any] = {}
    rev = series.get(REVENUE_METRIC, [])
    if rev:
        last = rev[-1]
        highlights["latest_revenue"] = {"value": last.value, "display": _display(last), "fiscal_year": last.fiscal_year,
                                        "source_url": last.source_url, "source_name": last.source_name,
                                        "verification_status": last.verification_status}
    if derived and derived[-1].get("revenue_growth") is not None:
        d = derived[-1]
        highlights["revenue_growth"] = {"value": d["revenue_growth"], "display": f"{d['revenue_growth'] * 100:+.1f}%",
                                        "fiscal_year": d["fiscal_year"], "verification_status": "derived",
                                        "source_name": "Derived from reported revenue"}
    if derived and derived[-1].get("net_margin") is not None:
        d = derived[-1]
        highlights["net_margin"] = {"value": d["net_margin"], "display": f"{d['net_margin'] * 100:.1f}%",
                                    "fiscal_year": d["fiscal_year"], "verification_status": "derived",
                                    "source_name": "Derived from reported net profit and revenue"}
    stores = series.get("store_count", [])
    if stores:
        s = stores[-1]
        highlights["store_count"] = {"value": s.value, "display": f"{s.value:,.0f}", "fiscal_year": s.fiscal_year,
                                     "source_url": s.source_url, "source_name": s.source_name,
                                     "verification_status": s.verification_status}
    out: dict[str, Any] = {
        "key": entity.key, "display_name": entity.display_name, "legal_name": entity.legal_name, "aliases": entity.aliases,
        "country": entity.country, "sector": entity.sector, "website": entity.website, "description": entity.description,
        "is_listed": entity.is_listed, "fiscal_year_end_month": entity.fiscal_year_end_month,
        "reporting_currency": entity.reporting_currency, "reporting_basis": entity.reporting_basis,
        "securities": [{"exchange": s.exchange, "ticker": s.ticker, "isin": s.isin, "currency": s.currency,
                        "listing_date": s.listing_date.isoformat() if s.listing_date else None,
                        "verification_status": s.verification_status, "source_url": s.source_url} for s in securities],
        "highlights": highlights, "market_snapshot": snapshot,
        "data_gaps": entity.data_gaps, "market_share_estimates": entity.market_share_estimates,
        "custom": entity.org_id is not None,
    }
    if compact:
        out["recent_years"] = derived[-3:]
        return out
    out["financials"] = {metric: [_obs_out(o) for o in rows] for metric, rows in sorted(series.items())}
    out["derived"] = derived
    out["price_performance"] = _price_performance(db, entity) if entity.is_listed else None
    out["news"] = [{"id": str(a.id), "title": a.title, "url": a.url, "source_name": a.source_name,
                    "published_at": a.published_at.isoformat() if a.published_at else None,
                    "is_official_announcement": a.is_official_announcement}
                   for a in db.scalars(select(NewsArticle).where(any_(NewsArticle.entity_keys) == entity.key,
                                                                 NewsArticle.duplicate_of_id.is_(None))
                                       .order_by(NewsArticle.published_at.desc().nulls_last()).limit(8))]
    out["measures_note"] = ("Revenue growth (from filings), share-price performance (from market data) and market-share "
                            "estimates (from third-party research) are different measures and are shown separately.")
    return out


def visible_entities(db: Session, org_id: uuid.UUID) -> list[MarketEntity]:
    return db.scalars(select(MarketEntity).where(or_(MarketEntity.org_id.is_(None), MarketEntity.org_id == org_id))
                      .order_by(MarketEntity.display_name)).all()


# ---------------------------------------------------------------------------------------------
# Benchmarking
# ---------------------------------------------------------------------------------------------


def own_company_metrics(db: Session, org_id: uuid.UUID, company: Company) -> dict[str, Any] | None:
    """Last complete fiscal year metrics for the organization's own company, computed from AUREX data."""
    _, data_end = data_bounds(db, company.id)
    if data_end is None:
        return None
    fy = fiscal_year_of(data_end, company.fiscal_year_start_month) - 1
    start, end = fiscal_year_range(fy, company.fiscal_year_start_month)
    prev_start, prev_end = fiscal_year_range(fy - 1, company.fiscal_year_start_month)
    scope = Scope(org_id=org_id, company=company)
    cur = compute_pnl(db, scope, start, end, data_end)
    prev = compute_pnl(db, scope, prev_start, prev_end, data_end)
    from sqlalchemy import func

    from app.models import Store
    from app.services.analytics.operations import inventory_value_series

    stores = db.scalar(select(func.count()).select_from(Store).where(Store.company_id == company.id,
                                                                     Store.opened_on <= end)) or 0
    prev_stores = db.scalar(select(func.count()).select_from(Store).where(Store.company_id == company.id,
                                                                          Store.opened_on <= prev_end)) or 0
    inv = inventory_value_series(db, scope, start, end)
    turnover = m.inventory_turnover(cur.cogs, float(inv["value"].mean()) if not inv.empty else None, (end - start).days + 1)
    covered_full = prev.days_with_sales >= 300
    return {
        "key": f"own:{company.id}", "display_name": company.name, "is_synthetic": company.is_synthetic, "own": True,
        "fiscal_year": f"FY{fy}", "period_end": end.isoformat(), "currency": company.base_currency,
        "revenue": cur.net_sales, "revenue_growth": m.growth_rate(cur.net_sales, prev.net_sales if covered_full else None).value,
        "gross_margin": cur.gross_margin, "ebitda_margin": cur.ebitda_margin, "net_margin": cur.net_margin,
        "store_count": stores, "store_growth": m.growth_rate(stores, prev_stores).value if prev_stores else None,
        "revenue_per_store": cur.net_sales / stores if stores else None, "inventory_turnover": turnover.value,
        "source": "AUREX (system-of-record data)" + (" - SYNTHETIC demo data" if company.is_synthetic else ""),
        "health": health_score(revenue_growth=m.growth_rate(cur.net_sales, prev.net_sales).value if covered_full else None,
                               ebitda_margin=cur.ebitda_margin, cash_months=None, inventory_turnover=turnover.value,
                               out_of_stock_rate=None, cost_coverage=cur.cost_coverage, data_age_days=None),
    }


def public_company_metrics(db: Session, entity: MarketEntity) -> dict[str, Any] | None:
    observations = db.scalars(select(FinancialObservation).where(FinancialObservation.entity_id == entity.id)).all()
    series = _series(observations)
    derived = derived_metrics(series)
    if not derived:
        return None
    latest = derived[-1]
    prev = derived[-2] if len(derived) > 1 else {}
    stores_now, stores_prev = latest.get("store_count"), prev.get("store_count")
    sources = sorted({o.verification_status for o in observations})
    return {
        "key": entity.key, "display_name": entity.display_name, "is_synthetic": False, "own": False,
        "is_listed": entity.is_listed, "fiscal_year": latest["fiscal_year"], "period_end": latest["period_end"],
        "currency": latest.get("currency") or entity.reporting_currency, "revenue": latest.get("revenue"),
        "revenue_growth": latest.get("revenue_growth"),
        "gross_margin": latest.get("gross_margin") if latest.get("gross_margin") is not None else latest.get("gross_margin_derived"),
        "ebitda_margin": latest.get("ebitda_margin"), "net_margin": latest.get("net_margin"), "store_count": stores_now,
        "store_growth": m.growth_rate(stores_now, stores_prev).value if stores_now and stores_prev else None,
        "revenue_per_store": latest.get("revenue_per_store"), "inventory_turnover": latest.get("inventory_turnover"),
        "basis": latest.get("basis"), "source": f"Public filings ({', '.join(sources)})",
        "price_performance": _price_performance(db, entity) if entity.is_listed else None,
        "health": health_score(revenue_growth=latest.get("revenue_growth"), ebitda_margin=latest.get("ebitda_margin"),
                               cash_months=None, inventory_turnover=latest.get("inventory_turnover"),
                               out_of_stock_rate=None, cost_coverage=None, data_age_days=None),
    }


def benchmark(db: Session, org_id: uuid.UUID, company: Company | None, entity_keys: list[str] | None) -> dict[str, Any]:
    rows = []
    if company is not None:
        own = own_company_metrics(db, org_id, company)
        if own:
            rows.append(own)
    for entity in visible_entities(db, org_id):
        if entity_keys and entity.key not in entity_keys:
            continue
        row = public_company_metrics(db, entity)
        if row:
            rows.append(row)
    fy_months = sorted({e.fiscal_year_end_month for e in visible_entities(db, org_id) if e.fiscal_year_end_month})
    currencies = sorted({r["currency"] for r in rows if r.get("currency")})
    notes = [
        "Ratios (growth, margins, turnover) are compared directly; absolute revenue is shown in each company's own "
        "reporting currency and is not converted.",
        "Fiscal years differ (e.g. year ending March vs December); each row shows its own latest complete fiscal year.",
        "Accounting standards differ (Ind AS vs MFRS); EBITDA definitions and lease accounting (Ind AS 116 / IFRS 16) affect "
        "comparability. Gross margin for some companies is derived as revenue − (purchases + change in inventories).",
        "Revenue growth includes new-store expansion; it is not like-for-like growth.",
        "Business health scores for public companies exclude liquidity and data-quality components (not derivable from the "
        "stored figures), so they are not directly comparable with your own company's score.",
    ]
    if any(r.get("is_synthetic") for r in rows):
        notes.insert(0, "Your company's figures are SYNTHETIC demonstration data and are not comparable to real companies.")
    if len(currencies) > 1:
        notes.append(f"Currencies present: {', '.join(currencies)}.")
    return {"rows": rows, "metrics": ["revenue_growth", "gross_margin", "ebitda_margin", "net_margin", "store_growth",
                                      "revenue_per_store", "inventory_turnover"],
            "fiscal_year_end_months": fy_months, "comparability_notes": notes,
            "health_score_method": "See the Executive Dashboard methodology; components without data are excluded."}


def add_observation(db: Session, entity: MarketEntity, data: dict[str, Any]) -> FinancialObservation:
    from app.seed.reference import UNIT_SCALE

    scale, currency = UNIT_SCALE.get(data["unit"], (None, None))
    obs = FinancialObservation(entity_id=entity.id, fiscal_year=data["fiscal_year"], period_end=data["period_end"],
                               basis=data.get("basis") or "consolidated", metric=data["metric"], value=data["value"],
                               unit=data["unit"], value_base_units=data["value"] * scale if scale else None,
                               currency=currency or entity.reporting_currency, source_url=data["source_url"],
                               source_name=data.get("source_name"), source_type=data.get("source_type") or "user_provided",
                               verification_status="user_provided", notes=data.get("notes"),
                               retrieved_at=date.today())
    db.add(obs)
    db.flush()
    return obs
