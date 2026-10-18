/** Benchmarking shapes (backend/app/services/intelligence.py benchmark). Ratios are fractions. */
import type { HealthComponent } from "./types";

export type BenchmarkHealth = {
  score: number | null;
  grade?: "strong" | "stable" | "watch" | "at_risk" | (string & {});
  status: string;
  components: HealthComponent[];
  excluded_components?: string[];
  limitations: string[];
};

export type BenchmarkRow = {
  key: string;
  display_name: string;
  is_synthetic: boolean;
  own: boolean;
  is_listed?: boolean | null;
  fiscal_year: string | null;
  period_end: string | null;
  currency: string | null;
  revenue: number | null;
  revenue_growth: number | null;
  gross_margin: number | null;
  ebitda_margin: number | null;
  net_margin: number | null;
  store_count: number | null;
  store_growth: number | null;
  revenue_per_store: number | null;
  inventory_turnover: number | null;
  basis?: string | null;
  source: string | null;
  price_performance?: { status: string; observations: number; note: string | null } | null;
  health: BenchmarkHealth | null;
};

export type BenchmarkResponse = {
  rows: BenchmarkRow[];
  metrics: string[];
  fiscal_year_end_months: number[];
  comparability_notes: string[];
  health_score_method: string;
};
