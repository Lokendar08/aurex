"use client";

import { CalendarRangeIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { RequireAccess } from "@/components/app/access";
import { AppPage } from "@/components/app/app-page";
import { FavourableBadge } from "@/components/app/badges";
import { useChartView } from "@/components/app/charts/chart-parts";
import { CONTEXT_COLOR, SERIES_COLORS } from "@/components/app/charts/palette";
import { TrendChart } from "@/components/app/charts/trend-chart";
import { DataTable, type Column } from "@/components/app/data-table";
import { ChangeIndicator, DefinitionButton, KpiLedger } from "@/components/app/kpi";
import { NoteList, PageHeader, Panel, SectionHeading } from "@/components/app/page";
import { CashPanel, expenseLabel, ExpenseBreakdownPanel } from "@/components/app/sections/finance";
import { ChartSkeleton, EmptyState, ErrorState, Notice, QueryView, TableSkeleton } from "@/components/app/states";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useFilters } from "@/hooks/use-filters";
import { useOrgQuery } from "@/hooks/use-org-query";
import {
  formatDate,
  formatMoney,
  formatMonth,
  formatPercent,
  formatPoints,
  formatZ,
  moneyTick,
  MISSING,
} from "@/lib/app/format";
import { PERMISSIONS } from "@/lib/app/nav";
import { budgetMetricLabel, isCostMetric, pnlKpis, pnlLines, type PnlLine } from "@/lib/app/pnl";
import type { BudgetRow, BudgetVsActual, ExpenseAnalysis, FinancialReport, MonthlyPnl, PnL } from "@/lib/app/types";
import { cn } from "@/lib/utils";

export default function FinancePage() {
  return (
    <AppPage>
      <RequireAccess area="Finance" permission={PERMISSIONS.financeRead}>
        <Finance />
      </RequireAccess>
    </AppPage>
  );
}

function Finance() {
  const filters = useFilters();
  const report = useOrgQuery<FinancialReport>("/analytics/financial", {
    query: filters.apiQuery,
    enabled: filters.customReady,
    keepPrevious: true,
  });
  const data = report.data;

  return (
    <>
      <PageHeader
        title="Finance"
        description="Profit and loss, budget against actual, expenses and cash for the selected period. Every line is computed from the system-of-record feeds."
        meta={
          data ? (
            <span className="inline-flex items-center gap-1.5">
              <CalendarRangeIcon className="size-4" aria-hidden />
              {data.period.label}: {formatDate(data.period.start)} to {formatDate(data.period.end)}
            </span>
          ) : null
        }
      />
      {!filters.customReady ? (
        <EmptyState title="Choose a date range" description="Pick a start and end date in the filter row." />
      ) : report.isPending ? (
        <div className="space-y-6">
          <TableSkeleton rows={2} columns={4} />
          <Panel>
            <TableSkeleton rows={10} columns={6} />
          </Panel>
        </div>
      ) : report.error || !data ? (
        <Panel>
          <ErrorState error={report.error} onRetry={() => void report.refetch()} />
        </Panel>
      ) : (
        <FinanceContent data={data} dimmed={report.isPlaceholderData} />
      )}
    </>
  );
}

function FinanceContent({ data, dimmed }: { data: FinancialReport; dimmed: boolean }) {
  const currency = data.currency;
  const kpis = pnlKpis(data.total, data.comparison, currency, data.definitions);
  return (
    <div className="space-y-6">
      <section aria-label="Profit and loss summary" className={dimmed ? "opacity-55 transition-opacity" : "transition-opacity"}>
        <KpiLedger kpis={kpis} currency={currency} comparisonLabel="(same period last year)" />
      </section>
      {data.total.notes.length ? (
        <Notice title="About this period">
          <NoteList notes={data.total.notes} />
        </Notice>
      ) : null}

      <PnlStatement data={data} dimmed={dimmed} />

      <SectionHeading title="Budget against actual" description="Favourable means revenue and profit above budget, or costs below it." />
      <BudgetSection />

      <SectionHeading title="Expenses and cash" />
      <ExpenseSection />
      <CashPanel cash={data.cash} currency={currency} dimmed={dimmed} />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Profit and loss statement
// ---------------------------------------------------------------------------------------------

function cellValue(line: PnlLine, pnl: PnL | null, currency: string): string {
  if (!pnl) return MISSING;
  const value = line.get(pnl);
  if (value === null || value === undefined) return MISSING;
  if (line.ratio) return formatPercent(value);
  const signed = line.sign === -1 ? -Math.abs(value) : value;
  return formatMoney(signed, currency, { compact: true });
}

function changeValue(line: PnlLine, current: PnL, previous: PnL) {
  const a = line.get(current);
  const b = line.get(previous);
  if (a === null || a === undefined || b === null || b === undefined) return null;
  if (line.ratio) return { value: a - b, text: formatPoints(a - b) };
  if (Math.abs(b) < 1e-9) return null;
  const rel = (a - b) / Math.abs(b);
  return { value: rel, text: formatPercent(rel, { signed: true }) };
}

function PnlStatement({ data, dimmed }: { data: FinancialReport; dimmed: boolean }) {
  const [mode, setMode] = useState<"monthly" | "summary">("monthly");
  const currency = data.currency;
  const categories = useMemo(
    () =>
      Array.from(
        new Set([
          ...Object.keys(data.total.expenses_by_category ?? {}),
          ...data.monthly.flatMap((m) => Object.keys(m.expenses_by_category ?? {})),
        ]),
      ),
    [data],
  );
  const lines = pnlLines(categories);
  const months: MonthlyPnl[] = mode === "monthly" ? data.monthly : [];
  const incompleteMonths = data.monthly.filter((m) => !m.expenses_complete).map((m) => m.label);
  const estimatedMonths = data.monthly.filter((m) => m.gross_profit_estimated).map((m) => m.label);

  return (
    <Panel
      title="Profit and loss statement"
      description={`${data.period.label}${mode === "monthly" ? ", by month" : ""}, with the same period last year`}
      dimmed={dimmed}
      actions={
        <ToggleGroup
          type="single"
          size="sm"
          variant="outline"
          spacing={0}
          value={mode}
          onValueChange={(value) => value && setMode(value as "monthly" | "summary")}
          aria-label="Statement layout"
        >
          <ToggleGroupItem value="monthly">Monthly</ToggleGroupItem>
          <ToggleGroupItem value="summary">Summary</ToggleGroupItem>
        </ToggleGroup>
      }
      footer={
        <NoteList
          notes={[
            "Deductions are shown as negative amounts. A dash means the figure is not available, never zero.",
            ...(estimatedMonths.length
              ? [`Gross profit includes an estimate for sales without cost data in ${estimatedMonths.join(", ")}.`]
              : []),
            ...(incompleteMonths.length
              ? [`Expenses are incomplete for ${incompleteMonths.join(", ")}, so profit below gross profit is not shown there.`]
              : []),
            ...(data.monthly.some((m) => m.partial) ? ["Months marked “partial” are clipped to the period or the latest data."] : []),
          ]}
        />
      }
    >
      <div className="relative w-full overflow-x-auto rounded-lg ring-1 ring-foreground/8" tabIndex={0} role="region" aria-label="Profit and loss statement">
        <table className="w-full border-collapse text-[0.8125rem]">
          <caption className="sr-only">Profit and loss statement</caption>
          <thead className="bg-muted/60">
            <tr className="border-b">
              <th scope="col" className="sticky left-0 z-[1] min-w-[11rem] bg-muted px-3 py-2 text-left font-medium text-muted-foreground">
                Line item
              </th>
              {months.map((m) => (
                <th key={m.month} scope="col" className="px-3 py-2 text-right font-medium whitespace-nowrap text-muted-foreground">
                  {formatMonth(m.month)}
                  {m.partial ? <span className="block text-[0.6875rem] font-normal">partial</span> : null}
                </th>
              ))}
              <th scope="col" className="border-l px-3 py-2 text-right font-semibold whitespace-nowrap text-foreground">
                Period total
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium whitespace-nowrap text-muted-foreground">
                Same period last year
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium whitespace-nowrap text-muted-foreground">
                Change
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              const change = changeValue(line, data.total, data.comparison);
              const definition = line.definitionKey ? data.definitions[line.definitionKey] : undefined;
              const strong = line.kind === "subtotal" || line.kind === "total";
              const direction = line.sign === -1 ? "down" : "up";
              return (
                <tr
                  key={line.key}
                  className={cn(
                    "border-b last:border-b-0",
                    strong && "bg-muted/30",
                    line.kind === "total" && "border-t-2 border-t-foreground/20",
                  )}
                >
                  <th
                    scope="row"
                    className={cn(
                      "sticky left-0 z-[1] bg-card px-3 py-2 text-left font-normal whitespace-nowrap",
                      strong && "bg-[color-mix(in_oklch,var(--muted)_30%,var(--card))] font-semibold",
                      line.kind === "ratio" && "text-muted-foreground italic",
                      line.kind === "detail" && "pl-7 text-muted-foreground",
                    )}
                  >
                    <span className="inline-flex items-center gap-1.5">
                      {line.kind === "detail" ? expenseLabel(line.label) : line.label}
                      {definition ? (
                        <DefinitionButton label={line.label} formula={definition.formula} description={definition.description} />
                      ) : null}
                    </span>
                  </th>
                  {months.map((m) => (
                    <td
                      key={m.month}
                      className={cn(
                        "px-3 py-2 text-right tabular whitespace-nowrap",
                        strong && "font-semibold",
                        line.kind === "detail" && "text-muted-foreground",
                        line.kind === "ratio" && "text-muted-foreground",
                      )}
                    >
                      {cellValue(line, m, currency)}
                      {line.key === "gross_profit" && m.gross_profit_estimated ? (
                        <span className="ml-0.5 text-warning" title="Includes an estimate">
                          *
                        </span>
                      ) : null}
                    </td>
                  ))}
                  <td className={cn("border-l px-3 py-2 text-right tabular whitespace-nowrap", strong ? "font-semibold" : "font-medium")}>
                    {cellValue(line, data.total, currency)}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap text-muted-foreground tabular">
                    {cellValue(line, data.comparison, currency)}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {change ? (
                      <ChangeIndicator change={change.value} direction={line.ratio ? "up" : direction}>
                        {change.text}
                      </ChangeIndicator>
                    ) : (
                      <span className="text-muted-foreground">{MISSING}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------------------------
// Budget against actual
// ---------------------------------------------------------------------------------------------

type MetricSummary = {
  metric: string;
  budget: number | null;
  actual: number | null;
  variance: number | null;
  variance_pct: number | null;
  favourable: boolean | null;
  months: number;
  prorated: boolean;
};

function summarize(rows: BudgetRow[]): MetricSummary[] {
  const groups = new Map<string, BudgetRow[]>();
  rows.forEach((row) => groups.set(row.metric, [...(groups.get(row.metric) ?? []), row]));
  const order = (metric: string) => (metric === "net_sales" ? 0 : metric === "cogs" ? 1 : metric === "gross_profit" ? 2 : 3);
  return Array.from(groups.entries())
    .map(([metric, items]) => {
      const complete = items.every((r) => r.actual !== null && r.budget !== null);
      const budget = items.reduce((sum, r) => sum + (r.budget ?? 0), 0);
      const actual = complete ? items.reduce((sum, r) => sum + (r.actual ?? 0), 0) : null;
      const variance = actual === null ? null : actual - budget;
      const variance_pct = variance === null || Math.abs(budget) < 1e-9 ? null : variance / Math.abs(budget);
      const favourable = variance === null ? null : isCostMetric(metric) ? variance <= 0 : variance >= 0;
      return { metric, budget, actual, variance, variance_pct, favourable, months: items.length, prorated: items.some((r) => r.prorated) };
    })
    .sort((a, b) => order(a.metric) - order(b.metric) || a.metric.localeCompare(b.metric));
}

function BudgetSection() {
  const filters = useFilters();
  const [version, setVersion] = useState<string>("all");
  const query = useOrgQuery<BudgetVsActual>("/analytics/budget-vs-actual", {
    query: { ...filters.apiQuery, version: version === "all" ? undefined : version },
    enabled: filters.customReady,
    keepPrevious: true,
  });
  const [view, toggle] = useChartView("Net sales against budget");

  return (
    <QueryView
      query={query}
      loading={
        <div className="grid gap-6 xl:grid-cols-2">
          <Panel>
            <TableSkeleton rows={6} columns={5} />
          </Panel>
          <Panel>
            <ChartSkeleton />
          </Panel>
        </div>
      }
    >
      {(data) => {
        if (data.status !== "ok" || data.rows.length === 0) {
          return (
            <Panel>
              <EmptyState title="No budget for this period" description={data.note ?? "Import budget lines to compare them with actuals."} />
            </Panel>
          );
        }
        const currency = data.currency;
        const summary = summarize(data.rows);
        const salesByMonth = data.rows
          .filter((r) => r.metric === "net_sales")
          .sort((a, b) => a.month.localeCompare(b.month))
          .map((r) => ({ month: r.month, actual: r.actual, budget: r.budget, prorated: r.prorated }));
        const columns: Column<MetricSummary>[] = [
          { key: "metric", header: "Line", cell: (r) => <span className="font-medium">{budgetMetricLabel(r.metric)}</span>, sortValue: (r) => r.metric },
          { key: "budget", header: "Budget", align: "right", cell: (r) => formatMoney(r.budget, currency, { compact: true }), sortValue: (r) => r.budget },
          { key: "actual", header: "Actual", align: "right", cell: (r) => formatMoney(r.actual, currency, { compact: true }), sortValue: (r) => r.actual },
          {
            key: "variance",
            header: "Variance",
            align: "right",
            cell: (r) => formatMoney(r.variance, currency, { compact: true, signed: true }),
            sortValue: (r) => r.variance,
          },
          { key: "pct", header: "Variance %", align: "right", cell: (r) => formatPercent(r.variance_pct, { signed: true }), sortValue: (r) => r.variance_pct },
          { key: "fav", header: "Assessment", cell: (r) => <FavourableBadge favourable={r.favourable} />, sortValue: (r) => (r.favourable === null ? 2 : r.favourable ? 0 : 1) },
        ];
        const monthColumns: Column<BudgetRow>[] = [
          { key: "month", header: "Month", cell: (r) => formatMonth(r.month) + (r.prorated ? " (prorated)" : ""), sortValue: (r) => r.month },
          { key: "metric", header: "Line", cell: (r) => budgetMetricLabel(r.metric), sortValue: (r) => r.metric },
          { key: "budget", header: "Budget", align: "right", cell: (r) => formatMoney(r.budget, currency, { compact: true }), sortValue: (r) => r.budget },
          { key: "actual", header: "Actual", align: "right", cell: (r) => formatMoney(r.actual, currency, { compact: true }), sortValue: (r) => r.actual },
          { key: "variance", header: "Variance", align: "right", cell: (r) => formatMoney(r.variance, currency, { compact: true, signed: true }), sortValue: (r) => r.variance },
          { key: "pct", header: "Variance %", align: "right", cell: (r) => formatPercent(r.variance_pct, { signed: true }), sortValue: (r) => r.variance_pct },
          { key: "fav", header: "Assessment", cell: (r) => <FavourableBadge favourable={r.favourable} />, sortValue: (r) => (r.favourable === null ? 2 : r.favourable ? 0 : 1) },
        ];
        return (
          <div className="space-y-6">
            <div className="grid gap-6 xl:grid-cols-5">
              <Panel
                className="xl:col-span-3"
                title="Totals for the period"
                description={data.period.label}
                dimmed={query.isPlaceholderData}
                actions={
                  data.versions && data.versions.length > 1 ? (
                    <div className="flex items-center gap-2">
                      <Label htmlFor="budget-version" className="text-xs text-muted-foreground">
                        Budget version
                      </Label>
                      <Select value={version} onValueChange={setVersion}>
                        <SelectTrigger id="budget-version" size="sm" className="max-w-[14rem]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent position="popper" align="end">
                          <SelectItem value="all">All versions</SelectItem>
                          {data.versions.map((v) => (
                            <SelectItem key={v} value={v}>
                              {v}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : null
                }
                footer={data.method}
              >
                <DataTable caption="Budget against actual by line" columns={columns} rows={summary} rowKey={(r) => r.metric} dense />
              </Panel>
              <Panel
                className="xl:col-span-2"
                title="Net sales against budget"
                description="Actual by month (columns) with the budget (line), one scale"
                actions={toggle}
                dimmed={query.isPlaceholderData}
              >
                {salesByMonth.length === 0 ? (
                  <EmptyState compact title="No net sales budget in this period" />
                ) : view === "chart" ? (
                  <TrendChart
                    ariaLabel="Net sales actual against budget by month"
                    data={salesByMonth}
                    xKey="month"
                    xFormat={(v) => formatMonth(v).split(" ")[0]}
                    tooltipTitle={formatMonth}
                    yFormat={moneyTick(currency)}
                    series={[
                      { key: "actual", label: "Actual", color: SERIES_COLORS[0], kind: "bar", format: (v) => formatMoney(v, currency, { compact: true }) },
                      { key: "budget", label: "Budget", color: CONTEXT_COLOR, kind: "line", format: (v) => formatMoney(v, currency, { compact: true }) },
                    ]}
                    height={250}
                  />
                ) : (
                  <DataTable
                    caption="Net sales actual against budget by month"
                    columns={monthColumns}
                    rows={data.rows.filter((r) => r.metric === "net_sales")}
                    rowKey={(r) => `${r.month}-${r.metric}`}
                    dense
                  />
                )}
              </Panel>
            </div>
            <Panel title="Month by month" description="Every budget line compared with its actual">
              <DataTable
                caption="Budget against actual by month and line"
                columns={monthColumns}
                rows={data.rows}
                rowKey={(r) => `${r.month}-${r.metric}`}
                defaultSort={{ key: "month", dir: "desc" }}
                pageSize={12}
                dense
              />
            </Panel>
          </div>
        );
      }}
    </QueryView>
  );
}

// ---------------------------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------------------------

function ExpenseSection() {
  const filters = useFilters();
  const query = useOrgQuery<ExpenseAnalysis>("/analytics/expenses", {
    query: filters.apiQuery,
    enabled: filters.customReady,
    keepPrevious: true,
  });
  const [view, toggle] = useChartView("Monthly expenses");
  return (
    <QueryView
      query={query}
      loading={
        <Panel>
          <ChartSkeleton />
        </Panel>
      }
    >
      {(data) => {
        if (data.status !== "ok") {
          return (
            <Panel>
              <EmptyState title="No expenses recorded" description="Expenses arrive from the accounting feed or a file import." />
            </Panel>
          );
        }
        const currency = data.currency;
        const monthlyTotals = Object.values(
          data.monthly.reduce<Record<string, { month: string; operating: number; other: number }>>((acc, row) => {
            const entry = (acc[row.month] ??= { month: row.month, operating: 0, other: 0 });
            if (["depreciation", "finance_costs", "income_tax"].includes(row.category)) entry.other += row.amount;
            else entry.operating += row.amount;
            return acc;
          }, {}),
        ).sort((a, b) => a.month.localeCompare(b.month));
        const anomalyColumns: Column<ExpenseAnalysis["anomalies"][number]>[] = [
          { key: "month", header: "Month", cell: (r) => formatMonth(r.month), sortValue: (r) => r.month },
          { key: "store", header: "Store", cell: (r) => r.store, sortValue: (r) => r.store },
          { key: "category", header: "Category", cell: (r) => expenseLabel(r.category), sortValue: (r) => r.category },
          { key: "amount", header: "Amount", align: "right", cell: (r) => formatMoney(r.amount, currency), sortValue: (r) => r.amount },
          { key: "mean", header: "Trailing 12-month mean", align: "right", cell: (r) => formatMoney(r.trailing_mean, currency), sortValue: (r) => r.trailing_mean },
          { key: "z", header: "Std. deviations", align: "right", cell: (r) => formatZ(r.z_score), sortValue: (r) => Math.abs(r.z_score) },
          {
            key: "ly",
            header: "vs same month last year",
            align: "right",
            cell: (r) =>
              r.change_vs_same_month_last_year === null ? (
                <span className="text-muted-foreground">No prior year</span>
              ) : (
                <ChangeIndicator change={r.change_vs_same_month_last_year} direction="down">
                  {formatPercent(r.change_vs_same_month_last_year, { signed: true })}
                </ChangeIndicator>
              ),
            sortValue: (r) => r.change_vs_same_month_last_year,
          },
        ];
        const categoryColumns: Column<ExpenseAnalysis["categories"][number]>[] = [
          { key: "category", header: "Category", cell: (r) => <span className="font-medium">{expenseLabel(r.category)}</span>, sortValue: (r) => r.category },
          { key: "section", header: "Section", cell: (r) => (r.section === "operating" ? "Operating" : "Below EBITDA"), sortValue: (r) => r.section },
          { key: "amount", header: "Amount", align: "right", cell: (r) => formatMoney(r.amount, currency, { compact: true }), sortValue: (r) => r.amount },
          { key: "share", header: "Share", align: "right", cell: (r) => formatPercent(r.share), sortValue: (r) => r.share },
        ];
        return (
          <div className="space-y-6">
            <div className="grid gap-6 xl:grid-cols-2">
              <ExpenseBreakdownPanel
                expenses={data.categories.map((c) => ({ category: c.category, amount: c.amount }))}
                currency={currency}
                dimmed={query.isPlaceholderData}
                description={`${formatMoney(data.total, currency, { compact: true })} in total for the period`}
              />
              <Panel title="Monthly expenses" description="Operating expenses and items below EBITDA, by ledger month" actions={toggle} dimmed={query.isPlaceholderData}>
                {view === "chart" ? (
                  <TrendChart
                    ariaLabel="Monthly expenses"
                    data={monthlyTotals}
                    xKey="month"
                    xFormat={(v) => formatMonth(v).split(" ")[0]}
                    tooltipTitle={formatMonth}
                    yFormat={moneyTick(currency)}
                    series={[
                      { key: "operating", label: "Operating expenses", color: SERIES_COLORS[0], kind: "bar", format: (v) => formatMoney(v, currency, { compact: true }) },
                      { key: "other", label: "Depreciation, finance costs and tax", color: SERIES_COLORS[1], kind: "bar", format: (v) => formatMoney(v, currency, { compact: true }) },
                    ]}
                    height={250}
                  />
                ) : (
                  <DataTable caption="Expenses by category" columns={categoryColumns} rows={data.categories} rowKey={(r) => r.category} defaultSort={{ key: "amount", dir: "desc" }} dense />
                )}
              </Panel>
            </div>
            <Panel
              title="Expense anomalies"
              description="Months that stand out against the same store and category’s own history"
              footer={data.method}
              dimmed={query.isPlaceholderData}
            >
              <DataTable
                caption="Expense anomalies"
                columns={anomalyColumns}
                rows={data.anomalies}
                rowKey={(r) => `${r.month}-${r.store}-${r.category}`}
                defaultSort={{ key: "z", dir: "desc" }}
                pageSize={8}
                dense
                empty={<EmptyState compact title="No anomalies in this period" description="No month moved more than three standard deviations from its trailing mean." />}
              />
            </Panel>
          </div>
        );
      }}
    </QueryView>
  );
}
