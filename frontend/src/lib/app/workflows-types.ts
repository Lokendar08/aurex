/** Recommendations, approvals, tasks and notifications (backend/app/api/routes/workflows.py). */

export type RecommendationStatus =
  | "proposed"
  | "pending_approval"
  | "approved"
  | "rejected"
  | "in_progress"
  | "implemented"
  | "measured"
  | "dismissed"
  | (string & {});

export type Priority = "low" | "medium" | "high" | "critical" | (string & {});

export type PredictedImpact = {
  metric?: string;
  predicted_delta?: number | null;
  net_sales_delta?: number | null;
  interval?: { p10?: number | null; p90?: number | null } | null;
  investment?: number | null;
  horizon_months?: number | null;
  payback_months?: number | null;
  baseline_value?: number | null;
  predicted_value?: number | null;
  direction?: "up" | "down" | null;
  note?: string | null;
  baseline_monthly?: Record<string, number | null>;
  scenario_monthly?: Record<string, number | null>;
  [key: string]: unknown;
};

export type Recommendation = {
  id: string;
  title: string;
  summary: string;
  category: string;
  source: "rule_engine" | "scenario" | "manual" | (string & {});
  source_ref: Record<string, unknown> | null;
  status: RecommendationStatus;
  priority: Priority;
  confidence: "high" | "medium" | "low" | (string & {}) | null;
  company_id: string | null;
  store_id: string | null;
  store_code: string | null;
  evidence: Record<string, unknown>[];
  assumptions: string[];
  predicted_impact: PredictedImpact | null;
  created_by: string | null;
  created_at: string | null;
  decided_at: string | null;
  implemented_at: string | null;
  measurement_start: string | null;
  measurement_end: string | null;
};

export type RecommendationsResponse = { recommendations: Recommendation[]; counts: Record<string, number> };

export type Approval = {
  id: string;
  approver: string | null;
  status: "pending" | "approved" | "rejected" | "cancelled" | (string & {});
  note: string | null;
  requested_at: string;
  decided_at: string | null;
};

export type Task = {
  id: string;
  title: string;
  description: string | null;
  status: "open" | "in_progress" | "done" | "cancelled" | (string & {});
  priority: Priority;
  assignee_id: string | null;
  recommendation_id: string | null;
  store_id: string | null;
  due_date: string | null;
  created_at: string | null;
  completed_at: string | null;
};

export type Outcome = {
  id: string;
  metric: string;
  window_start: string;
  window_end: string;
  baseline_value: number | null;
  predicted_value: number | null;
  actual_value: number | null;
  variance_vs_predicted: number | null;
  realized_effect: number | null;
  predicted_effect: number | null;
  accuracy: number | null;
  method: string;
  notes: string | null;
  measured_at: string | null;
};

export type HistoryEvent = { action: string; actor: string | null; at: string; details: Record<string, unknown> | null };

export type RecommendationDetail = Recommendation & {
  approvals: Approval[];
  tasks: Task[];
  outcomes: Outcome[];
  history: HistoryEvent[];
  can_approve: boolean;
};

export type MeasureResult = { status: "measured" | "partial" | "pending_data" | (string & {}); outcome?: Outcome; message?: string };

export type Notification = {
  id: number;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  created_at: string;
};

export type NotificationsResponse = { unread: number; notifications: Notification[] };

export type MyWork = {
  tasks: Task[];
  approvals_pending: { approval_id: string; recommendation: Recommendation }[];
  my_open_recommendations: Recommendation[];
  notifications: { id: number; kind: string; title: string; link: string | null; created_at: string }[];
};

export type MemberLite = { user_id: string; full_name: string; email: string; role_label: string; status: string };

export const STATUS_FLOW: RecommendationStatus[] = ["proposed", "pending_approval", "approved", "in_progress", "implemented", "measured"];

export const STATUS_LABELS: Record<string, string> = {
  proposed: "Proposed",
  pending_approval: "Pending approval",
  approved: "Approved",
  rejected: "Rejected",
  in_progress: "In progress",
  implemented: "Implemented",
  measured: "Measured",
  dismissed: "Dismissed",
};

export const SOURCE_LABELS: Record<string, string> = {
  rule_engine: "Rule engine",
  scenario: "Decision Lab scenario",
  manual: "Entered manually",
};

export const CATEGORY_OPTIONS = ["general", "inventory", "suppliers", "stores", "pricing", "workforce", "finance", "marketing"];

/** Money-valued impact metrics; others are counts, days or ratios. */
export const MONEY_METRICS = new Set(["net_profit", "net_sales", "gross_profit", "operating_expenses", "working_capital_release", "ebitda", "free_cash_flow"]);
