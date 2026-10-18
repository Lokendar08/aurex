"""Shared analytics plumbing: scope (company + permitted stores), data bounds and source selection.

Store scope: members with a store scope only ever see rows for their stores. Company-level rows
(head-office expenses, company cash flow, company marketing) are excluded for them and reported as
"not available at store scope" rather than silently mixed in.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import date
from typing import Any

import pandas as pd
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.models import Company, Integration

FACT_TABLES = {
    "sales": "sales_records", "traffic": "store_traffic", "inventory": "inventory_snapshots",
    "inventory_movements": "inventory_movements", "purchasing": "purchase_orders", "expenses": "expenses",
    "cash": "cash_flow_entries", "cash_balances": "cash_balances", "budgets": "budgets",
    "workforce": "workforce_aggregates", "marketing": "marketing_spend", "customers": "customer_metrics",
}
DATE_COLUMNS = {
    "sales_records": "business_date", "store_traffic": "business_date", "inventory_snapshots": "snapshot_date",
    "inventory_movements": "movement_date", "purchase_orders": "order_date", "expenses": "expense_date",
    "cash_flow_entries": "period_start", "cash_balances": "as_of_date", "budgets": "period_start",
    "workforce_aggregates": "period_start", "marketing_spend": "period_start", "customer_metrics": "period_start",
}
AUTHORITY_KEYS = {"inventory_movements": "inventory", "cash_balances": "cash"}


@dataclass
class Scope:
    org_id: uuid.UUID
    company: Company
    store_ids: list[uuid.UUID] | None = None
    store_scoped: bool = False  # True when the *member* is restricted (not merely a UI filter)
    _sources: dict[str, Any] = field(default_factory=dict)

    @property
    def company_id(self) -> uuid.UUID:
        return self.company.id

    @property
    def currency(self) -> str:
        return self.company.base_currency

    def params(self, **extra: Any) -> dict[str, Any]:
        params: dict[str, Any] = {"org": self.org_id, "company": self.company_id, **extra}
        if self.store_ids is not None:
            params["stores"] = list(self.store_ids)
        return params

    def store_clause(self, column: str = "store_id") -> str:
        """SQL predicate restricting rows to the selected/permitted stores.

        With a store filter, company-level rows (``store_id IS NULL``, e.g. head-office costs) are excluded
        because they cannot be attributed to the selected stores.
        """
        if self.store_ids is None:
            return "TRUE"
        return f"{column} = ANY(:stores)"

    @property
    def company_level_visible(self) -> bool:
        """Company-level rows (store_id NULL) are visible only without any store restriction."""
        return self.store_ids is None


def read_frame(db: Session, sql: str, params: dict[str, Any]) -> pd.DataFrame:
    result = db.execute(text(sql), params)
    return pd.DataFrame(result.fetchall(), columns=list(result.keys()))


def chosen_source(db: Session, scope: Scope, fact: str) -> uuid.UUID | None:
    """System-of-record integration for a non-sales fact type within the company.

    Rule from ``entity_authorities`` if configured, otherwise the earliest-created integration that
    supplied rows. Using exactly one source per fact type prevents double counting when two systems
    (e.g. HRIS and payroll, or ERP and accounting) report the same facts.
    """
    if fact in scope._sources:
        return scope._sources[fact]
    table = FACT_TABLES[fact]
    authority_key = AUTHORITY_KEYS.get(fact, fact)
    rule = db.execute(text("""SELECT integration_id FROM entity_authorities
                              WHERE company_id = :c AND fact_type = :f AND store_id IS NULL"""),
                      {"c": scope.company_id, "f": authority_key}).scalar()
    if rule is None:
        rule = db.execute(text(f"""
            SELECT t.integration_id FROM (SELECT DISTINCT integration_id FROM {table} WHERE company_id = :c) t
            JOIN integrations i ON i.id = t.integration_id ORDER BY i.created_at LIMIT 1"""),  # noqa: S608
            {"c": scope.company_id}).scalar()
    scope._sources[fact] = rule
    return rule


def source_count(db: Session, scope: Scope, fact: str) -> int:
    """How many sources can report the same records: callers skip the system-of-record filter only when this is 1.

    For sales it is the largest number of integrations that reported any single store-day
    (``agg_store_daily.overlapping_sources``). Counting the *chosen* integrations instead would return 1 while a
    second feed overlaps the system of record, and its rows would then be double counted.
    """
    key = f"count:{fact}"
    if key not in scope._sources:
        if fact == "sales":  # cheap: the derived table records every store-day's number of reporting sources
            sql = "SELECT coalesce(max(overlapping_sources), 0) FROM agg_store_daily WHERE company_id = :c"
        else:
            sql = f"SELECT count(DISTINCT integration_id) FROM {FACT_TABLES[fact]} WHERE company_id = :c"  # noqa: S608
        scope._sources[key] = int(db.execute(text(sql), {"c": scope.company_id}).scalar() or 0)  # type: ignore[assignment]
    return int(scope._sources[key])  # type: ignore[arg-type]


def sales_authority_join(db: Session, scope: Scope, alias: str = "s") -> str:
    """JOIN clause keeping only system-of-record sales rows per store-day.

    Empty when no store-day is reported by more than one integration (every row is then authoritative), so
    single-source installations do not pay for the join.
    """
    if source_count(db, scope, "sales") <= 1:
        return ""
    return (f" JOIN agg_store_daily sor ON sor.store_id = {alias}.store_id AND sor.business_date = {alias}.business_date"
            f" AND sor.sales_integration_id = {alias}.integration_id")


def data_bounds(db: Session, company_id: uuid.UUID) -> tuple[date | None, date | None]:
    row = db.execute(text("SELECT min(business_date), max(business_date) FROM agg_store_daily WHERE company_id = :c"),
                     {"c": company_id}).one()
    return row[0], row[1]


def freshness(db: Session, scope: Scope) -> list[dict[str, Any]]:
    """Latest data date and last successful sync per fact type, with the integration that supplied it."""
    out = []
    integrations = {i.id: i for i in db.query(Integration).filter(Integration.org_id == scope.org_id).all()}
    for fact, table in FACT_TABLES.items():
        date_col = DATE_COLUMNS[table]
        rows = db.execute(text(f"""
            SELECT integration_id, max({date_col}) AS latest, count(*) AS n, max(ingested_at) AS ingested
            FROM {table} WHERE company_id = :c GROUP BY integration_id"""), {"c": scope.company_id}).all()  # noqa: S608
        if not rows:
            out.append({"fact": fact, "status": "no_data", "latest_date": None, "sources": []})
            continue
        sources = []
        for r in rows:
            integ = integrations.get(r[0])
            sources.append({
                "integration_id": str(r[0]), "name": integ.display_name if integ else "unknown",
                "provider_key": integ.provider_key if integ else None, "is_demo": bool(integ and integ.is_demo),
                "latest_date": r[1].isoformat() if r[1] else None, "records": int(r[2]),
                "last_ingested_at": r[3].isoformat() if r[3] else None,
                "last_successful_sync_at": integ.last_successful_sync_at.isoformat()
                if integ and integ.last_successful_sync_at else None,
            })
        latest = max((r[1] for r in rows if r[1]), default=None)
        out.append({"fact": fact, "status": "ok", "latest_date": latest.isoformat() if latest else None,
                    "sources": sources, "multiple_sources": len(sources) > 1})
    return out
