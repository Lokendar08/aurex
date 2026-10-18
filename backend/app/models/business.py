from __future__ import annotations

import uuid
from datetime import date

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, Timestamps, UUIDPk
from app.models.mixins import CompanyScoped, OrgScoped


class Company(UUIDPk, Timestamps, OrgScoped, Base):
    """A legal/operating business inside an organization (an organization may own several)."""

    __tablename__ = "companies"

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    legal_name: Mapped[str | None] = mapped_column(String(250))
    base_currency: Mapped[str] = mapped_column(String(3), nullable=False)
    fiscal_year_start_month: Mapped[int] = mapped_column(Integer, default=4, nullable=False)
    country: Mapped[str | None] = mapped_column(String(2))
    industry: Mapped[str | None] = mapped_column(String(120))
    description: Mapped[str | None] = mapped_column(Text)
    is_synthetic: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    settings: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)

    __table_args__ = (
        UniqueConstraint("org_id", "name"),
        CheckConstraint("fiscal_year_start_month BETWEEN 1 AND 12", name="fy_month_valid"),
    )


class Store(UUIDPk, Timestamps, CompanyScoped, Base):
    __tablename__ = "stores"

    code: Mapped[str] = mapped_column(String(40), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    city: Mapped[str | None] = mapped_column(String(120))
    region: Mapped[str | None] = mapped_column(String(120))
    format: Mapped[str | None] = mapped_column(String(60))
    opened_on: Mapped[date | None] = mapped_column(Date)
    closed_on: Mapped[date | None] = mapped_column(Date)
    selling_area_sqft: Mapped[float | None] = mapped_column(Numeric(12, 2))
    status: Mapped[str] = mapped_column(String(20), default="active", server_default="active", nullable=False)

    __table_args__ = (
        UniqueConstraint("company_id", "code"),
        CheckConstraint("status IN ('planned', 'active', 'closed')", name="status_valid"),
        CheckConstraint("selling_area_sqft IS NULL OR selling_area_sqft > 0", name="area_positive"),
    )


class Department(UUIDPk, Timestamps, CompanyScoped, Base):
    __tablename__ = "departments"

    store_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("stores.id", ondelete="CASCADE"))
    code: Mapped[str] = mapped_column(String(40), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    function: Mapped[str | None] = mapped_column(String(60))

    __table_args__ = (UniqueConstraint("company_id", "code"),)


class FinancialPeriod(UUIDPk, CompanyScoped, Base):
    """Fiscal calendar (monthly periods) used for reporting-period filters and period close status."""

    __tablename__ = "financial_periods"

    period_start: Mapped[date] = mapped_column(Date, nullable=False)
    period_end: Mapped[date] = mapped_column(Date, nullable=False)
    fiscal_year: Mapped[int] = mapped_column(Integer, nullable=False)
    fiscal_quarter: Mapped[int] = mapped_column(Integer, nullable=False)
    fiscal_month: Mapped[int] = mapped_column(Integer, nullable=False)
    label: Mapped[str] = mapped_column(String(40), nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="open", nullable=False)

    __table_args__ = (
        UniqueConstraint("company_id", "period_start"),
        CheckConstraint("period_end >= period_start", name="range_valid"),
        CheckConstraint("status IN ('open', 'closed')", name="status_valid"),
    )
