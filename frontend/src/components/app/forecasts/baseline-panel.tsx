"use client";

import { LockIcon } from "lucide-react";

import { useChartView } from "@/components/app/charts/chart-parts";
import { DataTable, type Column } from "@/components/app/data-table";
import { DetailList, NoteList, Panel } from "@/components/app/page";
import { EmptyState, TableSkeleton } from "@/components/app/states";
import { QueryError, ReliabilityBadge } from "@/components/app/decision-lab/common";
import { useOrgQuery } from "@/hooks/use-org-query";
import { ApiError } from "@/lib/api";
import { formatDate, formatMoney, formatMonth, formatPercent, humanize, MISSING } from "@/lib/app/format";
import { algorithmLabel } from "@/lib/app/forecasts-series";
import type { BaselineMonth, BaselineResponse } from "@/lib/app/forecasts-types";

import { ForecastChart } from "./forecast-chart";

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function sum(rows: BaselineMonth[], key: keyof BaselineMonth): number | null {
  let total = 0;
  for (const r of rows) {
    const v = r[key];
    if (!isNum(v)) return null;
    total += v;
  }
  return total;
}

export function BaselinePanel({ companyId, canSee }: { companyId?: string; canSee: boolean }) {
  const query = useOrgQuery<BaselineResponse>("/forecasts/baseline", {
    query: { months: 12, company_id: companyId },
    enabled: canSee,
    staleTime: 10 * 60_000,
    retry: false,
  });
  const [view, toggle] = useChartView("Twelve-month baseline");

  if (!canSee) {
    return (
      <Panel title="Twelve-month baseline P&L">
        <EmptyState
          compact
          icon={LockIcon}
          title="The baseline P&L needs finance access"
          description="It projects net sales from the active forecast and costs from the trailing cost structure. Ask an organization owner if your role should include finance figures."
        />
      </Panel>
    );
  }
  if (query.isPending) {
    return (
      <Panel title="Twelve-month baseline P&L">
        <TableSkeleton rows={6} columns={6} />
      </Panel>
    );
  }
  if (query.error || !query.data) {
    const notTrained = query.error instanceof ApiError && (query.error.code === "not_trained" || query.error.status === 422);
    return (
      <Panel title="Twelve-month baseline P&L">
        {notTrained ? (
          <EmptyState compact title="No baseline yet" description={query.error?.message} />
        ) : (
          <QueryError error={query.error} onRetry={() => void query.refetch()} />
        )}
      </Panel>
    );
  }
  const data = query.data;
  const currency = data.currency;
  const money = (v: number | null | undefined) => formatMoney(v ?? null, currency, { compact: true });
  const rows = data.months;
  const columns: Column<BaselineMonth>[] = [
    { key: "month", header: "Month", cell: (r) => formatMonth(r.month), sortValue: (r) => r.month },
    { key: "ns", header: "Net sales", align: "right", cell: (r) => money(r.net_sales), sortValue: (r) => r.net_sales },
    {
      key: "int",
      header: "80% interval",
      align: "right",
      cell: (r) => (isNum(r.net_sales_p10) && isNum(r.net_sales_p90) ? `${money(r.net_sales_p10)} – ${money(r.net_sales_p90)}` : MISSING),
    },
    { key: "cogs", header: "COGS", align: "right", cell: (r) => money(r.cogs) },
    { key: "gp", header: "Gross profit", align: "right", cell: (r) => money(r.gross_profit) },
    { key: "opex", header: "Operating expenses", align: "right", cell: (r) => money(r.operating_expenses) },
    { key: "ebitda", header: "EBITDA", align: "right", cell: (r) => money(r.ebitda) },
    { key: "np", header: "Net profit", align: "right", cell: (r) => money(r.net_profit), sortValue: (r) => r.net_profit },
    { key: "ocf", header: "Operating cash flow", align: "right", cell: (r) => money(r.operating_cash_flow) },
  ];
  const totals: [string, keyof BaselineMonth][] = [
    ["ns", "net_sales"],
    ["int", "net_sales_p10"],
    ["cogs", "cogs"],
    ["gp", "gross_profit"],
    ["opex", "operating_expenses"],
    ["ebitda", "ebitda"],
    ["np", "net_profit"],
    ["ocf", "operating_cash_flow"],
  ];
  const footer = (
    <tr>
      <th scope="row" className="px-3 py-2 text-left font-semibold">
        12 months
      </th>
      {totals.map(([key, field]) => (
        <td key={key} className="px-3 py-2 text-right font-semibold whitespace-nowrap tabular">
          {key === "int" ? <span className="font-normal text-muted-foreground">Not additive</span> : money(sum(rows, field))}
        </td>
      ))}
    </tr>
  );
  const assumptions = data.assumptions ?? {};
  const fixed = Object.entries(assumptions.fixed_costs_monthly ?? {}).sort((a, b) => b[1] - a[1]);
  const variable = Object.entries(assumptions.variable_cost_ratios ?? {});
  const source = data.revenue_source;
  return (
    <Panel
      title="Twelve-month baseline P&L"
      description={`What happens if nothing changes: net sales from the active forecast, costs from the trailing structure${data.first_month ? `, from ${formatMonth(data.first_month)}` : ""}`}
      actions={toggle}
      footer={<NoteList notes={data.notes} />}
    >
      <div className="space-y-5">
        {view === "chart" ? (
          <ForecastChart
            ariaLabel="Baseline net sales by month with 80% and 95% intervals"
            points={rows.map((r) => ({
              period: r.month,
              actual: null,
              yhat: r.net_sales,
              band80: isNum(r.net_sales_p10) && isNum(r.net_sales_p90) ? [r.net_sales_p10, r.net_sales_p90] : null,
              band95: isNum(r.net_sales_p025) && isNum(r.net_sales_p975) ? [r.net_sales_p025, r.net_sales_p975] : null,
            }))}
            unit="currency"
            currency={currency}
            period="month"
            forecastStart={null}
            showActual={false}
            height={240}
          />
        ) : (
          <DataTable caption="Twelve-month baseline P&L by month" columns={columns} rows={rows} rowKey={(r) => r.month} dense footer={footer} />
        )}
        <DetailList
          items={[
            {
              label: "Revenue from",
              value: source?.algorithm ? (
                <span className="inline-flex flex-wrap items-center gap-2">
                  {algorithmLabel(source.algorithm)} v{source.version ?? MISSING}
                  <ReliabilityBadge reliability={source.reliability} />
                  <span className="text-xs text-muted-foreground">daily WAPE {formatPercent(source.wape_daily)}</span>
                </span>
              ) : (
                "Not available"
              ),
            },
            { label: "Gross margin", value: formatPercent(assumptions.gross_margin ?? null) },
            { label: "Effective tax rate", value: formatPercent(assumptions.effective_tax_rate ?? null) },
            {
              label: "Cost window",
              value: assumptions.trailing_window
                ? `${formatDate(assumptions.trailing_window.start)} to ${formatDate(assumptions.trailing_window.end)}`
                : "Not available",
            },
            {
              label: "Variable costs (share of sales)",
              value: variable.length ? variable.map(([k, v]) => `${humanize(k)} ${formatPercent(v)}`).join(", ") : "None",
            },
            {
              label: "Fixed costs per month",
              value: fixed.length ? fixed.map(([k, v]) => `${humanize(k)} ${money(v)}`).join(", ") : "None",
            },
          ]}
        />
      </div>
    </Panel>
  );
}
