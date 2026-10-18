/**
 * Decision Lab lever forms. One schema per lever type mirrors the backend's pydantic models
 * (backend/app/services/simulation/levers.py): the same field names, defaults and bounds, so the
 * form rejects what the API would reject before a request is made.
 *
 * Drafts hold what the person typed, in display units: percentages as "5" for 5%, percentage
 * points as "2" for +2 pp. `leverPayload` converts to API units (fractions) and leaves out empty
 * optional fields so the backend applies its evidence-based defaults.
 */
import type { LeverType } from "./decision-lab-types";

export type FieldKind =
  | "percent"
  | "points"
  | "integer"
  | "number"
  | "money"
  | "month"
  | "days"
  | "select"
  | "categories"
  | "category"
  | "text";

export type FieldDef = {
  key: string;
  label: string;
  kind: FieldKind;
  /** Bounds in API units (fractions for percent / points). */
  min?: number;
  max?: number;
  minExclusive?: boolean;
  maxExclusive?: boolean;
  required?: boolean;
  /** Initial value in display units. */
  initial?: string;
  /** Placeholder for optional fields that default to evidence from the data. */
  placeholder?: string;
  hint?: string;
  options?: { value: string; label: string }[];
  /** Listed under "More options". */
  advanced?: boolean;
  visible?: (draft: LeverDraft) => boolean;
};

export type DraftValue = string | string[];

export type LeverDraft = {
  /** Client-side identity (stable React key); never sent. */
  uid: string;
  type: LeverType;
  label: string;
  note: string;
  values: Record<string, DraftValue>;
  /** Operating expense changes for the opex lever: rows of category + percent. */
  opex: { category: string; pct: string }[];
};

export const OPERATING_EXPENSE_CATEGORIES = [
  "rent",
  "utilities",
  "payroll",
  "marketing",
  "maintenance",
  "logistics",
  "technology",
  "insurance",
  "professional_fees",
  "store_supplies",
  "other",
] as const;

const START_MONTH: FieldDef = {
  key: "start_month",
  label: "Starts in month",
  kind: "month",
  min: 1,
  max: 60,
  initial: "1",
  hint: "Month 1 is the first month after the latest data.",
};

const CATEGORY_CODES: FieldDef = {
  key: "category_codes",
  label: "Categories",
  kind: "categories",
  hint: "Leave empty to apply to every category.",
};

export const LEVER_FIELDS: Record<LeverType, FieldDef[]> = {
  workforce: [
    {
      key: "_mode",
      label: "Change headcount by",
      kind: "select",
      initial: "target",
      options: [
        { value: "target", label: "Setting a target headcount" },
        { value: "change", label: "Adding or removing people" },
      ],
    },
    {
      key: "target_headcount",
      label: "Target headcount",
      kind: "integer",
      min: 0,
      max: 100000,
      required: true,
      visible: (d) => d.values._mode !== "change",
      hint: "Total headcount for the stores in scope after the change.",
    },
    {
      key: "headcount_change",
      label: "Headcount change",
      kind: "integer",
      min: -5000,
      max: 5000,
      required: true,
      visible: (d) => d.values._mode === "change",
      hint: "Positive to hire, negative to reduce.",
    },
    START_MONTH,
    {
      key: "revenue_effect",
      label: "Revenue effect",
      kind: "select",
      initial: "none",
      options: [
        { value: "none", label: "None (cost only)" },
        { value: "historical", label: "From your data (capacity evidence)" },
        { value: "assumption", label: "My documented assumption" },
      ],
      hint: "Hiring never raises revenue by itself. “From your data” applies only when stores are capacity-constrained.",
    },
    {
      key: "assumed_revenue_uplift_pct",
      label: "Assumed revenue uplift",
      kind: "percent",
      min: -0.5,
      max: 1,
      required: true,
      visible: (d) => d.values.revenue_effect === "assumption",
      hint: "Your assumption, applied to the scope's sales. Document it in the note.",
    },
    {
      key: "monthly_cost_per_employee",
      label: "Monthly cost per employee",
      kind: "money",
      min: 0,
      minExclusive: true,
      max: 10_000_000,
      maxExclusive: true,
      placeholder: "From payroll data",
      advanced: true,
    },
    { key: "hiring_cost_per_hire", label: "Hiring cost per hire", kind: "money", min: 0, max: 10_000_000, maxExclusive: true, initial: "0", advanced: true },
    { key: "severance_per_exit", label: "Severance per exit", kind: "money", min: 0, max: 10_000_000, maxExclusive: true, initial: "0", advanced: true },
    { key: "ramp_months", label: "Ramp-up months", kind: "integer", min: 0, max: 12, initial: "2", advanced: true, hint: "Months until new staff reach full productivity." },
  ],
  price: [
    { key: "change_pct", label: "Price change", kind: "percent", min: -0.5, max: 0.5, required: true, hint: "Between −50% and +50%. Volume reacts through the estimated price elasticity." },
    CATEGORY_CODES,
    START_MONTH,
    {
      key: "elasticity_override",
      label: "Elasticity override",
      kind: "number",
      min: -6,
      max: 0,
      placeholder: "Estimated from your data",
      advanced: true,
      hint: "Between −6 and 0. Replaces the estimated elasticity with your assumption.",
    },
  ],
  marketing: [
    { key: "change_pct", label: "Spend change", kind: "percent", min: -1, max: 3, required: true, hint: "Between −100% and +300% of current monthly spend." },
    START_MONTH,
    {
      key: "elasticity_override",
      label: "Response override",
      kind: "number",
      min: 0,
      max: 1,
      placeholder: "Estimated from your data",
      advanced: true,
      hint: "Between 0 and 1: % sales change per 1% spend change. Replaces the estimate with your assumption.",
    },
  ],
  supplier_cost: [
    { key: "change_pct", label: "Unit cost change", kind: "percent", min: -0.5, max: 0.5, required: true, hint: "Negative values are savings. Between −50% and +50%." },
    CATEGORY_CODES,
    START_MONTH,
    { key: "one_time_cost", label: "One-time cost", kind: "money", min: 0, initial: "0", advanced: true, hint: "Negotiation or switching cost, booked in the start month." },
  ],
  inventory: [
    { key: "safety_days_change", label: "Safety stock change", kind: "days", min: -15, max: 30, initial: "0", hint: "Days of demand, between −15 and +30." },
    { key: "cover_days_change", label: "Cover days change", kind: "days", min: -30, max: 60, initial: "0", hint: "Between −30 and +60 days." },
    CATEGORY_CODES,
    { key: "holding_cost_rate", label: "Annual holding cost rate", kind: "percent", min: 0, max: 1, initial: "20", advanced: true },
  ],
  new_store: [
    { key: "count", label: "Stores to open", kind: "integer", min: 1, max: 50, initial: "1" },
    { key: "open_month", label: "Opening month", kind: "month", min: 1, max: 60, initial: "3" },
    { key: "selling_area_sqft", label: "Selling area per store (sq ft)", kind: "number", min: 500, minExclusive: true, max: 500_000, maxExclusive: true, placeholder: "Median of your stores", advanced: true },
    { key: "capex_per_store", label: "Capex per store", kind: "money", min: 0, placeholder: "From past openings", advanced: true },
    { key: "pre_opening_cost_per_store", label: "Pre-opening cost per store", kind: "money", min: 0, placeholder: "Two months of rent", advanced: true },
    { key: "headcount_per_store", label: "Headcount per store", kind: "integer", min: 1, max: 2000, placeholder: "Current average", advanced: true },
    { key: "mature_sales_per_sqft_day", label: "Mature sales per sq ft per day", kind: "money", min: 0, minExclusive: true, placeholder: "From your stores", advanced: true },
  ],
  opex: [
    START_MONTH,
    { key: "one_time_cost", label: "One-time implementation cost", kind: "money", min: 0, initial: "0", advanced: true },
  ],
  retention: [
    { key: "retention_change_pp", label: "Monthly retention change", kind: "points", min: -0.3, max: 0.3, required: true, hint: "Percentage points, between −30 and +30. An assumption: explain it in the note." },
    { key: "monthly_program_cost", label: "Programme cost per month", kind: "money", min: 0, initial: "0" },
    START_MONTH,
    { key: "spend_per_customer", label: "Monthly spend per customer", kind: "money", min: 0, minExclusive: true, placeholder: "From the loyalty feed", advanced: true },
  ],
  product_mix: [
    { key: "from_category", label: "Shift sales from", kind: "category", required: true },
    { key: "to_category", label: "To", kind: "category", required: true },
    { key: "shift_pct", label: "Share of sales shifted", kind: "percent", min: 0, minExclusive: true, max: 0.5, required: true, hint: "Of the source category's sales; total sales stay unchanged." },
    START_MONTH,
  ],
};

/** Levers whose note is required by the backend (documented assumptions). */
export function noteRequired(draft: LeverDraft): boolean {
  if (draft.type === "retention") return true;
  return draft.type === "workforce" && draft.values.revenue_effect === "assumption";
}

export function visibleFields(draft: LeverDraft): FieldDef[] {
  return LEVER_FIELDS[draft.type].filter((f) => (f.visible ? f.visible(draft) : true));
}

let uidCounter = 0;
export function newUid(): string {
  uidCounter += 1;
  return `lever-${Date.now().toString(36)}-${uidCounter}`;
}

export function emptyDraft(type: LeverType): LeverDraft {
  const values: Record<string, DraftValue> = {};
  for (const field of LEVER_FIELDS[type]) {
    if (field.kind === "categories") values[field.key] = [];
    else values[field.key] = field.initial ?? "";
  }
  return { uid: newUid(), type, label: "", note: "", values, opex: type === "opex" ? [{ category: "utilities", pct: "" }] : [] };
}

// ---------------------------------------------------------------------------------------------
// Unit conversion
// ---------------------------------------------------------------------------------------------

/** Strip floating noise: 0.1 * 100 = 10.000000000000002 → "10". */
function clean(value: number): string {
  return String(Number(value.toPrecision(12)));
}

function isScaled(kind: FieldKind): boolean {
  return kind === "percent" || kind === "points";
}

/** API value → display string. */
export function toDisplay(kind: FieldKind, value: unknown): DraftValue {
  if (kind === "categories") return Array.isArray(value) ? value.map(String) : [];
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return clean(isScaled(kind) ? value * 100 : value);
  return String(value);
}

/** Parse a display string (accepts "1,000", "−5", "5%"). */
export function parseNumber(text: string): number | null {
  const normalized = text.replace(/[−–]/g, "-").replace(/[,\s%₹]/g, "").trim();
  if (normalized === "" || normalized === "-" || normalized === ".") return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

/** Display value → API units (fractions for percent / points). */
export function toApi(kind: FieldKind, text: string): number | null {
  const value = parseNumber(text);
  if (value === null) return null;
  return isScaled(kind) ? Number((value / 100).toPrecision(12)) : value;
}

function integerKind(kind: FieldKind): boolean {
  return kind === "integer" || kind === "month";
}

function boundText(field: FieldDef, value: number): string {
  if (field.kind === "percent") return `${clean(value * 100)}%`;
  if (field.kind === "points") return `${clean(value * 100)} pp`;
  return new Intl.NumberFormat("en-IN").format(value);
}

/** The allowed range in words, for messages and hints. */
export function rangeText(field: FieldDef): string | null {
  const { min, max } = field;
  if (min !== undefined && max !== undefined) return `between ${boundText(field, min)} and ${boundText(field, max)}`;
  if (min !== undefined) return field.minExclusive ? `above ${boundText(field, min)}` : `at least ${boundText(field, min)}`;
  if (max !== undefined) return field.maxExclusive ? `below ${boundText(field, max)}` : `at most ${boundText(field, max)}`;
  return null;
}

// ---------------------------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------------------------

export type LeverErrors = Record<string, string>;

function checkNumber(field: FieldDef, text: string): string | null {
  const value = toApi(field.kind, text);
  if (value === null) return "Enter a number";
  if (integerKind(field.kind) && !Number.isInteger(value)) return "Enter a whole number";
  const { min, max } = field;
  const belowMin = min !== undefined && (field.minExclusive ? value <= min : value < min);
  const aboveMax = max !== undefined && (field.maxExclusive ? value >= max : value > max);
  if (belowMin || aboveMax) return `Must be ${rangeText(field)}`;
  return null;
}

export function validateLever(draft: LeverDraft): LeverErrors {
  const errors: LeverErrors = {};
  for (const field of visibleFields(draft)) {
    const raw = draft.values[field.key];
    if (field.kind === "categories" || field.kind === "select" || field.kind === "text") continue;
    if (field.kind === "category") {
      if (field.required && !(typeof raw === "string" && raw)) errors[field.key] = "Choose a category";
      continue;
    }
    const text = typeof raw === "string" ? raw.trim() : "";
    if (!text) {
      if (field.required) errors[field.key] = "Required";
      continue;
    }
    const problem = checkNumber(field, text);
    if (problem) errors[field.key] = problem;
  }
  if (draft.type === "product_mix" && draft.values.from_category && draft.values.from_category === draft.values.to_category) {
    errors.to_category = "Choose a different category than the source";
  }
  if (draft.type === "opex") {
    if (!draft.opex.length) errors._opex = "Add at least one expense category";
    const seen = new Set<string>();
    draft.opex.forEach((row, index) => {
      if (!row.category) errors[`_opex.${index}.category`] = "Choose a category";
      else if (seen.has(row.category)) errors[`_opex.${index}.category`] = "Each category once";
      seen.add(row.category);
      const value = parseNumber(row.pct);
      if (value === null) errors[`_opex.${index}.pct`] = "Enter a percentage";
      else if (value < -100 || value > 100) errors[`_opex.${index}.pct`] = "Between −100% and +100%";
    });
  }
  if (noteRequired(draft) && !draft.note.trim()) {
    errors.note =
      draft.type === "retention"
        ? "Retention changes are assumptions: explain the programme behind them"
        : "Document the assumption behind the revenue uplift";
  }
  if (draft.label.length > 120) errors.label = "At most 120 characters";
  if (draft.note.length > 1000) errors.note = "At most 1,000 characters";
  return errors;
}

export function hasErrors(errors: LeverErrors): boolean {
  return Object.keys(errors).length > 0;
}

/** Advice that does not block a run (a lever that changes nothing). */
export function leverAdvice(draft: LeverDraft): string | null {
  if (draft.type === "inventory") {
    const safety = parseNumber(String(draft.values.safety_days_change ?? "")) ?? 0;
    const cover = parseNumber(String(draft.values.cover_days_change ?? "")) ?? 0;
    if (safety === 0 && cover === 0) return "Both changes are zero, so this lever changes nothing.";
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Draft ↔ API lever
// ---------------------------------------------------------------------------------------------

export function leverPayload(draft: LeverDraft, fallbackLabel?: string): Record<string, unknown> {
  const out: Record<string, unknown> = { type: draft.type };
  const label = draft.label.trim() || fallbackLabel;
  if (label) out.label = label.slice(0, 120);
  if (draft.note.trim()) out.note = draft.note.trim();
  for (const field of visibleFields(draft)) {
    if (field.key.startsWith("_")) continue;
    const raw = draft.values[field.key];
    if (field.kind === "categories") {
      if (Array.isArray(raw) && raw.length) out[field.key] = raw;
      continue;
    }
    if (field.kind === "select" || field.kind === "category" || field.kind === "text") {
      if (typeof raw === "string" && raw) out[field.key] = raw;
      continue;
    }
    const text = typeof raw === "string" ? raw.trim() : "";
    if (!text) continue;
    const value = toApi(field.kind, text);
    if (value !== null) out[field.key] = integerKind(field.kind) ? Math.round(value) : value;
  }
  if (draft.type === "opex") {
    const changes: Record<string, number> = {};
    for (const row of draft.opex) {
      const value = parseNumber(row.pct);
      if (row.category && value !== null) changes[row.category] = Number((value / 100).toPrecision(12));
    }
    out.changes = changes;
  }
  return out;
}

/** Rebuild a draft from a stored / suggested API lever (saved scenarios, optimizer output). */
export function draftFromLever(lever: Record<string, unknown>): LeverDraft | null {
  const type = lever.type as LeverType;
  if (!LEVER_FIELDS[type]) return null;
  const draft = emptyDraft(type);
  draft.label = typeof lever.label === "string" ? lever.label : "";
  draft.note = typeof lever.note === "string" ? lever.note : "";
  for (const field of LEVER_FIELDS[type]) {
    if (field.key === "_mode") continue;
    if (field.key in lever) {
      const value = lever[field.key];
      if (value === null || value === undefined) draft.values[field.key] = field.kind === "categories" ? [] : "";
      else draft.values[field.key] = toDisplay(field.kind, value);
    }
  }
  if (type === "workforce") {
    draft.values._mode = lever.target_headcount !== null && lever.target_headcount !== undefined ? "target" : "change";
  }
  if (type === "opex") {
    const changes = (lever.changes ?? {}) as Record<string, number>;
    draft.opex = Object.entries(changes).map(([category, value]) => ({ category, pct: clean(value * 100) }));
  }
  return draft;
}

// ---------------------------------------------------------------------------------------------
// Optimizer
// ---------------------------------------------------------------------------------------------

/** Fields the backend optimizer can vary (backend OPTIMIZABLE_FIELDS), by lever type. */
const OPTIMIZABLE = new Set([
  "change_pct",
  "headcount_change",
  "target_headcount",
  "safety_days_change",
  "cover_days_change",
  "retention_change_pp",
  "shift_pct",
  "open_month",
  "count",
  "monthly_program_cost",
]);

export function optimizableFields(type: LeverType): FieldDef[] {
  return LEVER_FIELDS[type].filter((f) => OPTIMIZABLE.has(f.key));
}

export function fieldDef(type: LeverType, key: string): FieldDef | undefined {
  return LEVER_FIELDS[type].find((f) => f.key === key);
}

// ---------------------------------------------------------------------------------------------
// Quick-start presets
// ---------------------------------------------------------------------------------------------

export type PresetKey = "hire_s04" | "price_5" | "new_store" | "utilities_10" | "safety_3";

/** Facts about the preset's scope from the evidence endpoint (current headcount at S04). */
export type PresetContext = { headcount?: number | null };

export type Preset = {
  key: PresetKey;
  /** Store code the preset is scoped to (resolved against the permitted stores). */
  storeCode?: string;
  label: (context: PresetContext) => string;
  levers: (context: PresetContext) => LeverDraft[];
};

function withValues(type: LeverType, label: string, values: Record<string, DraftValue>, opex?: LeverDraft["opex"]): LeverDraft {
  const draft = emptyDraft(type);
  draft.label = label;
  draft.values = { ...draft.values, ...values };
  if (opex) draft.opex = opex;
  return draft;
}

export const PRESET_TARGET_HEADCOUNT = 30;

/** "Hire 10 employees at S04 (20 → 30)" when the current headcount is known, else the target only. */
function hireLabel({ headcount }: PresetContext, withArrow: boolean): string {
  const current = typeof headcount === "number" && Number.isFinite(headcount) ? Math.round(headcount) : null;
  if (current === null || current >= PRESET_TARGET_HEADCOUNT) return `Staff S04 to ${PRESET_TARGET_HEADCOUNT} employees`;
  const hires = PRESET_TARGET_HEADCOUNT - current;
  return `Hire ${hires} employees at S04${withArrow ? ` (${current} → ${PRESET_TARGET_HEADCOUNT})` : ""}`;
}

export const PRESETS: Preset[] = [
  {
    key: "hire_s04",
    storeCode: "S04",
    label: (context) => hireLabel(context, true),
    levers: (context) => [
      withValues("workforce", hireLabel(context, false), {
        _mode: "target",
        target_headcount: String(PRESET_TARGET_HEADCOUNT),
        revenue_effect: "none",
      }),
    ],
  },
  { key: "price_5", label: () => "Price +5%", levers: () => [withValues("price", "Price +5%", { change_pct: "5" })] },
  {
    key: "new_store",
    label: () => "Open a new store",
    levers: () => [withValues("new_store", "Open a new store", { count: "1", open_month: "3" })],
  },
  {
    key: "utilities_10",
    label: () => "Cut utilities 10%",
    levers: () => [withValues("opex", "Cut utilities 10%", {}, [{ category: "utilities", pct: "-10" }])],
  },
  {
    key: "safety_3",
    label: () => "Safety stock +3 days",
    levers: () => [withValues("inventory", "Safety stock +3 days", { safety_days_change: "3" })],
  },
];
