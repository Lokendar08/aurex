"use client";

import { CircleAlertIcon } from "lucide-react";

import { DonutChart } from "@/components/app/charts/donut-chart";
import { Meter } from "@/components/app/charts/sparkline";
import { KPI_STATUS_TEXT } from "@/components/app/kpi";
import { NoteList, Panel, Stat } from "@/components/app/page";
import { EmptyState, Notice } from "@/components/app/states";
import {
  formatDate,
  formatDays,
  formatMoney,
  formatNumber,
  formatPercent,
  formatRatio,
  formatScore,
  humanize,
} from "@/lib/app/format";
import type { CashSummary, HealthScore } from "@/lib/app/types";
import { cn } from "@/lib/utils";

export function expenseLabel(category: string): string {
  const labels: Record<string, string> = {
    income_tax: "Income tax",
    finance_costs: "Finance costs",
    store_supplies: "Store supplies",
    professional_fees: "Professional fees",
  };
  return labels[category] ?? humanize(category);
}

/** Expense mix for the period (top five plus "Other"). */
export function ExpenseBreakdownPanel({
  expenses,
  currency,
  dimmed,
  className,
  description = "Ledger expenses allocated to the selected period",
}: {
  expenses: { category: string; amount: number }[];
  currency: string;
  dimmed?: boolean;
  className?: string;
  description?: string;
}) {
  const total = expenses.reduce((sum, e) => sum + (e.amount > 0 ? e.amount : 0), 0);
  return (
    <Panel title="Expense breakdown" description={description} dimmed={dimmed} className={className}>
      {expenses.length === 0 ? (
        <EmptyState compact title="No expenses recorded for this period" description="Expenses arrive from the accounting feed or a file import." />
      ) : (
        <DonutChart
          ariaLabel="Expenses by category"
          slices={expenses.map((e) => ({ key: e.category, label: expenseLabel(e.category), value: e.amount }))}
          format={(v) => formatMoney(v, currency, { compact: true })}
          centerLabel="Total"
          centerValue={formatMoney(total, currency, { compact: true })}
        />
      )}
    </Panel>
  );
}

/** Cash position: balance, operating / investing / financing flows and months of cover. */
export function CashPanel({
  cash,
  currency,
  dimmed,
  className,
}: {
  cash: CashSummary | null | undefined;
  currency: string;
  dimmed?: boolean;
  className?: string;
}) {
  if (!cash || cash.status !== "ok") {
    const info = cash?.status ? KPI_STATUS_TEXT[cash.status] : undefined;
    return (
      <Panel title="Cash" description="Bank balance and cash flow" className={className}>
        <EmptyState
          compact
          icon={CircleAlertIcon}
          title={cash?.status === "not_available_at_store_scope" ? "Not available at store scope" : (info?.label ?? "No cash data")}
          description={
            cash?.status === "not_available_at_store_scope"
              ? "Cash is reported for the company as a whole. Clear the store filter to see it."
              : cash?.status === "not_permitted"
                ? "Your role does not include cash figures."
                : "No cash-flow or bank-balance data has been supplied for this period."
          }
        />
      </Panel>
    );
  }
  const flows = [
    { key: "operating", label: "Operating", value: cash.operating_cash_flow },
    { key: "investing", label: "Investing", value: cash.investing_cash_flow },
    { key: "financing", label: "Financing", value: cash.financing_cash_flow },
  ];
  return (
    <Panel
      title="Cash"
      description="Bank balance and cash flow"
      dimmed={dimmed}
      className={className}
      footer={cash.note ?? undefined}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Stat
          label="Cash balance"
          value={formatMoney(cash.cash_balance, currency, { compact: true })}
          hint={cash.cash_balance_as_of ? `As of ${formatDate(cash.cash_balance_as_of)}` : "No balance reported"}
        />
        <Stat
          label="Months of cover"
          value={cash.cash_months === null || cash.cash_months === undefined ? "Not available" : formatNumber(cash.cash_months, { decimals: 1 })}
          hint={
            cash.avg_monthly_operating_outflow
              ? `Average operating outflow ${formatMoney(cash.avg_monthly_operating_outflow, currency, { compact: true })} a month`
              : undefined
          }
        />
      </div>
      <dl className="mt-5 divide-y rounded-lg ring-1 ring-foreground/8">
        {flows.map((flow) => (
          <div key={flow.key} className="flex items-center justify-between px-3 py-2 text-[0.8125rem]">
            <dt className="text-muted-foreground">{flow.label} cash flow</dt>
            <dd className={cn("font-semibold tabular", (flow.value ?? 0) < 0 && "text-destructive")}>
              {flow.value === null || flow.value === undefined ? "Not available" : formatMoney(flow.value, currency, { compact: true, signed: true })}
            </dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

const GRADE: Record<string, { label: string; tone: string }> = {
  strong: { label: "Strong", tone: "text-[color-mix(in_oklch,var(--success),var(--foreground)_30%)]" },
  stable: { label: "Stable", tone: "text-foreground" },
  watch: { label: "Watch", tone: "text-[color-mix(in_oklch,var(--warning),var(--foreground)_45%)]" },
  at_risk: { label: "At risk", tone: "text-destructive" },
};

const COMPONENT_LABEL: Record<string, string> = {
  growth: "Growth",
  profitability: "Profitability",
  liquidity: "Liquidity",
  inventory: "Inventory",
  data_quality: "Data quality",
};

function rawValue(key: string, raw: number): string {
  switch (key) {
    case "growth":
    case "profitability":
    case "data_quality":
      return formatPercent(raw);
    case "liquidity":
      return `${formatNumber(raw, { decimals: 1 })} months`;
    case "inventory":
      return formatRatio(raw);
    default:
      return formatNumber(raw, { decimals: 2 });
  }
}

/** Business health score with its weighted components and stated limitations. */
export function HealthPanel({ health, className, dimmed }: { health: HealthScore | null | undefined; className?: string; dimmed?: boolean }) {
  if (!health || health.score === null) {
    return (
      <Panel title="Business health" className={className}>
        <EmptyState
          compact
          title="Not available"
          description={health ? "None of the score's components have data for this selection." : "The health score is shown to roles with finance access."}
        />
        {health?.limitations?.length ? <NoteList className="mt-2" notes={health.limitations} /> : null}
      </Panel>
    );
  }
  const grade = health.grade ? GRADE[health.grade] : undefined;
  return (
    <Panel
      title="Business health"
      description="A transparent heuristic, not a credit rating"
      dimmed={dimmed}
      className={className}
      footer={
        <details>
          <summary className="cursor-pointer font-medium text-foreground outline-none hover:underline focus-visible:underline">
            Limitations
          </summary>
          <NoteList className="mt-2" notes={health.limitations} />
        </details>
      }
    >
      <div className="flex items-end gap-3">
        <p className="text-[2.75rem] leading-none font-semibold tracking-[-0.03em]">{formatScore(health.score)}</p>
        <div className="pb-1">
          <p className="text-xs text-muted-foreground">out of 100</p>
          {grade ? <p className={cn("text-sm font-semibold", grade.tone)}>{grade.label}</p> : null}
        </div>
      </div>
      <ul className="mt-5 space-y-3.5">
        {health.components.map((c) => (
          <li key={c.key}>
            <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[0.8125rem]">
              <span className="font-medium">
                {COMPONENT_LABEL[c.key] ?? humanize(c.key)}
                <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                  weight {formatPercent(c.effective_weight, { decimals: 0 })}
                </span>
              </span>
              <span className="tabular">{formatScore(c.score)}</span>
            </div>
            <Meter value={c.score} label={`${COMPONENT_LABEL[c.key] ?? c.key} score`} />
            <p className="mt-1 text-xs text-muted-foreground">
              {humanize(c.raw_label)} {rawValue(c.key, c.raw)}
              {c.key === "inventory" && c.out_of_stock_rate !== undefined && c.out_of_stock_rate !== null
                ? `, out-of-stock rate ${formatPercent(c.out_of_stock_rate, { decimals: 2 })}`
                : ""}
              {c.key === "data_quality" && c.data_age_days !== undefined && c.data_age_days !== null
                ? `, latest data ${formatDays(c.data_age_days, 0)} old`
                : ""}
            </p>
          </li>
        ))}
      </ul>
      {health.excluded_components?.length ? (
        <Notice className="mt-4" tone="info">
          Excluded for lack of data: {health.excluded_components.map((k) => COMPONENT_LABEL[k] ?? humanize(k)).join(", ")}. The
          remaining weights were renormalized.
        </Notice>
      ) : null}
    </Panel>
  );
}
