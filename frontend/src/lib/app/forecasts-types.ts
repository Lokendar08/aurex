/**
 * Forecasting response shapes (backend/app/api/routes/forecasting.py). Errors and ratios are
 * fractions (WAPE 0.0376 = 3.8%); skill_vs_baseline is 1 − WAPE ÷ baseline WAPE.
 */

export type ForecastUnit = "currency" | "count" | "units" | (string & {});
export type ForecastLevel = "company" | "store" | "category" | (string & {});
export type Frequency = "D" | "W" | "M";
export type Reliability = "reliable" | "use_with_caution" | "unreliable" | (string & {});

export type ForecastTarget = {
  key: string;
  label: string;
  unit: ForecastUnit;
  frequency: Frequency;
  horizon: number;
  evaluation_horizon: number;
  folds: number;
  levels: ForecastLevel[];
};

export type ErrorQuantiles = { n: number; q10: number; q50: number; q90: number; q025: number; q975: number };

export type ForecastMetrics = {
  mae: number | null;
  rmse: number | null;
  wape: number | null;
  mape: number | null;
  bias: number | null;
  folds: number | null;
  coverage_80: number | null;
  eval_horizon: number | null;
  monthly_relative_error_quantiles?: ErrorQuantiles | null;
};

export type ModelCandidate = {
  algorithm: string;
  family: string;
  description: string;
  mae: number | null;
  rmse: number | null;
  wape: number | null;
  mape: number | null;
  bias: number | null;
  folds: number | null;
  failed: string | null;
  fit_seconds: number | null;
};

export type ForecastModel = {
  id: string;
  target: string;
  target_label: string;
  unit: ForecastUnit;
  level: ForecastLevel;
  level_key: string;
  level_label: string;
  frequency: Frequency;
  version: number;
  algorithm: string;
  baseline_algorithm: string | null;
  metrics: ForecastMetrics;
  baseline_metrics: { mae: number | null; rmse: number | null; wape: number | null; algorithm: string | null } | null;
  skill_vs_baseline: number | null;
  reliability: Reliability;
  training_start: string | null;
  training_end: string | null;
  n_observations: number | null;
  data_fingerprint: string | null;
  code_version: string | null;
  random_seed: number | null;
  limitations: string[];
  hyperparameters: Record<string, unknown> | null;
  candidates: ModelCandidate[];
  is_active: boolean;
  created_at: string | null;
};

export type ForecastJob = {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed" | (string & {});
  created_at: string;
  finished_at: string | null;
  result: Record<string, unknown> | null;
  error: string | null;
};

export type Methodology = {
  validation: string;
  metrics: string;
  selection: string;
  intervals: string;
  reliability: string;
};

export type ForecastsResponse = {
  company_id: string;
  is_synthetic: boolean;
  targets: ForecastTarget[];
  models: ForecastModel[];
  recent_jobs: ForecastJob[];
  methodology: Methodology;
};

export type ForecastPoint = {
  period_start: string;
  yhat: number | null;
  lower_80: number | null;
  upper_80: number | null;
  lower_95: number | null;
  upper_95: number | null;
};

export type Backtest = {
  algorithm: string;
  fold: number;
  cutoff: string;
  horizon: number;
  mae: number | null;
  rmse: number | null;
  wape: number | null;
  mape: number | null;
  bias: number | null;
};

export type ModelVersion = {
  id: string;
  version: number;
  algorithm: string;
  wape: number | null;
  reliability: Reliability;
  training_end: string;
  data_fingerprint: string;
  is_active: boolean;
  created_at: string;
};

export type ForecastDetail = ForecastModel & {
  history: { period_start: string; actual: number | null }[];
  forecast: ForecastPoint[];
  backtests: Backtest[];
  versions: ModelVersion[];
};

export type BaselineMonth = {
  month: string;
  net_sales: number | null;
  cogs: number | null;
  gross_profit: number | null;
  variable_opex: number | null;
  fixed_opex: number | null;
  operating_expenses: number | null;
  ebitda: number | null;
  depreciation: number | null;
  finance_costs: number | null;
  profit_before_tax: number | null;
  income_tax: number | null;
  net_profit: number | null;
  operating_cash_flow: number | null;
  net_sales_p10: number | null;
  net_sales_p90: number | null;
  net_sales_p025: number | null;
  net_sales_p975: number | null;
};

export type BaselineResponse = {
  currency: string;
  is_synthetic: boolean;
  as_of: string | null;
  first_month: string | null;
  months: BaselineMonth[];
  revenue_source: {
    model_id: string | null;
    algorithm: string | null;
    version: number | null;
    reliability: Reliability | null;
    wape_daily: number | null;
  } | null;
  revenue_interval: ErrorQuantiles | null;
  assumptions: {
    gross_margin?: number | null;
    variable_cost_ratios?: Record<string, number>;
    fixed_costs_monthly?: Record<string, number>;
    effective_tax_rate?: number | null;
    trailing_window?: { start: string; end: string } | null;
    [key: string]: unknown;
  } | null;
  notes: string[];
};

export type BackgroundJobStatus = {
  id: string;
  job_type: string;
  status: "queued" | "running" | "succeeded" | "failed" | (string & {});
  result: Record<string, unknown> | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};
