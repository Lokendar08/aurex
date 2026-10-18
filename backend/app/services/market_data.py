"""Optional market-data provider for listed securities (share prices).

Without ``AUREX_MARKET_DATA_PROVIDER`` + ``AUREX_MARKET_DATA_API_KEY`` AUREX shows only stored, sourced
snapshots (labelled "snapshot, not live"). With a provider configured, ``refresh_prices`` fetches
recent daily closes for securities that have a provider symbol mapping and stores them as
``MarketObservation`` rows with the provider named as source. No scraping is performed.

Provider symbol formats differ (e.g. Alpha Vantage uses an exchange suffix such as ``.BSE``); each
security's provider symbol must be configured explicitly - AUREX never guesses tickers.
"""

from __future__ import annotations

from datetime import date
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import ConflictError
from app.models import ListedSecurity, MarketObservation

PROVIDER_URLS = {"alphavantage": "https://www.alphavantage.co/query", "twelvedata": "https://api.twelvedata.com/time_series"}


def status() -> dict[str, Any]:
    settings = get_settings()
    configured = settings.market_data_provider != "none" and settings.market_data_api_key is not None
    return {"provider": settings.market_data_provider, "configured": configured,
            "note": None if configured else "No market-data provider configured: only stored snapshots with their source "
                                            "and as-of date are shown. See docs/research/COMPANY_DATA.md for licensed "
                                            "data options."}


def _fetch(provider: str, symbol: str, api_key: str) -> list[tuple[date, float]]:
    if provider == "alphavantage":
        response = httpx.get(PROVIDER_URLS[provider], params={"function": "TIME_SERIES_DAILY", "symbol": symbol,
                                                              "apikey": api_key, "outputsize": "compact"}, timeout=20)
        response.raise_for_status()
        series = response.json().get("Time Series (Daily)") or {}
        return [(date.fromisoformat(d), float(v["4. close"])) for d, v in series.items()]
    if provider == "twelvedata":
        response = httpx.get(PROVIDER_URLS[provider], params={"symbol": symbol, "interval": "1day", "outputsize": 100,
                                                              "apikey": api_key}, timeout=20)
        response.raise_for_status()
        return [(date.fromisoformat(v["datetime"][:10]), float(v["close"])) for v in response.json().get("values", [])]
    raise ConflictError("Unknown market-data provider")


def refresh_prices(db: Session, symbol_map: dict[str, str]) -> dict[str, Any]:
    """``symbol_map``: ``"EXCHANGE:TICKER" -> provider symbol`` supplied by an administrator."""
    st = status()
    if not st["configured"]:
        raise ConflictError(st["note"], code="market_data_not_configured")
    settings = get_settings()
    stored = 0
    errors = []
    for sec in db.scalars(select(ListedSecurity).where(ListedSecurity.verification_status == "verified")).all():
        symbol = symbol_map.get(f"{sec.exchange}:{sec.ticker}")
        if not symbol:
            continue
        try:
            points = _fetch(settings.market_data_provider, symbol, settings.market_data_api_key.get_secret_value())
        except (httpx.HTTPError, ValueError, KeyError) as exc:
            errors.append({"security": f"{sec.exchange}:{sec.ticker}", "error": type(exc).__name__})
            continue
        for day, close in points:
            exists = db.scalar(select(MarketObservation.id).where(MarketObservation.security_id == sec.id,
                                                                  MarketObservation.as_of == day,
                                                                  MarketObservation.source == settings.market_data_provider))
            if exists is None:
                db.add(MarketObservation(security_id=sec.id, as_of=day, close_price=close, currency=sec.currency,
                                         source=settings.market_data_provider, is_snapshot=False,
                                         notes=f"Daily close from {settings.market_data_provider} ({symbol})"))
                stored += 1
    return {"stored": stored, "errors": errors}
