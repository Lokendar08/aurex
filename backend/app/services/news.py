"""Market news: ingestion from verified feeds, duplicate detection, search and labelled summaries.

Facts vs interpretation
- ``facts_summary`` holds reported facts only: a curated own-words summary (seed data), or an
  *extractive* excerpt of the publisher's feed description. It never contains model speculation.
- ``ai_interpretation`` holds AI-generated strategic implications, produced only when an LLM is
  configured, always labelled as AI-generated with model name and timestamp, and never presented as fact.

Duplicates
- Exact: canonical URL (tracking parameters, fragments, ``www.`` and trailing slashes removed).
- Near: Jaccard similarity >= 0.75 between normalized title token sets within +/- 3 days.
  Near-duplicates are stored (provenance) but linked via ``duplicate_of_id`` and hidden by default.
"""

from __future__ import annotations

import hashlib
import html
import logging
import re
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

from sqlalchemy import and_, any_, func, or_, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import MarketEntity, NewsArticle, NewsSource

logger = logging.getLogger("aurex.news")

_TRACKING = re.compile(r"^(utm_.*|fbclid|gclid|mc_cid|mc_eid|ref|ref_src|cmpid|ito|taid|ns_.*|igshid)$", re.I)
_STOPWORDS = {"a", "an", "the", "and", "or", "of", "to", "in", "on", "for", "with", "at", "by", "from", "as", "is", "are",
              "its", "it", "be", "has", "have", "after", "over", "into", "up", "new", "says", "say", "amid"}
NEAR_DUPLICATE_THRESHOLD = 0.75


def canonicalize_url(url: str) -> str:
    parsed = urlparse(url.strip())
    host = (parsed.hostname or "").lower()
    if host.startswith("www."):
        host = host[4:]
    query = urlencode(sorted((k, v) for k, v in parse_qsl(parsed.query, keep_blank_values=False)
                             if not _TRACKING.match(k)))
    path = re.sub(r"/+$", "", parsed.path) or "/"
    return urlunparse(("https" if parsed.scheme in ("http", "https") else parsed.scheme, host, path, "", query, ""))


def url_hash(url: str) -> str:
    return hashlib.sha256(canonicalize_url(url).encode()).hexdigest()


def title_tokens(title: str) -> set[str]:
    words = re.findall(r"[a-z0-9]+", html.unescape(title).lower())
    return {w for w in words if w not in _STOPWORDS and len(w) > 1}


def title_fingerprint(title: str) -> str:
    return " ".join(sorted(title_tokens(title)))[:300]


def jaccard(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def strip_html(text: str | None, limit: int = 600) -> str | None:
    if not text:
        return None
    cleaned = re.sub(r"<[^>]+>", " ", html.unescape(text))
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned[:limit] if cleaned else None


def extractive_summary(text: str | None, max_sentences: int = 2, limit: int = 320) -> str | None:
    """First sentences of the publisher's own description - an excerpt, not a model-written summary."""
    cleaned = strip_html(text, 2000)
    if not cleaned:
        return None
    sentences = re.split(r"(?<=[.!?])\s+", cleaned)
    summary = " ".join(sentences[:max_sentences]).strip()
    return summary[:limit] + ("…" if len(summary) > limit else "")


def tag_entities(db: Session, org_id: uuid.UUID | None, title: str, snippet: str | None) -> list[str]:
    haystack = f" {title} {snippet or ''} ".lower()
    keys: list[str] = []
    rows = db.scalars(select(MarketEntity).where(or_(MarketEntity.org_id.is_(None), MarketEntity.org_id == org_id)))
    for entity in rows:
        names = [entity.display_name, entity.legal_name or "", *(entity.aliases or [])]
        for name in names:
            name = (name or "").strip().lower()
            if len(name) >= 4 and re.search(rf"(?<![a-z0-9]){re.escape(name)}(?![a-z0-9])", haystack):
                keys.append(entity.key)
                break
    return keys


def add_article(db: Session, *, org_id: uuid.UUID | None, url: str, title: str, source_name: str,
                published_at: datetime | None, entity_keys: list[str] | None = None, snippet: str | None = None,
                facts_summary: str | None = None, facts_summary_method: str | None = None,
                is_official: bool = False, verified: bool = False, source_id: uuid.UUID | None = None) -> dict[str, Any]:
    title = re.sub(r"\s+", " ", html.unescape(title)).strip()[:1000]
    if not title or not url.lower().startswith(("http://", "https://")):
        return {"status": "rejected", "reason": "title and http(s) url are required"}
    h = url_hash(url)
    scope = NewsArticle.org_id.is_(None) if org_id is None else NewsArticle.org_id == org_id
    existing = db.scalar(select(NewsArticle).where(scope, NewsArticle.url_hash == h))
    if existing:
        return {"status": "exists", "id": str(existing.id)}
    published = published_at.replace(tzinfo=published_at.tzinfo or UTC) if published_at else None
    tokens = title_tokens(title)
    duplicate_of = None
    window_start = (published or datetime.now(UTC)) - timedelta(days=3)
    window_end = (published or datetime.now(UTC)) + timedelta(days=3)
    candidates = db.scalars(select(NewsArticle).where(
        or_(NewsArticle.org_id.is_(None), NewsArticle.org_id == org_id), NewsArticle.duplicate_of_id.is_(None),
        or_(NewsArticle.published_at.is_(None),
            and_(NewsArticle.published_at >= window_start, NewsArticle.published_at <= window_end))).limit(500))
    for cand in candidates:
        if jaccard(tokens, set(cand.title_fingerprint.split())) >= NEAR_DUPLICATE_THRESHOLD:
            duplicate_of = cand.id
            break
    clean_snippet = strip_html(snippet)
    if not facts_summary and clean_snippet:
        facts_summary = extractive_summary(clean_snippet)
        facts_summary_method = "extractive"
    article = NewsArticle(
        org_id=org_id, source_id=source_id, url=url, canonical_url=canonicalize_url(url), url_hash=h, title=title,
        title_fingerprint=title_fingerprint(title), source_name=source_name[:200], published_at=published,
        snippet=clean_snippet, facts_summary=facts_summary, facts_summary_method=facts_summary_method,
        entity_keys=entity_keys or tag_entities(db, org_id, title, clean_snippet), is_official_announcement=is_official,
        duplicate_of_id=duplicate_of, verified=verified,
    )
    db.add(article)
    db.flush()
    return {"status": "duplicate" if duplicate_of else "created", "id": str(article.id),
            "duplicate_of": str(duplicate_of) if duplicate_of else None}


def search_articles(db: Session, org_id: uuid.UUID, *, q: str | None = None, entity_key: str | None = None,
                    start: datetime | None = None, end: datetime | None = None, official_only: bool = False,
                    include_duplicates: bool = False, limit: int = 30, offset: int = 0) -> dict[str, Any]:
    query = select(NewsArticle).where(or_(NewsArticle.org_id.is_(None), NewsArticle.org_id == org_id))
    if not include_duplicates:
        query = query.where(NewsArticle.duplicate_of_id.is_(None))
    if entity_key:
        query = query.where(any_(NewsArticle.entity_keys) == entity_key)
    if official_only:
        query = query.where(NewsArticle.is_official_announcement.is_(True))
    if start:
        query = query.where(NewsArticle.published_at >= start)
    if end:
        query = query.where(NewsArticle.published_at <= end)
    if q:
        like = f"%{q.strip()[:120]}%"
        query = query.where(or_(NewsArticle.title.ilike(like), NewsArticle.facts_summary.ilike(like),
                                func.similarity(NewsArticle.title, q) > 0.25))
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    rows = db.scalars(query.order_by(NewsArticle.published_at.desc().nulls_last()).limit(limit).offset(offset)).all()
    dup_counts = dict(db.execute(select(NewsArticle.duplicate_of_id, func.count()).where(
        NewsArticle.duplicate_of_id.in_([r.id for r in rows])).group_by(NewsArticle.duplicate_of_id)).all()) if rows else {}
    return {"total": total, "limit": limit, "offset": offset, "articles": [article_out(r, dup_counts.get(r.id, 0))
                                                                          for r in rows]}


def article_out(a: NewsArticle, duplicate_count: int = 0) -> dict[str, Any]:
    return {
        "id": str(a.id), "title": a.title, "url": a.url, "source_name": a.source_name,
        "published_at": a.published_at.isoformat() if a.published_at else None, "entity_keys": a.entity_keys,
        "is_official_announcement": a.is_official_announcement, "verified": a.verified,
        "reported_facts": {"text": a.facts_summary, "method": a.facts_summary_method,
                           "label": {"curated": "Curated summary of reported facts (verified at source)",
                                     "extractive": "Excerpt from the publisher's feed description",
                                     "llm": "Model-condensed restatement of the publisher description"}.get(
                                         a.facts_summary_method or "", None)},
        "ai_interpretation": {"text": a.ai_interpretation, "model": a.ai_model,
                              "generated_at": a.ai_generated_at.isoformat() if a.ai_generated_at else None,
                              "label": "AI-generated interpretation - not a reported fact; may be wrong"}
        if a.ai_interpretation else None,
        "duplicate_of": str(a.duplicate_of_id) if a.duplicate_of_id else None,
        "duplicate_count": duplicate_count,
    }


def refresh_source(db: Session, source: NewsSource) -> dict[str, Any]:
    import feedparser
    import httpx

    from app.connectors.base import validate_outbound_host

    settings = get_settings()
    created = duplicates = exists = 0
    try:
        validate_outbound_host(source.url)
        response = httpx.get(source.url, timeout=settings.news_http_timeout_seconds, follow_redirects=True,
                             headers={"User-Agent": "AUREX-News/1.0 (+feed reader)"})
        response.raise_for_status()
        feed = feedparser.parse(response.content)
        for entry in feed.entries[:100]:
            link = entry.get("link")
            title = entry.get("title")
            if not link or not title:
                continue
            published = None
            if entry.get("published_parsed"):
                published = datetime(*entry.published_parsed[:6], tzinfo=UTC)
            result = add_article(db, org_id=source.org_id, url=link, title=title, source_name=source.name,
                                 published_at=published, entity_keys=None, snippet=entry.get("summary"),
                                 is_official=source.source_type in ("official_ir", "exchange_announcements"),
                                 source_id=source.id)
            created += result["status"] == "created"
            duplicates += result["status"] == "duplicate"
            exists += result["status"] == "exists"
        source.last_status = f"ok: {created} new, {duplicates} near-duplicates, {exists} already stored"
    except Exception as exc:  # noqa: BLE001 - one broken feed must not stop the others
        source.last_status = f"error: {type(exc).__name__}"
        logger.warning("News source %s failed: %s", source.url, type(exc).__name__)
    source.last_fetched_at = datetime.now(UTC)
    return {"source": source.name, "created": created, "duplicates": duplicates, "status": source.last_status}


def refresh_all_sources(db: Session, org_id: uuid.UUID | None = None) -> dict[str, Any]:
    query = select(NewsSource).where(NewsSource.is_active.is_(True), NewsSource.source_type == "rss")
    if org_id is not None:
        query = query.where(or_(NewsSource.org_id.is_(None), NewsSource.org_id == org_id))
    results = [refresh_source(db, s) for s in db.scalars(query).all()]
    return {"sources": len(results), "results": results}
