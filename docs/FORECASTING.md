# AUREX forecasting

AUREX trains one model per series (target x level x key), chooses it by rolling-origin backtests against simple
baselines, derives prediction intervals from the backtest errors, labels its reliability and stores everything as an
immutable version. Code: [services/forecasting](../backend/app/services/forecasting) and
[api/routes/forecasting.py](../backend/app/api/routes/forecasting.py).

```
series.py (training series from stored data) -> models.py (candidates) -> engine.py (backtests, selection,
intervals, reliability) -> service.py (versioned storage, default plan, Decision Lab baseline)
```

## 1. Targets

`TARGETS` ([service.py:48-54](../backend/app/services/forecasting/service.py#L48-L54)):

| Target | Frequency | Horizon | Evaluation horizon | Folds | Levels | Training series |
|---|---|---|---|---|---|---|
| `net_sales` | D (daily) | 365 | 91 | 4 | company, store | Sum of `agg_store_daily.net_amount` per day; store level adds a store-age covariate ([series.py:62-75](../backend/app/services/forecasting/series.py#L62-L75)) |
| `transactions` | D | 182 | 91 | 3 | company, store | Sum of `agg_store_daily.transaction_count` per day ([series.py:78-79](../backend/app/services/forecasting/series.py#L78-L79)) |
| `units` | W (weekly) | 26 | 13 | 3 | category | Weekly units of system-of-record sales lines for the category; current partial week and first (possibly partial) week dropped; weeks without sales = 0 ([series.py:82-102](../backend/app/services/forecasting/series.py#L82-L102)) |
| `operating_expenses` | M (monthly) | 12 | 6 | 2 | company | Monthly operating-category expenses from the chosen expense integration; current month dropped unless `data_end` is a month end ([series.py:105-119](../backend/app/services/forecasting/series.py#L105-L119)) |
| `inventory_value` | W | 26 | 13 | 3 | company | Sunday inventory value at cost from the chosen inventory integration, labelled by the week's Monday; only interior gaps of at most two consecutive weeks are interpolated, every week of a longer gap is dropped ([series.py:122-137](../backend/app/services/forecasting/series.py#L122-L137)) |

- A level not listed for the target raises 404; fewer than 24 periods raise 422 `insufficient_data`
  ([service.py:95-101](../backend/app/services/forecasting/service.py#L95-L101)).
- Daily series are reindexed to every calendar day. Only interior gaps of at most three consecutive missing days are
  interpolated (linear, `limit_area="inside"`); every day of a longer gap is dropped, never partly filled, and the note in
  the model's limitations counts the missing and the dropped days ([series.py:33-59](../backend/app/services/forecasting/series.py#L33-L59),
  [series.py:49-58](../backend/app/services/forecasting/series.py#L49-L58)).
- `MIN_HISTORY` recommends at least 180 daily, 52 weekly or 18 monthly observations; shorter series get a limitation
  ([engine.py:29](../backend/app/services/forecasting/engine.py#L29), [engine.py:122-123](../backend/app/services/forecasting/engine.py#L122-L123)).
  If more than 20% of periods are zero, an intermittent-demand limitation is added ([engine.py:124-126](../backend/app/services/forecasting/engine.py#L124-L126)).

## 2. Candidate models

All candidates implement `fit(history)` / `predict(future_index)`; `candidate_models(ctx, n)` decides which are tried
([models.py:241-254](../backend/app/services/forecasting/models.py#L241-L254)).

| Name | Family | Description | Included when |
|---|---|---|---|
| `naive_last` | baseline | Repeats the last observed value ([models.py:53-59](../backend/app/services/forecasting/models.py#L53-L59)) | always |
| `seasonal_naive_weekly` | baseline | Repeats the last 7 days ([models.py:62-77](../backend/app/services/forecasting/models.py#L62-L77)) | daily |
| `moving_average` | baseline | Mean of the last 3 periods ([models.py:232-238](../backend/app/services/forecasting/models.py#L232-L238)) | monthly |
| `seasonal_naive_yearly` | baseline | Same period last year: 364 days (weekday-aligned), 52 weeks or 12 months back, stepping back further years as needed; mean of the last season when no such date exists ([models.py:80-104](../backend/app/services/forecasting/models.py#L80-L104)) | n > season lag |
| `holt_winters` | statistical | Exponential smoothing on `log1p(y)`: additive damped trend, additive seasonality with period 7 / 52 / 12 when n >= 2 x period + 2, estimated initialization ([models.py:107-139](../backend/app/services/forecasting/models.py#L107-L139)) | always |
| `ridge_regression` | machine_learning | Ridge (alpha 3) on standardized trend, Fourier terms, weekday/month dummies, event weights, last-year lag (+ missing-lag indicator), covariates; target `log1p(y)` ([models.py:192-229](../backend/app/services/forecasting/models.py#L192-L229)) | n >= 120 (D), 60 (W), 18 (M) |
| `gradient_boosting` | machine_learning | `HistGradientBoostingRegressor` (300 iterations, learning rate 0.05, 15 leaves, min leaf max(5, n/60), L2 1.0, weekday and month categorical, `random_state=42`); target `log1p(y)` ([models.py:172-189](../backend/app/services/forecasting/models.py#L172-L189)) | same as ridge |

Regression predictions are `expm1(...)` clipped at 0; final forecasts are clipped at 0
([models.py:160-163](../backend/app/services/forecasting/models.py#L160-L163), [engine.py:209](../backend/app/services/forecasting/engine.py#L209)).

## 3. Features and event calendar

`calendar_features(index, freq, events)` ([features.py:45-79](../backend/app/services/forecasting/features.py#L45-L79)):

| Feature | Definition |
|---|---|
| `trend` | Years since 2000-01-01 |
| `dow`, `dom`, `is_weekend`, `salary_week` | Daily only; `salary_week` = day of month <= 7 |
| `sin1..3`, `cos1..3` | Annual Fourier terms of day of year (weekly: day of year + 3; monthly: month midpoint) |
| `month` | Calendar month |
| `evt_<name>` | Event window weight: rises linearly to 1 on the event day over `before` days, falls over `after` days; weekly/monthly series use the mean daily weight |
| `lag_season` | Value from 364 days / 52 weeks / 12 months earlier, looked up in the training history only ([features.py:86-94](../backend/app/services/forecasting/features.py#L86-L94)) |
| `store_age_log` | `log1p(months since opening)`, store-level net sales only ([series.py:67-74](../backend/app/services/forecasting/series.py#L67-L74)) |

**Event calendar** ([features.py:17-31](../backend/app/services/forecasting/features.py#L17-L31)): for companies with
`country = "IN"`, Diwali and Ganesh Chaturthi dates for 2021-2028 (described in the code as approximate public dates);
windows are 20 days before / 2 after Diwali and 7 before / 3 after Ganesh. `company.settings["events"]` (name to ISO dates)
replaces the built-in calendar; other countries get no events. The Decision Lab calibration controls for the same
calendar, override included, with its own weekly weight: triangular, measured from mid-week, falling to zero 21 days either
side of each event ([calibration.py:87-95](../backend/app/services/simulation/calibration.py#L87-L95)).

## 4. Rolling-origin backtesting and leakage prevention

`evaluate_and_forecast(series, freq, horizon, folds, eval_horizon, ctx)`
([engine.py:115-247](../backend/app/services/forecasting/engine.py#L115-L247)):

1. `eval_h = min(eval_horizon or horizon, max(1, n // 4))` ([engine.py:120](../backend/app/services/forecasting/engine.py#L120)).
2. `max_folds = max(1, min(folds, (n - MIN_HISTORY // 2) // eval_h))`; cutoffs at `n - eval_h x k` for `k = max_folds..1`,
   keeping only cutoffs >= `max(12, MIN_HISTORY // 2)`; if none remain, a single cutoff at `n - eval_h` with the limitation
   "History supports a single short backtest only" ([engine.py:128-133](../backend/app/services/forecasting/engine.py#L128-L133)).
   The test windows are consecutive, non-overlapping blocks of `eval_h` periods ending at the last observation.
3. For every candidate and cutoff a fresh, unfitted copy is fitted on `series[:cut]` and scored on the next `eval_h`
   periods ([engine.py:140-161](../backend/app/services/forecasting/engine.py#L140-L161), [engine.py:250-256](../backend/app/services/forecasting/engine.py#L250-L256)).
   A candidate that raises in any fold is recorded as failed and excluded.

Leakage controls in the code:
- Each fold's model sees only observations before its cutoff; no shuffling.
- Preprocessing is fitted on the training window: ridge standardization and the missing-lag fill value are computed in
  `_prep(fit=True)` and reused at prediction ([models.py:196-217](../backend/app/services/forecasting/models.py#L196-L217)).
- `lag_season` is read from the fitted history; dates whose lag falls outside it get NaN, never a value from the test window.
- Calendar, event and store-age features are known in advance for any date.
- Weekly and monthly series drop the incomplete trailing period, so no model is trained on partial totals.

## 5. Metrics, selection and prediction intervals

**Metrics.** Each fold is scored with MAE, RMSE, WAPE, MAPE (zero actuals excluded) and bias from
[metrics.py](../backend/app/services/metrics.py) ([engine.py:105-107](../backend/app/services/forecasting/engine.py#L105-L107));
a candidate's metric is the mean over its folds. Formulas are in [METRICS.md](METRICS.md#forecast-accuracy).

**Selection** ([engine.py:176-184](../backend/app/services/forecasting/engine.py#L176-L184)):
- winner = lowest mean WAPE rounded to 4 decimals; ties go to the simpler family (baseline < statistical < machine_learning);
- best baseline = the baseline (`naive_last`, `seasonal_naive_weekly`, `seasonal_naive_yearly`, `moving_average`) with the
  lowest WAPE ([models.py:257](../backend/app/services/forecasting/models.py#L257));
- `skill_vs_baseline = 1 - WAPE_winner / WAPE_best_baseline` (`None` if undefined);
- when a baseline wins, the limitation "A simple baseline performed best" is added.

**Prediction intervals** ([engine.py:186-222](../backend/app/services/forecasting/engine.py#L186-L222)):
- relative errors `(actual - pred) / pred` of the selected model on every backtest step (predictions with
  `|pred| <= 1e-9` skipped);
- horizon buckets with edges `{0, max(1, eval_h // 4), max(2, eval_h // 2), eval_h}`; per bucket the 2.5%, 10%, 90% and
  97.5% quantiles; a bucket with fewer than 8 errors uses all errors pooled ([engine.py:110-112](../backend/app/services/forecasting/engine.py#L110-L112),
  [engine.py:189-193](../backend/app/services/forecasting/engine.py#L189-L193));
- for forecast step s: `lower_80 = max(0, yhat x (1 + q10 x w))`, `upper_80 = yhat x (1 + q90 x w)`, and the same with q2.5 /
  q97.5 for the 95% band; `w = 1` within the evaluated horizon and `sqrt((s + 1) / eval_h)` beyond it, using the last bucket's
  quantiles (limitation added when `horizon > eval_h`);
- `coverage_80` = share of backtest errors that fall inside their bucket's [q10, q90]. It is measured on the same errors
  that set the quantiles, which the code discloses as a limitation ([engine.py:195-203](../backend/app/services/forecasting/engine.py#L195-L203)).
  It is stored in `metrics.coverage_80`; the per-fold `forecast_backtests.coverage_80` column is reserved and not populated
  ([DATA_MODEL.md](DATA_MODEL.md#reserved-schema-declared-not-populated)).

**Monthly error quantiles** for daily models ([service.py:72-90](../backend/app/services/forecasting/service.py#L72-L90)): monthly
totals of the out-of-sample fold predictions in months with at least 25 observed days give relative errors
`(actual - pred) / pred`; with at least 4 such months the 2.5/10/50/90/97.5% quantiles are stored as
`metrics.monthly_relative_error_quantiles`. The Decision Lab uses them for baseline revenue uncertainty.

## 6. Reliability verdict

Exact rules ([engine.py:224-232](../backend/app/services/forecasting/engine.py#L224-L232)), with WAPE the winner's mean
backtest WAPE and `n` the number of observations:

| Verdict | Condition |
|---|---|
| `reliable` | WAPE <= 0.10 **and** (skill >= 0.10 **or** the winner is itself a baseline) **and** 0.70 <= coverage_80 <= 0.95 **and** n >= `MIN_HISTORY[freq]` |
| `use_with_caution` | not reliable, WAPE <= 0.25 **and** (skill is `None` **or** skill >= 0) |
| `unreliable` | otherwise |

A missing WAPE is treated as 1.0 before these tests; a WAPE of exactly 0 stays 0. The engine docstring and the
methodology text returned by `GET /forecasts` state the same rules, including the baseline-winner exception and the
history condition ([engine.py:8-12](../backend/app/services/forecasting/engine.py#L8-L12),
[routes/forecasting.py:72-74](../backend/app/api/routes/forecasting.py#L72-L74)). Short history only rules out `reliable`; it
does not force `unreliable`.

## 7. Versioning and storage

`train_target` ([service.py:93-146](../backend/app/services/forecasting/service.py#L93-L146)):

- `version` = highest existing version + 1 for (company, target, level, level_key, frequency); all earlier versions of that
  series are set `is_active = false` first, so exactly one version is active ([service.py:106-111](../backend/app/services/forecasting/service.py#L106-L111)).
- The `forecast_models` row stores the algorithm, the final model's parameters (`hyperparameters`), every candidate's
  summary, metrics and baseline metrics, skill, reliability, training window, `n_observations`, `data_fingerprint`,
  `random_seed = 42`, `code_version = ENGINE_VERSION` (`"1.1.0"`, [engine.py:28](../backend/app/services/forecasting/engine.py#L28);
  per the code comment, 1.1.0 introduced interior-gap-only interpolation and keeps a WAPE of 0 as 0) and
  limitations (series notes, engine notes, and a synthetic-data note for synthetic companies).
- `data_fingerprint` = SHA-256 over `date:value` pairs with 4 decimals ([engine.py:92-94](../backend/app/services/forecasting/engine.py#L92-L94)):
  two versions with the same fingerprint were trained on identical data.
- The seed only affects `gradient_boosting`; the other candidates are deterministic.
- Per-fold scores go to `forecast_backtests`; the forecast itself to one `forecast_runs` row (`as_of` = last training date,
  `interval_method`) and one `forecast_points` row per step ([service.py:130-143](../backend/app/services/forecasting/service.py#L130-L143)).
- Fitted model objects are not saved (`artifact_path` is reserved and not populated), so a forecast changes only by
  training a new version.

## 8. Default plan and retraining

`default_plan(company)` ([service.py:149-155](../backend/app/services/forecasting/service.py#L149-L155)):

| Series | Count |
|---|---|
| `net_sales`, `transactions`, `operating_expenses`, `inventory_value` at company level | 4 |
| `net_sales` per store | one per store of the company |
| `units` per category | one per product category, ordered by code |

Store-level `transactions` is supported by `TARGETS` but not in the plan. `train_targets` trains each planned series
(optionally only the given target keys), commits after each, and records a failure without stopping the rest
([service.py:158-176](../backend/app/services/forecasting/service.py#L158-L176)).

How to retrain:
- **API:** `POST /api/v1/orgs/{org_id}/forecasts/train` with `{"company_id": "<optional>", "targets": ["net_sales", ...]}`
  (`forecasts:run`). It enqueues a `train_forecasts` background job and returns `{"job_id", "status": "queued"}`, or the
  existing job with `"already_running"`; store-scoped members get 403 ([routes/forecasting.py:82-101](../backend/app/api/routes/forecasting.py#L82-L101)).
  Poll `GET /api/v1/orgs/{org_id}/jobs/{job_id}`.
- **Seed:** `python -m app.seed.demo --train` trains the full default plan after seeding ([demo.py:265-278](../backend/app/seed/demo.py#L265-L278));
  the docker-compose `seed` service passes `--train`.
- The test fixture trains only company and S04 net sales ([conftest.py:71-76](../backend/tests/conftest.py#L71-L76)).

Nothing retrains automatically when new data arrives; the dashboard's `forecast_wape` KPI reports the active company
net-sales model's backtest WAPE and its training date.

## 9. API endpoints

| Method and path | Permission | Returns |
|---|---|---|
| `GET /orgs/{org_id}/forecasts?company_id=` | `forecasts:read` | Active models (store-scoped members see only their stores' store-level models), target catalogue, last 5 training jobs, methodology text ([routes/forecasting.py:45-74](../backend/app/api/routes/forecasting.py#L45-L74)) |
| `POST /orgs/{org_id}/forecasts/train` | `forecasts:run` | Training job (above) |
| `GET /orgs/{org_id}/jobs/{job_id}` | `org:read` | Background job status and result ([routes/forecasting.py:104-112](../backend/app/api/routes/forecasting.py#L104-L112)) |
| `GET /orgs/{org_id}/forecasts/models/{model_id}?history_periods=` (10-2000, default 180) | `forecasts:read` | Model, recent actuals (recomputed from current data), forecast points, backtests, all versions ([routes/forecasting.py:115-137](../backend/app/api/routes/forecasting.py#L115-L137)) |
| `GET /orgs/{org_id}/forecasts/active?target=&level=&key=&company_id=` | `forecasts:read` | Same for the active version of a series; 404 `not_trained` if none ([routes/forecasting.py:140-149](../backend/app/api/routes/forecasting.py#L140-L149)) |
| `GET /orgs/{org_id}/forecasts/baseline?company_id=&store_ids=&months=` (1-24) | `forecasts:read` + `finance:read` | Monthly P&L baseline for the Decision Lab ([routes/forecasting.py:152-157](../backend/app/api/routes/forecasting.py#L152-L157), [DECISION_LAB.md](DECISION_LAB.md#2-baseline)) |

## 10. Limitations

- Models are univariate apart from calendar, events and store age; prices, promotions, marketing and stock levels are not
  regressors. Stockouts cap the observed sales the models learn from.
- The only store-related covariate is store age, for store-level net sales; known-in-advance features are calendar,
  festival calendar and store age ([features.py:1-6](../backend/app/services/forecasting/features.py#L1-L6)). Company-level
  series have no store-count feature, so store openings appear to their models as level shifts.
- Interval coverage is in-sample; intervals beyond the evaluated horizon rely on the square-root rule.
- The `net_sales` horizon (365 days) exceeds the daily season lag (364 days), so the last forecast day has no `lag_season`.
- Months without any expense rows remain gaps in the monthly operating-expense series (`asfreq("MS")`, not interpolated).
- The event calendar covers only Diwali and Ganesh Chaturthi (2021-2028) unless overridden per company.
- Forecasts are not refreshed between trainings, and fitted models are not persisted.
- Units are forecast per category only; there are no product-level models.
