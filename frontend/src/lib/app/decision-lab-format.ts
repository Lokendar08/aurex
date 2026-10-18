/**
 * Formatting shared by the planning and delivery pages (Decision Lab, Advisor, Workflows,
 * Reports): signed money deltas, evidence values without units, assumption sources and
 * rate-limit-aware error text. Built on part A's formatters (lib/app/format.ts).
 */
import { ApiError } from "@/lib/api";

import {
  formatDays,
  formatMoney,
  formatNumber,
  formatPercent,
  formatPoints,
  humanize,
  MISSING,
} from "./format";

type Maybe = number | null | undefined;

export function isNum(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Simulation totals carry float noise (−4638789.480000002, 2.8e-9): treat sub-unit amounts as zero. */
export function cleanAmount(value: Maybe): number | null {
  if (!isNum(value)) return null;
  return Math.abs(value) < 0.5 ? 0 : value;
}

export function cleanFraction(value: Maybe): number | null {
  if (!isNum(value)) return null;
  return Math.abs(value) < 1e-9 ? 0 : value;
}

/** "+₹46.39 L", "−₹3.87 L", "₹0"; null → "—". */
export function formatDelta(value: Maybe, currency: string | null | undefined): string {
  const v = cleanAmount(value);
  if (v === null) return MISSING;
  return formatMoney(v, currency, { compact: true, signed: true });
}

export function formatAmount(value: Maybe, currency: string | null | undefined): string {
  const v = cleanAmount(value);
  if (v === null) return MISSING;
  return formatMoney(v, currency, { compact: true });
}

export function formatFullAmount(value: Maybe, currency: string | null | undefined): string {
  const v = cleanAmount(value);
  if (v === null) return MISSING;
  return formatMoney(v, currency, { decimals: 0 });
}

export function formatProbability(value: Maybe): string {
  if (!isNum(value)) return MISSING;
  if (value <= 0) return "0%";
  if (value >= 1) return "100%";
  return formatPercent(value, { decimals: value < 0.1 || value > 0.9 ? 1 : 0 });
}

// ---------------------------------------------------------------------------------------------
// Evidence & assumption values (the API sends bare numbers; the name says what they measure)
// ---------------------------------------------------------------------------------------------

const MONEY_WORDS =
  /(cost|capex|spend|rent|revenue|sales|cogs|investment|inventory|price|payroll|salary|wage|value|opex|capital|cash|run-rate|base|amount|utilities|maintenance|logistics|technology|insurance|fees|supplies)/i;
const NOT_MONEY = /(transactions|units|elasticity|utili[sz]ation|share|ratio|days|headcount|\bcustomers\b|count|probability|products|area|observations|level|gap|tau)/i;
const RATE_WORDS = /(utili[sz]ation|retention|share|rate|margin|probability|coverage|realization|uplift|change)/i;

/** Format an evidence or assumption value by what its name says it measures. */
export function formatEvidenceValue(name: string, value: unknown, currency: string | null | undefined): string {
  if (value === null || value === undefined) return "Not available";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((v) => formatEvidenceValue(name, v, currency)).join(", ");
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => {
        const inner = formatEvidenceValue(k.replace(/_/g, " "), v, currency);
        return `${humanize(k)}: ${typeof v === "object" && v !== null ? `(${inner})` : inner}`;
      })
      .join("; ");
  }
  if (!isNum(value)) return String(value);
  const lower = name.toLowerCase();
  if (/elasticity/.test(lower)) return formatNumber(value, { decimals: 3 });
  if (/(sq ?ft\)|selling area)/.test(lower) && !/per sq/.test(lower)) return `${formatNumber(value, { decimals: 0 })} sq ft`;
  if (/headcount|employees|products|customers|count|observations/.test(lower) && !MONEY_WORDS.test(lower.replace(/count/g, ""))) {
    return formatNumber(value, { decimals: 0 });
  }
  if (/retention change|percentage points|\bpp\b/.test(lower)) return formatPoints(value);
  if (RATE_WORDS.test(lower) && Math.abs(value) <= 1.5 && !MONEY_WORDS.test(lower)) return formatPercent(value);
  if (/unit cost change|shift share|holding cost rate/.test(lower)) return formatPercent(value, { signed: /change/.test(lower) });
  if (/days/.test(lower)) return formatDays(value);
  if (/per labor hour|per hour/.test(lower)) return formatNumber(value, { decimals: 2 });
  if (MONEY_WORDS.test(lower) && !NOT_MONEY.test(lower)) return formatMoney(value, currency, { compact: Math.abs(value) >= 1e5 });
  if (Math.abs(value) < 1 && !Number.isInteger(value)) return formatNumber(value, { decimals: 3 });
  return formatNumber(value, { decimals: Number.isInteger(value) ? 0 : 2 });
}

// ---------------------------------------------------------------------------------------------
// Where a number comes from
// ---------------------------------------------------------------------------------------------

/**
 * The evidence vocabulary of the public site, carried into the product:
 * data (estimated from the organization's own records), user (a documented assumption),
 * model (a rule of the engine), default (a fallback value nobody has supplied).
 */
export type SourceKind = "data" | "user" | "model" | "default";

export function sourceKind(source: string | null | undefined): SourceKind {
  const s = (source ?? "").toLowerCase().trim();
  if (s === "user") return "user";
  if (s.includes("default")) return "default";
  if (s === "model" || s.startsWith("model")) return "model";
  if (/(historical|history|current|trailing|estimated|data|observed|payroll|feed)/.test(s)) return "data";
  return "default";
}

export const SOURCE_LABELS: Record<SourceKind, string> = {
  data: "From your data",
  user: "Your assumption",
  model: "Model rule",
  default: "Default",
};

export const SOURCE_HINTS: Record<SourceKind, string> = {
  data: "Estimated or measured from this organization's own records.",
  user: "Entered in this scenario. The data cannot confirm it.",
  model: "A fixed rule of the simulation engine.",
  default: "A fallback used because nothing more specific was supplied.",
};

// ---------------------------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------------------------

export function retryAfterSeconds(error: unknown): number | null {
  if (!(error instanceof ApiError) || error.status !== 429) return null;
  const details = error.details as { retry_after?: unknown } | null | undefined;
  const value = details && typeof details === "object" ? Number(details.retry_after) : NaN;
  return Number.isFinite(value) && value > 0 ? Math.ceil(value) : null;
}

/** The backend's message, with a retry hint for rate limits. */
export function errorText(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 429) {
      const seconds = retryAfterSeconds(error);
      return seconds ? `Rate limited: retry in ${seconds} s.` : "Rate limited: wait a moment and retry.";
    }
    return error.message;
  }
  if (error instanceof TypeError) return "AUREX can't be reached. Check your connection and try again.";
  if (error instanceof Error) return error.message;
  return "Something went wrong";
}

/** A copy of a rate-limit error whose message carries the retry hint (for part A's ErrorState). */
export function withRetryHint(error: unknown): unknown {
  if (error instanceof ApiError && error.status === 429) {
    return new ApiError(error.status, error.code, errorText(error), error.details, error.requestId);
  }
  return error;
}
