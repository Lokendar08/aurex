# AUREX Decision Lab

The Decision Lab answers "what happens to the P&L and cash if we do X" by applying levers to a forecast-based monthly
baseline. Code: [services/simulation](../backend/app/services/simulation) (levers, calibration, engine, optimizer) and
[api/routes/decision_lab.py](../backend/app/api/routes/decision_lab.py). The worked example in section 11 walks through
the required 20 to 30 employees test.

## 1. Principles

Stated in [engine.py:1-16](../backend/app/services/simulation/engine.py#L1-L16) and returned by
`GET /decision-lab/catalog` ([decision_lab.py:112-120](../backend/app/api/routes/decision_lab.py#L112-L120)):

1. **Deterministic costs and accounting identities.** Payroll = headcount change x cost per employee, rent, capex,
   straight-line depreciation, tax at the effective rate, and cash = EBITDA - tax - working capital - capex are computed,
   not estimated.
2. **Behavioural effects only from evidence or documented assumptions.** Volume, revenue and customer responses use
   relationships estimated from the company's own data (with standard error, confidence interval, p-value and an
   `identified` flag, [calibration.py:1-6](../backend/app/services/simulation/calibration.py#L1-L6)) or an explicit user value.
3. **Unsupported effects default to zero.** If an effect is not statistically identified it is not applied, and a warning
   says so. The single exception is price elasticity, where the code treats a zero response as dangerous (it would credit
   a price increase with no loss of volume); there a labelled default of -1.0 +/- 0.5 is used
   ([engine.py:40](../backend/app/services/simulation/engine.py#L40)).
4. **Hiring never raises revenue automatically.** A workforce change always adds its cost; revenue changes only with a
   documented assumption, or with the historical mode when stores are capacity-constrained and the labour relationship is
   identified ([engine.py:357-383](../backend/app/services/simulation/engine.py#L357-L383)).

## 2. Baseline

`build_context(scope, horizon)` ([engine.py:108-160](../backend/app/services/simulation/engine.py#L108-L160)) combines the
forecast baseline with calibrated evidence.

**Revenue** comes from `baseline_monthly(scope, months=horizon)` ([service.py:255-362](../backend/app/services/forecasting/service.py#L255-L362)):

| Scope | Revenue source |
|---|---|
| Whole company | Active company-level `net_sales` model: daily `yhat` summed per calendar month |
| Exactly one store | Active store-level `net_sales` model of that store |
| Two or more selected stores, or no active model | Heuristic: same month last year x trailing 12-month growth when at least 25 months of history exist, else trailing 90-day average daily sales x days in month (no seasonality); `reliability = "unreliable"` and a note |

The first baseline month is the month after `data_end`. With a daily model, a month that is at least half inside the
forecast horizon is scaled up from its forecast daily average (total / share of its days forecast) and noted; a month
covered less than half counts as beyond the horizon. Months beyond the horizon take the value of the same calendar month
one year earlier (forecast or already extended), which keeps seasonality without assuming further growth; a note says so,
and any month still without a value repeats the previous month (`ffill`)
([service.py:274-304](../backend/app/services/forecasting/service.py#L274-L304)). Tested in
[test_review_fixes.py:105-135](../backend/tests/test_review_fixes.py#L105-L135).

**Costs** use the trailing 12 complete months ending before `data_end`'s month, computed with the P&L engine
([service.py:232-252](../backend/app/services/forecasting/service.py#L232-L252)):

| Element | Rule |
|---|---|
| COGS | revenue x (1 - trailing gross margin). The margin is the P&L gross margin; when the P&L does not report one because cost coverage is below 90%, it is measured on the trailing sales that have a recorded cost, provided they are at least 50% of sales (`MIN_COVERAGE_FOR_BASELINE_MARGIN`), and a note gives the coverage. Below 50%, or with no cost data, `baseline_monthly` and `build_context` raise 422 `insufficient_data` instead of using a margin of 0 ([service.py:229](../backend/app/services/forecasting/service.py#L229), [service.py:243-248](../backend/app/services/forecasting/service.py#L243-L248), [service.py:329-334](../backend/app/services/forecasting/service.py#L329-L334), [engine.py:121-124](../backend/app/services/simulation/engine.py#L121-L124)) |
| Variable operating costs | `logistics` and `store_supplies` as a share of trailing net sales |
| Fixed costs | Every other category's 12-month total / 12 (including depreciation and finance costs, excluding income tax) |
| Income tax | `max(PBT, 0)` x effective rate = trailing income tax / trailing PBT when PBT > 0, else 0.25; clamped to [0, 0.35] |
| Operating cash flow | EBITDA - tax (no working-capital movement in the baseline) |

**Context** additions:
- `revenue_sd` = (q90 - q10) / 2.563 of the model's monthly relative backtest errors, i.e. a relative standard deviation;
  `None` when the model has no monthly quantiles ([engine.py:116-117](../backend/app/services/simulation/engine.py#L116-L117)).
- Category revenue shares and COGS ratios from the trailing 12 months of system-of-record sales lines
  ([calibration.py:103-118](../backend/app/services/simulation/calibration.py#L103-L118)). Categories without a measured
  margin take the baseline margin, and all ratios are rescaled so that their share-weighted average equals
  1 - baseline gross margin ([engine.py:125-135](../backend/app/services/simulation/engine.py#L125-L135)). With no category
  data a single `ALL` bucket is used.
- Average inventory per store for new-store working capital: the latest inventory value of the last 14 days divided by the
  selected stores, else by the company's `active` stores; the store count of the scope uses the same rule
  ([engine.py:136-150](../backend/app/services/simulation/engine.py#L136-L150)).
- The evidence bundle (section 3).

## 3. Evidence (calibration)

`evidence_bundle(scope)` ([calibration.py:506-534](../backend/app/services/simulation/calibration.py#L506-L534)), also exposed at
`GET /orgs/{org_id}/decision-lab/evidence?include_elasticities=` ([decision_lab.py:123-140](../backend/app/api/routes/decision_lab.py#L123-L140)).
Results are cached in-process for 30 minutes, keyed by company, selected stores and `data_end`; the new-store profile
always uses the whole company and is keyed by company and `data_end` only
([calibration.py:30](../backend/app/services/simulation/calibration.py#L30), [calibration.py:50-62](../backend/app/services/simulation/calibration.py#L50-L62),
[calibration.py:341-343](../backend/app/services/simulation/calibration.py#L341-L343)).

| Evidence | Method | Identified when | Source |
|---|---|---|---|
| Price elasticity per category | Weekly product-level log(units) on log(net price per unit) from system-of-record sales rows, within-product (fixed effects), controls for annual Fourier terms, the company's festival calendar and trend; OLS with HC1 robust SE; 3 years ending 7 days before `data_end` | n >= 80 and price variation, p < 0.05, beta < 0, SE < \|beta\| | [calibration.py:126-175](../backend/app/services/simulation/calibration.py#L126-L175) |
| Marketing elasticity | Estimated at company level whatever the scope: weekly log(company net sales) on log(adstocked weekly spend of the chosen marketing integration) + Fourier, festivals, trend, log(store count); adstock decay chosen by AIC from {0, 0.2, 0.4, 0.55, 0.7}; needs 52 complete weeks. `monthly_spend` = last 13 weeks / 3; for a store selection it is multiplied by the selection's share of company net sales in those weeks (`allocation_share`, with an `allocation_note`) | p < 0.05 and beta > 0 | [calibration.py:183-256](../backend/app/services/simulation/calibration.py#L183-L256), [calibration.py:196-201](../backend/app/services/simulation/calibration.py#L196-L201), [calibration.py:245-255](../backend/app/services/simulation/calibration.py#L245-L255) |
| Workforce profile | Headcount of the latest complete month; cost per employee = labour cost / headcount over the last 6 complete months; transactions per labour hour (TPLH) over 3 months; utilization = TPLH / mean of each store's historical 90th-percentile TPLH; `capacity_constrained` when utilization >= 0.95 | — | [calibration.py:264-313](../backend/app/services/simulation/calibration.py#L264-L313) |
| Labour-hours elasticity | Store fixed-effects OLS of log monthly sales on log hours with month dummies; documented as correlational | >= 2 stores, >= 24 store-months, p < 0.05, beta > 0 | [calibration.py:316-333](../backend/app/services/simulation/calibration.py#L316-L333) |
| New-store ramp | Relative productivity of stores opened within the history (sales per sq ft per day / mature stores' same month) fitted to L x (1 - g e^(-months/tau)) by bounded non-linear least squares | >= 6 monthly points and a successful fit | [calibration.py:341-402](../backend/app/services/simulation/calibration.py#L341-L402) |
| Mature productivity | Mean and SD across stores aged >= 24 months of sales per sq ft per day, trailing 12 months | — | [calibration.py:374-380](../backend/app/services/simulation/calibration.py#L374-L380) |
| Capex per sq ft | `capital_expenditure` cash flows of the chosen cash integration in the 3 months before each opening / selling area | at least one observation | [calibration.py:403-419](../backend/app/services/simulation/calibration.py#L403-L419) |
| Store cost profile | Rent and utilities per sq ft per month, maintenance + technology + insurance per store per month, from the chosen expense integration and stores open for the whole trailing 12 months | — | [calibration.py:428-451](../backend/app/services/simulation/calibration.py#L428-L451) |
| Inventory demand | Per store x product: daily mean and SD of units of system-of-record sales over the last 90 days (days without sales count as 0), recent net price per unit | — | [calibration.py:454-477](../backend/app/services/simulation/calibration.py#L454-L477) |
| Customers | Retention = returning / previous month's active, 6-month mean; spend per active customer = 6-month net sales / 6 / average active; needs 4 months | — | [calibration.py:480-503](../backend/app/services/simulation/calibration.py#L480-L503) |

Price elasticities are estimated only when a scenario contains a price lever (the slowest estimate)
([engine.py:763](../backend/app/services/simulation/engine.py#L763)).

## 4. Levers

All levers are pydantic models discriminated by `type` ([levers.py:114-115](../backend/app/services/simulation/levers.py#L114-L115));
invalid input is a 422. Every lever accepts an optional `label` and `note` (max 1000 characters); results are labelled with
`label`, else the lever type's catalog label ([engine.py:199-204](../backend/app/services/simulation/engine.py#L199-L204)). Month numbers are 1-based
within the horizon. A scenario holds at most 20 levers ([engine.py:761-762](../backend/app/services/simulation/engine.py#L761-L762)).

### workforce ([levers.py:15-33](../backend/app/services/simulation/levers.py#L15-L33), [engine.py:332-400](../backend/app/services/simulation/engine.py#L332-L400))

| Field | Bounds | Default |
|---|---|---|
| `headcount_change` | -5000..5000 | — (this or `target_headcount` is required) |
| `target_headcount` | 0..100000 | — (change = target - recorded headcount) |
| `start_month` | 1..60 | 1 |
| `monthly_cost_per_employee` | > 0 | historical 6-month loaded cost per employee |
| `hiring_cost_per_hire` / `severance_per_exit` | >= 0 | 0 (booked once in the start month, as `other` / `payroll`) |
| `revenue_effect` | `none`, `assumption`, `historical` | `none` |
| `assumed_revenue_uplift_pct` | -0.5..1.0 | required with a `note` when `revenue_effect = assumption` |
| `ramp_months` | 0..12 | 2 (linear ramp of any revenue effect) |

- Deterministic: payroll += change x cost per employee in every month from `start_month`.
- `assumption`: revenue x (1 + uplift x realization x ramp); realization is 1 in the point estimate and Uniform(0.6, 1.0) in
  Monte Carlo.
- `historical`: applied only if the scope is capacity-constrained **and** the labour elasticity is identified; then
  revenue x (1 + ((1 + change / headcount)^beta - 1) x ramp). Otherwise zero with a warning stating why.
- Reports capacity: current and new headcount, utilization, `capacity_constrained`, TPLH after the change
  (current TPLH x headcount / new headcount) and the monthly staffing cost change; warns when cutting staff at utilization
  >= 0.9. Requires workforce data (422 `insufficient_data` otherwise) and a caller with `workforce:read` (403
  `workforce_access_required` otherwise, section 9).

### price ([levers.py:36-41](../backend/app/services/simulation/levers.py#L36-L41), [engine.py:221-249](../backend/app/services/simulation/engine.py#L221-L249))

| Field | Bounds | Default |
|---|---|---|
| `change_pct` | -0.5..0.5 | required |
| `category_codes` | up to 50 known codes | all categories |
| `elasticity_override` | -6..0 | — |
| `start_month` | 1..60 | 1 |

- Revenue of each affected category x (1 + change)^(1 + epsilon); its COGS ratio / (1 + change), because unit costs are
  unchanged, so COGS moves with volume (1 + change)^epsilon.
- epsilon: the override (source `user`), else the identified estimate (cited as evidence), else the **default -1.0**
  (source `default`) with the warning "could not be estimated from your data; using a conservative default of -1.0 +/- 0.5
  (labelled assumption)".
- Warning when \|change\| > 15% (outside the typically observed range).

### product_mix ([levers.py:106-111](../backend/app/services/simulation/levers.py#L106-L111), [engine.py:252-267](../backend/app/services/simulation/engine.py#L252-L267))

`from_category`, `to_category` (known codes), `shift_pct` (0 < x <= 0.5), `start_month`. Moves that share of the source
category's revenue to the destination; total sales unchanged, margin changes through the two categories' COGS ratios.
Warns when the destination margin is lower. Fully deterministic.

### marketing ([levers.py:44-48](../backend/app/services/simulation/levers.py#L44-L48), [engine.py:270-300](../backend/app/services/simulation/engine.py#L270-L300))

| Field | Bounds | Default |
|---|---|---|
| `change_pct` | -1.0..3.0 | required |
| `elasticity_override` | 0..1 | — |
| `start_month` | 1..60 | 1 |

- Deterministic cost: base monthly spend x change added to `marketing` from `start_month`; base = trailing monthly
  `marketing` expense run-rate of the scope, else the evidence's `monthly_spend`. For a store selection without its own
  marketing expenses (NovaMart books marketing at head office) that is the allocated share of company spend: the lever
  adds the allocation note as a warning and labels the base spend `allocated`
  ([engine.py:273-274](../backend/app/services/simulation/engine.py#L273-L274), [engine.py:295-300](../backend/app/services/simulation/engine.py#L295-L300)).
- Revenue x (1 + max(change, -0.9))^beta; beta = override, else the identified estimate, else **0** with the warning that
  the effect is not identified (cost only).

### retention ([levers.py:92-103](../backend/app/services/simulation/levers.py#L92-L103), [engine.py:303-329](../backend/app/services/simulation/engine.py#L303-L329))

`retention_change_pp` (-0.3..0.3, required), `monthly_program_cost` (default 0, booked as marketing), `spend_per_customer`
(default: historical spend per active customer), `start_month`, and a required `note`. Customer flow
`active(t) = new + r' x active(t-1)` with new-customer inflow held at `active x (1 - r)` and r' = clip(r + change, 0, 0.98);
extra revenue = (active(t) - active) x spend x realization, spread by category share. Assumption-based by construction:
realization Uniform(0.6, 1.0) in Monte Carlo. Requires customer aggregates.

### supplier_cost ([levers.py:51-56](../backend/app/services/simulation/levers.py#L51-L56), [engine.py:207-218](../backend/app/services/simulation/engine.py#L207-L218))

`change_pct` (-0.5..0.5, required), `category_codes` (default all), `one_time_cost` (default 0, booked as
`professional_fees` in the start month), `start_month`. COGS ratio x (1 + change); prices and volumes unchanged.
Deterministic.

### new_store ([levers.py:67-75](../backend/app/services/simulation/levers.py#L67-L75), [engine.py:403-477](../backend/app/services/simulation/engine.py#L403-L477))

| Field | Bounds | Default (source) |
|---|---|---|
| `count` | 1..50 | 1 |
| `open_month` | 1..60 | 3 |
| `selling_area_sqft` | 500..500000 | median selling area of existing stores |
| `capex_per_store` | >= 0 | capex per sq ft from past openings x area; **422 if there is no history** |
| `pre_opening_cost_per_store` | >= 0 | 2 months of rent |
| `headcount_per_store` | 1..2000 | scope headcount / scope store count (20 without workforce data) |
| `mature_sales_per_sqft_day` | > 0 | mature stores' average (422 if unavailable) |

- Revenue (estimated): count x area x sales per sq ft per day x productivity multiplier x days in month x baseline
  seasonality index (baseline revenue / its mean) x ramp(age), ramp = L x (1 - g e^(-age/tau)), age 1 in the opening month.
  The fitted ramp is used when identified; otherwise the **default** L = 0.85, g = 0.45, tau = 4.5 months
  ([engine.py:41](../backend/app/services/simulation/engine.py#L41)) with a warning. New-store revenue carries the company gross
  margin.
- Costs (deterministic, [engine.py:446-460](../backend/app/services/simulation/engine.py#L446-L460)): rent from two months before
  opening; payroll (headcount x cost per employee) from one month before; utilities and fixed store costs from the opening
  month; depreciation = capex / 120 per month (10-year straight line) from the opening month; pre-opening cost in the month
  before opening; capex split evenly over the (up to) three months before opening; opening inventory (average inventory per
  store) as working capital in the opening month.

### opex ([levers.py:78-89](../backend/app/services/simulation/levers.py#L78-L89), [engine.py:480-501](../backend/app/services/simulation/engine.py#L480-L501))

`changes` (category to fraction, each -1..1), `one_time_cost`, `start_month`. `logistics` and `store_supplies` change their
variable ratio through a per-month multiplier, and other operating categories change their trailing monthly run-rate;
both apply from `start_month` ([engine.py:486-493](../backend/app/services/simulation/engine.py#L486-L493)). `depreciation`,
`finance_costs`, `income_tax` or unknown categories are a 422. Warns about cuts above 30%. The `Changes` assumption records
only each category's type and change; the bases are the `Trailing monthly run-rates` evidence
([engine.py:493-498](../backend/app/services/simulation/engine.py#L493-L498)).

### inventory ([levers.py:59-64](../backend/app/services/simulation/levers.py#L59-L64), [engine.py:508-555](../backend/app/services/simulation/engine.py#L508-L555))

| Field | Bounds | Default |
|---|---|---|
| `safety_days_change` | -15..30 | 0 |
| `cover_days_change` | -30..60 | 0 |
| `category_codes` | up to 50 | all |
| `holding_cost_rate` | 0..1 (annual) | 0.20 |

Per store x product with recent demand: sigma_L = SD x sqrt(lead time); safety stock ss0 from the snapshot (else 5 days of
demand), ss1 = max(ss0 + change x mean demand, 0); cycle = days of cover clipped to 2..120 (14 if unknown) and at least
lead time + 1. Expected lost units per month = (30.4 / cycle) x sigma_L x G(ss / sigma_L), G the standard normal loss
function. The lost-sales change is valued at the recent net price (else unit cost x 1.3) with COGS at unit cost; the
inventory change ((ss1 - ss0) + cover change x demand / 2) x unit cost is working capital in month 1 and costs
`holding_cost_rate / 12` per month. Reports stockout probability per cycle before and after. Assumes roughly normal daily
demand and lost (not back-ordered) sales.

### Application order

`APPLY_ORDER = supplier_cost, price, product_mix, marketing, retention, workforce, new_store, opex, inventory`
([levers.py:117-118](../backend/app/services/simulation/levers.py#L117-L118)). Levers are applied sorted by this order
(then input position) and reported in input order ([engine.py:601-606](../backend/app/services/simulation/engine.py#L601-L606)),
so the result does not depend on input order. Interactions follow from the order: a price change alters volume and so
COGS and variable costs; marketing, retention and a workforce assumption multiply revenue that already includes price and
mix effects; new-store revenue is kept separately and is not affected by price or marketing levers.

## 5. Outputs

`_finalize` ([engine.py:578-598](../backend/app/services/simulation/engine.py#L578-L598)) produces the same monthly statement for
baseline and scenario:

| Line | Formula |
|---|---|
| `net_sales` | category revenue + new-store revenue |
| `cogs` | sum(category revenue x COGS ratio) + new-store revenue x (1 - gross margin) + inventory COGS adjustment |
| `operating_expenses` | variable ratios x revenue + fixed run-rates (excluding depreciation, finance costs) + lever opex |
| `ebitda` | gross profit - operating expenses |
| `depreciation`, `finance_costs` | baseline run-rate (+ new-store depreciation) |
| `income_tax` | max(PBT, 0) x effective rate, per month |
| `net_profit` | PBT - tax |
| `operating_cash_flow` | EBITDA - tax - working-capital change |
| `free_cash_flow` | operating cash flow - capex |

`run_scenario` ([engine.py:758-825](../backend/app/services/simulation/engine.py#L758-L825)) returns `baseline`, `scenario` and
`delta` (monthly rows and totals, gross and net margin change in percentage points), `levers` (per-lever summary, evidence,
assumptions, warnings), the flattened `assumptions` and `warnings`, `evidence_summary`, `investment`, and with levers also
`uncertainty`, `sensitivity` and `downside`.

**Investment metrics** on the incremental monthly cash flows ([engine.py:620-662](../backend/app/services/simulation/engine.py#L620-L662)):

| Metric | Definition |
|---|---|
| Investment | sum of positive incremental capex + positive working-capital changes |
| NPV | sum of incremental FCF_i / (1 + r_m)^(i+1), r_m = (1 + r)^(1/12) - 1, r = `discount_rate` (default 0.12) |
| ROI | (sum of incremental EBITDA - tax - capex) / investment; working capital treated as recovered at the horizon; `None` without investment |
| Payback | evaluated when there is investment or cumulative incremental FCF goes below 0 in any month ([engine.py:629](../backend/app/services/simulation/engine.py#L629)), and measured from the trough: the first month at or after the minimum of cumulative incremental FCF in which the cumulative value is back at >= 0; `payback_note` names the first negative month and the recovery month. 0 ("never negative") if the cumulative series never goes below 0; if it has not recovered by the end of the horizon, extrapolated from the last three months' run-rate when that is positive, otherwise "no payback" |

Measuring from the trough means months before a later investment, where cumulative FCF is still 0 (for example
`new_store` with `open_month = 6`), are not counted as payback ([test_review_fixes.py:35-45](../backend/tests/test_review_fixes.py#L35-L45)),
and a scenario without capex whose cash flow dips later, such as a one-time opex cost from month 6, still gets a payback
([test_review_fixes.py:177-190](../backend/tests/test_review_fixes.py#L177-L190)). "No upfront investment" is reported only
when there is no investment and cumulative incremental FCF never goes below 0.

## 6. Uncertainty: Monte Carlo P10/P50/P90

With at least one lever, `run_scenario` draws `max(50, min(runs, 5000))` parameter sets with
`numpy.random.default_rng(seed)` (API default 500 runs, seed 7) and simulates baseline and scenario with each
([engine.py:792-819](../backend/app/services/simulation/engine.py#L792-L819)). Sampled parameters
([engine.py:665-692](../backend/app/services/simulation/engine.py#L665-L692)):

| Parameter | Distribution |
|---|---|
| Baseline revenue error | Normal(0, `revenue_sd`), applied to baseline and scenario alike |
| Price elasticity per category | identified: Normal(beta, SE) clipped to [-5, -0.05]; otherwise Normal(-1.0, 0.5) clipped to [-3, -0.1] |
| Marketing elasticity | identified: max(Normal(beta, SE), 0); otherwise fixed 0 |
| Labour elasticity | identified: max(Normal(beta, SE), 0); otherwise fixed 0 |
| Ramp level and tau | fitted: Normal(estimate, SE) clipped ([0.3, 1.5], [0.5, 24]); default ramp: level Normal(0.85, 0.1) clipped to [0.4, 1.2] |
| New-store productivity multiplier | Normal(1, CV of mature stores' productivity) clipped to [0.4, 1.8] |
| Retention and workforce-assumption realization | Uniform(0.6, 1.0) |

Known costs (cost per employee, capex, holding cost rate) are not sampled. Outputs: P10/P50/P90 and mean of the net-profit
change; P10/P50/P90 of net-sales and FCF change; probability that the net-profit change is positive; and, when there is
investment, P10/P50/P90 of ROI with the same definition as the point ROI, (incremental EBITDA - tax - capex) / investment
with working capital treated as recovered ([engine.py:803-807](../backend/app/services/simulation/engine.py#L803-L807)).

**Sensitivity tornado** ([engine.py:702-749](../backend/app/services/simulation/engine.py#L702-L749)): for each relevant
parameter the net-profit change is recomputed at a low and a high value and rows are sorted by swing:

| Test | Low / high |
|---|---|
| Baseline revenue | -/+ 1.2816 x `revenue_sd` |
| Price elasticity per category (price levers) | estimate -/+ 1.2816 x SE (default SD 0.5 when not identified) |
| Marketing elasticity (identified only) | -/+ 1.2816 x SE |
| Cost per employee (workforce or new store) | x 0.9 / x 1.1 |
| New-store productivity | x (1 - rel) / x (1 + rel), rel = SD / mean of mature stores' sales per sq ft per day clipped to [0.05, 0.5] ("+/-1 sd across stores"); +/-20% labelled "no cross-store evidence" when either is unavailable ([engine.py:725-731](../backend/app/services/simulation/engine.py#L725-L731)) |
| New-store capex | x 0.8 / x 1.2 |
| Ramp level | -/+ 0.1 |
| Retention realization | 0.6 / 1.0 |
| Workforce uplift realization (assumption mode only) | 0.6 / 1.0 |
| Holding cost rate (inventory) | x 0.75 / x 1.25 |

**Downside** = the 10th percentile of the Monte Carlo distribution of the net-profit, net-sales and FCF changes, a 1-in-10
outcome, as the module docstring also states ([engine.py:821-824](../backend/app/services/simulation/engine.py#L821-L824),
[engine.py:14-15](../backend/app/services/simulation/engine.py#L14-L15)).

## 7. Goal optimizer

`POST /orgs/{org_id}/decision-lab/optimize` ([decision_lab.py:151-163](../backend/app/api/routes/decision_lab.py#L151-L163)),
implemented in [optimize.py](../backend/app/services/simulation/optimize.py):

- **Variables**: 1-3 of `{lever_index, field, min, max, steps}` (2-51 steps). Fields must belong to the lever and be one of
  `change_pct`, `headcount_change`, `target_headcount`, `safety_days_change`, `cover_days_change`, `retention_change_pp`,
  `shift_pct`, `open_month`, `count`, `monthly_program_cost`; integer fields are rounded and de-duplicated
  ([optimize.py:21-32](../backend/app/services/simulation/optimize.py#L21-L32), [optimize.py:56-70](../backend/app/services/simulation/optimize.py#L56-L70)).
- **Grid**: the exhaustive Cartesian product, at most 2500 combinations ([optimize.py:71-73](../backend/app/services/simulation/optimize.py#L71-L73)).
  Each combination is re-validated as levers and simulated with point parameters.
- **Constraints** (up to 6): `metric` in net_sales, gross_profit, gross_margin, net_margin, ebitda, net_profit,
  free_cash_flow, investment; `basis` `delta_total` (default) or `scenario_total`; `op` `>=` or `<=`
  ([optimize.py:35-40](../backend/app/services/simulation/optimize.py#L35-L40), [optimize.py:100-106](../backend/app/services/simulation/optimize.py#L100-L106)).
- **Objective**: maximize the total change in `net_profit` (default), `ebitda`, `net_sales`, `free_cash_flow` or
  `gross_profit`; or `risk_adjusted_net_profit`, which re-scores the 8 best feasible combinations by the 10th percentile of
  120 Monte Carlo runs (seed 11) and picks the highest P10 ([optimize.py:118-130](../backend/app/services/simulation/optimize.py#L118-L130)).
- **`skipped_combinations`** counts combinations rejected by lever validation or by the engine (for example a data
  requirement) instead of hiding them ([optimize.py:78-93](../backend/app/services/simulation/optimize.py#L78-L93)).
- Output: `status` (`ok` or `infeasible`), number of evaluations, the best point and its levers, and evaluated points
  (thinned to about 400), with the caveat that the optimum is optimal only within the model and its assumptions.

## 8. Reproducibility

- `inputs_hash` = SHA-256 of canonical JSON of company, sorted store ids, horizon, levers (`model_dump`), options
  (`runs`, `seed`, `discount_rate`) and `ENGINE_VERSION` ([engine.py:695-699](../backend/app/services/simulation/engine.py#L695-L699),
  [decision_lab.py:99-109](../backend/app/api/routes/decision_lab.py#L99-L109)).
- `ENGINE_VERSION = "1.1.0"` ([engine.py:39](../backend/app/services/simulation/engine.py#L39)) is stored with every run; the
  code comment attributes 1.1.0 to payback after the trough, the consistent Monte Carlo ROI and `start_month` for the
  variable opex categories, so runs stored under 1.0.0 used the earlier definitions.
- Same inputs, seed and data give the same Monte Carlo quantiles (tested in
  [test_simulation.py:167-171](../backend/tests/test_simulation.py#L167-L171)).
- The hash identifies the request, not the data: the same hash can produce different results after new data, a retrained
  forecast, or once the 30-minute evidence cache expires.

## 9. Permissions and redaction

| Endpoint | Permission |
|---|---|
| `GET /decision-lab/catalog`, `GET /decision-lab/evidence`, `GET /scenarios`, `GET /scenarios/{id}`, `POST /scenarios/compare` | `scenarios:read` |
| `POST /decision-lab/simulate` (60/min per user), `POST /decision-lab/optimize` (20/min per user), `POST /scenarios`, `PUT /scenarios/{id}`, `POST /scenarios/{id}/run`, `DELETE /scenarios/{id}` | `scenarios:write`; a scenario with a `workforce` lever also needs `workforce:read` |
| `POST /scenarios/{id}/recommendation` (turn the latest run into a recommendation) | `recommendations:write` + `scenarios:read` ([workflows.py:128-133](../backend/app/api/routes/workflows.py#L128-L133)) |

The policy lives in [access.py](../backend/app/services/simulation/access.py) and is shared by the Decision Lab routes, the
advisor and recommendations. Its docstring states the rule: members without `finance:read` see changes (deltas) but not
absolute P&L levels, margins or cost structure, and a delta can still imply the level of the very cost being changed (a 10%
utilities cut implies the utilities run-rate); because workforce deltas reveal labour cost, workforce levers need
`workforce:read` ([access.py:1-11](../backend/app/services/simulation/access.py#L1-L11)). `check_lever_permissions` raises 403
`workforce_access_required` otherwise ([access.py:51-54](../backend/app/services/simulation/access.py#L51-L54)); it runs for
simulate and for every scenario create, update and re-run (all go through `_simulate`), for optimize, and in the advisor's
`simulate_scenario` tool ([decision_lab.py:100](../backend/app/api/routes/decision_lab.py#L100),
[decision_lab.py:157](../backend/app/api/routes/decision_lab.py#L157)). Built-in roles without `finance:read`:
`inventory_manager` (no `workforce:read` either) and `hr_manager` (has it), both with `scenarios:write`.

| Response (caller without `finance:read`) | Effect |
|---|---|
| Simulate and every saved-scenario response with a result (`_redact`, [decision_lab.py:68-79](../backend/app/api/routes/decision_lab.py#L68-L79)) | Top-level `baseline` and `scenario` (absolute monthly P&L and totals) removed and a `redacted` note added. In each lever's `evidence` and `assumptions` and in the top-level `assumptions`, items named in `FINANCE_ITEMS` keep only `name`, `source` and `lever` and get the value "requires finance access": COGS affected in the horizon, trailing gross margin, baseline monthly marketing spend, capex per sq ft and per store, rent per sq ft, pre-opening cost, trailing monthly run-rates and the baseline's "Cost structure" notes. The labour-cost items (`WORKFORCE_COST_ITEMS`: loaded cost per employee, cost per added employee) are redacted the same way unless the caller has `workforce:read` ([access.py:27-35](../backend/app/services/simulation/access.py#L27-L35), [access.py:57-70](../backend/app/services/simulation/access.py#L57-L70)). `delta`, `investment`, `uncertainty`, `sensitivity`, `downside`, warnings and the other lever fields remain |
| `GET /decision-lab/evidence` (`_redact_evidence`, [decision_lab.py:82-96](../backend/app/api/routes/decision_lab.py#L82-L96)) | Category `gross_margin` set to `null`; `store_costs` reduced to an availability flag; marketing `monthly_spend` and `spend_share_of_sales` removed; new-store `capex_per_sqft`, `capex_observations` and `capex_method` removed; workforce `monthly_cost_per_employee` and `monthly_labor_cost` removed unless `workforce:read` |
| `POST /decision-lab/optimize` | A constraint with `basis = "scenario_total"` is refused with 403; with `delta_total` constraints the response holds changes only ([decision_lab.py:154-156](../backend/app/api/routes/decision_lab.py#L154-L156)) |
| Recommendations | `predicted_impact.baseline_monthly` and `scenario_monthly` (monthly net-profit levels) removed ([workflows.py:33-37](../backend/app/api/routes/workflows.py#L33-L37)); the assumptions copied from the run as "name: value (source)" texts are redacted by the same item names (`redact_assumption_texts`, [access.py:73-79](../backend/app/services/simulation/access.py#L73-L79), [workflows.py:45](../backend/app/api/routes/workflows.py#L45)) |

Tested in [test_review_fixes.py:61-77](../backend/tests/test_review_fixes.py#L61-L77),
[test_review_fixes.py:143-166](../backend/tests/test_review_fixes.py#L143-L166). Redaction matches item names; the lever
summaries and warnings, which recommendations also copy, are not redacted.

**Workforce scenarios.** A saved scenario with a workforce lever, and any recommendation made from it, is visible only to
members with `workforce:read`: its payroll delta would otherwise reveal the cost per employee.

**Store scope.** A member without a store restriction sees every scenario; a store-scoped member sees a scenario only when
it has a store selection that lies entirely inside their stores, so company-wide scenarios are hidden from them
([access.py:38-48](../backend/app/services/simulation/access.py#L38-L48)). `GET /scenarios` filters with this rule
([decision_lab.py:244](../backend/app/api/routes/decision_lab.py#L244)); get, update, re-run, archive, compare and the
recommendation route load scenarios through `get_visible_scenario` and answer 404 for a hidden one, so its existence is not
disclosed; the advisor's `list_saved_scenarios` applies the same rule. Tested in
[test_review_fixes.py:48-58](../backend/tests/test_review_fixes.py#L48-L58). `build_scope` applies the member's scope to
simulate, optimize, create and update; an update without `store_ids` sets the scenario to the member's full scope. A
recommendation made from a scenario keeps the scenario's `store_ids` in `source_ref`; with one store it also gets that
`store_id`. Store-scoped members see a recommendation when its `store_id` is in their scope or, without a `store_id`, when
all of its `source_ref.store_ids` are ([recommendations.py:180-184](../backend/app/services/recommendations.py#L180-L184),
[recommendations.py:340-347](../backend/app/services/recommendations.py#L340-L347),
[test_review_fixes.py:169-174](../backend/tests/test_review_fixes.py#L169-L174)).

## 10. Saved scenarios, versions and comparison

| Action | Behaviour | Source |
|---|---|---|
| Create `POST /scenarios` | Stores name, description, tags, horizon (1-36 via the API), levers, `assumptions` = {monte_carlo_runs, discount_rate, seed}, `store_ids`; computes and stores the first run | [decision_lab.py:248-263](../backend/app/api/routes/decision_lab.py#L248-L263) |
| Update `PUT /scenarios/{id}` | Replaces the definition, `version += 1`, un-archives, stores a new run | [decision_lab.py:280-300](../backend/app/api/routes/decision_lab.py#L280-L300) |
| Re-run `POST /scenarios/{id}/run` | Recomputes the same version against current data and stores a new run | [decision_lab.py:303-310](../backend/app/api/routes/decision_lab.py#L303-L310) |
| Archive `DELETE /scenarios/{id}` | `status = archived` (rows kept) | [decision_lab.py:313-320](../backend/app/api/routes/decision_lab.py#L313-L320) |
| Get `GET /scenarios/{id}` | Latest run in full (redacted as above) plus the last 10 runs with `inputs_hash` and net-profit change | [decision_lab.py:266-277](../backend/app/api/routes/decision_lab.py#L266-L277) |
| Compare `POST /scenarios/compare` | 2-6 computed scenarios side by side: deltas, investment, ROI, payback, NPV, P10/P50/P90, probability of gain, warnings; `best_risk_adjusted` = highest P10 net-profit change; notes when horizons differ and that each run used the baseline current at its own run time | [decision_lab.py:323-358](../backend/app/api/routes/decision_lab.py#L323-L358) |

Each `scenario_runs` row stores `scenario_version`, `engine_version`, `inputs_hash`, the JSON-sanitized result and the user
([decision_lab.py:202-215](../backend/app/api/routes/decision_lab.py#L202-L215)).

## 11. The required test: 20 to 30 employees

Test: [test_simulation.py::test_workforce_20_to_30_adds_known_cost_and_no_automatic_revenue](../backend/tests/test_simulation.py#L41-L67).
Scope: NovaMart store S04 only; NovaMart keeps S04 at a fixed 20-person roster
([novamart_generator.py:511-512](../backend/app/seed/novamart_generator.py#L511-L512)), asserted by
[test_simulation.py:36-38](../backend/tests/test_simulation.py#L36-L38). Lever: `WorkforceLever(target_headcount=30)`, 12 months.

1. **Context.** `build_context` loads the S04 baseline (S04's active store-level net-sales model, trained by the test
   fixture) and the workforce profile for S04: headcount 20 in the latest complete month and the 6-month loaded cost per
   employee c.
2. **Lever.** `apply_workforce`: change = 30 - 20 = 10; payroll += 10 x c in each of the 12 months; no hiring cost
   (default 0). `revenue_effect` defaults to `none`, so revenue is untouched and `revenue_effect_note` reads "No revenue
   effect modelled: hiring adds known cost; revenue changes only with capacity evidence or a documented assumption."
3. **Capacity is reported, not monetized.** `capacity` = {current 20, new 30, utilization, `capacity_constrained`,
   TPLH after = current TPLH x 20/30, monthly staffing cost change = 10 x c}; an insight states whether S04 is
   capacity-constrained.
4. **Statement.** Net sales and COGS deltas are 0 in every month; operating expenses rise by 10 x c x 12; EBITDA and PBT fall
   by the same amount; income tax can only fall (effective rate on positive PBT); so net profit change = -10 x c x 12 - (tax
   change), and free cash flow change equals net profit change (no depreciation, financing, capex or working-capital
   change).
5. **Investment.** No capex or working capital: ROI is `None` ("undefined without upfront investment"), and since cumulative
   incremental FCF never turns positive there is no payback.
6. **Uncertainty.** Monte Carlo samples only parameters this lever does not use, except the baseline revenue error, which
   moves baseline and scenario together; while monthly PBT stays on the same side of zero the net-profit change is identical
   in every run, so P10 = P90 ("known cost, no uncertainty band"). The tornado contains the revenue test (when the model has
   monthly error quantiles) and cost per employee +/-10%.

The test asserts: headcounts 20 and 30; monthly staffing cost change = 10 x c; operating-expense change = 10 x c x 12;
net-sales change 0 overall and in every month; the "No revenue effect" note; negative net-profit change equal to
-10 x c x 12 - tax change with a non-positive tax change; FCF change = net-profit change; TPLH after below current; P10 = P90.

Related tests: an assumed uplift requires a documented note and then raises revenue
([test_simulation.py:70-79](../backend/tests/test_simulation.py#L70-L79)); historical mode yields zero revenue when S04 is not
capacity-constrained ([test_simulation.py:82-89](../backend/tests/test_simulation.py#L82-L89)).

**Through the advisor.** [test_advisor_intel_news.py::test_advisor_models_20_to_30_question_as_a_change_on_recorded_headcount](../backend/tests/test_advisor_intel_news.py#L42-L54)
asks "What happens if we increase employees from 20 to 30 at store S04?" in deterministic mode, as the executive demo user
(the tool needs `workforce:read` for a workforce lever). The intent router sends
staffing questions to the hiring handler; `headcount_request` turns "from 20 to 30" into a **change of +10 applied to the
recorded headcount** (not a target), so a question whose starting figure differs from the data cannot silently cut or
inflate staff ([deterministic.py:178-196](../backend/app/services/advisor/deterministic.py#L178-L196)). The handler calls the
`simulate_scenario` tool with `{"type": "workforce", "headcount_change": 10}` and `store_codes = ["S04"]`; the test checks the
tool input, the capacity output (20, 30), the key figure "Revenue change over horizon" = 0, the text "20 → 30" and that every
number in the answer is traced to tool output. If the recorded headcount differed from the stated 20, the answer would add a
note that the change was applied to the recorded headcount ([deterministic.py:223-225](../backend/app/services/advisor/deterministic.py#L223-L225)).
[test_advisor_intel_news.py::test_advisor_hiring_answer_does_not_invent_revenue](../backend/tests/test_advisor_intel_news.py#L35-L39)
checks the same for "hire 10 additional employees at S04".

## 12. Limitations

- The baseline is only as good as the active forecast; subsets of two or more stores and untrained scopes use heuristic
  revenue; months beyond the forecast horizon repeat the same month one year earlier, so a baseline longer than the
  forecast assumes no growth after the horizon.
- Baseline costs are trailing ratios and run-rates: fixed costs are divided by 12 even when less than a year of history
  exists, and tax is a flat rate on positive monthly profit (no loss carry-forward). Between 50% and 90% cost coverage
  the gross margin is measured on the costed share of sales, where the P&L itself reports no margin.
- Elasticities are observational (promotions coincide with demand shifts; stockouts cap observed sales); the labour
  relationship is correlational and only used in the explicit historical mode.
- The marketing response is estimated for the whole company and applied to a store selection's revenue; without
  store-level marketing expenses the selection's base spend is an allocation by sales share, not its own spend
  (sections 3 and 4).
- Effects not modelled: competitor reactions, service-level effects of staffing, cannibalization of existing stores by new
  ones, receivables and payables (working capital covers inventory and new-store stock only).
- Redaction without `finance:read` works on item names, and a delta still implies the level of the cost it changes
  (section 9). Workforce scenarios therefore need `workforce:read` both to run and to be seen: `scenario_visible` hides a
  saved scenario that contains a workforce lever from members without it (404, filtered from lists and compare), and
  recommendations created from such a scenario record its `lever_types` and are hidden the same way.
- `inputs_hash` does not capture the data or the trained model; evidence is cached per process for 30 minutes.
- The advisor's `simulate_scenario` tool exposes only a subset of lever fields (no `retention`, `revenue_effect`,
  `elasticity_override` or `note`), so assumption-based effects are available only through the Decision Lab API.
