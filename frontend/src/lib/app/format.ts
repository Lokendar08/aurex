/**
 * Formatting for the authenticated app. Every formatter returns an em dash for a missing value so a
 * blank is never mistaken for zero; components decide when to show a fuller "Not available" state.
 *
 * Money: INR uses Indian grouping and lakh/crore compact notation (en-IN); other currencies use
 * their own Intl currency formatting with K/M/B compact notation.
 */

export const MISSING = "—";
const MINUS = "−";

type Maybe = number | null | undefined;

function isNum(value: Maybe): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Locale used for figures: Indian digit grouping for INR, international grouping otherwise. */
export function localeFor(currency?: string | null): string {
  return !currency || currency === "INR" ? "en-IN" : "en-US";
}

const nfCache = new Map<string, Intl.NumberFormat>();
function nf(locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let formatter = nfCache.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, options);
    nfCache.set(key, formatter);
  }
  return formatter;
}

/** Replace the ASCII hyphen Intl uses for negatives with a true minus sign. */
function minus(text: string): string {
  return text.replace(/^-/, MINUS).replace(/^\+-/, MINUS);
}

function currencySymbol(currency: string): string {
  try {
    const parts = nf(localeFor(currency), { style: "currency", currency, currencyDisplay: "narrowSymbol" }).formatToParts(0);
    return parts.find((p) => p.type === "currency")?.value ?? `${currency} `;
  } catch {
    return `${currency} `;
  }
}

export type MoneyOptions = {
  /** Lakh/crore (INR) or K/M/B (others) notation. */
  compact?: boolean;
  /** Prefix positive values with "+". */
  signed?: boolean;
  /** Force a number of fraction digits (full notation only). */
  decimals?: number;
};

function inrCompact(abs: number): string {
  const n = (value: number, digits: number) =>
    nf("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: digits }).format(value);
  if (abs >= 1e7) {
    const crore = abs / 1e7;
    return `₹${n(crore, crore >= 1000 ? 0 : crore >= 100 ? 1 : 2)} Cr`;
  }
  if (abs >= 1e5) {
    const lakh = abs / 1e5;
    return `₹${n(lakh, lakh >= 10 ? 1 : 2)} L`;
  }
  return `₹${n(abs, abs >= 100 ? 0 : 2)}`;
}

/** Format an amount of money. `formatMoney(17382234, "INR", { compact: true })` → "₹1.74 Cr". */
export function formatMoney(value: Maybe, currency: string | null | undefined = "INR", options: MoneyOptions = {}): string {
  if (!isNum(value)) return MISSING;
  const code = currency || "INR";
  const sign = value < 0 ? MINUS : options.signed && value > 0 ? "+" : "";
  const abs = Math.abs(value);
  if (options.compact) {
    if (code === "INR") return `${sign}${inrCompact(abs)}`;
    try {
      return `${sign}${nf("en-US", {
        style: "currency",
        currency: code,
        notation: "compact",
        maximumFractionDigits: abs >= 1000 ? 1 : 2,
      }).format(abs)}`;
    } catch {
      return `${sign}${code} ${nf("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(abs)}`;
    }
  }
  const digits = options.decimals ?? (abs > 0 && abs < 100 ? 2 : 0);
  try {
    return `${sign}${nf(localeFor(code), {
      style: "currency",
      currency: code,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(abs)}`;
  } catch {
    return `${sign}${code} ${nf("en-US", { maximumFractionDigits: digits }).format(abs)}`;
  }
}

/** Axis tick formatter for money: always compact, symbol included. */
export function moneyTick(currency: string | null | undefined) {
  const symbol = currencySymbol(currency || "INR");
  return (value: number) => {
    if (!isNum(value)) return "";
    if (value === 0) return `${symbol}0`;
    return formatMoney(value, currency, { compact: true });
  };
}

export type NumberOptions = {
  decimals?: number;
  compact?: boolean;
  signed?: boolean;
  currency?: string | null;
};

export function formatNumber(value: Maybe, options: NumberOptions = {}): string {
  if (!isNum(value)) return MISSING;
  const locale = localeFor(options.currency);
  const digits = options.decimals ?? (Math.abs(value) < 10 && !Number.isInteger(value) ? 1 : 0);
  const text = nf(locale, {
    notation: options.compact ? "compact" : "standard",
    minimumFractionDigits: options.compact ? 0 : digits,
    maximumFractionDigits: options.compact ? 1 : digits,
    signDisplay: options.signed ? "exceptZero" : "auto",
  }).format(value);
  return minus(text);
}

/** 0.2386 → "23.9%". */
export function formatPercent(value: Maybe, options: { decimals?: number; signed?: boolean } = {}): string {
  if (!isNum(value)) return MISSING;
  const decimals = options.decimals ?? 1;
  const text = nf("en-US", {
    style: "percent",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    signDisplay: options.signed ? "exceptZero" : "auto",
  }).format(value);
  return minus(text);
}

/** Percentage-point difference: 0.0027 → "+0.3 pp". */
export function formatPoints(value: Maybe, decimals = 1): string {
  if (!isNum(value)) return MISSING;
  const pp = value * 100;
  const text = nf("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    signDisplay: "exceptZero",
  }).format(pp);
  return `${minus(text)} pp`;
}

/** 22.12 → "22.1×". */
export function formatRatio(value: Maybe, decimals = 1): string {
  if (!isNum(value)) return MISSING;
  return `${nf("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value)}×`;
}

export function formatDays(value: Maybe, decimals = 1): string {
  if (!isNum(value)) return MISSING;
  const text = nf("en-US", { minimumFractionDigits: 0, maximumFractionDigits: decimals }).format(value);
  return `${text} ${text === "1" || text === "-1" ? "day" : "days"}`;
}

/** Standard-score style figure: 7.62 → "+7.6". */
export function formatZ(value: Maybe): string {
  if (!isNum(value)) return MISSING;
  return minus(nf("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: "exceptZero" }).format(value));
}

export function formatScore(value: Maybe): string {
  if (!isNum(value)) return MISSING;
  return nf("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 1 }).format(value);
}

export function formatBytes(value: Maybe): string {
  if (!isNum(value)) return MISSING;
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${nf("en-US", { maximumFractionDigits: unit === 0 ? 0 : 1 }).format(size)} ${units[unit]}`;
}

export function formatDuration(seconds: Maybe): string {
  if (!isNum(seconds)) return MISSING;
  if (seconds < 1) return `${Math.max(1, Math.round(seconds * 1000))} ms`;
  if (seconds < 60) return `${nf("en-US", { maximumFractionDigits: 1 }).format(seconds)} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  if (minutes < 60) return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${minutes % 60} min`;
}

// ---------------------------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------------------------

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parse an ISO date or datetime. Date-only strings are read as local calendar dates (no TZ shift). */
export function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const match = DATE_ONLY.exec(value);
  if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function dtf(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = JSON.stringify(options);
  let formatter = dtfCache.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-GB", options);
    dtfCache.set(key, formatter);
  }
  return formatter;
}

/** "17 Oct 2026" */
export function formatDate(value: string | null | undefined): string {
  const date = parseDate(value);
  return date ? dtf({ day: "numeric", month: "short", year: "numeric" }).format(date) : MISSING;
}

/** "17 Oct" */
export function formatShortDate(value: string | null | undefined): string {
  const date = parseDate(value);
  return date ? dtf({ day: "numeric", month: "short" }).format(date) : MISSING;
}

/** "Oct 2025" */
export function formatMonth(value: string | null | undefined): string {
  const date = parseDate(value);
  return date ? dtf({ month: "short", year: "numeric" }).format(date) : MISSING;
}

/** "18 Oct 2026, 20:59" */
export function formatDateTime(value: string | null | undefined): string {
  const date = parseDate(value);
  return date
    ? dtf({ day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(date)
    : MISSING;
}

const rtf = typeof Intl !== "undefined" ? new Intl.RelativeTimeFormat("en", { numeric: "auto" }) : null;

/** "3 hours ago", "yesterday". Falls back to the date for anything older than 30 days. */
export function formatRelative(value: string | null | undefined, now: number = Date.now()): string {
  const date = parseDate(value);
  if (!date || !rtf) return MISSING;
  const diff = (date.getTime() - now) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return "just now";
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86_400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 86_400 * 30) return rtf.format(Math.round(diff / 86_400), "day");
  return formatDate(value);
}

/** Bucket label for a time series point, by granularity. */
export function formatPeriodLabel(value: string, granularity?: string | null): string {
  if (granularity === "month") return formatMonth(value);
  return formatShortDate(value);
}

export function formatRange(start: string | null | undefined, end: string | null | undefined): string {
  if (!start && !end) return MISSING;
  return `${formatDate(start)} – ${formatDate(end)}`;
}

// ---------------------------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------------------------

const ACRONYMS: Record<string, string> = {
  pos: "POS",
  erp: "ERP",
  crm: "CRM",
  hris: "HRIS",
  api: "API",
  csv: "CSV",
  sku: "SKU",
  ebitda: "EBITDA",
  cogs: "COGS",
  opex: "Opex",
  oauth: "OAuth",
  url: "URL",
  id: "ID",
  wape: "WAPE",
  gl: "GL",
  po: "PO",
};

/** "professional_fees" → "Professional fees"; "pos" → "POS". */
export function humanize(value: string | null | undefined): string {
  if (!value) return MISSING;
  const words = value
    .replace(/[:_-]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (ACRONYMS[lower]) return ACRONYMS[lower];
      return index === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
    });
  return words.join(" ");
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${formatNumber(count)} ${count === 1 ? singular : pluralForm}`;
}

export function initials(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name.replace(/\(.*?\)/g, "").trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "")).toUpperCase() || "?";
}
