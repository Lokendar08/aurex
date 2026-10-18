/**
 * Decision Lab response shapes (backend/app/api/routes/decision_lab.py and
 * backend/app/services/simulation/*). Money is in the scope currency; ratios and percentage
 * changes are fractions (0.05 = 5%). Keys the backend can omit (redaction for members without
 * finance:read, levers without a detail block) are optional.
 */

export type LeverType =
  | "workforce"
  | "price"
  | "marketing"
  | "supplier_cost"
  | "inventory"
  | "new_store"
  | "opex"
  | "retention"
  | "product_mix";

export type CatalogLever = { type: LeverType; label: string; description: string };

export type DecisionCatalog = { levers: CatalogLever[]; engine_version: string; principles: string[] };

export type Estimate = {
  name: string;
  value: number | null;
  std_error: number | null;
  ci_low: number | null;
  ci_high: number | null;
  p_value: number | null;
  n: number | null;
  identified: boolean;
  method: string;
  notes?: string[];
};

export type EvidenceCategory = { code: string; name: string; share: number | null; gross_margin: number | null };

export type DecisionEvidence = {
  data_end: string;
  window: [string, string] | string[];
  categories: EvidenceCategory[];
  elasticities: Record<string, Estimate>;
  marketing: {
    estimate?: Estimate | null;
    adstock_decay?: number | null;
    monthly_spend?: number | null;
    spend_share_of_sales?: number | null;
  } | null;
  workforce: {
    available: boolean;
    as_of_month?: string | null;
    headcount?: number | null;
    monthly_cost_per_employee?: number | null;
    monthly_hours_per_employee?: number | null;
    monthly_labor_cost?: number | null;
    current_transactions_per_labor_hour?: number | null;
    historical_p90_transactions_per_labor_hour?: number | null;
    capacity_utilization?: number | null;
    capacity_constrained?: boolean | null;
    labor_elasticity?: Estimate | null;
    method?: string;
    note?: string;
  } | null;
  new_store: {
    available: boolean;
    new_stores_observed?: number;
    mature_sales_per_sqft_day?: number | null;
    mature_sales_per_sqft_day_sd?: number | null;
    median_selling_area_sqft?: number | null;
    capex_per_sqft?: number | null;
    capex_observations?: number;
    capex_method?: string;
    ramp?: { level: number; gap: number; tau_months: number; identified: boolean; method: string } | null;
    note?: string;
  } | null;
  store_costs: {
    available: boolean;
    stores?: number;
    rent_per_sqft_month?: number | null;
    utilities_per_sqft_month?: number | null;
    fixed_other_per_store_month?: number | null;
    depreciation_per_store_month?: number | null;
    payroll_per_store_month?: number | null;
  } | null;
  customers: {
    available: boolean;
    monthly_active_customers?: number | null;
    retention_rate?: number | null;
    monthly_spend_per_active_customer?: number | null;
    method?: string;
    note?: string;
  } | null;
};

export type PnlMonth = {
  month: string;
  net_sales: number | null;
  cogs: number | null;
  gross_profit: number | null;
  operating_expenses: number | null;
  ebitda: number | null;
  depreciation: number | null;
  finance_costs: number | null;
  profit_before_tax: number | null;
  income_tax: number | null;
  net_profit: number | null;
  working_capital_change: number | null;
  operating_cash_flow: number | null;
  capex: number | null;
  free_cash_flow: number | null;
};

export type PnlTotals = Omit<PnlMonth, "month"> & {
  gross_margin: number | null;
  net_margin: number | null;
  ebitda_margin: number | null;
};

export type RevenueSource = {
  model_id: string | null;
  algorithm: string | null;
  version: number | null;
  reliability: string | null;
  wape_daily: number | null;
};

export type LeverEvidenceItem = Record<string, unknown> & { name: string };

export type LeverAssumption = { name: string; value: unknown; source: string; note?: string | null };

export type LeverResult = {
  index: number;
  type: LeverType;
  label: string;
  summary: string;
  evidence: LeverEvidenceItem[];
  assumptions: LeverAssumption[];
  warnings: string[];
  revenue_effect_note?: string | null;
  insights?: string[];
  capacity?: Record<string, number | boolean | null>;
  inventory?: Record<string, number | null>;
  new_store?: Record<string, number | null>;
  [key: string]: unknown;
};

export type Quantiles = { p10: number | null; p50: number | null; p90: number | null; mean?: number | null };

export type Investment = {
  investment: number | null;
  capex: number | null;
  working_capital: number | null;
  roi: number | null;
  roi_note: string | null;
  payback_months: number | null;
  payback_note: string | null;
  npv: number | null;
  discount_rate_annual: number | null;
  cumulative_free_cash_flow: (number | null)[];
};

export type SensitivityRow = {
  parameter: string;
  low_case: number | null;
  high_case: number | null;
  base: number | null;
  swing: number | null;
};

export type SimulationResult = {
  engine_version: string;
  horizon_months: number;
  months: string[];
  baseline?: {
    monthly: PnlMonth[];
    totals: PnlTotals;
    revenue_source: RevenueSource | null;
    notes: string[];
    as_of: string | null;
    trailing_window: { start: string; end: string } | null;
  };
  scenario?: { monthly: PnlMonth[]; totals: PnlTotals };
  delta: { monthly: PnlMonth[]; totals: PnlTotals; gross_margin_pp: number | null; net_margin_pp: number | null };
  investment: Investment;
  levers: LeverResult[];
  assumptions: { lever: string; name: string; value: unknown; source: string; note?: string | null }[];
  warnings: string[];
  evidence_summary: {
    baseline_revenue_model?: RevenueSource | null;
    trailing_window?: { start: string; end: string } | null;
    [key: string]: unknown;
  } | null;
  uncertainty: {
    runs: number;
    seed: number;
    net_profit_delta: Quantiles;
    net_sales_delta: Quantiles;
    free_cash_flow_delta: Quantiles;
    probability_net_profit_positive: number | null;
    roi: Quantiles | null;
    method: string;
  } | null;
  sensitivity: SensitivityRow[];
  downside: {
    net_profit_delta: number | null;
    net_sales_delta: number | null;
    free_cash_flow_delta: number | null;
    definition: string;
  } | null;
  scope: { company_id: string; store_ids: string[] | null; currency: string; is_synthetic: boolean };
  inputs_hash: string;
  /** Present when absolute baseline / scenario P&L were removed for a member without finance access. */
  redacted?: string;
};

/** The request body of POST /decision-lab/simulate (and the base of a saved scenario). */
export type SimulateBody = {
  company_id?: string;
  store_ids?: string[];
  horizon_months: number;
  levers: Record<string, unknown>[];
  monte_carlo_runs: number;
  discount_rate: number;
  seed: number;
};

export type ScenarioRunSummary = {
  id: string;
  computed_at: string;
  engine_version: string;
  scenario_version: number;
  inputs_hash: string;
  summary: {
    delta: Partial<PnlTotals> | null;
    investment: { investment: number | null; roi: number | null; payback_months: number | null; npv: number | null };
    uncertainty: Quantiles | null;
    probability_net_profit_positive: number | null;
    warnings: number;
  };
};

export type SavedScenario = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  company_id: string;
  store_ids: string[] | null;
  horizon_months: number;
  levers: Record<string, unknown>[];
  assumptions: { monte_carlo_runs?: number; discount_rate?: number; seed?: number } | null;
  tags: string[];
  version: number;
  created_at: string | null;
  updated_at: string | null;
  created_by: string | null;
  latest_run?: ScenarioRunSummary;
};

export type ScenarioDetail = SavedScenario & {
  result?: SimulationResult;
  run_history?: {
    id: string;
    computed_at: string;
    scenario_version: number;
    engine_version: string;
    inputs_hash: string;
    net_profit_delta: number | null;
  }[];
};

export type ScenarioComparisonRow = {
  scenario_id: string;
  name: string;
  version: number;
  computed_at: string;
  levers: string[];
  delta: {
    net_sales: number | null;
    gross_profit: number | null;
    operating_expenses: number | null;
    ebitda: number | null;
    net_profit: number | null;
    free_cash_flow: number | null;
  };
  net_margin_pp: number | null;
  investment: number | null;
  roi: number | null;
  payback_months: number | null;
  npv: number | null;
  net_profit_p10: number | null;
  net_profit_p50: number | null;
  net_profit_p90: number | null;
  probability_profit_positive: number | null;
  warnings: string[];
  horizon_months: number | null;
};

export type ScenarioComparison = {
  scenarios: ScenarioComparisonRow[];
  best_risk_adjusted: string | null;
  ranking_basis: string;
  notes: string[];
};

export type OptimizeObjective =
  | "net_profit"
  | "ebitda"
  | "net_sales"
  | "free_cash_flow"
  | "gross_profit"
  | "risk_adjusted_net_profit";

export type OptimizeConstraintMetric =
  | "net_sales"
  | "gross_profit"
  | "gross_margin"
  | "net_margin"
  | "ebitda"
  | "net_profit"
  | "free_cash_flow"
  | "investment";

export type OptimizeConstraint = {
  metric: OptimizeConstraintMetric;
  basis: "scenario_total" | "delta_total";
  op: ">=" | "<=";
  value: number;
};

export type OptimizePoint = {
  values: Record<string, number>;
  objective: number | null;
  feasible: boolean;
  constraints: { metric: string; basis: string; op: string; limit: number; value: number | null; ok: boolean }[];
  delta: Record<string, number | null>;
  p10_net_profit?: number;
};

export type OptimizeResult = {
  status: "ok" | "infeasible";
  objective?: OptimizeObjective;
  evaluations: number;
  skipped_combinations?: number;
  best: OptimizePoint | null;
  best_levers?: Record<string, unknown>[];
  points: OptimizePoint[];
  method?: string;
  caveat?: string;
  message?: string;
};
