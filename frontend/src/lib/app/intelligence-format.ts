/** Labels and formatting for company intelligence, news and benchmarking. */
import { formatMoney, formatNumber, humanize, MISSING } from "./format";
import type { VerificationStatus } from "./intelligence-types";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function monthName(month: number | null | undefined): string {
  return month && month >= 1 && month <= 12 ? MONTHS[month - 1] : MISSING;
}

const UNIT_FORMAT: Record<string, { prefix: string; suffix: string }> = {
  INR_crore: { prefix: "₹", suffix: " crore" },
  INR_lakh: { prefix: "₹", suffix: " lakh" },
  INR_million: { prefix: "₹", suffix: " million" },
  INR_billion: { prefix: "₹", suffix: " billion" },
  MYR_million: { prefix: "RM ", suffix: " million" },
  MYR_thousand: { prefix: "RM ", suffix: " thousand" },
  MYR_billion: { prefix: "RM ", suffix: " billion" },
  sqft_million: { prefix: "", suffix: " million sq ft" },
  sqft: { prefix: "", suffix: " sq ft" },
  INR_per_sqft: { prefix: "₹", suffix: " per sq ft" },
  MYR_per_sqft: { prefix: "RM ", suffix: " per sq ft" },
  percent: { prefix: "", suffix: "%" },
  count: { prefix: "", suffix: "" },
};

export const UNIT_LABELS: Record<string, string> = {
  INR_crore: "₹ crore",
  INR_lakh: "₹ lakh",
  INR_million: "₹ million",
  INR_billion: "₹ billion",
  INR: "₹",
  MYR_million: "RM million",
  MYR_thousand: "RM thousand",
  MYR_billion: "RM billion",
  MYR: "RM",
  count: "Count",
  sqft_million: "Million sq ft",
  sqft: "Sq ft",
  INR_per_sqft: "₹ per sq ft",
  MYR_per_sqft: "RM per sq ft",
  percent: "Percent",
};

/** A reported figure in its own unit: "₹68,820.74 crore", "RM 11,433,224 thousand", "3,037". */
export function formatReported(value: number | null | undefined, unit: string | null | undefined, currency?: string | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return MISSING;
  if (unit === "INR" || unit === "MYR") return formatMoney(value, unit, { decimals: Math.abs(value) < 1000 ? 2 : 0 });
  const spec = unit ? UNIT_FORMAT[unit] : undefined;
  const locale = (unit ?? "").startsWith("INR") || currency === "INR" ? "en-IN" : "en-US";
  const digits = Number.isInteger(value) ? 0 : 2;
  const number = new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Math.abs(value));
  const sign = value < 0 ? "−" : "";
  if (spec) return `${sign}${spec.prefix}${number}${spec.suffix}`;
  return `${sign}${number}${unit ? ` ${humanize(unit)}` : ""}`;
}

/** An amount in base currency units (derived metrics): compact in the company's own currency. */
export function formatBaseAmount(value: number | null | undefined, currency: string | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return MISSING;
  return formatMoney(value, currency || "INR", { compact: true });
}

const METRICS: Record<string, string> = {
  revenue_from_operations: "Revenue from operations",
  total_income: "Total income",
  ebitda: "EBITDA",
  gross_profit: "Gross profit",
  net_profit: "Net profit",
  profit_before_tax: "Profit before tax",
  operating_cash_flow: "Operating cash flow",
  capex: "Capital expenditure",
  cash_and_equivalents: "Cash and equivalents",
  inventories: "Inventories",
  changes_in_inventories: "Change in inventories",
  purchases_of_stock_in_trade: "Purchases of stock-in-trade",
  employees: "Employees",
  store_count: "Stores",
  retail_area_sqft: "Retail area",
  revenue_per_sqft: "Revenue per sq ft",
};

export function metricLabel(metric: string): string {
  return METRICS[metric] ?? humanize(metric);
}

/** Metric order on the detail page: income statement, cash, balance sheet, operations. */
export const METRIC_ORDER = [
  "revenue_from_operations",
  "total_income",
  "gross_profit",
  "ebitda",
  "profit_before_tax",
  "net_profit",
  "operating_cash_flow",
  "capex",
  "cash_and_equivalents",
  "inventories",
  "purchases_of_stock_in_trade",
  "changes_in_inventories",
  "store_count",
  "retail_area_sqft",
  "revenue_per_sqft",
  "employees",
];

const VERIFICATION: Record<string, { label: string; tone: "good" | "warning" | "neutral" | "info" }> = {
  verified_primary: { label: "Verified · primary source", tone: "good" },
  verified: { label: "Verified", tone: "good" },
  partially_verified: { label: "Partially verified", tone: "warning" },
  secondary_source: { label: "Secondary source", tone: "warning" },
  derived: { label: "Derived", tone: "info" },
  unverified: { label: "Unverified", tone: "neutral" },
};

export function verificationInfo(status: VerificationStatus | null | undefined) {
  if (!status) return { label: "Not stated", tone: "neutral" as const };
  return VERIFICATION[status] ?? { label: humanize(status), tone: "neutral" as const };
}

/** Formulas for the derived metrics computed by AUREX from reported figures. */
export const DERIVED_FORMULAS: { key: string; label: string; formula: string }[] = [
  { key: "revenue_growth", label: "Revenue growth", formula: "Revenue ÷ previous fiscal year's revenue − 1 (only when both years share a basis)" },
  { key: "gross_margin", label: "Gross margin", formula: "Gross profit ÷ revenue; where gross profit is not reported, (revenue − (purchases + change in inventories)) ÷ revenue" },
  { key: "ebitda_margin", label: "EBITDA margin", formula: "EBITDA ÷ revenue" },
  { key: "net_margin", label: "Net margin", formula: "Net profit ÷ revenue" },
  { key: "revenue_per_store", label: "Revenue per store", formula: "Revenue ÷ store count at year end" },
  { key: "inventory_turnover", label: "Inventory turnover", formula: "Derived COGS ÷ average of opening and closing inventories" },
];

export function countValue(value: number | null | undefined): string {
  return formatNumber(value ?? null, { decimals: 0 });
}
