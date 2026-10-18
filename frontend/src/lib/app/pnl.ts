import type { Kpi, MetricDefinition, PnL } from "./types";

/** Expense categories that sit below EBITDA (everything else is operating). */
export const NON_OPERATING = new Set(["depreciation", "finance_costs", "income_tax"]);

export type PnlLine = {
  key: string;
  label: string;
  /** "+" adds to the total, "−" is a deduction shown as a negative movement. */
  sign: 1 | -1;
  kind: "line" | "subtotal" | "total" | "ratio" | "detail";
  get: (p: PnL) => number | null | undefined;
  /** For ratio rows: values are fractions. */
  ratio?: boolean;
  definitionKey?: string;
};

export function pnlLines(categories: string[]): PnlLine[] {
  const opexDetails: PnlLine[] = categories
    .filter((c) => !NON_OPERATING.has(c))
    .sort()
    .map((category) => ({
      key: `opex:${category}`,
      label: category,
      sign: -1 as const,
      kind: "detail" as const,
      get: (p: PnL) => (p.expenses_by_category && Object.keys(p.expenses_by_category).length ? (p.expenses_by_category[category] ?? null) : null),
    }));
  return [
    { key: "gross_sales", label: "Gross sales", sign: 1, kind: "line", get: (p) => p.gross_sales, definitionKey: "gross_sales" },
    { key: "discounts", label: "Discounts", sign: -1, kind: "line", get: (p) => p.discounts },
    { key: "refunds", label: "Refunds", sign: -1, kind: "line", get: (p) => p.refunds },
    { key: "net_sales", label: "Net sales", sign: 1, kind: "subtotal", get: (p) => p.net_sales, definitionKey: "net_sales" },
    { key: "cogs", label: "Cost of goods sold", sign: -1, kind: "line", get: (p) => p.cogs, definitionKey: "cogs" },
    { key: "gross_profit", label: "Gross profit", sign: 1, kind: "subtotal", get: (p) => p.gross_profit, definitionKey: "gross_profit" },
    { key: "gross_margin", label: "Gross margin", sign: 1, kind: "ratio", ratio: true, get: (p) => p.gross_margin, definitionKey: "gross_margin" },
    { key: "operating_expenses", label: "Operating expenses", sign: -1, kind: "line", get: (p) => p.operating_expenses, definitionKey: "operating_expenses" },
    ...opexDetails,
    { key: "ebitda", label: "EBITDA", sign: 1, kind: "subtotal", get: (p) => p.ebitda, definitionKey: "ebitda" },
    { key: "ebitda_margin", label: "EBITDA margin", sign: 1, kind: "ratio", ratio: true, get: (p) => p.ebitda_margin },
    { key: "depreciation", label: "Depreciation", sign: -1, kind: "line", get: (p) => p.depreciation },
    { key: "ebit", label: "EBIT", sign: 1, kind: "subtotal", get: (p) => p.ebit },
    { key: "finance_costs", label: "Finance costs", sign: -1, kind: "line", get: (p) => p.finance_costs },
    { key: "profit_before_tax", label: "Profit before tax", sign: 1, kind: "subtotal", get: (p) => p.profit_before_tax },
    { key: "income_tax", label: "Income tax", sign: -1, kind: "line", get: (p) => p.income_tax },
    { key: "net_profit", label: "Net profit", sign: 1, kind: "total", get: (p) => p.net_profit, definitionKey: "net_profit" },
    { key: "net_margin", label: "Net margin", sign: 1, kind: "ratio", ratio: true, get: (p) => p.net_margin, definitionKey: "net_margin" },
  ];
}

function relativeChange(current: number | null | undefined, previous: number | null | undefined): number | null {
  if (current === null || current === undefined || previous === null || previous === undefined) return null;
  if (Math.abs(previous) < 1e-9) return null;
  return (current - previous) / Math.abs(previous);
}

/** KPI objects (same shape as the backend's) built from two P&L results of the financial report. */
export function pnlKpis(current: PnL, previous: PnL, currency: string, definitions: Record<string, MetricDefinition>): Kpi[] {
  const incompleteNote = current.expenses_complete
    ? null
    : current.missing_expense_months.length
      ? `No expenses recorded for ${current.missing_expense_months.join(", ")}`
      : "Expenses are incomplete for this period";
  const make = (
    key: string,
    value: number | null | undefined,
    comparison: number | null | undefined,
    unit: "currency" | "percent",
    extra: Partial<Kpi> = {},
  ): Kpi => {
    const definition = definitions[key];
    const hasBoth = value !== null && value !== undefined && comparison !== null && comparison !== undefined;
    return {
      key,
      label: definition?.label ?? key,
      value: value ?? null,
      comparison: comparison ?? null,
      change: hasBoth ? (unit === "percent" ? (value as number) - (comparison as number) : relativeChange(value, comparison)) : null,
      change_kind: unit === "percent" ? "absolute" : "relative",
      unit,
      currency: unit === "currency" ? currency : null,
      status: value === null || value === undefined ? "missing_data" : "ok",
      note: null,
      estimated: false,
      direction: definition?.direction ?? "up",
      definition: { formula: definition?.formula ?? null, description: definition?.description ?? null },
      source: null,
      ...extra,
    };
  };
  const belowGp = (value: number | null) =>
    value === null && !current.expenses_complete ? { status: "incomplete" as const, note: incompleteNote } : {};
  return [
    make("net_sales", current.net_sales, previous.days_with_sales ? previous.net_sales : null, "currency"),
    make("gross_profit", current.gross_profit, previous.gross_profit, "currency", {
      estimated: current.gross_profit_estimated,
      note: current.notes.find((n) => n.toLowerCase().includes("cost")) ?? null,
    }),
    make("gross_margin", current.gross_margin, previous.gross_margin, "percent"),
    make("operating_expenses", current.operating_expenses, previous.operating_expenses, "currency", {
      direction: "down",
      ...(current.expenses_complete ? {} : { status: "incomplete", note: incompleteNote }),
    }),
    make("ebitda", current.ebitda, previous.ebitda, "currency", { estimated: current.gross_profit_estimated, ...belowGp(current.ebitda) }),
    make("net_profit", current.net_profit, previous.net_profit, "currency", {
      estimated: current.gross_profit_estimated,
      ...belowGp(current.net_profit),
    }),
    make("net_margin", current.net_margin, previous.net_margin, "percent", belowGp(current.net_margin)),
  ];
}

/** Cost-like budget metrics are favourable when actual is at or below budget. */
export function isCostMetric(metric: string): boolean {
  return metric === "cogs" || metric.startsWith("opex:");
}

export function budgetMetricLabel(metric: string): string {
  const labels: Record<string, string> = {
    net_sales: "Net sales",
    cogs: "Cost of goods sold",
    gross_profit: "Gross profit",
  };
  if (labels[metric]) return labels[metric];
  if (metric.startsWith("opex:")) {
    const category = metric.slice(5).replace(/_/g, " ");
    return `${category.charAt(0).toUpperCase()}${category.slice(1)} (opex)`;
  }
  return metric.replace(/_/g, " ");
}
