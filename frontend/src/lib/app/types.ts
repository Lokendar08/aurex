/**
 * Response shapes of the AUREX API used by the authenticated app. They mirror
 * backend/app/api/routes/*.py and backend/app/services/analytics/*.py. Values that the backend can
 * leave out (missing data) are typed as nullable so components must handle them explicitly.
 */

// ---------------------------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------------------------

export type KpiStatus =
  | "ok"
  | "missing_data"
  | "zero_denominator"
  | "incomplete"
  | "not_available_at_store_scope"
  | "not_trained"
  | "not_permitted"
  | "not_meaningful"
  | "insufficient_history"
  | "insufficient_granularity"
  | (string & {});

export type KpiUnit = "currency" | "percent" | "ratio" | "score" | "days" | (string & {});

export type Kpi = {
  key: string;
  label: string;
  value: number | null;
  comparison: number | null;
  change: number | null;
  change_kind: "relative" | "absolute";
  unit: KpiUnit | null;
  currency: string | null;
  status: KpiStatus;
  note: string | null;
  estimated: boolean;
  direction: "up" | "down";
  definition: { formula: string | null; description: string | null };
  source: string | null;
};

export type MetricDefinition = {
  label: string;
  unit: string;
  direction: "up" | "down";
  formula: string;
  description: string;
};

export type ResolvedPeriod = {
  key: string;
  label: string;
  start: string;
  end: string;
  comparison_start?: string;
  comparison_end?: string;
  comparison_label?: string;
  granularity: "day" | "week" | "month";
  days?: number;
};

export type MetricResult = { value: number | null; status: string; note: string | null };

export type FreshnessSource = {
  integration_id: string;
  name: string;
  provider_key: string | null;
  is_demo: boolean;
  latest_date: string | null;
  records: number;
  last_ingested_at: string | null;
  last_successful_sync_at: string | null;
};

export type FreshnessEntry = {
  fact: string;
  status: "ok" | "no_data";
  latest_date: string | null;
  sources: FreshnessSource[];
  multiple_sources?: boolean;
};

// ---------------------------------------------------------------------------------------------
// Filters & dashboard
// ---------------------------------------------------------------------------------------------

export type FilterCompany = {
  id: string;
  name: string;
  currency: string;
  is_synthetic: boolean;
  fiscal_year_start_month: number;
};

export type FilterStore = { id: string; code: string; name: string; city: string | null; opened_on: string | null };

export type FiltersResponse = {
  companies: FilterCompany[];
  company_id: string | null;
  stores: FilterStore[];
  store_scoped: boolean;
  data_start: string | null;
  data_end: string | null;
  periods: { key: string; label: string }[];
  metric_definitions: Record<string, MetricDefinition>;
};

export type SeriesPoint = {
  period: string;
  net_sales: number;
  gross_profit?: number | null;
  transactions: number | null;
  comparison_net_sales: number | null;
};

export type StoreRow = {
  store_id: string;
  code: string;
  name: string;
  city: string | null;
  opened_on: string | null;
  net_sales: number | null;
  growth: number | null;
  comparable_store: boolean;
  gross_margin?: number | null;
  store_contribution?: number | null;
  store_contribution_margin?: number | null;
  sales_per_sqft_annualized: number | null;
  sales_per_labor_hour: number | null;
  transactions: number | null;
  average_basket: number | null;
  contribution_rank?: number;
};

export type CategoryRow = {
  category_code: string | null;
  category: string;
  net_sales: number | null;
  units: number | null;
  share: number | null;
  gross_margin?: number | null;
  growth: number | null;
};

export type PnL = {
  start: string;
  end: string;
  gross_sales: number;
  discounts: number | null;
  refunds: number | null;
  net_sales: number;
  cogs: number | null;
  cost_covered_net_sales: number;
  cost_coverage: number | null;
  units: number | null;
  transactions: number | null;
  days_with_sales: number;
  gross_profit: number | null;
  gross_margin: number | null;
  gross_profit_estimated: boolean;
  expenses_by_category: Record<string, number>;
  operating_expenses: number | null;
  depreciation: number | null;
  finance_costs: number | null;
  income_tax: number | null;
  ebitda: number | null;
  ebit: number | null;
  profit_before_tax: number | null;
  net_profit: number | null;
  ebitda_margin: number | null;
  net_margin: number | null;
  expenses_complete: boolean;
  missing_expense_months: string[];
  company_level_included: boolean;
  notes: string[];
};

export type InventoryOverview = {
  status: string;
  note?: string;
  average_inventory_value?: number;
  latest_inventory_value?: number;
  latest_snapshot_date?: string;
  snapshots_used?: number;
  snapshot_cadence?: string;
  inventory_turnover?: MetricResult;
  days_of_inventory?: MetricResult;
  gmroi?: MetricResult;
  latest_stockout_items?: number;
  latest_items?: number;
  series: { date: string; value: number }[];
};

export type StockoutRecent = {
  status: string;
  days_observed?: number;
  out_of_stock_rate?: number;
  note?: string | null;
  series?: { date: string; rate: number }[];
};

export type CashSummary = {
  status: string;
  operating_cash_flow?: number | null;
  investing_cash_flow?: number | null;
  financing_cash_flow?: number | null;
  cash_balance?: number | null;
  cash_balance_as_of?: string | null;
  avg_monthly_operating_outflow?: number | null;
  cash_months?: number | null;
  note?: string | null;
};

export type HealthComponent = {
  key: string;
  weight: number;
  effective_weight: number;
  raw: number;
  raw_label: string;
  score: number;
  out_of_stock_rate?: number | null;
  data_age_days?: number | null;
};

export type HealthScore = {
  score: number | null;
  grade?: "strong" | "stable" | "watch" | "at_risk";
  status: string;
  components: HealthComponent[];
  excluded_components?: string[];
  limitations: string[];
};

export type ForecastAccuracy = {
  model_id: string;
  algorithm: string;
  version: number | string;
  wape: number | null;
  baseline_wape: number | null;
  skill_vs_baseline: number | null;
  reliability: string;
  trained_through: string;
  frequency: string;
};

export type ExecutiveDashboard = {
  company: FilterCompany;
  synthetic_notice: string | null;
  scope: { store_ids: string[] | null; member_store_scoped: boolean; company_level_included: boolean };
  period: ResolvedPeriod;
  data_end: string;
  kpis: Kpi[];
  pnl: PnL | null;
  comparison_pnl: PnL | null;
  series: SeriesPoint[];
  stores: StoreRow[];
  categories: CategoryRow[];
  expenses: { category: string; amount: number }[] | null;
  inventory: InventoryOverview | null;
  stockouts_recent: StockoutRecent | null;
  cash: CashSummary | null;
  forecast: ForecastAccuracy | null;
  health: HealthScore | null;
  freshness: FreshnessEntry[];
  notes: string[];
};

export type SalesSummary = {
  company: { id: string; name: string; currency: string; is_synthetic: boolean };
  period: ResolvedPeriod;
  data_end: string;
  kpis: Kpi[];
  transactions: number | null;
  series: SeriesPoint[];
  last_7_days: { date: string; net_sales: number }[];
};

// ---------------------------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------------------------

export type MonthlyPnl = PnL & { month: string; label: string; partial: boolean };

export type FinancialReport = {
  period: ResolvedPeriod;
  data_end: string;
  currency: string;
  is_synthetic: boolean;
  total: PnL;
  comparison: PnL;
  monthly: MonthlyPnl[];
  cash: CashSummary;
  definitions: Record<string, MetricDefinition>;
};

export type BudgetRow = {
  month: string;
  metric: string;
  budget: number | null;
  actual: number | null;
  variance: number | null;
  variance_pct: number | null;
  favourable: boolean | null;
  prorated: boolean;
};

export type BudgetVsActual = {
  period: ResolvedPeriod;
  currency: string;
  status: string;
  note?: string;
  versions?: string[];
  rows: BudgetRow[];
  method?: string;
};

export type ExpenseAnalysis = {
  period: ResolvedPeriod;
  currency: string;
  status: string;
  total?: number;
  categories: { category: string; amount: number; share: number | null; section: string }[];
  monthly: { month: string; category: string; amount: number }[];
  anomalies: {
    month: string;
    category: string;
    store: string;
    amount: number;
    trailing_mean: number;
    z_score: number;
    change_vs_same_month_last_year: number | null;
  }[];
  method?: string;
};

export type InventoryPosition = {
  store_code: string;
  store: string;
  sku: string;
  product: string;
  category: string | null;
  supplier: string | null;
  on_hand_qty: number | null;
  on_order_qty: number | null;
  avg_daily_demand: number | null;
  days_of_cover: number | null;
  lead_time_days: number | null;
  risk: "stocked_out" | "high" | "medium" | "low" | "no_demand_no_stock" | (string & {});
  projected_stockout_date: string | null;
  inventory_value: number | null;
  excess_units?: number | null;
  excess_value?: number | null;
};

export type InventoryRisks = {
  status: string;
  note?: string;
  as_of?: string;
  positions?: number;
  risk_counts?: Record<string, number>;
  method?: string;
  limitations?: string[];
  stockout_risks: InventoryPosition[];
  overstock: InventoryPosition[];
  overstock_value_total?: number;
};

export type InventoryReport = {
  period: ResolvedPeriod;
  currency: string;
  data_end: string;
  overview: InventoryOverview;
  risks: InventoryRisks;
  recent_stockouts: StockoutRecent;
};

export type SupplierRow = {
  supplier_code: string;
  supplier: string;
  orders: number;
  received: number;
  open_orders: number;
  spend: number | null;
  contracted_lead_days: number | null;
  avg_lead_days: number | null;
  p90_lead_days: number | null;
  on_time_rate: number | null;
  recent_avg_lead_days: number | null;
  lead_time_change_recent_vs_prior: number | null;
  alert: boolean;
};

export type SupplierReport = {
  period: ResolvedPeriod;
  currency: string;
  status: string;
  suppliers: SupplierRow[];
  monthly_lead_time?: { month: string; supplier_code: string; avg_lead_days: number }[];
  method?: string;
};

export type WorkforceMonth = {
  month: string;
  headcount: number | null;
  hours: number | null;
  overtime: number | null;
  labor_cost: number | null;
  separations: number | null;
  store_hours: number | null;
  store_labor: number | null;
  net: number | null;
  txn: number | null;
  sales_per_labor_hour: number | null;
  transactions_per_labor_hour: number | null;
  labor_cost_ratio: number | null;
  overtime_share: number | null;
  attrition_rate: number | null;
};

export type WorkforceStore = {
  store_code: string;
  hours: number | null;
  labor_cost: number | null;
  net_sales: number | null;
  transactions: number | null;
  headcount: number | null;
  sales_per_labor_hour: number | null;
  transactions_per_labor_hour: number | null;
  labor_cost_ratio: number | null;
  avg_monthly_cost_per_employee: number | null;
};

export type WorkforceReport = {
  period: ResolvedPeriod;
  currency: string;
  status: string;
  note?: string;
  latest_month?: string;
  monthly: WorkforceMonth[];
  stores: WorkforceStore[];
};

export type StoresReport = { period: ResolvedPeriod; currency: string; stores: StoreRow[]; notes: string[] };

export type ProductRow = {
  sku: string | null;
  product: string | null;
  category: string | null;
  net_sales: number | null;
  units: number | null;
  gross_margin?: number | null;
  growth: number | null;
};

export type CategoriesReport = {
  period: ResolvedPeriod;
  currency: string;
  categories: CategoryRow[];
  products: { top: ProductRow[]; bottom: ProductRow[]; fastest_growing: ProductRow[]; declining: ProductRow[] };
};

export type BridgeItem = {
  base: number;
  current: number;
  change: number;
  change_pct: number | null;
};

export type RevenueBridge = {
  currency: string;
  base_period: { start: string; end: string; net_sales: number };
  current_period: { start: string; end: string; net_sales: number };
  change: number;
  change_pct: number | null;
  by_store: (BridgeItem & {
    store: string;
    name: string;
    transactions_change_pct: number | null;
    basket_change_pct: number | null;
  })[];
  by_category: (BridgeItem & { category: string })[];
  price_volume_mix: { volume: number; mix: number; price: number; new_or_discontinued_products: number };
  method: string;
};

export type DataQuality = {
  company_id: string;
  data_start: string | null;
  data_end: string | null;
  cost_coverage: number | null;
  store_days_with_multiple_sources: number;
  store_completeness: {
    store: string;
    expected_days: number;
    days_with_sales: number;
    missing_days: number;
    completeness: number;
  }[];
  freshness: FreshnessEntry[];
  recent_jobs: {
    id: string;
    integration: string;
    status: string;
    trigger: string;
    received: number;
    inserted: number;
    updated: number;
    unchanged: number;
    rejected: number;
    finished_at: string | null;
  }[];
  rejection_reasons: { code: string; count: number }[];
  rules: string[];
};

// ---------------------------------------------------------------------------------------------
// Integrations
// ---------------------------------------------------------------------------------------------

export type IntegrationStatus =
  | "connected"
  | "configured"
  | "awaiting_credentials"
  | "error"
  | "disabled"
  | "draft"
  | (string & {});

export type Availability = "available" | "requires_vendor_authorization" | "file_import_only" | "planned" | (string & {});

export type Integration = {
  id: string;
  provider_key: string;
  provider_name: string;
  display_name: string;
  company_id: string | null;
  status: IntegrationStatus;
  status_detail: string | null;
  is_live: boolean;
  is_demo: boolean;
  auth_type: string | null;
  methods: string[];
  availability: Availability | null;
  config: Record<string, unknown> | null;
  credentials: Record<string, string>;
  has_webhook_secret: boolean;
  schedule_minutes: number | null;
  sync_cursor: Record<string, unknown> | null;
  last_tested_at: string | null;
  last_test_result: TestResult | null;
  last_sync_at: string | null;
  last_successful_sync_at: string | null;
  supported_entities: string[];
  created_at: string | null;
  sync_job_count?: number;
  webhook?: { url: string; signing_secret: string; note: string };
};

export type TestResult = {
  ok?: boolean;
  status?: string;
  message?: string;
  checks?: { name: string; ok: boolean; detail?: string; [key: string]: unknown }[];
  tested_at?: string;
  last_verified_event_at?: string;
};

export type ResearchEvidence = {
  url: string;
  title?: string;
  publisher?: string;
  accessed?: string;
  supports?: string;
};

export type VendorResearch = {
  key: string;
  name: string;
  legal_name: string | null;
  categories: string[];
  website: string | null;
  country: string | null;
  description: string | null;
  reported_association: {
    retailer?: string;
    claim?: string;
    verification_status?: string;
    finding?: string;
    evidence?: ResearchEvidence[];
  } | null;
  integration_capabilities?: {
    public_api?: { available?: boolean | null; docs_url?: string | null; notes?: string | null } | null;
    auth_methods?: string[];
    webhooks?: { available?: boolean | null; notes?: string | null } | null;
    export_formats?: string[];
    database_access?: unknown;
    partner_program?: string | null;
    verification_status?: string | null;
    evidence?: ResearchEvidence[];
  } | null;
  activation_requirements?: string[];
  recommended_connector?: string | null;
  notes?: string | null;
};

export type ConfigField = {
  name: string;
  label: string;
  kind: "string" | "url" | "integer" | "select" | "json" | "boolean" | "password" | (string & {});
  required: boolean;
  secret: boolean;
  help: string;
  options: string[];
};

export type CatalogEntry = {
  key: string;
  name: string;
  categories: string[];
  methods: string[];
  availability: Availability;
  verification_status: string | null;
  summary: string;
  docs_url: string | null;
  implemented: boolean;
  activation_requirements: string[];
  research: VendorResearch | null;
  config_fields: ConfigField[];
  supported_entities: string[];
};

export type EntityField = {
  name: string;
  type: string;
  required: boolean;
  choices: string[] | null;
  description: string;
};

export type EntitySpec = {
  key: string;
  label: string;
  kind: "dimension" | "fact";
  date_field: string | null;
  fields: EntityField[];
};

export type JobStatus = "queued" | "running" | "succeeded" | "partially_succeeded" | "failed" | "cancelled" | (string & {});

export type EntityStats = {
  entity?: string;
  received?: number;
  inserted?: number;
  updated?: number;
  unchanged?: number;
  rejected?: number;
  warnings?: number;
  min_date?: string | null;
  max_date?: string | null;
  notes?: string[];
  error_counts?: Record<string, number>;
};

export type SyncJob = {
  id: string;
  integration_id: string;
  integration: string | null;
  trigger: string;
  status: JobStatus;
  attempt: number;
  max_attempts: number;
  retry_of_id: string | null;
  entity_types: string[];
  queued_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  duration_seconds: number | null;
  records: { received: number; inserted: number; updated: number; unchanged: number; rejected: number };
  stats: Record<string, EntityStats | Record<string, unknown>> | null;
  cursor_start: Record<string, unknown> | null;
  cursor_end: Record<string, unknown> | null;
  error_message: string | null;
  uploaded_file_id: string | null;
};

export type SyncJobDetail = SyncJob & {
  logged_errors: number;
  file: { filename: string; bytes: number; sha256: string } | null;
};

export type SyncError = {
  id: number;
  entity_type: string | null;
  row_number: number | null;
  source_record_id: string | null;
  field: string | null;
  code: string;
  message: string;
  severity: string;
  raw_excerpt: Record<string, unknown> | null;
};

export type IntegrationDetail = Integration & {
  recent_jobs: SyncJob[];
  provider: {
    summary: string;
    verification_status: string | null;
    activation_requirements: string[];
    docs_url: string | null;
    research: VendorResearch | null;
  } | null;
};

export type AuthorityRules = {
  rules: { id: string; company_id: string; fact_type: string; store_id: string | null; integration_id: string }[];
  fact_types: string[];
  default_rule: string;
};

// ---------------------------------------------------------------------------------------------
// Organization & settings
// ---------------------------------------------------------------------------------------------

export type Organization = {
  id: string;
  name: string;
  slug: string;
  industry: string | null;
  country: string | null;
  base_currency: string;
  timezone: string | null;
  is_demo: boolean;
  status: string;
  created_at: string | null;
  member_count?: number;
  company_count?: number;
  my_role?: string;
  my_role_label?: string;
  my_permissions?: string[];
  my_store_scope?: string[] | null;
};

export type RoleInfo = {
  role: string;
  label: string;
  description: string;
  workspace_path: string;
  store_scoped_by_default: boolean;
  permissions: string[];
};

export type RolesResponse = { roles: RoleInfo[]; assignable_by_me: string[]; all_permissions: string[] };

export type Member = {
  id: string;
  user_id: string;
  email: string;
  full_name: string;
  role: string;
  role_label: string;
  status: "active" | "suspended" | (string & {});
  store_scope: string[] | null;
  last_login_at: string | null;
  joined_at: string | null;
  is_me: boolean;
};

export type Invitation = {
  id: string;
  email: string;
  role: string;
  role_label: string;
  store_scope: string[] | null;
  expires_at: string;
  status: "pending" | "accepted" | "revoked" | "expired" | (string & {});
  created_at: string | null;
};

export type CreatedInvitation = {
  id: string;
  email: string;
  role: string;
  token: string;
  invite_path: string;
  expires_at: string;
};

export type Company = {
  id: string;
  name: string;
  legal_name: string | null;
  base_currency: string;
  fiscal_year_start_month: number;
  country: string | null;
  industry: string | null;
  description: string | null;
  is_synthetic: boolean;
};

export type Store = {
  id: string;
  company_id: string;
  code: string;
  name: string;
  city: string | null;
  region: string | null;
  format: string | null;
  opened_on: string | null;
  closed_on: string | null;
  selling_area_sqft: number | null;
  status: "planned" | "active" | "closed" | (string & {});
};

export type Department = {
  id: string;
  company_id: string;
  store_id: string | null;
  code: string;
  name: string;
  function: string | null;
};

export type FiscalPeriod = {
  id: string;
  period_start: string;
  period_end: string;
  fiscal_year: number;
  fiscal_quarter: number;
  fiscal_month: number;
  label: string;
  status: string;
};

export type AuditEvent = {
  id: number;
  action: string;
  actor: string | null;
  entity_type: string | null;
  entity_id: string | null;
  outcome: string;
  ip_address?: string | null;
  summary?: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
};

export type AuditPage = { total: number; limit: number; offset: number; events: AuditEvent[] };

// ---------------------------------------------------------------------------------------------
// Platform
// ---------------------------------------------------------------------------------------------

export type PlatformOverview = {
  organizations: number;
  users: number;
  integrations: number;
  integrations_by_status: Record<string, number>;
  sync_jobs_24h: Record<string, number>;
  background_jobs_24h: Record<string, number>;
  database_bytes: number | null;
  task_backend: string;
  environment: string;
  data_access_note: string;
};

export type PlatformOrganization = {
  id: string;
  name: string;
  slug: string;
  status: string;
  is_demo: boolean;
  created_at: string | null;
  members: number;
  integrations: number;
  last_successful_sync_at: string | null;
};

export type PlatformUser = {
  id: string;
  email: string;
  full_name: string;
  is_active: boolean;
  is_platform_admin: boolean;
  is_demo: boolean;
  memberships: number;
  locked_until: string | null;
  last_login_at: string | null;
};

export type PlatformJob = {
  id: string;
  org_id: string | null;
  job_type: string;
  status: string;
  attempts: number;
  error: string | null;
  created_at: string;
  finished_at: string | null;
};
