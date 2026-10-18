"""Scenario lever definitions (validated inputs for the Decision Lab)."""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, Field, model_validator


class _Lever(BaseModel):
    label: str | None = Field(default=None, max_length=120)
    note: str | None = Field(default=None, max_length=1000)


class WorkforceLever(_Lever):
    type: Literal["workforce"] = "workforce"
    headcount_change: int | None = Field(default=None, ge=-5000, le=5000)
    target_headcount: int | None = Field(default=None, ge=0, le=100000)
    start_month: int = Field(default=1, ge=1, le=60)
    monthly_cost_per_employee: float | None = Field(default=None, gt=0, lt=10_000_000)
    hiring_cost_per_hire: float = Field(default=0.0, ge=0, lt=10_000_000)
    severance_per_exit: float = Field(default=0.0, ge=0, lt=10_000_000)
    revenue_effect: Literal["none", "assumption", "historical"] = "none"
    assumed_revenue_uplift_pct: float | None = Field(default=None, ge=-0.5, le=1.0)
    ramp_months: int = Field(default=2, ge=0, le=12)

    @model_validator(mode="after")
    def _check(self) -> WorkforceLever:
        if self.headcount_change is None and self.target_headcount is None:
            raise ValueError("Provide headcount_change or target_headcount")
        if self.revenue_effect == "assumption" and (self.assumed_revenue_uplift_pct is None or not self.note):
            raise ValueError("An assumed revenue effect needs assumed_revenue_uplift_pct and a note documenting it")
        return self


class PriceLever(_Lever):
    type: Literal["price"] = "price"
    change_pct: float = Field(ge=-0.5, le=0.5)
    category_codes: list[str] | None = Field(default=None, max_length=50)
    elasticity_override: float | None = Field(default=None, ge=-6.0, le=0.0)
    start_month: int = Field(default=1, ge=1, le=60)


class MarketingLever(_Lever):
    type: Literal["marketing"] = "marketing"
    change_pct: float = Field(ge=-1.0, le=3.0)
    elasticity_override: float | None = Field(default=None, ge=0.0, le=1.0)
    start_month: int = Field(default=1, ge=1, le=60)


class SupplierCostLever(_Lever):
    type: Literal["supplier_cost"] = "supplier_cost"
    change_pct: float = Field(ge=-0.5, le=0.5)
    category_codes: list[str] | None = Field(default=None, max_length=50)
    one_time_cost: float = Field(default=0.0, ge=0)
    start_month: int = Field(default=1, ge=1, le=60)


class InventoryLever(_Lever):
    type: Literal["inventory"] = "inventory"
    safety_days_change: float = Field(default=0.0, ge=-15, le=30)
    cover_days_change: float = Field(default=0.0, ge=-30, le=60)
    category_codes: list[str] | None = Field(default=None, max_length=50)
    holding_cost_rate: float = Field(default=0.20, ge=0.0, le=1.0)


class NewStoreLever(_Lever):
    type: Literal["new_store"] = "new_store"
    count: int = Field(default=1, ge=1, le=50)
    open_month: int = Field(default=3, ge=1, le=60)
    selling_area_sqft: float | None = Field(default=None, gt=500, lt=500_000)
    capex_per_store: float | None = Field(default=None, ge=0)
    pre_opening_cost_per_store: float | None = Field(default=None, ge=0)
    headcount_per_store: int | None = Field(default=None, ge=1, le=2000)
    mature_sales_per_sqft_day: float | None = Field(default=None, gt=0)


class OpexLever(_Lever):
    type: Literal["opex"] = "opex"
    changes: dict[str, float] = Field(min_length=1)
    one_time_cost: float = Field(default=0.0, ge=0)
    start_month: int = Field(default=1, ge=1, le=60)

    @model_validator(mode="after")
    def _check(self) -> OpexLever:
        for key, value in self.changes.items():
            if not -1.0 <= value <= 1.0:
                raise ValueError(f"Change for {key} must be between -100% and +100%")
        return self


class RetentionLever(_Lever):
    type: Literal["retention"] = "retention"
    retention_change_pp: float = Field(ge=-0.3, le=0.3)
    monthly_program_cost: float = Field(default=0.0, ge=0)
    spend_per_customer: float | None = Field(default=None, gt=0)
    start_month: int = Field(default=1, ge=1, le=60)

    @model_validator(mode="after")
    def _check(self) -> RetentionLever:
        if not self.note:
            raise ValueError("Retention changes are assumptions: add a note explaining the programme behind them")
        return self


class ProductMixLever(_Lever):
    type: Literal["product_mix"] = "product_mix"
    from_category: str = Field(max_length=60)
    to_category: str = Field(max_length=60)
    shift_pct: float = Field(gt=0, le=0.5)
    start_month: int = Field(default=1, ge=1, le=60)


Lever = Annotated[WorkforceLever | PriceLever | MarketingLever | SupplierCostLever | InventoryLever | NewStoreLever
                  | OpexLever | RetentionLever | ProductMixLever, Field(discriminator="type")]

APPLY_ORDER = ["supplier_cost", "price", "product_mix", "marketing", "retention", "workforce", "new_store", "opex",
               "inventory"]

LEVER_CATALOG = [
    {"type": "workforce", "label": "Workforce", "description": "Increase or decrease headcount. Staffing cost is "
     "always applied; revenue changes only with capacity evidence or a documented assumption."},
    {"type": "price", "label": "Pricing", "description": "Change prices for all or selected categories; volume reacts "
     "through the estimated price elasticity."},
    {"type": "marketing", "label": "Marketing spend", "description": "Change marketing spend; revenue reacts only "
     "through a statistically identified response (or your explicit assumption)."},
    {"type": "supplier_cost", "label": "Supplier costs", "description": "Negotiate unit costs for categories; margins "
     "change deterministically."},
    {"type": "inventory", "label": "Inventory & reorder policy", "description": "Change safety stock or cover days; "
     "trades working capital and holding cost against lost sales."},
    {"type": "new_store", "label": "Open new stores", "description": "Capex, pre-opening costs, ramp-up from your own "
     "store openings, rent, staffing and payback."},
    {"type": "opex", "label": "Operating expenses", "description": "Reduce or increase specific expense categories."},
    {"type": "retention", "label": "Customer retention", "description": "Assumption-based: change monthly retention "
     "and the programme cost to achieve it."},
    {"type": "product_mix", "label": "Product mix", "description": "Shift sales between categories with different "
     "margins (total sales unchanged)."},
]
