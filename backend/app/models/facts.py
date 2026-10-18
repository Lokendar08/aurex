"""Normalized business data model (the AUREX common data model).

Conventions
- Monetary columns are NUMERIC(18,2) in the row's ``currency``; quantities NUMERIC(14,3).
- NULL means *unknown / not supplied by the source*. Zero means the source reported zero.
  Analytics propagate this distinction (e.g. gross profit is unavailable when cost is unknown).
- Every fact row carries provenance (integration, source id, sync job, content hash) and is unique
  per ``(integration_id, source_record_id)`` so re-imports are idempotent.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    PrimaryKeyConstraint,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, Timestamps, UUIDPk
from app.models.mixins import CompanyScoped, Provenance

Money = Numeric(18, 2)
Qty = Numeric(14, 3)


def _store_fk(nullable: bool = False, index: bool = False) -> Mapped:
    # Most fact tables carry a composite (store_id, date) index, so no single-column index by default.
    return mapped_column(
        UUID(as_uuid=True), ForeignKey("stores.id", ondelete="CASCADE"), nullable=nullable, index=index
    )


# ---------------------------------------------------------------------------------------------
# Dimensions
# ---------------------------------------------------------------------------------------------


class ProductCategory(UUIDPk, Timestamps, CompanyScoped, Base):
    __tablename__ = "product_categories"

    code: Mapped[str] = mapped_column(String(60), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("product_categories.id", ondelete="SET NULL")
    )

    __table_args__ = (UniqueConstraint("company_id", "code"),)


class Supplier(UUIDPk, Timestamps, CompanyScoped, Base):
    __tablename__ = "suppliers"

    code: Mapped[str] = mapped_column(String(60), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    country: Mapped[str | None] = mapped_column(String(2))
    payment_terms_days: Mapped[int | None] = mapped_column(Integer)
    contracted_lead_time_days: Mapped[int | None] = mapped_column(Integer)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true", nullable=False)

    __table_args__ = (UniqueConstraint("company_id", "code"),)


class Product(UUIDPk, Timestamps, CompanyScoped, Base):
    __tablename__ = "products"

    sku: Mapped[str] = mapped_column(String(80), nullable=False)
    name: Mapped[str] = mapped_column(String(250), nullable=False)
    category_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("product_categories.id", ondelete="SET NULL"), index=True
    )
    primary_supplier_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("suppliers.id", ondelete="SET NULL"), index=True
    )
    brand: Mapped[str | None] = mapped_column(String(120))
    unit_of_measure: Mapped[str] = mapped_column(String(20), default="unit", server_default="unit", nullable=False)
    list_price: Mapped[float | None] = mapped_column(Money)
    unit_cost: Mapped[float | None] = mapped_column(Money)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true", nullable=False)
    attributes: Mapped[dict] = mapped_column(JSONB, default=dict, server_default="{}", nullable=False)

    __table_args__ = (UniqueConstraint("company_id", "sku"),)


# ---------------------------------------------------------------------------------------------
# Sales
# ---------------------------------------------------------------------------------------------


class SalesRecord(CompanyScoped, Provenance, Base):
    """Sales at transaction-line or daily-summary grain. ``net = gross - discount - refund``."""

    __tablename__ = "sales_records"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    store_id: Mapped[uuid.UUID] = _store_fk()
    product_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("products.id", ondelete="CASCADE")
    )
    business_date: Mapped[date] = mapped_column(Date, nullable=False)
    grain: Mapped[str] = mapped_column(String(20), nullable=False, default="daily_summary")
    channel: Mapped[str] = mapped_column(String(20), nullable=False, default="in_store")
    transaction_ref: Mapped[str | None] = mapped_column(String(120))
    # NULL = the source did not report the value (distinct from a reported zero).
    quantity: Mapped[float | None] = mapped_column(Qty)
    gross_amount: Mapped[float] = mapped_column(Money, nullable=False)
    discount_amount: Mapped[float | None] = mapped_column(Money)
    refund_amount: Mapped[float | None] = mapped_column(Money)
    refund_quantity: Mapped[float | None] = mapped_column(Qty)
    net_amount: Mapped[float] = mapped_column(Money, nullable=False)
    cost_amount: Mapped[float | None] = mapped_column(Money)  # NULL = cost unknown (not zero)
    tax_amount: Mapped[float | None] = mapped_column(Money)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)

    __table_args__ = (
        UniqueConstraint("integration_id", "source_record_id"),
        CheckConstraint("grain IN ('transaction_line', 'daily_summary', 'store_daily_total')", name="grain_valid"),
        CheckConstraint("gross_amount >= 0 AND coalesce(discount_amount, 0) >= 0 AND coalesce(refund_amount, 0) >= 0",
                        name="amounts_nonneg"),
        CheckConstraint("abs(net_amount - (gross_amount - coalesce(discount_amount, 0) - coalesce(refund_amount, 0)))"
                        " < 0.05", name="net_identity"),
        CheckConstraint("coalesce(quantity, 0) >= 0 AND coalesce(refund_quantity, 0) >= 0", name="qty_nonneg"),
        Index("ix_sales_company_date", "company_id", "business_date"),
        Index("ix_sales_store_date", "store_id", "business_date"),
        Index("ix_sales_product_date", "product_id", "business_date"),
    )


class StoreTraffic(CompanyScoped, Provenance, Base):
    """Store-day counts that are not additive across products (transactions, footfall)."""

    __tablename__ = "store_traffic"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    store_id: Mapped[uuid.UUID] = _store_fk()
    business_date: Mapped[date] = mapped_column(Date, nullable=False)
    transaction_count: Mapped[int | None] = mapped_column(Integer)
    footfall: Mapped[int | None] = mapped_column(Integer)

    __table_args__ = (
        UniqueConstraint("integration_id", "source_record_id"),
        Index("ix_traffic_store_date", "store_id", "business_date"),
    )


# ---------------------------------------------------------------------------------------------
# Inventory & purchasing
# ---------------------------------------------------------------------------------------------


class InventorySnapshot(CompanyScoped, Provenance, Base):
    __tablename__ = "inventory_snapshots"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    store_id: Mapped[uuid.UUID] = _store_fk()
    product_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("products.id", ondelete="CASCADE"), nullable=False, index=True
    )
    snapshot_date: Mapped[date] = mapped_column(Date, nullable=False)
    on_hand_qty: Mapped[float] = mapped_column(Qty, nullable=False)
    on_order_qty: Mapped[float | None] = mapped_column(Qty)
    unit_cost: Mapped[float | None] = mapped_column(Money)
    inventory_value: Mapped[float | None] = mapped_column(Money)
    reorder_point: Mapped[float | None] = mapped_column(Qty)
    safety_stock: Mapped[float | None] = mapped_column(Qty)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)

    __table_args__ = (
        UniqueConstraint("integration_id", "source_record_id"),
        Index("ix_inv_snap_company_date", "company_id", "snapshot_date"),
        Index("ix_inv_snap_store_product_date", "store_id", "product_id", "snapshot_date"),
    )


MOVEMENT_TYPES = ("receipt", "sale", "customer_return", "adjustment", "transfer_in", "transfer_out", "shrinkage",
                  "write_off")


class InventoryMovement(CompanyScoped, Provenance, Base):
    __tablename__ = "inventory_movements"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    store_id: Mapped[uuid.UUID] = _store_fk()
    product_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("products.id", ondelete="CASCADE"), nullable=False, index=True
    )
    movement_date: Mapped[date] = mapped_column(Date, nullable=False)
    movement_type: Mapped[str] = mapped_column(String(30), nullable=False)
    quantity: Mapped[float] = mapped_column(Qty, nullable=False)  # signed: + into stock, - out of stock
    unit_cost: Mapped[float | None] = mapped_column(Money)
    value: Mapped[float | None] = mapped_column(Money)
    reference: Mapped[str | None] = mapped_column(String(120))
    currency: Mapped[str] = mapped_column(String(3), nullable=False)

    __table_args__ = (
        UniqueConstraint("integration_id", "source_record_id"),
        CheckConstraint("movement_type IN (" + ", ".join(f"'{m}'" for m in MOVEMENT_TYPES) + ")", name="type_valid"),
        Index("ix_inv_mov_company_date", "company_id", "movement_date"),
    )


class PurchaseOrder(UUIDPk, CompanyScoped, Provenance, Base):
    __tablename__ = "purchase_orders"

    store_id: Mapped[uuid.UUID | None] = _store_fk(nullable=True)
    supplier_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("suppliers.id", ondelete="CASCADE"), nullable=False, index=True
    )
    po_number: Mapped[str] = mapped_column(String(80), nullable=False)
    order_date: Mapped[date] = mapped_column(Date, nullable=False)
    expected_date: Mapped[date | None] = mapped_column(Date)
    received_date: Mapped[date | None] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="open")
    total_amount: Mapped[float | None] = mapped_column(Money)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)

    __table_args__ = (
        UniqueConstraint("integration_id", "source_record_id"),
        CheckConstraint("status IN ('open', 'partially_received', 'received', 'cancelled')", name="status_valid"),
        CheckConstraint("received_date IS NULL OR received_date >= order_date", name="dates_ordered"),
        Index("ix_po_company_order_date", "company_id", "order_date"),
    )


class PurchaseOrderLine(CompanyScoped, Provenance, Base):
    __tablename__ = "purchase_order_lines"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    purchase_order_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("purchase_orders.id", ondelete="CASCADE"), nullable=False, index=True
    )
    product_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("products.id", ondelete="CASCADE"), nullable=False, index=True
    )
    quantity_ordered: Mapped[float] = mapped_column(Qty, nullable=False)
    quantity_received: Mapped[float | None] = mapped_column(Qty)
    unit_cost: Mapped[float] = mapped_column(Money, nullable=False)
    line_amount: Mapped[float] = mapped_column(Money, nullable=False)

    __table_args__ = (UniqueConstraint("integration_id", "source_record_id"),)


# ---------------------------------------------------------------------------------------------
# Finance
# ---------------------------------------------------------------------------------------------

# P&L lines other than revenue and COGS. Sections: operating (all except the last three),
# depreciation (D&A, below EBITDA), finance_costs (below EBIT) and income_tax (below profit before tax).
EXPENSE_CATEGORIES = ("rent", "utilities", "payroll", "marketing", "maintenance", "logistics", "technology",
                      "insurance", "professional_fees", "store_supplies", "other", "depreciation", "finance_costs",
                      "income_tax")
OPERATING_EXPENSE_CATEGORIES = EXPENSE_CATEGORIES[:-3]


class Expense(CompanyScoped, Provenance, Base):
    """Operating expenses from accounting. COGS is NOT an expense row (it comes from sales cost)."""

    __tablename__ = "expenses"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    store_id: Mapped[uuid.UUID | None] = _store_fk(nullable=True)  # NULL = corporate / head office
    department_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("departments.id", ondelete="SET NULL")
    )
    expense_date: Mapped[date] = mapped_column(Date, nullable=False)
    category: Mapped[str] = mapped_column(String(40), nullable=False)
    subcategory: Mapped[str | None] = mapped_column(String(80))
    description: Mapped[str | None] = mapped_column(Text)
    vendor: Mapped[str | None] = mapped_column(String(200))
    amount: Mapped[float] = mapped_column(Money, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    gl_account: Mapped[str | None] = mapped_column(String(40))

    __table_args__ = (
        UniqueConstraint("integration_id", "source_record_id"),
        CheckConstraint("category IN (" + ", ".join(f"'{c}'" for c in EXPENSE_CATEGORIES) + ")", name="category_valid"),
        Index("ix_expenses_company_date", "company_id", "expense_date"),
        Index("ix_expenses_store_date", "store_id", "expense_date"),
    )


CASH_FLOW_CATEGORIES = ("customer_receipts", "supplier_payments", "payroll", "rent", "operating_expenses",
                        "marketing", "taxes", "capital_expenditure", "financing_inflow", "financing_outflow", "other")


class CashFlowEntry(CompanyScoped, Provenance, Base):
    __tablename__ = "cash_flow_entries"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    period_start: Mapped[date] = mapped_column(Date, nullable=False)
    category: Mapped[str] = mapped_column(String(40), nullable=False)
    activity: Mapped[str] = mapped_column(String(20), nullable=False)
    amount: Mapped[float] = mapped_column(Money, nullable=False)  # signed: + inflow, - outflow
    currency: Mapped[str] = mapped_column(String(3), nullable=False)

    __table_args__ = (
        UniqueConstraint("integration_id", "source_record_id"),
        CheckConstraint("activity IN ('operating', 'investing', 'financing')", name="activity_valid"),
        CheckConstraint("category IN (" + ", ".join(f"'{c}'" for c in CASH_FLOW_CATEGORIES) + ")", name="category_valid"),
        Index("ix_cash_flow_company_period", "company_id", "period_start"),
    )


class CashBalance(CompanyScoped, Provenance, Base):
    __tablename__ = "cash_balances"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    as_of_date: Mapped[date] = mapped_column(Date, nullable=False)
    balance: Mapped[float] = mapped_column(Money, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)

    __table_args__ = (UniqueConstraint("integration_id", "source_record_id"),)


class Budget(CompanyScoped, Provenance, Base):
    """Budget lines. ``metric`` is 'net_sales', 'cogs', 'gross_profit' or 'opex:<expense_category>'."""

    __tablename__ = "budgets"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    store_id: Mapped[uuid.UUID | None] = _store_fk(nullable=True)
    period_start: Mapped[date] = mapped_column(Date, nullable=False)
    metric: Mapped[str] = mapped_column(String(60), nullable=False)
    amount: Mapped[float] = mapped_column(Money, nullable=False)
    version_name: Mapped[str] = mapped_column(String(80), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)

    __table_args__ = (
        UniqueConstraint("integration_id", "source_record_id"),
        Index("ix_budgets_company_period", "company_id", "period_start"),
    )


# ---------------------------------------------------------------------------------------------
# Workforce, marketing, customers (aggregates only - no individual employee/customer PII)
# ---------------------------------------------------------------------------------------------


class WorkforceAggregate(CompanyScoped, Provenance, Base):
    __tablename__ = "workforce_aggregates"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    store_id: Mapped[uuid.UUID | None] = _store_fk(nullable=True)
    department_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("departments.id", ondelete="SET NULL")
    )
    period_start: Mapped[date] = mapped_column(Date, nullable=False)
    period_type: Mapped[str] = mapped_column(String(10), nullable=False, default="month")
    headcount: Mapped[int | None] = mapped_column(Integer)
    fte: Mapped[float | None] = mapped_column(Numeric(10, 2))
    hours_worked: Mapped[float | None] = mapped_column(Numeric(12, 2))
    overtime_hours: Mapped[float | None] = mapped_column(Numeric(12, 2))
    labor_cost: Mapped[float | None] = mapped_column(Money)
    hires: Mapped[int | None] = mapped_column(Integer)
    separations: Mapped[int | None] = mapped_column(Integer)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)

    __table_args__ = (
        UniqueConstraint("integration_id", "source_record_id"),
        CheckConstraint("period_type IN ('week', 'month')", name="period_type_valid"),
        Index("ix_workforce_company_period", "company_id", "period_start"),
    )


class MarketingSpend(CompanyScoped, Provenance, Base):
    __tablename__ = "marketing_spend"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    store_id: Mapped[uuid.UUID | None] = _store_fk(nullable=True)
    period_start: Mapped[date] = mapped_column(Date, nullable=False)
    period_type: Mapped[str] = mapped_column(String(10), nullable=False, default="week")
    channel: Mapped[str] = mapped_column(String(40), nullable=False)
    campaign: Mapped[str | None] = mapped_column(String(200))
    spend: Mapped[float] = mapped_column(Money, nullable=False)
    impressions: Mapped[int | None] = mapped_column(BigInteger)
    clicks: Mapped[int | None] = mapped_column(BigInteger)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)

    __table_args__ = (
        UniqueConstraint("integration_id", "source_record_id"),
        CheckConstraint("spend >= 0", name="spend_nonneg"),
        Index("ix_marketing_company_period", "company_id", "period_start"),
    )


class CustomerMetric(CompanyScoped, Provenance, Base):
    __tablename__ = "customer_metrics"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    store_id: Mapped[uuid.UUID | None] = _store_fk(nullable=True)
    period_start: Mapped[date] = mapped_column(Date, nullable=False)
    active_customers: Mapped[int | None] = mapped_column(Integer)
    new_customers: Mapped[int | None] = mapped_column(Integer)
    returning_customers: Mapped[int | None] = mapped_column(Integer)
    loyalty_members: Mapped[int | None] = mapped_column(Integer)

    __table_args__ = (
        UniqueConstraint("integration_id", "source_record_id"),
        Index("ix_customers_company_period", "company_id", "period_start"),
    )


# ---------------------------------------------------------------------------------------------
# Reference & derived
# ---------------------------------------------------------------------------------------------


class FxRate(Base):
    __tablename__ = "fx_rates"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    base_currency: Mapped[str] = mapped_column(String(3), nullable=False)
    quote_currency: Mapped[str] = mapped_column(String(3), nullable=False)
    rate_date: Mapped[date] = mapped_column(Date, nullable=False)
    rate: Mapped[float] = mapped_column(Numeric(18, 8), nullable=False)
    source: Mapped[str] = mapped_column(String(200), nullable=False)
    source_url: Mapped[str | None] = mapped_column(Text)
    notes: Mapped[str | None] = mapped_column(Text)

    __table_args__ = (UniqueConstraint("base_currency", "quote_currency", "rate_date", "source"),)


class AggStoreDaily(Base):
    """Derived store-day totals from *authoritative* sales and traffic rows (rebuilt by the pipeline)."""

    __tablename__ = "agg_store_daily"

    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    company_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    store_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("stores.id", ondelete="CASCADE"))
    business_date: Mapped[date] = mapped_column(Date, nullable=False)
    # The single integration counted for this store-day (system-of-record resolution, no double counting)
    sales_integration_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    traffic_integration_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    gross_amount: Mapped[float] = mapped_column(Money, nullable=False, default=0)
    discount_amount: Mapped[float | None] = mapped_column(Money)
    refund_amount: Mapped[float | None] = mapped_column(Money)
    net_amount: Mapped[float] = mapped_column(Money, nullable=False, default=0)
    cost_amount: Mapped[float | None] = mapped_column(Money)
    # Net sales of lines whose cost is known - margins are computed on this covered base only.
    cost_covered_net_amount: Mapped[float] = mapped_column(Money, nullable=False, default=0)
    quantity: Mapped[float | None] = mapped_column(Qty)
    line_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    transaction_count: Mapped[int | None] = mapped_column(Integer)
    overlapping_sources: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    refreshed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        PrimaryKeyConstraint("store_id", "business_date"),
        Index("ix_agg_store_daily_company_date", "company_id", "business_date"),
    )


class DataQualityNote(UUIDPk, CompanyScoped, Base):
    """Known data limitations recorded by the pipeline or users (shown next to affected metrics)."""

    __tablename__ = "data_quality_notes"

    scope: Mapped[str] = mapped_column(String(60), nullable=False)  # e.g. 'sales', 'cost', 'inventory'
    severity: Mapped[str] = mapped_column(String(10), nullable=False, default="info")
    message: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
