"""Public company intelligence, market observations and news.

These tables hold *public* reference data (verified filings, exchange data, news metadata). Rows with
``org_id IS NULL`` are platform-wide reference data curated from cited sources; organizations may add
their own tracked companies/news (``org_id`` set) which only they can see.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, Timestamps, UUIDPk


class MarketEntity(UUIDPk, Timestamps, Base):
    __tablename__ = "market_entities"

    org_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), index=True
    )
    key: Mapped[str] = mapped_column(String(80), nullable=False)
    display_name: Mapped[str] = mapped_column(String(200), nullable=False)
    legal_name: Mapped[str | None] = mapped_column(String(250))
    aliases: Mapped[list[str]] = mapped_column(ARRAY(String(120)), default=list, nullable=False)
    country: Mapped[str | None] = mapped_column(String(2))
    sector: Mapped[str | None] = mapped_column(String(200))
    website: Mapped[str | None] = mapped_column(String(300))
    description: Mapped[str | None] = mapped_column(Text)
    is_listed: Mapped[bool | None] = mapped_column(Boolean)
    fiscal_year_end_month: Mapped[int | None] = mapped_column(Integer)
    reporting_currency: Mapped[str | None] = mapped_column(String(3))
    reporting_basis: Mapped[str | None] = mapped_column(Text)
    data_gaps: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    market_share_estimates: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    source_note: Mapped[str | None] = mapped_column(Text)

    __table_args__ = (UniqueConstraint("org_id", "key", postgresql_nulls_not_distinct=True),)


class ListedSecurity(UUIDPk, Base):
    __tablename__ = "listed_securities"

    entity_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("market_entities.id", ondelete="CASCADE"), nullable=False, index=True
    )
    exchange: Mapped[str] = mapped_column(String(80), nullable=False)
    ticker: Mapped[str] = mapped_column(String(40), nullable=False)
    isin: Mapped[str | None] = mapped_column(String(12))
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    listing_date: Mapped[date | None] = mapped_column(Date)
    verification_status: Mapped[str] = mapped_column(String(30), nullable=False)
    source_url: Mapped[str | None] = mapped_column(Text)

    __table_args__ = (UniqueConstraint("exchange", "ticker"),)


class FinancialObservation(Base):
    __tablename__ = "financial_observations"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    entity_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("market_entities.id", ondelete="CASCADE"), nullable=False
    )
    fiscal_year: Mapped[str] = mapped_column(String(40), nullable=False)
    period_end: Mapped[date] = mapped_column(Date, nullable=False)
    basis: Mapped[str] = mapped_column(String(40), nullable=False)
    metric: Mapped[str] = mapped_column(String(60), nullable=False)
    value: Mapped[float] = mapped_column(Float, nullable=False)  # as reported
    unit: Mapped[str] = mapped_column(String(30), nullable=False)
    value_base_units: Mapped[float | None] = mapped_column(Float)  # normalized (e.g. INR, MYR, count)
    currency: Mapped[str | None] = mapped_column(String(3))
    source_url: Mapped[str | None] = mapped_column(Text)
    source_name: Mapped[str | None] = mapped_column(String(300))
    source_type: Mapped[str | None] = mapped_column(String(40))
    verification_status: Mapped[str] = mapped_column(String(30), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text)
    retrieved_at: Mapped[date | None] = mapped_column(Date)

    __table_args__ = (
        UniqueConstraint("entity_id", "fiscal_year", "basis", "metric"),
        Index("ix_fin_obs_entity_metric", "entity_id", "metric", "period_end"),
    )


class MarketObservation(Base):
    """Share price / market cap observation for a listed security, always with source and as-of date."""

    __tablename__ = "market_observations"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    security_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("listed_securities.id", ondelete="CASCADE"), nullable=False
    )
    as_of: Mapped[date] = mapped_column(Date, nullable=False)
    close_price: Mapped[float | None] = mapped_column(Float)
    market_cap: Mapped[float | None] = mapped_column(Float)
    market_cap_unit: Mapped[str | None] = mapped_column(String(30))
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    source: Mapped[str] = mapped_column(String(200), nullable=False)
    source_url: Mapped[str | None] = mapped_column(Text)
    is_snapshot: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (UniqueConstraint("security_id", "as_of", "source"),)


class NewsSource(UUIDPk, Base):
    __tablename__ = "news_sources"

    org_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    source_type: Mapped[str] = mapped_column(String(40), nullable=False)  # rss | official_ir | exchange_announcements
    url: Mapped[str] = mapped_column(Text, nullable=False)
    entity_keys: Mapped[list[str]] = mapped_column(ARRAY(String(80)), default=list, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    verified_working: Mapped[bool | None] = mapped_column(Boolean)
    last_fetched_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_status: Mapped[str | None] = mapped_column(Text)
    notes: Mapped[str | None] = mapped_column(Text)

    __table_args__ = (UniqueConstraint("org_id", "url", postgresql_nulls_not_distinct=True),)


class NewsArticle(UUIDPk, Base):
    __tablename__ = "news_articles"

    org_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), index=True
    )
    source_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("news_sources.id", ondelete="SET NULL"))
    url: Mapped[str] = mapped_column(Text, nullable=False)
    canonical_url: Mapped[str] = mapped_column(Text, nullable=False)
    url_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    title_fingerprint: Mapped[str] = mapped_column(String(300), nullable=False)
    source_name: Mapped[str] = mapped_column(String(200), nullable=False)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    snippet: Mapped[str | None] = mapped_column(Text)  # publisher-provided feed description (short)
    facts_summary: Mapped[str | None] = mapped_column(Text)  # reported facts (curated / extractive)
    facts_summary_method: Mapped[str | None] = mapped_column(String(30))  # curated | extractive | llm
    ai_interpretation: Mapped[str | None] = mapped_column(Text)  # AI-generated strategic implications (labelled)
    ai_model: Mapped[str | None] = mapped_column(String(80))
    ai_generated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    entity_keys: Mapped[list[str]] = mapped_column(ARRAY(String(80)), default=list, nullable=False)
    is_official_announcement: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    duplicate_of_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("news_articles.id", ondelete="SET NULL")
    )
    verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    tags: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)

    __table_args__ = (
        UniqueConstraint("org_id", "url_hash", postgresql_nulls_not_distinct=True),
        Index("ix_news_entity_keys", "entity_keys", postgresql_using="gin"),
        # Fuzzy title search (requires the pg_trgm extension, created in migration 0001)
        Index("ix_news_articles_title_trgm", "title", postgresql_using="gin", postgresql_ops={"title": "gin_trgm_ops"}),
    )
