"use client";

import { useChartView } from "@/components/app/charts/chart-parts";
import { CONTEXT_COLOR, SERIES_COLORS } from "@/components/app/charts/palette";
import { TrendChart } from "@/components/app/charts/trend-chart";
import { DataTable, type Column } from "@/components/app/data-table";
import { ChangeIndicator } from "@/components/app/kpi";
import { Panel } from "@/components/app/page";
import { EmptyState } from "@/components/app/states";
import {
  formatDate,
  formatMoney,
  formatMonth,
  formatNumber,
  formatPercent,
  formatShortDate,
  moneyTick,
  parseDate,
} from "@/lib/app/format";
import type { SeriesPoint } from "@/lib/app/types";

type Granularity = "day" | "week" | "month";

export function periodAxisLabel(value: string, granularity: Granularity): string {
  if (granularity === "month") {
    const date = parseDate(value);
    // Short month on the axis; the year appears on January and on the first tick.
    return date ? date.toLocaleDateString("en-GB", { month: "short" }) + (date.getMonth() === 0 ? ` ${String(date.getFullYear()).slice(2)}` : "") : value;
  }
  return formatShortDate(value);
}

export function periodTitle(value: string, granularity: Granularity): string {
  if (granularity === "month") return formatMonth(value);
  if (granularity === "week") return `Week of ${formatDate(value)}`;
  return formatDate(value);
}

function growth(current: number | null | undefined, previous: number | null | undefined): number | null {
  if (current === null || current === undefined || previous === null || previous === undefined || previous === 0) return null;
  return (current - previous) / Math.abs(previous);
}

/** Net sales for the period against the same days one year earlier (context series in grey). */
export function SalesTrendPanel({
  series,
  granularity,
  currency,
  dimmed,
  className,
  title = "Net sales",
  comparisonLabel = "Same period last year",
}: {
  series: SeriesPoint[];
  granularity: Granularity;
  currency: string;
  dimmed?: boolean;
  className?: string;
  title?: string;
  comparisonLabel?: string;
}) {
  const [view, toggle] = useChartView(title);
  const hasComparison = series.some((p) => p.comparison_net_sales !== null);
  const money = (v: number) => formatMoney(v, currency, { compact: true });
  const columns: Column<SeriesPoint>[] = [
    { key: "period", header: "Period", cell: (r) => periodTitle(r.period, granularity), sortValue: (r) => r.period },
    { key: "net", header: "Net sales", align: "right", cell: (r) => formatMoney(r.net_sales, currency), sortValue: (r) => r.net_sales },
    {
      key: "cmp",
      header: comparisonLabel,
      align: "right",
      cell: (r) => (r.comparison_net_sales === null ? "Not available" : formatMoney(r.comparison_net_sales, currency)),
      sortValue: (r) => r.comparison_net_sales,
    },
    {
      key: "chg",
      header: "Change",
      align: "right",
      cell: (r) => {
        const g = growth(r.net_sales, r.comparison_net_sales);
        return g === null ? "—" : <ChangeIndicator change={g}>{formatPercent(g, { signed: true })}</ChangeIndicator>;
      },
      sortValue: (r) => growth(r.net_sales, r.comparison_net_sales),
    },
    {
      key: "txn",
      header: "Transactions",
      align: "right",
      cell: (r) => formatNumber(r.transactions, { currency }),
      sortValue: (r) => r.transactions,
    },
  ];

  return (
    <Panel
      title={title}
      description={`${granularity === "month" ? "Monthly" : granularity === "week" ? "Weekly" : "Daily"} net sales${hasComparison ? `, with ${comparisonLabel.toLowerCase()} for context` : ""}`}
      actions={toggle}
      dimmed={dimmed}
      className={className}
    >
      {series.length === 0 ? (
        <EmptyState compact title="No sales in this period" description="Choose a different period or store selection." />
      ) : view === "chart" ? (
        <TrendChart
          ariaLabel={`${title} by ${granularity}`}
          data={series as unknown as Record<string, unknown>[]}
          xKey="period"
          xFormat={(v) => periodAxisLabel(v, granularity)}
          tooltipTitle={(v) => periodTitle(v, granularity)}
          yFormat={moneyTick(currency)}
          series={[
            { key: "net_sales", label: "Net sales", color: SERIES_COLORS[0], kind: "area", format: money },
            ...(hasComparison
              ? [{ key: "comparison_net_sales", label: comparisonLabel, color: CONTEXT_COLOR, kind: "line" as const, format: money }]
              : []),
          ]}
        />
      ) : (
        <DataTable caption={`${title} by period`} columns={columns} rows={series} rowKey={(r) => r.period} dense maxHeight={320} />
      )}
    </Panel>
  );
}

/** Gross profit per period (finance roles only; the field is absent for others). */
export function GrossProfitPanel({
  series,
  granularity,
  currency,
  dimmed,
  className,
}: {
  series: SeriesPoint[];
  granularity: Granularity;
  currency: string;
  dimmed?: boolean;
  className?: string;
}) {
  const [view, toggle] = useChartView("Gross profit");
  const points = series.map((p) => ({
    period: p.period,
    gross_profit: p.gross_profit ?? null,
    margin: p.gross_profit !== null && p.gross_profit !== undefined && p.net_sales ? p.gross_profit / p.net_sales : null,
  }));
  const missing = points.filter((p) => p.gross_profit === null).length;
  const columns: Column<(typeof points)[number]>[] = [
    { key: "period", header: "Period", cell: (r) => periodTitle(r.period, granularity), sortValue: (r) => r.period },
    {
      key: "gp",
      header: "Gross profit",
      align: "right",
      cell: (r) => (r.gross_profit === null ? "Not available" : formatMoney(r.gross_profit, currency)),
      sortValue: (r) => r.gross_profit,
    },
    {
      key: "margin",
      header: "Share of net sales",
      align: "right",
      cell: (r) => formatPercent(r.margin),
      sortValue: (r) => r.margin,
    },
  ];
  return (
    <Panel
      title="Gross profit"
      description="Cost-covered gross profit per period"
      actions={toggle}
      dimmed={dimmed}
      className={className}
      footer={
        missing
          ? `${missing} ${missing === 1 ? "period has" : "periods have"} no cost data, so gross profit is not shown there rather than shown as zero.`
          : undefined
      }
    >
      {points.length === 0 ? (
        <EmptyState compact title="No gross profit for this period" />
      ) : view === "chart" ? (
        <TrendChart
          ariaLabel={`Gross profit by ${granularity}`}
          data={points}
          xKey="period"
          xFormat={(v) => periodAxisLabel(v, granularity)}
          tooltipTitle={(v) => periodTitle(v, granularity)}
          yFormat={moneyTick(currency)}
          series={[
            {
              key: "gross_profit",
              label: "Gross profit",
              color: SERIES_COLORS[1],
              kind: "bar",
              format: (v) => formatMoney(v, currency, { compact: true }),
            },
          ]}
          legend={false}
          height={240}
        />
      ) : (
        <DataTable caption="Gross profit by period" columns={columns} rows={points} rowKey={(r) => r.period} dense maxHeight={300} />
      )}
    </Panel>
  );
}
