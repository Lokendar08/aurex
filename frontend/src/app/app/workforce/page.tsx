"use client";

import { RequireAccess } from "@/components/app/access";
import { AppPage } from "@/components/app/app-page";
import { useChartView } from "@/components/app/charts/chart-parts";
import { SERIES_COLORS } from "@/components/app/charts/palette";
import { TrendChart, type TrendSeries } from "@/components/app/charts/trend-chart";
import { DataTable, type Column } from "@/components/app/data-table";
import { KpiLedger } from "@/components/app/kpi";
import { PageHeader, Panel, SectionHeading } from "@/components/app/page";
import { ChartSkeleton, EmptyState, ErrorState, Notice, TableSkeleton } from "@/components/app/states";
import { useFilters } from "@/hooks/use-filters";
import { useOrgQuery } from "@/hooks/use-org-query";
import { formatMoney, formatMonth, formatNumber, formatPercent, moneyTick } from "@/lib/app/format";
import { PERMISSIONS } from "@/lib/app/nav";
import type { Kpi, WorkforceMonth, WorkforceReport, WorkforceStore } from "@/lib/app/types";

export default function WorkforcePage() {
  return (
    <AppPage>
      <RequireAccess area="Workforce" permission={PERMISSIONS.workforceRead}>
        <Workforce />
      </RequireAccess>
    </AppPage>
  );
}

const sum = (rows: WorkforceMonth[], key: keyof WorkforceMonth) => {
  const values = rows.map((r) => r[key]).filter((v): v is number => typeof v === "number");
  return values.length ? values.reduce((a, b) => a + b, 0) : null;
};
const ratio = (a: number | null, b: number | null) => (a === null || b === null || Math.abs(b) < 1e-9 ? null : a / b);

function workforceKpis(data: WorkforceReport): Kpi[] {
  const months = data.monthly;
  const latest = months[months.length - 1];
  const hours = sum(months, "hours");
  const overtime = sum(months, "overtime");
  const laborCost = sum(months, "labor_cost");
  const storeHours = sum(months, "store_hours");
  const storeLabor = sum(months, "store_labor");
  const net = sum(months, "net");
  const txn = sum(months, "txn");
  const separations = sum(months, "separations");
  const headcounts = months.map((m) => m.headcount).filter((v): v is number => typeof v === "number");
  const avgHeadcount = headcounts.length ? headcounts.reduce((a, b) => a + b, 0) / headcounts.length : null;
  const base = {
    comparison: null,
    change: null,
    change_kind: "relative" as const,
    currency: null,
    estimated: false,
    source: "Workforce aggregates (system-of-record HRIS or payroll feed)",
  };
  const make = (k: Partial<Kpi> & Pick<Kpi, "key" | "label" | "value" | "unit" | "direction">, formula: string, description = ""): Kpi => ({
    ...base,
    status: k.value === null || k.value === undefined ? "missing_data" : "ok",
    note: null,
    definition: { formula, description },
    ...k,
  });
  return [
    make({ key: "headcount", label: "Headcount", value: latest?.headcount ?? null, unit: "count", direction: "up", note: latest ? `In ${formatMonth(latest.month)}` : null }, "Σ headcount reported for the latest month"),
    make({ key: "hours", label: "Hours worked", value: hours, unit: "count", direction: "up", note: "Period total" }, "Σ hours worked"),
    make({ key: "labor_cost", label: "Labor cost", value: laborCost, unit: "currency", currency: data.currency, direction: "down", note: "Period total" }, "Σ labor cost"),
    make({ key: "labor_cost_ratio", label: "Labor cost % of sales", value: ratio(storeLabor, net), unit: "percent", direction: "down" }, "Store payroll ÷ store net sales", "Head-office staff are excluded from the store ratio."),
    make({ key: "splh", label: "Sales per labor hour", value: ratio(net, storeHours), unit: "currency", currency: data.currency, direction: "up" }, "Store net sales ÷ store hours worked"),
    make({ key: "tplh", label: "Transactions per labor hour", value: ratio(txn, storeHours), unit: "count", direction: "up" }, "Store transactions ÷ store hours worked"),
    make({ key: "overtime_share", label: "Overtime share", value: ratio(overtime, hours), unit: "percent", direction: "down" }, "Overtime hours ÷ hours worked"),
    make(
      { key: "attrition", label: "Attrition", value: ratio(separations, avgHeadcount), unit: "percent", direction: "down", note: "Separations in the period ÷ average monthly headcount" },
      "Σ separations ÷ average headcount",
    ),
  ];
}

function MiniTrend({
  title,
  description,
  rows,
  series,
  yFormat,
  yWidth,
}: {
  title: string;
  description?: string;
  rows: WorkforceMonth[];
  series: TrendSeries[];
  yFormat: (v: number) => string;
  yWidth?: number;
}) {
  return (
    <Panel title={title} description={description}>
      <TrendChart
        ariaLabel={`${title} by month`}
        data={rows}
        xKey="month"
        xFormat={(v) => formatMonth(v).split(" ")[0]}
        tooltipTitle={formatMonth}
        yFormat={yFormat}
        series={series}
        height={200}
        yWidth={yWidth}
        legend={series.length > 1}
      />
    </Panel>
  );
}

function Workforce() {
  const filters = useFilters();
  const query = useOrgQuery<WorkforceReport>("/analytics/workforce", {
    query: filters.apiQuery,
    enabled: filters.customReady,
    keepPrevious: true,
  });
  const data = query.data;
  const [view, toggle] = useChartView("Monthly workforce", "table");

  const header = (
    <PageHeader
      title="Workforce"
      description="Headcount, hours, labor cost and productivity by month and store."
      meta={data ? <span>{data.period.label}</span> : null}
    />
  );
  if (!filters.customReady) {
    return (
      <>
        {header}
        <EmptyState title="Choose a date range" description="Pick a start and end date in the filter row." />
      </>
    );
  }
  if (query.isPending) {
    return (
      <>
        {header}
        <div className="space-y-6">
          <TableSkeleton rows={2} columns={4} />
          <div className="grid gap-6 lg:grid-cols-2">
            <Panel><ChartSkeleton height={200} /></Panel>
            <Panel><ChartSkeleton height={200} /></Panel>
          </div>
        </div>
      </>
    );
  }
  if (query.error || !data) {
    return (
      <>
        {header}
        <Panel>
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        </Panel>
      </>
    );
  }
  if (data.status !== "ok") {
    return (
      <>
        {header}
        <Panel>
          <EmptyState title="No workforce data for this period" description="Workforce aggregates arrive from the HRIS or payroll feed." />
        </Panel>
      </>
    );
  }

  const currency = data.currency;
  const money = (v: number) => formatMoney(v, currency, { compact: true });
  const monthColumns: Column<WorkforceMonth>[] = [
    { key: "month", header: "Month", sticky: true, cell: (r) => formatMonth(r.month), sortValue: (r) => r.month },
    { key: "headcount", header: "Headcount", align: "right", cell: (r) => formatNumber(r.headcount), sortValue: (r) => r.headcount },
    { key: "hours", header: "Hours", align: "right", cell: (r) => formatNumber(r.hours, { currency }), sortValue: (r) => r.hours },
    { key: "overtime", header: "Overtime hours", align: "right", cell: (r) => formatNumber(r.overtime, { currency }), sortValue: (r) => r.overtime },
    { key: "cost", header: "Labor cost", align: "right", cell: (r) => formatMoney(r.labor_cost, currency, { compact: true }), sortValue: (r) => r.labor_cost },
    { key: "ratio", header: "Labor % of sales", align: "right", cell: (r) => formatPercent(r.labor_cost_ratio), sortValue: (r) => r.labor_cost_ratio },
    { key: "splh", header: "Sales / labor hour", align: "right", cell: (r) => formatMoney(r.sales_per_labor_hour, currency), sortValue: (r) => r.sales_per_labor_hour },
    { key: "tplh", header: "Transactions / labor hour", align: "right", cell: (r) => formatNumber(r.transactions_per_labor_hour, { decimals: 2 }), sortValue: (r) => r.transactions_per_labor_hour },
    { key: "ot", header: "Overtime share", align: "right", cell: (r) => formatPercent(r.overtime_share), sortValue: (r) => r.overtime_share },
    { key: "attrition", header: "Attrition", align: "right", cell: (r) => formatPercent(r.attrition_rate), sortValue: (r) => r.attrition_rate },
  ];
  const storeColumns: Column<WorkforceStore>[] = [
    { key: "store", header: "Store", sticky: true, cell: (r) => <span className="font-medium">{r.store_code}</span>, sortValue: (r) => r.store_code },
    { key: "headcount", header: "Headcount (latest)", align: "right", cell: (r) => formatNumber(r.headcount), sortValue: (r) => r.headcount },
    { key: "hours", header: "Hours", align: "right", cell: (r) => formatNumber(r.hours, { currency }), sortValue: (r) => r.hours },
    { key: "cost", header: "Labor cost", align: "right", cell: (r) => formatMoney(r.labor_cost, currency, { compact: true }), sortValue: (r) => r.labor_cost },
    { key: "net", header: "Net sales", align: "right", cell: (r) => formatMoney(r.net_sales, currency, { compact: true }), sortValue: (r) => r.net_sales },
    { key: "ratio", header: "Labor % of sales", align: "right", cell: (r) => formatPercent(r.labor_cost_ratio), sortValue: (r) => r.labor_cost_ratio },
    { key: "splh", header: "Sales / labor hour", align: "right", cell: (r) => formatMoney(r.sales_per_labor_hour, currency), sortValue: (r) => r.sales_per_labor_hour },
    { key: "tplh", header: "Transactions / labor hour", align: "right", cell: (r) => formatNumber(r.transactions_per_labor_hour, { decimals: 2 }), sortValue: (r) => r.transactions_per_labor_hour },
    {
      key: "cpe",
      header: "Monthly cost per employee",
      align: "right",
      cell: (r) => formatMoney(r.avg_monthly_cost_per_employee, currency),
      sortValue: (r) => r.avg_monthly_cost_per_employee,
    },
  ];

  return (
    <>
      {header}
      <div className="space-y-6">
        <Notice>{data.note ?? "Workforce figures are aggregates by store and department. AUREX holds no individual employee records."}</Notice>
        <section aria-label="Workforce figures" className={query.isPlaceholderData ? "opacity-55" : undefined}>
          <KpiLedger kpis={workforceKpis(data)} currency={currency} />
        </section>

        <div className="grid gap-6 lg:grid-cols-2">
          <MiniTrend
            title="Headcount"
            description="All stores and head office"
            rows={data.monthly}
            series={[{ key: "headcount", label: "Headcount", color: SERIES_COLORS[0], kind: "bar", format: (v) => formatNumber(v) }]}
            yFormat={(v) => formatNumber(v, { compact: true })}
            yWidth={44}
          />
          <MiniTrend
            title="Labor cost"
            rows={data.monthly}
            series={[{ key: "labor_cost", label: "Labor cost", color: SERIES_COLORS[0], kind: "bar", format: money }]}
            yFormat={moneyTick(currency)}
          />
          <MiniTrend
            title="Labor cost % of sales"
            description="Store payroll ÷ store net sales"
            rows={data.monthly}
            series={[{ key: "labor_cost_ratio", label: "Labor % of sales", color: SERIES_COLORS[0], kind: "line", format: (v) => formatPercent(v) }]}
            yFormat={(v) => formatPercent(v, { decimals: 1 })}
            yWidth={52}
          />
          <MiniTrend
            title="Sales per labor hour"
            rows={data.monthly}
            series={[{ key: "sales_per_labor_hour", label: "Sales per labor hour", color: SERIES_COLORS[0], kind: "line", format: (v) => formatMoney(v, currency) }]}
            yFormat={(v) => formatMoney(v, currency, { compact: true })}
          />
          <MiniTrend
            title="Overtime and attrition"
            description="Both as a share; one scale"
            rows={data.monthly}
            series={[
              { key: "overtime_share", label: "Overtime share of hours", color: SERIES_COLORS[0], kind: "line", format: (v) => formatPercent(v) },
              { key: "attrition_rate", label: "Monthly attrition", color: SERIES_COLORS[1], kind: "line", format: (v) => formatPercent(v) },
            ]}
            yFormat={(v) => formatPercent(v, { decimals: 1 })}
            yWidth={48}
          />
          <MiniTrend
            title="Transactions per labor hour"
            rows={data.monthly}
            series={[{ key: "transactions_per_labor_hour", label: "Transactions per labor hour", color: SERIES_COLORS[0], kind: "line", format: (v) => formatNumber(v, { decimals: 2 }) }]}
            yFormat={(v) => formatNumber(v, { decimals: 1 })}
            yWidth={40}
          />
        </div>

        <SectionHeading title="Detail" />
        <Panel title="By month" description="All workforce figures per month" actions={toggle}>
          {view === "table" ? (
            <DataTable caption="Workforce by month" columns={monthColumns} rows={data.monthly} rowKey={(r) => r.month} defaultSort={{ key: "month", dir: "desc" }} dense />
          ) : (
            <TrendChart
              ariaLabel="Hours worked by month"
              data={data.monthly}
              xKey="month"
              xFormat={(v) => formatMonth(v).split(" ")[0]}
              tooltipTitle={formatMonth}
              yFormat={(v) => formatNumber(v, { compact: true })}
              series={[
                { key: "hours", label: "Hours worked", color: SERIES_COLORS[0], kind: "bar", format: (v) => formatNumber(v, { currency }) },
                { key: "overtime", label: "Overtime hours", color: SERIES_COLORS[1], kind: "bar", format: (v) => formatNumber(v, { currency }) },
              ]}
            />
          )}
        </Panel>
        <Panel title="By store" description={`Period totals; headcount is for ${data.latest_month ? formatMonth(data.latest_month) : "the latest month"}`}>
          <DataTable caption="Workforce by store" columns={storeColumns} rows={data.stores} rowKey={(r) => r.store_code} defaultSort={{ key: "store", dir: "asc" }} dense />
        </Panel>
      </div>
    </>
  );
}
