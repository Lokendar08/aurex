/**
 * Company intelligence shapes (backend/app/api/routes/intelligence.py, services/intelligence.py).
 * Figures carry their fiscal year, basis, unit and source; ratios are fractions. Market-share
 * estimates use percent values (value_pct = 40.1 means 40.1%).
 */

export type VerificationStatus = "verified" | "verified_primary" | "partially_verified" | "secondary_source" | "derived" | "unverified" | (string & {});

export type Security = {
  exchange: string;
  ticker: string;
  isin: string | null;
  currency: string | null;
  listing_date: string | null;
  verification_status: VerificationStatus | null;
  source_url: string | null;
};

export type Highlight = {
  value: number | null;
  display: string;
  fiscal_year: string | null;
  source_url?: string | null;
  source_name?: string | null;
  verification_status?: VerificationStatus | null;
};

export type MarketSnapshot = {
  exchange: string | null;
  ticker: string | null;
  as_of: string | null;
  close_price: number | null;
  currency: string | null;
  market_cap: number | null;
  market_cap_unit: string | null;
  source: string | null;
  source_url: string | null;
  is_snapshot: boolean;
  notes: string | null;
};

export type MarketShareEstimate = {
  as_of: string | null;
  scope: string;
  value_pct: number | null;
  notes: string | null;
  source_url: string | null;
  source_name: string | null;
};

export type DerivedYear = {
  fiscal_year: string;
  period_end: string;
  basis: string;
  revenue: number | null;
  currency: string | null;
  revenue_growth?: number | null;
  revenue_growth_note?: string | null;
  ebitda_margin?: number | null;
  net_margin?: number | null;
  gross_margin?: number | null;
  store_count?: number | null;
  revenue_per_store?: number | null;
  cogs_derived?: number | null;
  gross_margin_derived?: number | null;
  inventory_turnover?: number | null;
};

export type CompanyProfile = {
  key: string;
  display_name: string;
  legal_name: string | null;
  aliases: string[];
  country: string | null;
  sector: string | null;
  website: string | null;
  description: string | null;
  is_listed: boolean | null;
  fiscal_year_end_month: number | null;
  reporting_currency: string | null;
  reporting_basis: string | null;
  securities: Security[];
  highlights: Record<string, Highlight>;
  market_snapshot: MarketSnapshot | null;
  data_gaps: string[];
  market_share_estimates: MarketShareEstimate[];
  custom: boolean;
  recent_years?: DerivedYear[];
};

export type MarketDataStatus = { provider: string; configured: boolean; note: string };

export type CompaniesResponse = { companies: CompanyProfile[]; market_data: MarketDataStatus; disclaimer: string };

export type Observation = {
  fiscal_year: string;
  period_end: string;
  basis: string;
  value: number | null;
  unit: string;
  value_base_units: number | null;
  currency: string | null;
  source_url: string | null;
  source_name: string | null;
  source_type: string | null;
  verification_status: VerificationStatus | null;
  notes: string | null;
};

export type RelatedArticle = {
  id: string;
  title: string;
  url: string | null;
  source_name: string | null;
  published_at: string | null;
  is_official_announcement: boolean;
};

export type CompanyDetail = CompanyProfile & {
  financials: Record<string, Observation[]>;
  derived: DerivedYear[];
  price_performance: { status: string; observations: number; note: string | null; [key: string]: unknown } | null;
  news: RelatedArticle[];
  measures_note: string | null;
  market_data: MarketDataStatus;
};

export const UNITS = [
  "INR_crore",
  "INR_lakh",
  "INR_million",
  "INR_billion",
  "INR",
  "MYR_million",
  "MYR_thousand",
  "MYR_billion",
  "MYR",
  "count",
  "sqft_million",
  "sqft",
  "INR_per_sqft",
  "MYR_per_sqft",
  "percent",
] as const;
