"""NovaMart synthetic data generator.

NovaMart is a FICTIONAL retail company. Every number produced here is SYNTHETIC, generated from a
fixed random seed so the dataset is reproducible. It must never be presented as data from DMart,
MR D.I.Y., Wellness Forever or any real business.

One simulation produces every feed so that figures are internally consistent:
  demand (trend x seasonality x festivals x weekday x price x promotions x marketing x shocks)
    -> inventory replenishment with supplier lead times -> sales capped by stock (stockouts)
    -> refunds, COGS, transactions, staffing, expenses, P&L, cash flow, budgets.

Built-in operating stories (so analytics have something real to find, not hard-coded answers):
  * Store S04 (Andheri) loses ~16% of demand after a competitor opens on 2026-02-01.
  * Beverage supplier SUP-BEV's lead time triples in Apr-May 2026 -> beverage stockouts in peak season.
  * Electronics accessories are over-ordered (120 days cover vs 25-50 elsewhere) -> overstock / low turnover.
  * Staples supplier costs rise 6% on 2025-07-01, retail prices only follow on 2025-10-01 (margin squeeze).
  * Stores S07 (opened 2024-07-12) and S08 (opened 2025-11-01) ramp up; S08 cost data is missing for its
    first 61 days (POS migration) to exercise missing-vs-zero handling.
  * Marketing spend is cut in Jan 2025 and boosted in Jun 2025 (identifiable response).
"""

from __future__ import annotations

import calendar
from dataclasses import dataclass, field, replace
from datetime import date, timedelta
from functools import lru_cache

import numpy as np
import pandas as pd

SYNTHETIC_LABEL = "SYNTHETIC DEMO DATA - fictional company NovaMart"


# ---------------------------------------------------------------------------------------------
# Static specification
# ---------------------------------------------------------------------------------------------


@dataclass(frozen=True)
class StoreSpec:
    code: str
    name: str
    city: str
    region: str
    format: str
    opened_on: date
    sqft: float
    demand_factor: float
    basket: float  # average basket (INR)
    base_headcount: int
    rent_per_sqft: float


@dataclass(frozen=True)
class CategorySpec:
    code: str
    name: str
    gross_margin: float
    elasticity: float
    price_range: tuple[float, float]
    units_range: tuple[float, float]
    refund_rate: float
    supplier: str
    restock_returns: bool
    cover_days: float
    safety_days: float
    case_pack: int
    growth: float
    products: tuple[str, ...]


@dataclass(frozen=True)
class SupplierSpec:
    code: str
    name: str
    lead_days: int
    lead_sd: float
    delay_factor: float
    payment_terms: int


STORES: tuple[StoreSpec, ...] = (
    StoreSpec("S01", "NovaMart Pune Central", "Pune", "West", "Hypermarket", date(2018, 4, 14), 18000, 1.30, 640, 32, 28),
    StoreSpec("S02", "NovaMart Hinjewadi", "Pune", "West", "Supermarket", date(2019, 2, 1), 14000, 1.00, 610, 24, 26),
    StoreSpec("S03", "NovaMart Thane West", "Thane", "West", "Hypermarket", date(2019, 11, 8), 16500, 1.18, 660, 28, 34),
    StoreSpec("S04", "NovaMart Andheri East", "Mumbai", "West", "Supermarket", date(2020, 8, 20), 12000, 0.90, 720, 20, 46),
    StoreSpec("S05", "NovaMart Nashik Road", "Nashik", "North Maharashtra", "Supermarket", date(2021, 6, 5), 13000, 0.80, 560, 18, 20),
    StoreSpec("S06", "NovaMart Nagpur Sadar", "Nagpur", "Vidarbha", "Hypermarket", date(2022, 9, 15), 15000, 0.94, 590, 22, 22),
    StoreSpec("S07", "NovaMart Sambhajinagar", "Chhatrapati Sambhajinagar", "Marathwada", "Supermarket",
              date(2024, 7, 12), 13500, 0.86, 570, 20, 19),
    StoreSpec("S08", "NovaMart Kolhapur", "Kolhapur", "Western Maharashtra", "Supermarket", date(2025, 11, 1), 12500,
              0.82, 560, 19, 18),
)

SUPPLIERS: tuple[SupplierSpec, ...] = (
    SupplierSpec("SUP-AGRO", "Deccan Agro Commodities (fictional)", 4, 0.8, 1.0, 30),
    SupplierSpec("SUP-MILL", "Sahyadri Flour & Oil Mills (fictional)", 5, 1.0, 1.05, 30),
    SupplierSpec("SUP-FRESH", "GreenFields Farm Collective (fictional)", 1, 0.3, 1.0, 7),
    SupplierSpec("SUP-DAIRY", "Krishna Valley Dairy (fictional)", 1, 0.3, 1.0, 15),
    SupplierSpec("SUP-SNACK", "Konkan Foods Distribution (fictional)", 5, 1.2, 1.1, 30),
    SupplierSpec("SUP-BEV", "Coastal Beverages Distributors (fictional)", 4, 0.9, 1.0, 30),
    SupplierSpec("SUP-CARE", "Lotus Personal Care Traders (fictional)", 6, 1.3, 1.0, 45),
    SupplierSpec("SUP-HOME", "Shine Home Care Supplies (fictional)", 6, 1.2, 1.15, 45),
    SupplierSpec("SUP-KITCH", "Metro Kitchenware Imports (fictional)", 10, 2.5, 1.2, 45),
    SupplierSpec("SUP-TEX", "Varsha Textiles (fictional)", 9, 2.0, 1.1, 60),
    SupplierSpec("SUP-TECH", "Pixel Accessories Wholesale (fictional)", 8, 2.0, 1.0, 45),
)

CATEGORIES: tuple[CategorySpec, ...] = (
    CategorySpec("STAPLES", "Staples", 0.17, -0.45, (60, 650), (30, 85), 0.003, "SUP-AGRO", False, 25, 5, 12, 0.05, (
        "Basmati Rice 5kg", "Whole Wheat Atta 10kg", "Toor Dal 1kg", "Sunflower Oil 1L", "Sugar 1kg",
        "Iodised Salt 1kg", "Moong Dal 1kg", "Poha 1kg")),
    CategorySpec("PRODUCE", "Fresh Produce", 0.26, -0.8, (30, 200), (35, 90), 0.004, "SUP-FRESH", False, 3, 1, 1, 0.07, (
        "Onions (per kg)", "Potatoes (per kg)", "Tomatoes (per kg)", "Bananas (dozen)", "Apples (per kg)",
        "Seasonal Greens Bundle", "Lemons (pack of 6)", "Ginger-Garlic Pack")),
    CategorySpec("DAIRY", "Dairy & Eggs", 0.16, -0.5, (25, 600), (35, 100), 0.002, "SUP-DAIRY", False, 4, 1, 6, 0.06, (
        "Toned Milk 1L", "Curd 400g", "Paneer 200g", "Butter 100g", "Eggs (tray of 12)", "Cheese Slices 200g",
        "Ghee 500ml", "Flavoured Yogurt 90g")),
    CategorySpec("SNACKS", "Packaged Foods & Snacks", 0.27, -1.2, (20, 350), (18, 55), 0.004, "SUP-SNACK", False, 30, 6, 12,
                 0.08, ("Potato Chips 52g", "Instant Noodles (pack of 4)", "Glucose Biscuits 800g",
                        "Breakfast Cereal 475g", "Roasted Namkeen 400g", "Chocolate Bar 50g", "Peanut Butter 340g",
                        "Tomato Ketchup 1kg")),
    CategorySpec("BEVERAGES", "Beverages", 0.28, -1.4, (20, 450), (16, 50), 0.003, "SUP-BEV", False, 25, 5, 12, 0.09, (
        "Cola 2L", "Packaged Water 1L", "Mango Drink 1.2L", "Tea Powder 500g", "Instant Coffee 100g",
        "Orange Juice 1L", "Energy Drink 250ml", "Lemon Soda 750ml")),
    CategorySpec("PCARE", "Personal Care", 0.32, -1.1, (80, 400), (7, 20), 0.01, "SUP-CARE", True, 40, 7, 6, 0.08, (
        "Bath Soap (pack of 4)", "Shampoo 340ml", "Toothpaste 150g", "Hair Oil 300ml", "Face Wash 100ml",
        "Body Lotion 400ml", "Deodorant 150ml", "Hand Wash 750ml Refill")),
    CategorySpec("HOMECARE", "Home Care", 0.29, -1.0, (90, 550), (7, 17), 0.008, "SUP-HOME", True, 40, 7, 6, 0.07, (
        "Detergent Powder 4kg", "Dishwash Liquid 750ml", "Floor Cleaner 1L", "Toilet Cleaner 1L",
        "Glass Cleaner 500ml", "Garbage Bags (30)", "Mosquito Repellent Refill", "Fabric Softener 1L")),
    CategorySpec("KITCHEN", "Home & Kitchen", 0.36, -1.6, (150, 1500), (1.2, 5.5), 0.025, "SUP-KITCH", True, 50, 10, 2, 0.10, (
        "Steel Water Bottle 1L", "Non-stick Tawa", "Storage Container Set", "Bedsheet Double", "Bath Towel",
        "LED Bulb 9W", "Plastic Bucket 20L", "Pressure Cooker 3L")),
    CategorySpec("APPAREL", "Apparel Basics", 0.42, -1.8, (150, 900), (1.6, 5.5), 0.045, "SUP-TEX", True, 50, 10, 4, 0.11, (
        "Men's Cotton T-Shirt", "Women's Kurti", "Kids' Shorts", "Cotton Socks (3 pairs)", "Men's Track Pants",
        "Women's Leggings", "Innerwear Pack", "Festive Kurta")),
    CategorySpec("ELECTRONICS", "Electronics Accessories", 0.21, -2.0, (120, 1600), (0.6, 2.8), 0.03, "SUP-TECH", True,
                 120, 10, 2, 0.12, ("USB-C Cable 1m", "Wired Earphones", "Power Bank 10000mAh", "Phone Charger 20W",
                                  "Mini Bluetooth Speaker", "AAA Batteries (pack of 4)", "Extension Board 4-way",
                                  "Smartwatch Strap")),
)

DIWALI = (date(2023, 11, 12), date(2024, 11, 1), date(2025, 10, 21), date(2026, 11, 8))
GANESH = (date(2023, 9, 19), date(2024, 9, 7), date(2025, 8, 27), date(2026, 9, 14))
DIWALI_UPLIFT = {"STAPLES": 0.18, "PRODUCE": 0.08, "DAIRY": 0.22, "SNACKS": 0.4, "BEVERAGES": 0.15, "PCARE": 0.25,
                 "HOMECARE": 0.3, "KITCHEN": 0.75, "APPAREL": 0.95, "ELECTRONICS": 0.5}
WEEKDAY = np.array([0.93, 0.88, 0.9, 0.95, 1.05, 1.2, 1.24])  # Mon..Sun
DEPARTMENTS = (("FLOOR", "Sales Floor", "sales", 0.45, 118.0), ("FRONT", "Front End & Cashiers", "front_end", 0.30, 112.0),
               ("WH", "Receiving & Warehouse", "warehouse", 0.15, 115.0), ("MGMT", "Store Management", "management", 0.10, 260.0))
HQ_DEPARTMENTS = (("HQ-FIN", "Finance", 5, 72000.0), ("HQ-MERCH", "Merchandising & Buying", 6, 68000.0),
                  ("HQ-IT", "Technology", 4, 82000.0), ("HQ-HR", "People & HR", 3, 58000.0),
                  ("HQ-MKT", "Marketing", 3, 64000.0))
MARKETING_CHANNELS = (("digital_search", 0.28), ("social", 0.24), ("print", 0.2), ("radio", 0.13), ("in_store", 0.15))
EMPLOYER_ON_COST = 0.15  # provident fund, ESI, bonus accrual
OVERTIME_PREMIUM = 2.0
HOURS_PER_EMPLOYEE = 200.0


@dataclass(frozen=True)
class NovaMartConfig:
    seed: int = 20231001
    start: date = date(2023, 10, 1)
    end: date = date(2026, 10, 17)
    store_codes: tuple[str, ...] | None = None
    category_codes: tuple[str, ...] | None = None
    products_per_category: int = 8
    daily_snapshot_days: int = 120
    currency: str = "INR"
    fiscal_year_start_month: int = 4
    opening_cash: float = 85_000_000.0


@dataclass
class NovaMartData:
    config: NovaMartConfig
    frames: dict[str, pd.DataFrame] = field(default_factory=dict)
    facts: dict[str, object] = field(default_factory=dict)

    def entity(self, key: str) -> pd.DataFrame:
        return self.frames[key]


# ---------------------------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------------------------


def _month_end(d: date) -> date:
    return d.replace(day=calendar.monthrange(d.year, d.month)[1])


def _event_window(days: pd.DatetimeIndex, events: tuple[date, ...], before: int, after: int) -> np.ndarray:
    weight = np.zeros(len(days))
    ordinals = days.map(pd.Timestamp.toordinal).to_numpy()
    for event in events:
        delta = ordinals - event.toordinal()
        mask = (delta >= -before) & (delta <= after)
        # ramp up towards the event, fall off sharply after
        ramp = np.where(delta <= 0, 1 - (np.abs(delta) / (before + 1)) ** 1.5, 1 - delta / (after + 1))
        weight = np.maximum(weight, np.where(mask, np.clip(ramp, 0, 1), 0))
    return weight


def _fy(d: date, start_month: int) -> int:
    return d.year + 1 if (start_month > 1 and d.month >= start_month) else d.year


# ---------------------------------------------------------------------------------------------
# Generator
# ---------------------------------------------------------------------------------------------


def generate(config: NovaMartConfig | None = None) -> NovaMartData:  # noqa: C901 - one coherent simulation
    cfg = config or NovaMartConfig()
    rng = np.random.default_rng(cfg.seed)
    stores = [s for s in STORES if cfg.store_codes is None or s.code in cfg.store_codes]
    cats = [c for c in CATEGORIES if cfg.category_codes is None or c.code in cfg.category_codes]
    days = pd.date_range(cfg.start, cfg.end, freq="D")
    T, S = len(days), len(stores)
    day_dates = [d.date() for d in days]

    # --- products ------------------------------------------------------------------------
    products: list[dict] = []
    for ci, cat in enumerate(cats):
        names = cat.products[: cfg.products_per_category]
        lo, hi = cat.price_range
        ulo, uhi = cat.units_range
        for pi, name in enumerate(names):
            price = float(np.round(np.exp(rng.uniform(np.log(lo), np.log(hi))) / 5) * 5)
            margin = float(np.clip(cat.gross_margin + rng.normal(0, 0.025), 0.06, 0.6))
            units = float(rng.uniform(ulo, uhi) * (hi / price) ** 0.35)
            products.append({
                "sku": f"NM-{cat.code[:4]}-{pi + 1:03d}", "name": name, "category_index": ci, "category_code": cat.code,
                "base_price": price, "base_cost": round(price * (1 - margin), 2), "base_units": units,
                "elasticity": cat.elasticity * float(rng.uniform(0.85, 1.15)),
                "supplier_code": "SUP-MILL" if cat.code == "STAPLES" and pi % 2 == 1 else cat.supplier,
            })
    P = len(products)
    cat_idx = np.array([p["category_index"] for p in products])
    base_units = np.array([p["base_units"] for p in products])
    elasticity = np.array([p["elasticity"] for p in products])

    # --- calendar effects (T x C) ---------------------------------------------------------
    doy = days.dayofyear.to_numpy()
    dow = days.dayofweek.to_numpy()
    years = (days - pd.Timestamp(cfg.start)).days.to_numpy() / 365.25
    diwali_w = _event_window(days, DIWALI, 20, 2)
    ganesh_w = _event_window(days, GANESH, 7, 3)
    summer = np.exp(-0.5 * ((doy - 135) / 28.0) ** 2)  # mid-May peak
    monsoon = np.exp(-0.5 * ((doy - 205) / 22.0) ** 2)  # late July
    salary_week = (days.day.to_numpy() <= 7).astype(float)
    year_end = ((days.month.to_numpy() == 12) & (days.day.to_numpy() >= 24)).astype(float)
    C = len(cats)
    season = np.ones((T, C))
    for ci, cat in enumerate(cats):
        factor = 1 + DIWALI_UPLIFT[cat.code] * diwali_w + 0.12 * ganesh_w - 0.06 * monsoon
        if cat.code == "BEVERAGES":
            factor += 0.38 * summer
        if cat.code == "DAIRY":
            factor += 0.12 * summer
        if cat.code == "STAPLES":
            factor += 0.08 * salary_week
        if cat.code in ("SNACKS", "BEVERAGES"):
            factor += 0.1 * year_end
        if cat.code == "PRODUCE":
            factor += 0.18 * ganesh_w
        trend = (1 + cat.growth) ** years
        season[:, ci] = factor * trend
    weekday = WEEKDAY[dow]

    # --- prices, costs, promotions (T x P) ------------------------------------------------
    price = np.tile(np.array([p["base_price"] for p in products]), (T, 1))
    cost = np.tile(np.array([p["base_cost"] for p in products]), (T, 1))

    def bump(arr: np.ndarray, start: date, pct: float, cols: np.ndarray) -> None:
        idx = max(0, (start - cfg.start).days)
        if idx < T:
            arr[idx:, cols] *= 1 + pct

    for ci, cat in enumerate(cats):
        cols = np.flatnonzero(cat_idx == ci)
        for revision in (date(2024, 4, 1), date(2025, 4, 1), date(2026, 4, 1)):
            pct = float(rng.uniform(0.02, 0.05))
            bump(cost, revision - timedelta(days=int(rng.integers(10, 40))), pct, cols)
            bump(price, revision, pct + float(rng.uniform(-0.005, 0.01)), cols)
        if cat.code == "STAPLES":
            bump(cost, date(2025, 7, 1), 0.06, cols)   # supplier increase ...
            bump(price, date(2025, 10, 1), 0.03, cols)  # ... only partly passed on, later
    # product-specific price tests (identify elasticity)
    for pi in range(P):
        for _ in range(int(rng.integers(1, 3))):
            when = cfg.start + timedelta(days=int(rng.integers(60, max(61, T - 30))))
            bump(price, when, float(rng.choice([-0.08, -0.05, 0.05, 0.08])), np.array([pi]))
    price = np.round(price, 2)
    cost = np.round(cost, 2)

    week_index = ((days - pd.Timestamp(cfg.start)).days.to_numpy() + days[0].dayofweek) // 7
    n_weeks = int(week_index.max()) + 1
    festive_week = np.zeros(n_weeks)
    np.maximum.at(festive_week, week_index, diwali_w + ganesh_w)
    promo_prob = 0.07 + 0.1 * (festive_week > 0.3)
    promo_weeks = rng.random((n_weeks, P)) < promo_prob[:, None]
    promo_depth = np.where(promo_weeks, rng.uniform(0.08, 0.25, (n_weeks, P)), 0.0)
    discount_rate = promo_depth[week_index]  # T x P

    # --- marketing (weekly) ---------------------------------------------------------------
    week_starts = pd.date_range(days[0] - pd.Timedelta(days=int(days[0].dayofweek)), periods=n_weeks, freq="7D")
    open_weekly = np.array([sum(1 for s in stores if s.opened_on <= (ws + pd.Timedelta(days=6)).date())
                            for ws in week_starts])
    mk_total = 34_000.0 * np.maximum(open_weekly, 1) * (1 + 1.2 * np.clip(festive_week, 0, 1))
    mk_total *= rng.lognormal(0, 0.3, n_weeks)
    for wi, ws in enumerate(week_starts):
        if ws.year == 2025 and ws.month == 1:
            mk_total[wi] *= 0.4
        if ws.year == 2025 and ws.month == 6:
            mk_total[wi] *= 1.8
    adstock = np.zeros(n_weeks)
    for wi in range(n_weeks):
        adstock[wi] = mk_total[wi] + (0.55 * adstock[wi - 1] if wi else mk_total[wi] * 1.2)
    k_half = 34_000.0 * max(S, 1) * 2.2
    mk_lift_weekly = 0.075 * adstock / (adstock + k_half)
    mk_lift = mk_lift_weekly[week_index]  # T

    # --- stores: open mask, ramp, shocks (T x S) ------------------------------------------
    ordinals = np.array([d.toordinal() for d in day_dates])
    open_mask = np.zeros((T, S), dtype=bool)
    ramp = np.ones((T, S))
    shock = np.ones((T, S))
    for si, st in enumerate(stores):
        age_days = ordinals - st.opened_on.toordinal()
        open_mask[:, si] = age_days >= 0
        months_open = np.clip(age_days / 30.4, 0, None)
        ramp[:, si] = np.where(age_days >= 0, 1 - 0.45 * np.exp(-months_open / 4.5), 0)
        if st.code == "S04":
            shock[:, si] = np.where(ordinals >= date(2026, 2, 1).toordinal(), 0.84, 1.0)
        if st.code == "S01":
            refurb = (ordinals >= date(2025, 1, 6).toordinal()) & (ordinals <= date(2025, 1, 19).toordinal())
            after = ordinals > date(2025, 1, 19).toordinal()
            shock[:, si] = np.where(refurb, 0.7, np.where(after, 1.05, 1.0))
    common_noise = rng.lognormal(0, 0.06, (T, S))

    # --- demand (T x S x P) ---------------------------------------------------------------
    store_factor = np.array([s.demand_factor for s in stores])
    real_price_index = price / price[0][None, :] / (1.05 ** years)[:, None]  # demand reacts to real price
    price_effect = real_price_index ** elasticity[None, :]
    promo_effect = (1 - discount_rate) ** elasticity[None, :] * np.where(discount_rate > 0, 1.05, 1.0)
    base_tp = (base_units[None, :] * 0.85 * season[:, cat_idx] * weekday[:, None] * price_effect * promo_effect
               * (1 + mk_lift)[:, None])  # T x P
    lam = (base_tp[:, None, :] * (store_factor[None, :] * ramp * shock * common_noise)[:, :, None]
           * open_mask[:, :, None])  # T x S x P
    gamma = rng.gamma(6.0, 1 / 6.0, lam.shape)
    demand = rng.poisson(lam * gamma).astype(float)

    # --- inventory simulation -------------------------------------------------------------
    supplier_by_code = {s.code: s for s in SUPPLIERS}
    sup_codes = [p["supplier_code"] for p in products]
    sup_lead = np.array([supplier_by_code[c].lead_days for c in sup_codes], dtype=float)
    cover = np.array([cats[c].cover_days for c in cat_idx])
    safety = np.array([cats[c].safety_days for c in cat_idx])
    case = np.array([cats[c].case_pack for c in cat_idx])
    perishable = np.isin(np.array([cats[c].code for c in cat_idx]), ["PRODUCE", "DAIRY"])
    restock_returns = np.array([cats[c].restock_returns for c in cat_idx])
    refund_rate = np.array([cats[c].refund_rate for c in cat_idx])
    # planner's demand estimate: trailing 28-day mean of expected demand (no hindsight of noise)
    lam_cum = np.cumsum(lam, axis=0)
    planning = np.empty_like(lam)
    planning[:28] = lam_cum[:28] / np.arange(1, 29)[:, None, None]
    planning[28:] = (lam_cum[28:] - lam_cum[:-28]) / 28.0
    planning = np.maximum(planning, lam * 0.6)  # new stores: use current expectation while history builds
    max_lead = 40
    pipeline = np.zeros((max_lead + 1, S, P))
    on_hand = np.where(open_mask[0][:, None], planning[0] * (sup_lead + safety + cover)[None, :], 0.0)
    on_hand = np.ceil(on_hand)
    sales_units = np.zeros((T, S, P))
    on_hand_hist = np.zeros((T, S, P))
    on_order_hist = np.zeros((T, S, P))
    refund_units = np.zeros((T, S, P))
    receipts: list[tuple[int, int, int, float, int, int]] = []  # (order_t, s, p, qty, lead, receive_t)
    movements: list[tuple[int, int, int, str, float]] = []
    supplier_index = {c: i for i, c in enumerate(sorted(set(sup_codes)))}
    p_sup = np.array([supplier_index[c] for c in sup_codes])
    for t in range(T):
        slot = t % (max_lead + 1)
        arriving = pipeline[slot]
        if arriving.any():
            on_hand += arriving
            pipeline[slot] = 0
        # stores opening today receive an opening stock
        if t > 0:
            newly_open = open_mask[t] & ~open_mask[t - 1]
            if newly_open.any():
                on_hand[newly_open] = np.ceil(planning[t][newly_open] * (sup_lead + safety + cover)[None, :] * 1.1)
        sold = np.minimum(demand[t], on_hand)
        sales_units[t] = sold
        on_hand -= sold
        refunds = rng.binomial(sold.astype(int), refund_rate[None, :]).astype(float)
        refund_units[t] = refunds
        on_hand += refunds * restock_returns[None, :]
        # weekly spoilage of perishables
        if dow[t] == 6:
            spoil = np.floor(on_hand * 0.04 * perishable[None, :])
            on_hand -= spoil
            for s_i, p_i in zip(*np.nonzero(spoil), strict=True):
                movements.append((t, int(s_i), int(p_i), "write_off", -float(spoil[s_i, p_i])))
        # replenishment: one purchase order per (supplier, store) per day with a shared lead time
        on_order = pipeline.sum(axis=0)
        position = on_hand + on_order
        demand_rate = planning[t]
        reorder_point = demand_rate * (sup_lead + safety)[None, :]
        need = open_mask[t][:, None] & (position <= reorder_point) & (demand_rate > 0.05)
        if need.any():
            qty = np.ceil((reorder_point + demand_rate * cover[None, :] - position) / case[None, :]) * case[None, :]
            qty = np.where(need, np.maximum(qty, case[None, :]), 0)
            s_ids, p_ids = np.nonzero(qty)
            groups: dict[tuple[int, int], int] = {}
            for s_i, p_i in zip(s_ids, p_ids, strict=True):
                key = (int(s_i), int(p_sup[p_i]))
                if key not in groups:
                    sup = supplier_by_code[sup_codes[p_i]]
                    mean = sup.lead_days * sup.delay_factor
                    when = day_dates[t]
                    if sup.code == "SUP-BEV" and date(2026, 4, 1) <= when <= date(2026, 5, 31):
                        mean = sup.lead_days * 3.0
                    groups[key] = int(np.clip(np.round(rng.normal(mean, sup.lead_sd)), 1, max_lead))
                lead = groups[key]
                pipeline[(t + lead) % (max_lead + 1), s_i, p_i] += qty[s_i, p_i]
                receipts.append((t, int(s_i), int(p_i), float(qty[s_i, p_i]), lead, t + lead))
        on_hand_hist[t] = on_hand
        on_order_hist[t] = pipeline.sum(axis=0)

    # --- sales frame ----------------------------------------------------------------------
    t_i, s_i, p_i = np.nonzero((sales_units > 0) | (refund_units > 0))
    qty = sales_units[t_i, s_i, p_i]
    refq = refund_units[t_i, s_i, p_i]
    unit_price = price[t_i, p_i]
    disc_rate = discount_rate[t_i, p_i]
    gross = np.round(qty * unit_price, 2)
    discount = np.round(gross * disc_rate, 2)
    refund_amt = np.round(refq * unit_price * (1 - disc_rate), 2)
    net = np.round(gross - discount - refund_amt, 2)
    cogs = np.round((qty - refq) * cost[t_i, p_i], 2)
    store_codes = np.array([s.code for s in stores])
    skus = np.array([p["sku"] for p in products])
    date_str = np.array([d.strftime("%Y%m%d") for d in days])
    cogs_reported = cogs.copy()
    s08 = [i for i, s in enumerate(stores) if s.code == "S08"]
    if s08:  # POS migration: cost of goods not transmitted for S08's first 61 days (unknown, not zero)
        missing = (s_i == s08[0]) & (ordinals[t_i] < stores[s08[0]].opened_on.toordinal() + 61)
        cogs_reported[missing] = np.nan
    sales = pd.DataFrame({
        "source_record_id": pd.Series(store_codes[s_i]) + "-" + pd.Series(skus[p_i]) + "-" + pd.Series(date_str[t_i]),
        "store_code": store_codes[s_i], "sku": skus[p_i], "business_date": days[t_i],
        "grain": "daily_summary", "channel": "in_store", "quantity": qty, "gross_amount": gross,
        "discount_amount": discount, "refund_amount": refund_amt, "refund_quantity": refq, "net_amount": net,
        "cost_amount": cogs_reported, "currency": cfg.currency,
    })
    sales["source_record_id"] = "POS-" + sales["source_record_id"]

    # --- store-day totals, traffic ----------------------------------------------------------
    net_sd = np.zeros((T, S))
    np.add.at(net_sd, (t_i, s_i), net)
    cogs_sd = np.zeros((T, S))
    np.add.at(cogs_sd, (t_i, s_i), cogs)
    basket = np.array([s.basket for s in stores])[None, :] * (1 + 0.08 * (weekday[:, None] > 1.1)) * (
        1 + 0.12 * diwali_w[:, None]) * (1.04 ** years)[:, None] * rng.lognormal(0, 0.04, (T, S))
    transactions = np.where(open_mask & (net_sd > 0), np.round(net_sd / basket), 0).astype(int)
    footfall = np.round(transactions / rng.uniform(0.62, 0.74, (T, S))).astype(int)
    ts, ss = np.nonzero(open_mask & (transactions > 0))
    traffic = pd.DataFrame({
        "source_record_id": "POS-TRF-" + pd.Series(store_codes[ss]) + "-" + pd.Series(date_str[ts]),
        "store_code": store_codes[ss], "business_date": days[ts], "transaction_count": transactions[ts, ss],
        "footfall": footfall[ts, ss],
    })

    # --- monthly frame helpers ------------------------------------------------------------
    month_starts = pd.date_range(pd.Timestamp(cfg.start).replace(day=1), pd.Timestamp(cfg.end), freq="MS")
    month_of_day = (days.year.to_numpy() - month_starts[0].year) * 12 + days.month.to_numpy() - month_starts[0].month
    M = len(month_starts)
    days_in_month = np.array([calendar.monthrange(m.year, m.month)[1] for m in month_starts])
    observed_days = np.bincount(month_of_day, minlength=M)
    month_fraction = observed_days / days_in_month  # last month is partial
    net_ms = np.zeros((M, S))
    np.add.at(net_ms, month_of_day, net_sd)
    cogs_ms = np.zeros((M, S))
    np.add.at(cogs_ms, month_of_day, cogs_sd)
    txn_ms = np.zeros((M, S))
    np.add.at(txn_ms, month_of_day, transactions)
    open_days_ms = np.zeros((M, S))
    np.add.at(open_days_ms, month_of_day, open_mask.astype(float))
    open_frac_ms = open_days_ms / days_in_month[:, None]

    # --- workforce (monthly x store x department) -----------------------------------------
    wf_rows: list[dict] = []
    labor_cost_ms = np.zeros((M, S))
    headcount_ms = np.zeros((M, S))
    txn_ref = np.array([np.median(txn_ms[(open_frac_ms[:, si] > 0.99), si]) if (open_frac_ms[:, si] > 0.99).any()
                        else 1.0 for si in range(S)])
    wage_city = {"Mumbai": 1.18, "Thane": 1.1, "Pune": 1.05}
    prev_head: dict[tuple[int, str], int] = {}
    for mi, ms in enumerate(month_starts):
        festive = ms.month in (10, 11)
        for si, st in enumerate(stores):
            frac = open_frac_ms[mi, si]
            pre_opening = 0 < (st.opened_on - ms.date()).days <= 31
            if frac <= 0 and not pre_opening:
                continue
            activity = (txn_ms[mi, si] / max(month_fraction[mi], 1e-6)) / txn_ref[si] if frac > 0 else 0.6
            target = st.base_headcount * (0.75 + 0.25 * min(max(activity, 0.5), 1.6))
            if st.code == "S04":
                target = st.base_headcount  # S04 keeps a fixed 20-person roster (staffing not cut after demand fell)
            if festive and st.code != "S04":
                target += 3
            total = max(int(round(target)), 8)
            for code, _dname, _func, share, wage in DEPARTMENTS:
                head = max(1, int(round(total * share)))
                prev = prev_head.get((si, code), head)
                separations = int(rng.binomial(prev, 0.035))
                hires = max(0, head - prev + separations)
                prev_head[(si, code)] = head
                hours_regular = head * HOURS_PER_EMPLOYEE * (0.96 if frac > 0 else 0.5) * month_fraction[mi]
                overtime = hours_regular * (0.06 if festive else 0.015) * (activity if activity > 1.1 else 0.5)
                rate = wage * wage_city.get(st.city, 1.0) * (1.04 ** (ms.year - cfg.start.year))
                cost_m = (hours_regular * rate + overtime * rate * OVERTIME_PREMIUM) * (1 + EMPLOYER_ON_COST)
                labor_cost_ms[mi, si] += cost_m
                headcount_ms[mi, si] += head
                wf_rows.append({
                    "source_record_id": f"HR-{st.code}-{code}-{ms:%Y%m}", "store_code": st.code,
                    "department_code": f"{st.code}-{code}", "period_start": ms, "period_type": "month",
                    "headcount": head, "fte": round(head * 0.97, 2), "hours_worked": round(hours_regular + overtime, 1),
                    "overtime_hours": round(overtime, 1), "labor_cost": round(cost_m, 2), "hires": hires,
                    "separations": separations, "currency": cfg.currency,
                })
    hq_cost_m = np.zeros(M)
    for mi, ms in enumerate(month_starts):
        for code, _dname, head, salary in HQ_DEPARTMENTS:
            head_m = head + (1 if ms >= pd.Timestamp(2025, 6, 1) and code in ("HQ-IT", "HQ-MERCH") else 0)
            cost_m = head_m * salary * (1.06 ** (ms.year - cfg.start.year)) * (1 + EMPLOYER_ON_COST) * month_fraction[mi]
            hq_cost_m[mi] += cost_m
            wf_rows.append({
                "source_record_id": f"HR-HQ-{code}-{ms:%Y%m}", "store_code": None, "department_code": code,
                "period_start": ms, "period_type": "month", "headcount": head_m, "fte": float(head_m),
                "hours_worked": round(head_m * 176 * month_fraction[mi], 1), "overtime_hours": 0.0,
                "labor_cost": round(cost_m, 2), "hires": 0, "separations": 0, "currency": cfg.currency,
            })
    workforce = pd.DataFrame(wf_rows)

    # --- marketing frames -----------------------------------------------------------------
    mk_rows = []
    mk_month = np.zeros(M)
    for wi, ws in enumerate(week_starts):
        in_range = [ws.date() + timedelta(days=k) for k in range(7)
                    if cfg.start <= ws.date() + timedelta(days=k) <= cfg.end]
        if not in_range:
            continue
        for channel, share in MARKETING_CHANNELS:
            spend = round(float(mk_total[wi] * share * len(in_range) / 7 * rng.uniform(0.9, 1.1)), 2)
            for d in in_range:  # accrue to calendar months by day so the GL equals the spend feed
                mk_month[(d.year - month_starts[0].year) * 12 + d.month - month_starts[0].month] += spend / len(in_range)
            impressions = int(spend * rng.uniform(55, 80)) if channel in ("digital_search", "social") else None
            clicks = int(impressions * rng.uniform(0.008, 0.02)) if impressions else None
            mk_rows.append({"source_record_id": f"MKT-{ws:%Y%m%d}-{channel}", "store_code": None,
                            "period_start": ws, "period_type": "week", "channel": channel,
                            "campaign": "Festive campaign" if festive_week[wi] > 0.3 else "Always-on",
                            "spend": spend, "impressions": impressions, "clicks": clicks, "currency": cfg.currency})
    marketing = pd.DataFrame(mk_rows)

    # --- expenses -------------------------------------------------------------------------
    exp_rows: list[dict] = []

    def add_expense(sid: str, store: str | None, ms: pd.Timestamp, category: str, amount: float,
                    sub: str | None = None, vendor: str | None = None) -> None:
        if amount <= 0:
            return
        exp_rows.append({"source_record_id": f"GL-{sid}", "store_code": store, "department_code": None,
                         "expense_date": pd.Timestamp(min(_month_end(ms.date()), cfg.end)), "category": category,
                         "subcategory": sub, "description": None, "vendor": vendor, "amount": round(float(amount), 2),
                         "currency": cfg.currency, "gl_account": None})

    summer_util = 1 + 0.35 * np.exp(-0.5 * ((month_starts.month.to_numpy() - 5) / 1.3) ** 2)
    depreciation_ms = np.zeros(M)
    store_capex = {"S07": 38_000_000.0, "S08": 41_000_000.0}
    for mi, ms in enumerate(month_starts):
        mf = month_fraction[mi]
        for si, st in enumerate(stores):
            open_frac = open_frac_ms[mi, si]
            months_to_open = (st.opened_on.year - ms.year) * 12 + st.opened_on.month - ms.month
            if open_frac <= 0 and not (0 < months_to_open <= 2):
                continue
            tag = f"{st.code}-{ms:%Y%m}"
            fy_esc = 1.05 ** max(0, _fy(ms.date(), 4) - _fy(cfg.start, 4))
            rent = st.sqft * st.rent_per_sqft * fy_esc * mf
            add_expense(f"{tag}-RENT", st.code, ms, "rent", rent * 1.2, "store lease", "Landlord (fictional)")
            if open_frac <= 0:
                add_expense(f"{tag}-PREOPEN", st.code, ms, "other", 650_000 * mf, "pre_opening")
                add_expense(f"{tag}-PAY", st.code, ms, "payroll", labor_cost_ms[mi, si], "pre-opening payroll (from HRIS)")
                continue
            sales_m = net_ms[mi, si]
            add_expense(f"{tag}-UTIL", st.code, ms, "utilities",
                        st.sqft * 6.5 * summer_util[mi] * open_frac * rng.uniform(0.94, 1.06), "electricity & water")
            add_expense(f"{tag}-PAY", st.code, ms, "payroll", labor_cost_ms[mi, si], "store payroll (from HRIS)")
            add_expense(f"{tag}-MAINT", st.code, ms, "maintenance", rng.uniform(90_000, 150_000) * open_frac)
            add_expense(f"{tag}-SUPP", st.code, ms, "store_supplies", sales_m * 0.005)
            add_expense(f"{tag}-LOG", st.code, ms, "logistics", sales_m * 0.018, "distribution centre to store")
            add_expense(f"{tag}-TECH", st.code, ms, "technology", (32_000 + sales_m * 0.0015) * open_frac,
                        "POS & connectivity")
            add_expense(f"{tag}-INS", st.code, ms, "insurance", 18_000 * open_frac)
            fitout = store_capex.get(st.code, 30_000_000.0)
            dep = fitout / 120 * open_frac
            if st.code == "S01" and ms >= pd.Timestamp(2025, 2, 1):
                dep += 12_000_000 / 84 * open_frac
            depreciation_ms[mi] += dep
            add_expense(f"{tag}-DEP", st.code, ms, "depreciation", dep, "store fit-out")
        tag = f"HQ-{ms:%Y%m}"
        add_expense(f"{tag}-PAY", None, ms, "payroll", hq_cost_m[mi], "head office payroll (from HRIS)")
        add_expense(f"{tag}-TECH", None, ms, "technology", 380_000 * mf, "ERP, POS licences, cloud")
        add_expense(f"{tag}-RENT", None, ms, "rent", 320_000 * mf, "head office lease")
        add_expense(f"{tag}-PROF", None, ms, "professional_fees", rng.uniform(160_000, 240_000) * mf, "audit & legal")
        add_expense(f"{tag}-INS", None, ms, "insurance", 95_000 * mf)
        add_expense(f"{tag}-OTH", None, ms, "other", rng.uniform(110_000, 170_000) * mf, "admin & travel")
        add_expense(f"{tag}-MKT", None, ms, "marketing", mk_month[mi], "campaigns (from marketing platform)")

    # financing: term loan + new-store loan, interest monthly
    loan = np.zeros(M)
    balance = 80_000_000.0
    interest_ms = np.zeros(M)
    principal_ms = np.zeros(M)
    drawdown_ms = np.zeros(M)
    for mi, ms in enumerate(month_starts):
        if ms == pd.Timestamp(2025, 8, 1):
            balance += 35_000_000.0
            drawdown_ms[mi] = 35_000_000.0
        interest = balance * 0.096 / 12 * month_fraction[mi]
        interest_ms[mi] = interest
        repay = min(balance, 1_000_000.0 * month_fraction[mi])
        principal_ms[mi] = repay
        balance -= repay
        loan[mi] = balance
        add_expense(f"FIN-{ms:%Y%m}-INT", None, ms, "finance_costs", interest, "term loan interest", "Bank (fictional)")

    exp_df = pd.DataFrame(exp_rows)
    # income tax: quarterly 25.17% of positive profit before tax, booked in the quarter's last month
    exp_month_idx = ((exp_df["expense_date"].dt.year - month_starts[0].year) * 12
                     + exp_df["expense_date"].dt.month - month_starts[0].month).to_numpy()
    opex_month = np.bincount(exp_month_idx, weights=exp_df["amount"].to_numpy(), minlength=M)
    pbt_month = net_ms.sum(axis=1) - cogs_ms.sum(axis=1) - opex_month
    tax_ms = np.zeros(M)
    for mi, ms in enumerate(month_starts):
        if ms.month in (3, 6, 9, 12) or mi == M - 1:
            q_start = max(0, mi - 2) if ms.month in (3, 6, 9, 12) else mi - ((ms.month - 1) % 3)
            pbt_q = pbt_month[q_start: mi + 1].sum()
            tax = max(pbt_q, 0) * 0.2517
            tax_ms[mi] = tax
            if tax > 0:
                exp_rows.append({"source_record_id": f"GL-TAX-{ms:%Y%m}", "store_code": None, "department_code": None,
                                 "expense_date": pd.Timestamp(min(_month_end(ms.date()), cfg.end)),
                                 "category": "income_tax", "subcategory": "provision for income tax",
                                 "description": None, "vendor": None, "amount": round(float(tax), 2),
                                 "currency": cfg.currency, "gl_account": None})
    expenses = pd.DataFrame(exp_rows)

    # --- purchase orders, lines, movements ------------------------------------------------
    rec = pd.DataFrame(receipts, columns=["t", "s", "p", "qty", "lead", "rt"])
    rec["supplier"] = [sup_codes[p] for p in rec["p"]]
    rec["store_code"] = store_codes[rec["s"].to_numpy()]
    rec["sku"] = skus[rec["p"].to_numpy()]
    rec["order_date"] = days[rec["t"].to_numpy()]
    rec["unit_cost"] = cost[rec["t"].to_numpy(), rec["p"].to_numpy()]
    rec["po_number"] = ("PO-" + rec["store_code"] + "-" + rec["order_date"].dt.strftime("%Y%m%d") + "-"
                        + rec["supplier"].str.replace("SUP-", "", regex=False))
    rec["received"] = rec["rt"] < T
    rec["received_date"] = [days[int(x)] if x < T else pd.NaT for x in rec["rt"]]
    rec["line_amount"] = np.round(rec["qty"] * rec["unit_cost"], 2)
    contracted = {s.code: s.lead_days for s in SUPPLIERS}
    po = rec.groupby("po_number").agg(store_code=("store_code", "first"), supplier_code=("supplier", "first"),
                                      order_date=("order_date", "first"), received_date=("received_date", "first"),
                                      total_amount=("line_amount", "sum"), received=("received", "first")).reset_index()
    po["expected_date"] = po["order_date"] + pd.to_timedelta(po["supplier_code"].map(contracted), unit="D")
    po["status"] = np.where(po["received"], "received", "open")
    po["source_record_id"] = "ERP-" + po["po_number"]
    po["currency"] = cfg.currency
    po["total_amount"] = po["total_amount"].round(2)
    purchase_orders = po[["source_record_id", "po_number", "store_code", "supplier_code", "order_date", "expected_date",
                          "received_date", "status", "total_amount", "currency"]]
    lines = rec.assign(source_record_id="ERP-" + rec["po_number"] + "-" + rec["sku"],
                       quantity_ordered=rec["qty"],
                       quantity_received=np.where(rec["received"], rec["qty"], np.nan))
    lines = lines.groupby("source_record_id", as_index=False).agg(
        po_number=("po_number", "first"), sku=("sku", "first"), quantity_ordered=("quantity_ordered", "sum"),
        quantity_received=("quantity_received", "sum"), unit_cost=("unit_cost", "first"), line_amount=("line_amount", "sum"))
    purchase_order_lines = lines
    recv = rec[rec["received"]]
    mv_receipts = pd.DataFrame({
        "source_record_id": "WMS-RCV-" + recv["po_number"] + "-" + recv["sku"],
        "store_code": recv["store_code"], "sku": recv["sku"], "movement_date": recv["received_date"],
        "movement_type": "receipt", "quantity": recv["qty"], "unit_cost": recv["unit_cost"],
        "value": recv["line_amount"], "reference": recv["po_number"], "currency": cfg.currency,
    }).groupby("source_record_id", as_index=False).agg({
        "store_code": "first", "sku": "first", "movement_date": "first", "movement_type": "first",
        "quantity": "sum", "unit_cost": "first", "value": "sum", "reference": "first", "currency": "first"})
    mv_other = pd.DataFrame([
        {"source_record_id": f"WMS-{kind.upper()}-{store_codes[s]}-{skus[p]}-{date_str[t]}", "store_code": store_codes[s],
         "sku": skus[p], "movement_date": days[t], "movement_type": kind, "quantity": q,
         "unit_cost": cost[t, p], "value": round(q * cost[t, p], 2), "reference": None, "currency": cfg.currency}
        for t, s, p, kind, q in movements
    ])
    inventory_movements = pd.concat([mv_receipts, mv_other], ignore_index=True)

    # --- inventory snapshots: weekly (Sundays) history + daily for the recent window -------
    snap_days = np.flatnonzero((dow == 6) | (np.arange(T) >= T - cfg.daily_snapshot_days) | (np.arange(T) == T - 1))
    st_i, ss_i, sp_i = np.meshgrid(snap_days, np.arange(S), np.arange(P), indexing="ij")
    st_i, ss_i, sp_i = st_i.ravel(), ss_i.ravel(), sp_i.ravel()
    keep = open_mask[st_i, ss_i]
    st_i, ss_i, sp_i = st_i[keep], ss_i[keep], sp_i[keep]
    onh = on_hand_hist[st_i, ss_i, sp_i]
    rop = planning[st_i, ss_i, sp_i] * (sup_lead[sp_i] + safety[sp_i])
    inventory_snapshots = pd.DataFrame({
        "source_record_id": "WMS-SNAP-" + pd.Series(store_codes[ss_i]) + "-" + pd.Series(skus[sp_i]) + "-"
                            + pd.Series(date_str[st_i]),
        "store_code": store_codes[ss_i], "sku": skus[sp_i], "snapshot_date": days[st_i], "on_hand_qty": onh,
        "on_order_qty": on_order_hist[st_i, ss_i, sp_i], "unit_cost": cost[st_i, sp_i],
        "inventory_value": np.round(onh * cost[st_i, sp_i], 2), "reorder_point": np.round(rop, 1),
        "safety_stock": np.round(planning[st_i, ss_i, sp_i] * safety[sp_i], 1), "currency": cfg.currency,
    })

    # --- customers (monthly per store) ----------------------------------------------------
    cust_rows = []
    prev_active = np.zeros(S)
    loyalty = np.array([2500.0 for _ in stores])
    for mi, ms in enumerate(month_starts):
        for si, st in enumerate(stores):
            if open_frac_ms[mi, si] <= 0:
                continue
            visits = 2.1 + 0.3 * (ms.month in (10, 11))
            active = int(txn_ms[mi, si] / visits)
            retention = float(np.clip(rng.normal(0.62 if st.code != "S04" or ms < pd.Timestamp(2026, 2, 1) else 0.55,
                                                 0.02), 0.4, 0.8))
            returning = int(min(active, prev_active[si] * retention)) if prev_active[si] else int(active * 0.5)
            loyalty[si] += active * 0.035
            cust_rows.append({"source_record_id": f"CRM-{st.code}-{ms:%Y%m}", "store_code": st.code, "period_start": ms,
                              "active_customers": active, "new_customers": max(active - returning, 0),
                              "returning_customers": returning, "loyalty_members": int(loyalty[si])})
            prev_active[si] = active
    customer_metrics = pd.DataFrame(cust_rows)

    # --- cash flow & balances ------------------------------------------------------------
    purchases_m = np.zeros(M)
    if len(recv):
        rmonths = ((recv["received_date"].dt.year - month_starts[0].year) * 12 + recv["received_date"].dt.month
                   - month_starts[0].month).to_numpy()
        terms = recv["supplier"].map({s.code: s.payment_terms for s in SUPPLIERS}).to_numpy()
        pay_months = rmonths + np.where(terms >= 30, 1, 0) + np.where(terms >= 60, 1, 0)
        valid = pay_months < M
        np.add.at(purchases_m, pay_months[valid], recv["line_amount"].to_numpy()[valid])
    cat_by_month: dict[str, np.ndarray] = {}
    for cat_name in ("rent", "payroll", "marketing", "income_tax"):
        mask = expenses["category"] == cat_name
        idx = ((expenses.loc[mask, "expense_date"].dt.year - month_starts[0].year) * 12
               + expenses.loc[mask, "expense_date"].dt.month - month_starts[0].month).to_numpy()
        cat_by_month[cat_name] = np.bincount(idx, weights=expenses.loc[mask, "amount"].to_numpy(), minlength=M)
    other_mask = expenses["category"].isin(["utilities", "maintenance", "store_supplies", "logistics", "technology",
                                           "insurance", "professional_fees", "other"])
    oidx = ((expenses.loc[other_mask, "expense_date"].dt.year - month_starts[0].year) * 12
            + expenses.loc[other_mask, "expense_date"].dt.month - month_starts[0].month).to_numpy()
    other_opex = np.bincount(oidx, weights=expenses.loc[other_mask, "amount"].to_numpy(), minlength=M)
    capex_ms = np.zeros(M)
    for st in stores:
        if st.code in store_capex and st.opened_on >= cfg.start:
            for k in (3, 2, 1):
                when = (pd.Timestamp(st.opened_on) - pd.DateOffset(months=k)).replace(day=1)
                mi = (when.year - month_starts[0].year) * 12 + when.month - month_starts[0].month
                if 0 <= mi < M:
                    capex_ms[mi] += store_capex[st.code] / 3
    s01_refurb = (2024 - month_starts[0].year) * 12 + 12 - month_starts[0].month
    if any(s.code == "S01" for s in stores) and 0 <= s01_refurb < M:
        capex_ms[s01_refurb] += 12_000_000.0
    cf_rows = []
    cash = cfg.opening_cash
    bal_rows = []
    for mi, ms in enumerate(month_starts):
        flows = {
            ("customer_receipts", "operating"): net_ms[mi].sum(),
            ("supplier_payments", "operating"): -purchases_m[mi],
            ("payroll", "operating"): -cat_by_month["payroll"][mi],
            ("rent", "operating"): -cat_by_month["rent"][mi],
            ("operating_expenses", "operating"): -other_opex[mi],
            ("marketing", "operating"): -cat_by_month["marketing"][mi],
            ("taxes", "operating"): -cat_by_month["income_tax"][mi],
            ("capital_expenditure", "investing"): -capex_ms[mi],
            ("financing_inflow", "financing"): drawdown_ms[mi],
            ("financing_outflow", "financing"): -(interest_ms[mi] + principal_ms[mi]),
        }
        for (cat_name, activity), amount in flows.items():
            if abs(amount) < 0.005:
                continue
            cf_rows.append({"source_record_id": f"CF-{ms:%Y%m}-{cat_name}", "period_start": ms, "category": cat_name,
                            "activity": activity, "amount": round(float(amount), 2), "currency": cfg.currency})
            cash += round(float(amount), 2)
        as_of = min(_month_end(ms.date()), cfg.end)
        bal_rows.append({"source_record_id": f"BANK-{as_of:%Y%m%d}", "as_of_date": pd.Timestamp(as_of),
                         "balance": round(cash, 2), "currency": cfg.currency})
    cash_flows = pd.DataFrame(cf_rows)
    cash_balances = pd.DataFrame(bal_rows)

    # --- budgets: prior-year actual x planned growth --------------------------------------
    budget_rows = []
    fy_first = _fy(cfg.start, cfg.fiscal_year_start_month) + 1
    fy_last = _fy(cfg.end, cfg.fiscal_year_start_month)
    planned_growth = 0.09
    for fy in range(fy_first + 1, fy_last + 1):
        version = f"FY{fy} Annual Budget"
        fy_start = pd.Timestamp(fy - 1, cfg.fiscal_year_start_month, 1)
        for k in range(12):
            ms = fy_start + pd.DateOffset(months=k)
            prior = ms - pd.DateOffset(years=1)
            pmi = (prior.year - month_starts[0].year) * 12 + prior.month - month_starts[0].month
            if pmi < 0 or pmi >= M:
                continue
            prior_full = month_fraction[pmi] > 0.99
            for si, st in enumerate(stores):
                if (st.opened_on - ms.date()).days > 0:
                    continue
                if open_frac_ms[pmi, si] > 0.99 and prior_full:
                    sales_b = net_ms[pmi, si] * (1 + planned_growth)
                else:  # new store plan: 70% of the chain's average mature-store month
                    mature = [net_ms[pmi, j] for j in range(S) if open_frac_ms[pmi, j] > 0.99]
                    sales_b = 0.7 * (np.mean(mature) if mature else 0)
                if sales_b <= 0:
                    continue
                for metric, amount in (("net_sales", sales_b), ("cogs", sales_b * 0.775),
                                       ("gross_profit", sales_b * 0.225), ("opex:payroll", sales_b * 0.058),
                                       ("opex:rent", st.sqft * st.rent_per_sqft * 1.2 * 1.05 ** (fy - fy_first)),
                                       ("opex:utilities", st.sqft * 6.5 * summer_util[min(pmi, M - 1)])):
                    budget_rows.append({"source_record_id": f"BUD-{fy}-{st.code}-{ms:%Y%m}-{metric}",
                                        "store_code": st.code, "period_start": ms, "metric": metric,
                                        "amount": round(float(amount), 2), "version_name": version,
                                        "currency": cfg.currency})
            for metric, amount in (("opex:marketing", mk_month[pmi] * 1.05), ("opex:technology", 380_000.0 * 1.06),
                                   ("opex:professional_fees", 200_000.0)):
                budget_rows.append({"source_record_id": f"BUD-{fy}-HQ-{ms:%Y%m}-{metric}", "store_code": None,
                                    "period_start": ms, "metric": metric, "amount": round(float(amount), 2),
                                    "version_name": version, "currency": cfg.currency})
    budgets = pd.DataFrame(budget_rows)

    # --- dimensions -----------------------------------------------------------------------
    store_df = pd.DataFrame([{
        "source_record_id": f"ERP-STORE-{s.code}", "code": s.code, "name": s.name, "city": s.city, "region": s.region,
        "format": s.format, "opened_on": pd.Timestamp(s.opened_on), "closed_on": pd.NaT,
        "selling_area_sqft": s.sqft, "status": "active"} for s in stores])
    category_df = pd.DataFrame([{"source_record_id": f"ERP-CAT-{c.code}", "code": c.code, "name": c.name,
                                 "parent_code": None} for c in cats])
    supplier_df = pd.DataFrame([{"source_record_id": f"ERP-SUP-{s.code}", "code": s.code, "name": s.name, "country": "IN",
                                 "payment_terms_days": s.payment_terms, "contracted_lead_time_days": s.lead_days}
                                for s in SUPPLIERS if s.code in set(sup_codes)])
    product_df = pd.DataFrame([{
        "source_record_id": f"ERP-SKU-{p['sku']}", "sku": p["sku"], "name": p["name"], "category_code": p["category_code"],
        "supplier_code": p["supplier_code"], "brand": "NovaMart Select (fictional)", "unit_of_measure": "unit",
        "list_price": float(price[-1, i]), "unit_cost": float(cost[-1, i]), "is_active": True, "currency": cfg.currency,
    } for i, p in enumerate(products)])
    dept_rows = [{"source_record_id": f"ERP-DEPT-{s.code}-{code}", "code": f"{s.code}-{code}", "name": f"{s.code} {name}",
                  "store_code": s.code, "function": func} for s in stores for code, name, func, _, _ in DEPARTMENTS]
    dept_rows += [{"source_record_id": f"ERP-DEPT-{code}", "code": code, "name": name, "store_code": None,
                   "function": "head_office"} for code, name, _, _ in HQ_DEPARTMENTS]
    department_df = pd.DataFrame(dept_rows)

    data = NovaMartData(config=cfg)
    data.frames = {
        "store": store_df, "category": category_df, "supplier": supplier_df, "product": product_df,
        "department": department_df, "sales": sales, "traffic": traffic, "inventory_snapshot": inventory_snapshots,
        "inventory_movement": inventory_movements, "purchase_order": purchase_orders,
        "purchase_order_line": purchase_order_lines, "expense": expenses, "cash_flow": cash_flows,
        "cash_balance": cash_balances, "budget": budgets, "workforce": workforce, "marketing_spend": marketing,
        "customer_metric": customer_metrics,
    }
    data.facts = {
        "lost_sales_units": float((demand - sales_units).sum()),
        "net_sales_total": float(net.sum()),
        "cogs_total": float(cogs.sum()),
        "stores": [s.code for s in stores],
        "products": P,
        "days": T,
    }
    return data


@lru_cache(maxsize=4)
def cached_generate(config: NovaMartConfig) -> NovaMartData:
    return generate(config)


def small_config(**overrides: object) -> NovaMartConfig:
    """Compact configuration for tests: 2 stores, 3 categories x 3 products, ~7 months."""
    base = NovaMartConfig(store_codes=("S01", "S04"), category_codes=("STAPLES", "BEVERAGES", "ELECTRONICS"),
                          products_per_category=3, start=date(2025, 10, 1), end=date(2026, 4, 30),
                          daily_snapshot_days=30)
    return replace(base, **overrides)  # type: ignore[arg-type]
