# AUREX metrics

How AUREX computes every business figure it shows: the shared metric functions, the P&L, reporting periods and
comparisons, the revenue bridge, inventory risk, other operational measures and the business health score. All
monetary values are in the company's base currency; facts in another currency are rejected at import
([DATA_MODEL.md](DATA_MODEL.md#4-missing-is-not-zero)).

## 1. Metric functions (`services/metrics.py`)

Every function returns a `MetricResult(value, status, note)` instead of a bare number
([metrics.py:17-31](../backend/app/services/metrics.py#L17-L31)). Statuses: `ok`, `missing_data`, `zero_denominator`,
`not_meaningful`, `insufficient_history`. `None` and NaN inputs both count as missing
([metrics.py:34-35](../backend/app/services/metrics.py#L34-L35)). A zero denominator is any `|d| < 1e-12`. No function
returns 0 or infinity in place of an undefined value. Scalar KPIs call these functions; per-row ratios in analytics tables
(workforce by month and store, product margins) apply the same definitions inline with pandas, with a zero denominator
giving `null` ([metrics.py:1-8](../backend/app/services/metrics.py#L1-L8), section 6).

### Business ratios

| Function | Formula | Unit | Edge cases | Used by |
|---|---|---|---|---|
| `safe_ratio(n, d)` [L42](../backend/app/services/metrics.py#L42) | n / d | ratio | missing input: `missing_data`; d = 0: `zero_denominator` | P&L cost coverage, data-quality coverage, shares (categories, expenses, stores), forecast skill, advisor `calculate` |
| `growth_rate(c, p)` [L50](../backend/app/services/metrics.py#L50) | (c - p) / \|p\| | fraction | missing: `missing_data` ("comparison period has no data"); p = 0: `zero_denominator`; p < 0: computed against \|p\| and flagged in `note` | Dashboard KPI changes and revenue growth, store/category growth, revenue bridge, supplier lead-time trend, expense anomalies, benchmarking, advisor |
| `gross_profit(net, cogs)` [L67](../backend/app/services/metrics.py#L67) | net - cogs | currency | either missing: `None` (unknown cost never yields gross profit = net sales) | Tests only; the P&L applies the coverage rules in section 2 instead |
| `margin(profit, revenue)` [L73](../backend/app/services/metrics.py#L73) | profit / revenue | fraction | as `safe_ratio`; revenue < 0: `not_meaningful` | Gross, EBITDA and net margins in the P&L; category and store margins; derived margins of public companies |
| `net_sales(gross, disc, refunds)` [L80](../backend/app/services/metrics.py#L80) | gross - disc - refunds | currency | gross missing: `None`; missing discount/refund treated as 0 | Tests only; the same identity is enforced by validation and a CHECK constraint |
| `inventory_turnover(cogs, avg_inv, days)` [L86](../backend/app/services/metrics.py#L86) | cogs / avg_inv x 365 / days | times per year | as `safe_ratio`; annualized (note) | Inventory overview, dashboard KPI, benchmarking |
| `days_inventory_outstanding(avg_inv, cogs, days)` [L96](../backend/app/services/metrics.py#L96) | avg_inv / cogs x days | days | as `safe_ratio` | Inventory overview |
| `gmroi(gp, avg_inv, days)` [L103](../backend/app/services/metrics.py#L103) | gp / avg_inv x 365 / max(days, 1) | ratio | as `safe_ratio`; annualized (note); tested in [test_metrics.py:99-105](../backend/tests/test_metrics.py#L99-L105) | Inventory overview with the P&L gross profit (section 5), removed for members without `finance:read`; a KPI on the inventory page |
| `sell_through(sold, available)` [L111](../backend/app/services/metrics.py#L111) | sold / available | fraction | as `safe_ratio` | Not called |
| `average_basket(net, txn)` [L115](../backend/app/services/metrics.py#L115) | net / transactions | currency | as `safe_ratio` | Sales summary KPI, store productivity, revenue bridge |
| `sales_per_labor_hour(net, hours)` [L119](../backend/app/services/metrics.py#L119) | net / hours | currency per hour | as `safe_ratio` | Store productivity |
| `transactions_per_labor_hour(txn, hours)` [L123](../backend/app/services/metrics.py#L123) | txn / hours | count per hour | as `safe_ratio` | Not called (computed inline, see section 6) |
| `labor_cost_ratio(cost, net)` [L127](../backend/app/services/metrics.py#L127) | labor cost / net sales | fraction | as `safe_ratio` | Tests only (computed inline, see section 6) |
| `revenue_per_sqft(net, sqft, days)` [L131](../backend/app/services/metrics.py#L131) | net / sqft x 365 / max(days, 1) | currency per sq ft per year | as `safe_ratio`; annualized (note) | Store productivity |
| `retention_rate(returning, prev_active)` [L139](../backend/app/services/metrics.py#L139) | returning / previous active | fraction | value > 1 stays `ok` with a note (counts are not de-duplicated) | Not called (Decision Lab computes retention inline) |
| `cagr(begin, end, years)` [L146](../backend/app/services/metrics.py#L146) | (end / begin)^(1/years) - 1 | fraction | missing: `missing_data`; years <= 0: `insufficient_history`; begin or end <= 0: `not_meaningful` | Tests only |
| `budget_variance(actual, budget)` [L156](../backend/app/services/metrics.py#L156) | variance = actual - budget; pct = variance / budget | currency, fraction | missing: `status=missing_data`; budget 0: `zero_denominator`; favourable direction decided by the caller | Budget vs actual |

### Forecast accuracy

Pairs where either value is missing are dropped first; inputs of different lengths raise `ValueError`
([metrics.py:171-176](../backend/app/services/metrics.py#L171-L176)).

| Function | Formula | Edge cases | Used by |
|---|---|---|---|
| `mae` [L179](../backend/app/services/metrics.py#L179) | mean \|a - f\| | no pairs: `missing_data` | Forecast backtests ([engine.py:105-107](../backend/app/services/forecasting/engine.py#L105-L107)) |
| `rmse` [L186](../backend/app/services/metrics.py#L186) | sqrt(mean (a - f)^2) | no pairs: `missing_data` | Forecast backtests |
| `wape` [L193](../backend/app/services/metrics.py#L193) | sum \|a - f\| / sum \|a\| | all actuals 0: `zero_denominator` | Forecast backtests, model selection, reliability |
| `mape` [L204](../backend/app/services/metrics.py#L204) | mean \|(a - f) / a\| over non-zero actuals | zero actuals excluded and counted in `note`; none left: `zero_denominator` | Forecast backtests |
| `bias` [L215](../backend/app/services/metrics.py#L215) | mean(f - a) / mean(a); positive = over-forecast | mean(a) = 0: `zero_denominator` | Forecast backtests |
| `interval_coverage` [L226](../backend/app/services/metrics.py#L226) | share of actuals inside [lower, upper] | no rows: `missing_data` | Tests only; the engine computes coverage itself ([FORECASTING.md](FORECASTING.md#5-metrics-selection-and-prediction-intervals)) |

### Metric definitions shown in the UI

`METRIC_DEFINITIONS` ([metrics.py:237-297](../backend/app/services/metrics.py#L237-L297)) is served by
`GET /orgs/{org_id}/analytics/metric-definitions`, embedded in `/dashboard/filters`, and attached to every dashboard KPI
as `definition` ([dashboard.py:47-59](../backend/app/services/analytics/dashboard.py#L47-L59)).

| Key | Unit | Direction | Stated formula | How the value is actually produced |
|---|---|---|---|---|
| `net_sales` | currency | up | Gross sales - discounts - refunds (taxes excluded) | Sum of `agg_store_daily.net_amount` (system-of-record rows) |
| `gross_sales` | currency | up | units x list price | Sum of reported `gross_amount`; AUREX does not recompute it from list prices |
| `revenue_growth` | percent | up | (net sales - comparison) / \|comparison\| | `growth_rate` vs the same dates one year earlier |
| `cogs` | currency | down | (units sold - units refunded) x unit cost | Sum of reported `cost_amount` on lines where it is known |
| `gross_profit` | currency | up | Net sales (cost-covered) - COGS | Section 2 coverage rules |
| `gross_margin` | percent | up | Gross profit / cost-covered net sales | Section 2 |
| `operating_expenses` | currency | down | Expenses excl. depreciation, finance costs, income tax | Section 2, prorated by day |
| `ebitda` | currency | up | Gross profit - operating expenses | Section 2 |
| `net_profit` | currency | up | EBITDA - depreciation - finance costs - income tax | Section 2 |
| `net_margin` | percent | up | Net profit / net sales | Section 2 |
| `inventory_turnover` | ratio | up | COGS / average inventory at cost x 365 / days | Section 5 |
| `days_of_inventory` | days | down | Average inventory / COGS x days | Section 5 |
| `gmroi` | ratio | up | Gross profit / average inventory at cost x 365 / days (not reported without gross profit) | Section 5 |
| `operating_cash_flow` | currency | up | Sum of operating inflows - outflows | Section 6 (cash) |
| `cash_balance` | currency | up | Latest reported bank balance | Section 6 (cash) |
| `average_basket` | currency | up | Net sales / transactions | `average_basket` |
| `sales_per_labor_hour` | currency | up | Net sales / hours worked | Section 6 |
| `labor_cost_ratio` | percent | down | Labor cost / net sales | Section 6 |
| `revenue_per_sqft` | currency | up | Net sales / selling area x 365 / days | `revenue_per_sqft` |
| `forecast_wape` | percent | down | sum \|actual - forecast\| / sum \|actual\| | Backtest WAPE of the active company net-sales model |
| `business_health` | score | up | Weighted average of component scores (0-100) | Section 7 |

The `gross_sales` and `cogs` descriptions state how a source typically derives those amounts; AUREX stores and sums what
the source reports.

## 2. P&L construction

`compute_pnl(scope, start, end, data_end)` ([pnl.py:127-207](../backend/app/services/analytics/pnl.py#L127-L207)) builds a
P&L for any date range from stored data only.

**Inputs**
- Revenue, discounts, refunds, COGS, cost-covered net sales, units and transactions come from `agg_store_daily`, i.e.
  one system-of-record integration per store-day ([pnl.py:70-82](../backend/app/services/analytics/pnl.py#L70-L82)).
- Expenses are monthly ledger totals by category from the company's chosen expense integration, fetched for whole
  months that touch the range ([pnl.py:85-99](../backend/app/services/analytics/pnl.py#L85-L99)).

**Steps**

1. `end` is clipped to the latest sales date. No sales in the range: every figure stays empty and
   `expenses_complete=false` ([pnl.py:129-142](../backend/app/services/analytics/pnl.py#L129-L142)).
2. Sums: `gross_sales`, `net_sales`, `days_with_sales`, `cost_covered_net_sales`; `discounts`, `refunds`, `units`,
   `transactions` and `cogs` are `None` (not 0) when the source never reported them
   ([pnl.py:143-152](../backend/app/services/analytics/pnl.py#L143-L152)).
3. `cost_coverage = cost_covered_net_sales / net_sales` ([pnl.py:153-154](../backend/app/services/analytics/pnl.py#L153-L154)).
4. Gross profit ([pnl.py:160-177](../backend/app/services/analytics/pnl.py#L160-L177)); the measured margin is
   `(cost_covered_net_sales - cogs) / cost_covered_net_sales`:

| Cost coverage | Gross profit | Gross margin | Flag |
|---|---|---|---|
| >= 99.95% | covered net sales - COGS | measured margin | — |
| >= 90% (`MIN_COST_COVERAGE_FOR_ESTIMATE`, [pnl.py:28](../backend/app/services/analytics/pnl.py#L28)) and < 99.95% | covered GP + uncovered net sales x measured margin | measured margin | `gross_profit_estimated=true` + note giving the uncovered share |
| < 90% | `None` | `None` | note "Cost data covers only X% of sales" |
| No cost reported at all | `None` | `None` | note |

5. Expense allocation by day proration ([pnl.py:102-124](../backend/app/services/analytics/pnl.py#L102-L124)). For each
   (month, category) total, the month's *covered days* run from the 1st to `min(month end, data_end)`; the range receives
   `amount x overlap_days / covered_days`. A full month inside the range gets its whole amount; a range that cuts a month
   gets the day-proportional share; for the month containing `data_end` the amount is spread over the days that have
   data, which assumes that month's ledger amount is month-to-date.
6. Missing expense months ([pnl.py:184-189](../backend/app/services/analytics/pnl.py#L184-L189)): if any calendar month with
   sales in the range received no expense allocation, `expenses_complete=false`, the months are listed in
   `missing_expense_months`, and everything below gross profit stays `None` instead of overstating profit.
7. Operating expenses = sum of the eleven operating categories (all except `depreciation`, `finance_costs`,
   `income_tax`) ([facts.py:263-268](../backend/app/models/facts.py#L263-L268), [pnl.py:193-197](../backend/app/services/analytics/pnl.py#L193-L197)).
   When some expenses exist, absent depreciation, finance costs or tax count as 0; with no expense rows at all they are
   `None`.
8. When gross profit, operating expenses and complete expenses are all available
   ([pnl.py:198-206](../backend/app/services/analytics/pnl.py#L198-L206)):

| Line | Formula |
|---|---|
| EBITDA | gross profit - operating expenses |
| EBIT | EBITDA - depreciation |
| Profit before tax | EBIT - finance costs |
| Net profit | profit before tax - income tax |
| EBITDA margin, net margin | `margin(..., net_sales)` (on total net sales, not the cost-covered base) |

**Store views.** With any store filter or store-scoped membership, rows with `store_id IS NULL` (head office expenses,
company cash flows) are excluded, so "net profit" is store contribution after store depreciation and before head-office
costs; notes say so ([pnl.py:190-191](../backend/app/services/analytics/pnl.py#L190-L191), [pnl.py:205-206](../backend/app/services/analytics/pnl.py#L205-L206)).

**Monthly series.** `monthly_pnl_series` runs the same function per calendar month and flags partial months
([pnl.py:210-225](../backend/app/services/analytics/pnl.py#L210-L225)).

**Limitations**
- Income tax enters in the month the ledger books it; a source that books tax quarterly (as NovaMart does) shows tax only
  in those months.
- Day proration assumes costs accrue evenly within a month.
- The estimated gross profit assumes uncovered sales earn the covered margin; the 90% floor bounds that assumption.

## 3. Periods and like-for-like comparisons

`resolve_period(key, fy_start_month, data_end, start, end)` ([periods.py:103-159](../backend/app/services/periods.py#L103-L159))
anchors every period on `data_end`, the latest date in `agg_store_daily`, not on the wall clock. Fiscal years are named by
the calendar year in which they end (April 2025 - March 2026 is FY2026) ([periods.py:1-5](../backend/app/services/periods.py#L1-L5),
[periods.py:30-33](../backend/app/services/periods.py#L30-L33)).

| Key | Range |
|---|---|
| `last_30d` / `last_90d` | `data_end - 29` / `- 89` days through `data_end` |
| `mtd` | 1st of `data_end`'s month through `data_end` |
| `qtd` | Start of the fiscal quarter through `data_end` |
| `ytd` | Start of the fiscal year through `data_end` |
| `last_fy` | The previous complete fiscal year |
| `fy:<year>` | That fiscal year, capped at `data_end` (label "(to date)") |
| `last_12m` (default) | Twelve complete months ending with the last complete month of data |
| `custom` | `start`..`end`; requires `start <= end` |

- A range that ends before it starts raises `validation_error` ("no days with data"); an unknown key lists the allowed
  values ([periods.py:148-153](../backend/app/services/periods.py#L148-L153)). `fy:` must be followed by a year from 1900
  to 2200; anything else (`fy:abc`) is a 422 `validation_error` ([periods.py:134-137](../backend/app/services/periods.py#L134-L137)).
- Granularity for charts: up to 45 days daily, up to 200 days weekly, otherwise monthly
  ([periods.py:95-100](../backend/app/services/periods.py#L95-L100)).
- **Comparison period** = the same calendar dates one year earlier (`relativedelta(years=1)`)
  ([periods.py:154-155](../backend/app/services/periods.py#L154-L155)). Dates are not weekday-aligned, and a range containing
  29 February maps onto 28 February, so the two ranges can differ by one day. The dashboard trend shifts the prior-year
  series forward by one year to overlay it ([dashboard.py:62-94](../backend/app/services/analytics/dashboard.py#L62-L94)).
- **Revenue growth** on the dashboard compares total net sales; it is `missing_data` when the comparison range has no sales
  days ([dashboard.py:155](../backend/app/services/analytics/dashboard.py#L155)). Total growth includes new stores.
- **Comparable stores.** Store growth is reported only for stores whose `opened_on` is on or before the comparison start;
  other stores show `growth = null` and `comparable_store = false` ([operations.py:419-423](../backend/app/services/analytics/operations.py#L419-L423)).
- Fiscal calendars: `ensure_financial_periods` creates one row per fiscal month
  ([periods.py:60-76](../backend/app/services/periods.py#L60-L76)). It runs for fiscal years current year - 3 to + 2 whenever
  a company is created: at registration ([auth.py:311-314](../backend/app/services/auth.py#L311-L314)), through `POST /orgs`
  ([organizations.py:113](../backend/app/api/routes/organizations.py#L113)) and `POST /orgs/{org_id}/companies`
  ([organizations.py:377](../backend/app/api/routes/organizations.py#L377)), and in the demo seed. The dashboard's
  `fy:<year>` filter options are the fiscal years of these rows that overlap the data range
  ([routes/dashboard.py:43-75](../backend/app/api/routes/dashboard.py#L43-L75)), so data older than current year - 3 gets no
  `fy:` option although `fy:<year>` still resolves for it. Period resolution itself does not need the rows.

## 4. Revenue bridge

`revenue_bridge(A, B)` explains the change in net sales from base period A to current period B
([operations.py:570-620](../backend/app/services/analytics/operations.py#L570-L620)). Endpoint:
`GET /orgs/{org_id}/analytics/revenue-bridge` with explicit `base_*`/`current_*` dates, or by default the selected period
(`last_30d`) against the same dates a year earlier ([routes/analytics.py:138-151](../backend/app/api/routes/analytics.py#L138-L151)).
The advisor uses month vs previous month or vs the same month last year.

| Component | Definition |
|---|---|
| Total | Net sales from product-level system-of-record sales rows in A and B |
| By store | Exact per-store difference from `agg_store_daily`, with the percentage change in transactions and in average basket |
| By category | Exact per-category difference |
| Price / volume / mix | On products with units > 0 in both periods, using net price per unit p = net / units |
| New or discontinued | Total change - (volume + mix + price) |

With U = total units of the common products, avgP_A = sum(net_A) / U_A, and per-product u, p:

- volume = (U_B - U_A) x avgP_A
- mix = sum_i (u_B,i / U_B - u_A,i / U_A) x U_B x (p_A,i - avgP_A)
- price = sum_i (p_B,i - p_A,i) x u_B,i

Expanding the terms, volume + mix + price = sum_i (net_B,i - net_A,i) over the common products, so the decomposition is
exact for them; the remainder holds products sold in only one period and rows without units or product.

## 5. Inventory metrics and the stockout/overstock method

**Turnover, days of inventory and GMROI** ([operations.py:136-156](../backend/app/services/analytics/operations.py#L136-L156)):
average inventory is the mean, over snapshot dates in the period, of the total `inventory_value` of the chosen inventory
integration; COGS is the P&L COGS (known-cost lines) and GMROI uses the P&L gross profit, so GMROI is `missing_data`
whenever the P&L does not report gross profit (cost coverage below 90%)
([routes/analytics.py:88-89](../backend/app/api/routes/analytics.py#L88-L89), [dashboard.py:151](../backend/app/services/analytics/dashboard.py#L151)).
The mean is per snapshot date, not time-weighted: when a period mixes weekly and daily snapshots (NovaMart has weekly
history plus daily snapshots for the last 120 days) the daily part carries more weight. Without `finance:read` the
inventory endpoint removes only GMROI, which is derived from gross profit
([routes/analytics.py:91-92](../backend/app/api/routes/analytics.py#L91-L92)). Turnover and days of inventory stay as
inventory KPIs at cost; together with the average inventory value they still imply the period's COGS (average inventory
x days / days of inventory).

**Positions** ([operations.py:159-210](../backend/app/services/analytics/operations.py#L159-L210)): the latest snapshot per
store x product within 21 days of `data_end`, joined to

- demand = units sold in the last 28 days (system-of-record rows) / 28; no sales rows = 0;
- lead time = average (received - ordered) days of the chosen purchasing integration's purchase orders received in the
  last 90 days for the product's primary supplier, else the supplier's contracted lead time
  ([operations.py:188-196](../backend/app/services/analytics/operations.py#L188-L196)).

**Classification** ([operations.py:213-253](../backend/app/services/analytics/operations.py#L213-L253)):

| Quantity | Definition |
|---|---|
| days of cover | on hand / daily demand (infinite when demand is 0) |
| cover incl. on order | (on hand + on order) / daily demand |
| lead (L) | lead time, 7 days when unknown |
| `stocked_out` | on hand <= 0 |
| `high` | cover incl. on order < L |
| `medium` | cover incl. on order < L + max(2, 0.5 x L) |
| `low` | otherwise, or zero demand with stock (`no_demand_no_stock` when there is neither) |
| projected stockout date | `data_end` + days of cover, when under 120 days |
| overstock | days of cover > max(60, 2 x (L + 21)) and on hand > 0 |
| excess units / value | on hand - demand x (L + 21), at unit cost |

Stated limitations: demand during a stockout is understated because sales are capped by stock, and the 28-day demand
ignores upcoming seasonality.

**Recent out-of-stock rate** ([operations.py:256-273](../backend/app/services/analytics/operations.py#L256-L273)): out-of-stock
positions / all positions across the snapshot dates of the last 30 days; status `insufficient_granularity` when fewer than
90% of those days have snapshots.

**Suppliers** ([operations.py:281-323](../backend/app/services/analytics/operations.py#L281-L323)): lead time = received -
ordered for received, non-cancelled purchase orders; on time = received on or before the expected date; p90 lead time;
`alert` when the last 60 days' average lead time exceeds the earlier average by more than 40% with at least 5 recent
receipts.

## 6. Other operational measures

| Measure | Definition | Source |
|---|---|---|
| Store contribution | Store gross profit - store operating expenses (day-prorated); no head-office allocation; stores ranked by it. Gross profit follows the P&L coverage rule: exact at >= 99.95% cost coverage, uncovered sales valued at the store's measured margin from 90%, `null` below 90%; each row reports `cost_coverage` and `contribution_estimated` | [operations.py:384-437](../backend/app/services/analytics/operations.py#L384-L437), [operations.py:406-415](../backend/app/services/analytics/operations.py#L406-L415) |
| Store sales per labor hour | Store net sales / hours of the store's monthly workforce rows from the 1st of the start month | same |
| Monthly sales and transactions per labor hour, labor cost % | Store net sales, transactions and store payroll divided by store hours or store net sales; head-office rows excluded | [operations.py:347-381](../backend/app/services/analytics/operations.py#L347-L381) |
| Overtime share, attrition | overtime / hours; separations / headcount per month | same |
| Expense anomaly | A month at least 3 standard deviations from the trailing 12-month mean of the same store and category (needs 6 months of history), more than 15% from that mean, and more than 15% from the same month last year; the month in progress and income tax are not tested | [operations.py:445-493](../backend/app/services/analytics/operations.py#L445-L493) |
| Budget vs actual | Per month and metric, actuals from the P&L; a month in progress compares actuals to date with the budget x elapsed days / days in month; versions are never summed: the requested `version`, or per month the most recently imported version (`max(ingested_at)`, then name), listed in `versions_used` and `version_note`; `favourable` = variance <= 0 for `cogs` and `opex:*`, >= 0 otherwise | [operations.py:496-562](../backend/app/services/analytics/operations.py#L496-L562) |
| Operating cash flow, cash balance, cash months | Sum of operating cash-flow entries for every month touched by the period (whole months); latest balance on or before the period end; months of cover = balance / average monthly operating outflow. Not available at store scope | [dashboard.py:97-127](../backend/app/services/analytics/dashboard.py#L97-L127) |

Workforce ratios are computed inline with pandas (`x / y.replace(0, NaN)`), as the module docstring of section 1 states;
a zero denominator still yields `null`. A store's `gross_margin` is its measured margin on cost-covered sales at any
coverage, so read it together with `cost_coverage`. The budget `cogs` actual is net sales minus the P&L gross profit,
so it includes the cost estimate for uncosted sales and is consistent with the `gross_profit` actual; when the P&L reports
no gross profit (cost coverage below 90%) the `cogs` actual is unavailable as well
([operations.py:543-547](../backend/app/services/analytics/operations.py#L543-L547)). The dashboard
trend's `gross_profit` is the covered gross profit per bucket, without the estimate
([dashboard.py:75](../backend/app/services/analytics/dashboard.py#L75)).

## 7. Business health score

`health_score(...)` ([health.py:31-63](../backend/app/services/analytics/health.py#L31-L63)) is a 0-100 heuristic composite.

| Component | Weight | Input | Score mapping (clipped to 0..1, x 100) |
|---|---|---|---|
| growth | 0.25 | revenue growth vs same period last year | (g + 0.10) / 0.30: -10% gives 0, +20% gives 100 |
| profitability | 0.30 | EBITDA margin | m / 0.12: 0% gives 0, 12% gives 100 |
| liquidity | 0.20 | months of operating outflow covered by cash | c / 3: 3 months or more gives 100 |
| inventory | 0.15 | annualized turnover t, out-of-stock rate r | ((t - 2) / 10) x (1 - min(5r, 0.5)): 2x gives 0, 12x gives 100 |
| data_quality | 0.10 | cost coverage, age of the latest sales date | coverage x freshness; freshness = 1 up to 3 days old, then 1 - (age - 3) / 30, floor 0.4 |

Sources: [health.py:18](../backend/app/services/analytics/health.py#L18), [health.py:35-49](../backend/app/services/analytics/health.py#L35-L49).

- Components without input are excluded and the remaining weights are renormalized; `effective_weight` and
  `excluded_components` are returned ([health.py:50-63](../backend/app/services/analytics/health.py#L50-L63)).
- Grade: `strong` >= 75, `stable` >= 55, `watch` >= 35, otherwise `at_risk` ([health.py:54](../backend/app/services/analytics/health.py#L54)).
- On the executive dashboard the score is computed only for members with `finance:read`; data age uses
  `date.today() - data_end`, so a static dataset loses freshness as calendar time passes
  ([dashboard.py:194-201](../backend/app/services/analytics/dashboard.py#L194-L201)).
- In benchmarking, public companies are scored without liquidity and data quality (not derivable from filings), and the own
  company without liquidity, so the scores are not directly comparable ([intelligence.py](../backend/app/services/intelligence.py) `own_company_metrics`, `public_company_metrics`).
- Returned limitations ([health.py:19-24](../backend/app/services/analytics/health.py#L19-L24)): thresholds are generic retail
  heuristics, not statistically fitted to outcomes; not a credit rating, valuation or failure forecast; growth includes new
  stores.
