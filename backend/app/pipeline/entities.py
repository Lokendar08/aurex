"""Canonical entity specifications for the common data model.

Connectors map source fields onto these canonical fields; the pipeline then validates, resolves
dimension references (store_code -> store_id, sku -> product_id ...), hashes and loads them.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from app.models import (
    Budget,
    CashBalance,
    CashFlowEntry,
    CustomerMetric,
    Department,
    Expense,
    InventoryMovement,
    InventorySnapshot,
    MarketingSpend,
    Product,
    ProductCategory,
    PurchaseOrder,
    PurchaseOrderLine,
    SalesRecord,
    Store,
    StoreTraffic,
    Supplier,
    WorkforceAggregate,
)
from app.models.facts import CASH_FLOW_CATEGORIES, EXPENSE_CATEGORIES, MOVEMENT_TYPES

Kind = Literal["str", "date", "decimal", "int", "bool", "datetime"]


@dataclass(frozen=True)
class FieldSpec:
    name: str
    kind: Kind = "str"
    required: bool = False
    nonneg: bool = False
    max_len: int | None = None
    choices: tuple[str, ...] | None = None
    default: object = None
    description: str = ""


@dataclass(frozen=True)
class EntitySpec:
    key: str
    label: str
    kind: Literal["dimension", "fact"]
    model: type
    fields: tuple[FieldSpec, ...]
    # canonical reference field -> (dimension entity, target column on the model)
    refs: dict[str, tuple[str, str]] = field(default_factory=dict)
    required_refs: tuple[str, ...] = ()
    date_field: str | None = None
    natural_key: str | None = None  # dimensions: canonical field that identifies the row within a company
    has_currency: bool = False
    aggregates: tuple[str, ...] = ()  # derived tables refreshed after load

    def field_names(self) -> list[str]:
        return [f.name for f in self.fields]

    def get(self, name: str) -> FieldSpec | None:
        return next((f for f in self.fields if f.name == name), None)


F = FieldSpec
SRC = F("source_record_id", "str", max_len=255, description="Identifier of the record in the source system")
CUR = F("currency", "str", max_len=3, description="ISO 4217 code; defaults to the company base currency")

ENTITIES: dict[str, EntitySpec] = {}


def _register(spec: EntitySpec) -> EntitySpec:
    ENTITIES[spec.key] = spec
    return spec


# --- Dimensions --------------------------------------------------------------------------------
_register(EntitySpec("store", "Stores", "dimension", Store, (
    SRC, F("code", required=True, max_len=40), F("name", required=True, max_len=200), F("city", max_len=120),
    F("region", max_len=120), F("format", max_len=60), F("opened_on", "date"), F("closed_on", "date"),
    F("selling_area_sqft", "decimal", nonneg=True), F("status", choices=("planned", "active", "closed"), default="active"),
), natural_key="code"))

_register(EntitySpec("category", "Product categories", "dimension", ProductCategory, (
    SRC, F("code", required=True, max_len=60), F("name", required=True, max_len=200), F("parent_code", max_len=60),
), natural_key="code"))

_register(EntitySpec("supplier", "Suppliers", "dimension", Supplier, (
    SRC, F("code", required=True, max_len=60), F("name", required=True, max_len=200), F("country", max_len=2),
    F("payment_terms_days", "int", nonneg=True), F("contracted_lead_time_days", "int", nonneg=True),
), natural_key="code"))

_register(EntitySpec("product", "Products", "dimension", Product, (
    SRC, F("sku", required=True, max_len=80), F("name", required=True, max_len=250), F("category_code", max_len=60),
    F("supplier_code", max_len=60), F("brand", max_len=120), F("unit_of_measure", max_len=20, default="unit"),
    F("list_price", "decimal", nonneg=True), F("unit_cost", "decimal", nonneg=True), F("is_active", "bool", default=True),
    CUR,
), refs={"category_code": ("category", "category_id"), "supplier_code": ("supplier", "primary_supplier_id")},
    natural_key="sku", has_currency=True))

_register(EntitySpec("department", "Departments", "dimension", Department, (
    SRC, F("code", required=True, max_len=40), F("name", required=True, max_len=200), F("store_code", max_len=40),
    F("function", max_len=60),
), refs={"store_code": ("store", "store_id")}, natural_key="code"))

# --- Facts -------------------------------------------------------------------------------------
_register(EntitySpec("sales", "Sales (lines or daily summaries)", "fact", SalesRecord, (
    SRC, F("store_code", required=True, max_len=40), F("sku", max_len=80), F("business_date", "date", required=True),
    F("grain", choices=("transaction_line", "daily_summary", "store_daily_total"), default="daily_summary"),
    F("channel", max_len=20, default="in_store"), F("transaction_ref", max_len=120),
    F("quantity", "decimal", nonneg=True), F("gross_amount", "decimal", required=True, nonneg=True),
    F("discount_amount", "decimal", nonneg=True), F("refund_amount", "decimal", nonneg=True),
    F("refund_quantity", "decimal", nonneg=True), F("net_amount", "decimal"),
    F("cost_amount", "decimal", nonneg=True, description="COGS of the units sold; blank = unknown, not zero"),
    F("tax_amount", "decimal", nonneg=True), CUR,
), refs={"store_code": ("store", "store_id"), "sku": ("product", "product_id")}, required_refs=("store_code",),
    date_field="business_date", has_currency=True, aggregates=("agg_store_daily",)))

_register(EntitySpec("traffic", "Store traffic (transactions, footfall)", "fact", StoreTraffic, (
    SRC, F("store_code", required=True, max_len=40), F("business_date", "date", required=True),
    F("transaction_count", "int", nonneg=True), F("footfall", "int", nonneg=True),
), refs={"store_code": ("store", "store_id")}, required_refs=("store_code",), date_field="business_date",
    aggregates=("agg_store_daily",)))

_register(EntitySpec("inventory_snapshot", "Inventory snapshots", "fact", InventorySnapshot, (
    SRC, F("store_code", required=True, max_len=40), F("sku", required=True, max_len=80),
    F("snapshot_date", "date", required=True), F("on_hand_qty", "decimal", required=True),
    F("on_order_qty", "decimal", nonneg=True), F("unit_cost", "decimal", nonneg=True),
    F("inventory_value", "decimal"), F("reorder_point", "decimal", nonneg=True), F("safety_stock", "decimal", nonneg=True),
    CUR,
), refs={"store_code": ("store", "store_id"), "sku": ("product", "product_id")},
    required_refs=("store_code", "sku"), date_field="snapshot_date", has_currency=True))

_register(EntitySpec("inventory_movement", "Stock movements", "fact", InventoryMovement, (
    SRC, F("store_code", required=True, max_len=40), F("sku", required=True, max_len=80),
    F("movement_date", "date", required=True), F("movement_type", required=True, choices=MOVEMENT_TYPES),
    F("quantity", "decimal", required=True), F("unit_cost", "decimal", nonneg=True), F("value", "decimal"),
    F("reference", max_len=120), CUR,
), refs={"store_code": ("store", "store_id"), "sku": ("product", "product_id")},
    required_refs=("store_code", "sku"), date_field="movement_date", has_currency=True))

_register(EntitySpec("purchase_order", "Purchase orders", "fact", PurchaseOrder, (
    SRC, F("po_number", required=True, max_len=80), F("store_code", max_len=40), F("supplier_code", required=True, max_len=60),
    F("order_date", "date", required=True), F("expected_date", "date"), F("received_date", "date"),
    F("status", choices=("open", "partially_received", "received", "cancelled"), default="open"),
    F("total_amount", "decimal", nonneg=True), CUR,
), refs={"store_code": ("store", "store_id"), "supplier_code": ("supplier", "supplier_id")},
    required_refs=("supplier_code",), date_field="order_date", has_currency=True))

_register(EntitySpec("purchase_order_line", "Purchase order lines", "fact", PurchaseOrderLine, (
    SRC, F("po_number", required=True, max_len=80), F("sku", required=True, max_len=80),
    F("quantity_ordered", "decimal", required=True, nonneg=True), F("quantity_received", "decimal", nonneg=True),
    F("unit_cost", "decimal", required=True, nonneg=True), F("line_amount", "decimal", nonneg=True),
), refs={"po_number": ("purchase_order", "purchase_order_id"), "sku": ("product", "product_id")},
    required_refs=("po_number", "sku")))

_register(EntitySpec("expense", "Operating expenses", "fact", Expense, (
    SRC, F("store_code", max_len=40), F("department_code", max_len=40), F("expense_date", "date", required=True),
    F("category", required=True, choices=EXPENSE_CATEGORIES), F("subcategory", max_len=80), F("description"),
    F("vendor", max_len=200), F("amount", "decimal", required=True), CUR, F("gl_account", max_len=40),
), refs={"store_code": ("store", "store_id"), "department_code": ("department", "department_id")},
    date_field="expense_date", has_currency=True))

_register(EntitySpec("cash_flow", "Cash flow entries", "fact", CashFlowEntry, (
    SRC, F("period_start", "date", required=True), F("category", required=True, choices=CASH_FLOW_CATEGORIES),
    F("activity", required=True, choices=("operating", "investing", "financing")), F("amount", "decimal", required=True),
    CUR,
), date_field="period_start", has_currency=True))

_register(EntitySpec("cash_balance", "Cash balances", "fact", CashBalance, (
    SRC, F("as_of_date", "date", required=True), F("balance", "decimal", required=True), CUR,
), date_field="as_of_date", has_currency=True))

_register(EntitySpec("budget", "Budgets", "fact", Budget, (
    SRC, F("store_code", max_len=40), F("period_start", "date", required=True), F("metric", required=True, max_len=60),
    F("amount", "decimal", required=True), F("version_name", required=True, max_len=80), CUR,
), refs={"store_code": ("store", "store_id")}, date_field="period_start", has_currency=True))

_register(EntitySpec("workforce", "Workforce aggregates", "fact", WorkforceAggregate, (
    SRC, F("store_code", max_len=40), F("department_code", max_len=40), F("period_start", "date", required=True),
    F("period_type", choices=("week", "month"), default="month"), F("headcount", "int", nonneg=True),
    F("fte", "decimal", nonneg=True), F("hours_worked", "decimal", nonneg=True), F("overtime_hours", "decimal", nonneg=True),
    F("labor_cost", "decimal", nonneg=True), F("hires", "int", nonneg=True), F("separations", "int", nonneg=True), CUR,
), refs={"store_code": ("store", "store_id"), "department_code": ("department", "department_id")},
    date_field="period_start", has_currency=True))

_register(EntitySpec("marketing_spend", "Marketing spend", "fact", MarketingSpend, (
    SRC, F("store_code", max_len=40), F("period_start", "date", required=True),
    F("period_type", choices=("week", "month"), default="week"), F("channel", required=True, max_len=40),
    F("campaign", max_len=200), F("spend", "decimal", required=True, nonneg=True), F("impressions", "int", nonneg=True),
    F("clicks", "int", nonneg=True), CUR,
), refs={"store_code": ("store", "store_id")}, date_field="period_start", has_currency=True))

_register(EntitySpec("customer_metric", "Customer aggregates", "fact", CustomerMetric, (
    SRC, F("store_code", max_len=40), F("period_start", "date", required=True),
    F("active_customers", "int", nonneg=True), F("new_customers", "int", nonneg=True),
    F("returning_customers", "int", nonneg=True), F("loyalty_members", "int", nonneg=True),
), refs={"store_code": ("store", "store_id")}, date_field="period_start"))

DIMENSION_ORDER = ["store", "category", "supplier", "product", "department"]
FACT_ORDER = ["sales", "traffic", "inventory_snapshot", "inventory_movement", "purchase_order", "purchase_order_line",
              "expense", "cash_flow", "cash_balance", "budget", "workforce", "marketing_spend", "customer_metric"]
LOAD_ORDER = DIMENSION_ORDER + FACT_ORDER

# Fact types used for system-of-record (authority) resolution.
AUTHORITY_FACT_TYPES = {"sales": "sales", "traffic": "traffic", "inventory_snapshot": "inventory",
                        "inventory_movement": "inventory", "purchase_order": "purchasing",
                        "purchase_order_line": "purchasing", "expense": "expenses", "cash_flow": "cash",
                        "cash_balance": "cash", "budget": "budgets", "workforce": "workforce",
                        "marketing_spend": "marketing", "customer_metric": "customers"}


def ordered_entities(keys: list[str] | None) -> list[str]:
    wanted = set(keys) if keys else set(ENTITIES)
    return [k for k in LOAD_ORDER if k in wanted]


def entity_catalog() -> list[dict]:
    return [
        {"key": s.key, "label": s.label, "kind": s.kind, "date_field": s.date_field,
         "fields": [{"name": f.name, "type": f.kind, "required": f.required, "choices": list(f.choices) if f.choices else None,
                     "description": f.description} for f in s.fields]}
        for s in (ENTITIES[k] for k in LOAD_ORDER)
    ]
