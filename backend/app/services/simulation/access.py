"""Access rules for Decision Lab data: who may see a saved scenario, which levers a member may run, and which
evidence items are hidden from members without finance access.

Store-scoped members (e.g. a store manager) may only see scenarios whose store selection lies entirely inside
their stores; company-wide scenarios (no store selection) are visible only to members without a store
restriction. Hidden scenarios answer 404 so their existence is not disclosed.

Members without ``finance:read`` see changes (deltas) but not absolute P&L levels, margins or cost structure.
A delta can still imply the level of the very cost the member changes (a 10% utilities cut implies the utilities
run-rate); that is inherent in showing changes and is why workforce scenarios require ``workforce:read``.
"""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING, Any

from sqlalchemy.orm import Session

from app.core.errors import NotFoundError, PermissionDeniedError
from app.core.permissions import Permission as P
from app.models import Scenario

if TYPE_CHECKING:
    from app.api.deps import OrgContext

# Evidence/assumption items that carry absolute company financials (cost structure, margins, spend, capex).
FINANCE_ITEMS = frozenset({
    "COGS affected in horizon (before change)", "Gross margin (trailing 12 months)",
    "Baseline monthly marketing spend", "Capex per sq ft from past openings", "Capex per store",
    "Rent per sq ft per month", "Pre-opening cost per store", "Trailing monthly run-rates", "Cost structure",
})
# Labour cost items are visible with workforce:read (HR) even without finance:read.
WORKFORCE_COST_ITEMS = frozenset({"Monthly loaded cost per employee (6-month average)", "Monthly cost per added employee"})
REDACTED = "requires finance access"


def scenario_visible(ctx: OrgContext, scenario: Scenario) -> bool:
    lever_types = {lv.get("type") for lv in scenario.levers or [] if isinstance(lv, dict)}
    if "workforce" in lever_types and not ctx.has(P.WORKFORCE_READ):
        return False  # its payroll delta reveals the cost per employee
    if ctx.store_scope is None:
        return True
    return bool(scenario.store_ids) and all(uuid.UUID(s) in ctx.store_scope for s in scenario.store_ids)


def get_visible_scenario(db: Session, ctx: OrgContext, scenario_id: uuid.UUID) -> Scenario:
    scenario = ctx.scoped_get(db, Scenario, scenario_id, "Scenario")
    if not scenario_visible(ctx, scenario):
        raise NotFoundError("Scenario not found")
    return scenario


def check_lever_permissions(ctx: OrgContext, levers: list[Any]) -> None:
    """Workforce levers reveal labour cost through their deltas, so they need workforce access."""
    if any(getattr(lv, "type", None) == "workforce" for lv in levers) and not ctx.has(P.WORKFORCE_READ):
        raise PermissionDeniedError("Workforce scenarios require workforce access", code="workforce_access_required")


def hidden_items(ctx: OrgContext) -> frozenset[str]:
    if ctx.has(P.FINANCE_READ):
        return frozenset()
    return FINANCE_ITEMS if ctx.has(P.WORKFORCE_READ) else FINANCE_ITEMS | WORKFORCE_COST_ITEMS


def redact_items(items: list[Any] | None, hidden: frozenset[str]) -> list[Any]:
    """Replace the values of hidden evidence/assumption dicts (``{"name": ..., "value": ...}``)."""
    out = []
    for item in items or []:
        if isinstance(item, dict) and item.get("name") in hidden:
            item = {k: v for k, v in item.items() if k in ("name", "source", "lever")} | {"value": REDACTED}
        out.append(item)
    return out


def redact_assumption_texts(items: list[str] | None, hidden: frozenset[str]) -> list[str]:
    """Same rule for assumptions stored as text (``"name: value (source)"``, e.g. on recommendations)."""
    out = []
    for text in items or []:
        name = str(text).split(":", 1)[0].strip()
        out.append(f"{name}: {REDACTED}" if name in hidden else text)
    return out
