/** Report generation shapes (backend/app/api/routes/reports.py, services/reports/service.py). */

export type ReportFormat = "pdf" | "csv" | "xlsx";

export type ReportTypeInfo = { key: string; title: string; permission: string; allowed: boolean };

export type ReportStatus = "queued" | "running" | "completed" | "failed" | (string & {});

export type Report = {
  id: string;
  report_type: string;
  format: ReportFormat;
  title: string;
  status: ReportStatus;
  parameters: Record<string, unknown> | null;
  file_size: number | null;
  sha256: string | null;
  error: string | null;
  created_by: string | null;
  created_at: string;
  completed_at: string | null;
};

export type ReportsResponse = { types: ReportTypeInfo[]; formats: ReportFormat[]; reports: Report[] };

/** Which request parameters each report type reads (mirrors the backend builders). */
export const REPORT_PARAMETERS: Record<string, { scope: boolean; stores: boolean; period: boolean; custom: boolean; scenarios?: boolean; companies?: boolean }> = {
  executive: { scope: true, stores: true, period: true, custom: true },
  financial: { scope: true, stores: true, period: true, custom: true },
  inventory: { scope: true, stores: true, period: true, custom: false },
  forecast: { scope: true, stores: false, period: false, custom: false },
  scenario_comparison: { scope: false, stores: false, period: false, custom: false, scenarios: true },
  benchmarking: { scope: false, stores: false, period: false, custom: false, companies: true },
};

export const REPORT_DESCRIPTIONS: Record<string, string> = {
  executive: "KPIs, business health, store and category performance, data freshness and sources.",
  financial: "Monthly P&L with margins, budget against actual and cash summary.",
  inventory: "Stock levels, stockout and overstock risk, supplier lead times.",
  forecast: "Every active forecast model with its backtest accuracy and reliability.",
  scenario_comparison: "Saved Decision Lab scenarios side by side, with P10/P90 ranges.",
  benchmarking: "Your company against listed peers on comparable ratios.",
};

export const PERMISSION_LABELS: Record<string, string> = {
  "dashboard:read": "dashboard access",
  "finance:read": "finance access",
  "inventory:read": "inventory access",
  "forecasts:read": "forecast access",
  "scenarios:read": "scenario access",
  "intelligence:read": "market intelligence access",
};
