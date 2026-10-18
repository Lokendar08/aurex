"use client";

import { CalendarRangeIcon } from "lucide-react";

import { RequireAccess } from "@/components/app/access";
import { AppPage } from "@/components/app/app-page";
import { RiskBadge } from "@/components/app/badges";
import { useChartView } from "@/components/app/charts/chart-parts";
import { TrendChart } from "@/components/app/charts/trend-chart";
import { SERIES_COLORS } from "@/components/app/charts/palette";
import { DataTable, type Column } from "@/components/app/data-table";
import { KpiLedger } from "@/components/app/kpi";
import { NoteList, PageHeader, Panel, SectionHeading } from "@/components/app/page";
import {
  InventoryValuePanel,
  MethodNotes,
  OverstockTable,
  StockoutRiskTable,
  SupplierLeadTimes,
} from "@/components/app/sections/inventory";
import { useSession } from "@/components/app/session-provider";
import { ChartSkeleton, EmptyState, ErrorState, QueryView, TableSkeleton } from "@/components/app/states";
import { useFilters } from "@/hooks/use-filters";
import { useOrgQuery } from "@/hooks/use-org-query";
import { formatDate, formatMoney, formatPercent, formatShortDate } from "@/lib/app/format";
import { PERMISSIONS } from "@/lib/app/nav";
import type { InventoryReport, Kpi, SupplierReport } from "@/lib/app/types";

export default function InventoryPage() {
  return (
    <AppPage>
      <RequireAccess area="Inventory" permission={PERMISSIONS.inventoryRead}>
        <Inventory />
      </RequireAccess>
    </AppPage>
  );
}

function kpi(partial: Partial<Kpi> & Pick<Kpi, "key" | "label" | "value" | "unit">): Kpi {
  return {
    comparison: null,
    change: null,
    change_kind: "relative",
    currency: null,
    status: partial.value === null || partial.value === undefined ? "missing_data" : "ok",
    note: null,
    estimated: false,
    direction: "up",
    definition: { formula: null, description: null },
    source: null,
    ...partial,
  };
}

function inventoryKpis(data: InventoryReport): Kpi[] {
  const o = data.overview;
  const risks = data.risks;
  const counts = risks.risk_counts ?? {};
  const atRisk = (counts.stocked_out ?? 0) + (counts.high ?? 0) + (counts.medium ?? 0);
  const list: Kpi[] = [
    kpi({
      key: "latest_value",
      label: "Stock value at cost",
      value: o.status === "ok" ? (o.latest_inventory_value ?? null) : null,
      unit: "currency",
      currency: data.currency,
      note: o.latest_snapshot_date ? `Latest snapshot ${formatDate(o.latest_snapshot_date)}` : (o.note ?? null),
      definition: { formula: "Σ on hand × unit cost", description: "Value of the latest inventory snapshot in the period." },
    }),
    kpi({
      key: "average_value",
      label: "Average stock value",
      value: o.status === "ok" ? (o.average_inventory_value ?? null) : null,
      unit: "currency",
      currency: data.currency,
      note: o.snapshots_used ? `Mean of ${o.snapshots_used} ${o.snapshot_cadence ?? ""} snapshots` : null,
    }),
    kpi({
      key: "days_of_inventory",
      label: "Days of inventory",
      value: o.days_of_inventory?.value ?? null,
      unit: "days",
      direction: "down",
      status: o.days_of_inventory?.status ?? "missing_data",
      note: o.days_of_inventory?.note ?? null,
      definition: { formula: "Average inventory ÷ COGS × days", description: "How many days of sales the average stock covers." },
    }),
  ];
  if (o.inventory_turnover) {
    list.push(
      kpi({
        key: "inventory_turnover",
        label: "Inventory turnover",
        value: o.inventory_turnover.value,
        unit: "ratio",
        status: o.inventory_turnover.status,
        note: o.inventory_turnover.note === "annualized" ? "Annualized" : o.inventory_turnover.note,
        definition: { formula: "COGS ÷ average inventory at cost × 365 ÷ days", description: "Annualized." },
      }),
    );
  }
  if (o.gmroi) {
    list.push(
      kpi({
        key: "gmroi",
        label: "GMROI",
        value: o.gmroi.value,
        unit: "ratio",
        status: o.gmroi.status,
        note: o.gmroi.note === "annualized" ? "Annualized" : o.gmroi.note,
        definition: {
          formula: "Gross profit ÷ average inventory at cost × 365 ÷ days",
          description: "Gross margin earned per unit of average stock at cost, annualized.",
        },
      }),
    );
  }
  list.push(
    kpi({
      key: "at_risk",
      label: "Positions at stockout risk",
      value: risks.status === "ok" ? atRisk : null,
      unit: "count",
      direction: "down",
      note: risks.positions ? `Of ${risks.positions} store × product positions` : (risks.note ?? null),
    }),
    kpi({
      key: "overstock_value",
      label: "Excess stock value",
      value: risks.status === "ok" ? (risks.overstock_value_total ?? null) : null,
      unit: "currency",
      currency: data.currency,
      direction: "down",
      note: `${risks.overstock.length} overstocked positions`,
      definition: { formula: "Σ (on hand − demand × cover target) × unit cost", description: "Stock above the cover target, at cost." },
    }),
    kpi({
      key: "stockout_rate",
      label: "Out-of-stock rate, 30 days",
      value: data.recent_stockouts.status === "missing_data" ? null : (data.recent_stockouts.out_of_stock_rate ?? null),
      unit: "percent",
      direction: "down",
      status: data.recent_stockouts.status === "insufficient_granularity" ? "insufficient_granularity" : data.recent_stockouts.status === "ok" ? "ok" : "missing_data",
      note: data.recent_stockouts.note ?? (data.recent_stockouts.days_observed ? `${data.recent_stockouts.days_observed} days observed` : null),
      definition: { formula: "Σ items with zero stock ÷ Σ items, per daily snapshot", description: "Share of store × product positions with nothing on hand." },
    }),
  );
  return list;
}

function Inventory() {
  const { has } = useSession();
  const filters = useFilters();
  const query = useOrgQuery<InventoryReport>("/analytics/inventory", {
    query: filters.apiQuery,
    enabled: filters.customReady,
    keepPrevious: true,
  });
  const data = query.data;

  return (
    <>
      <PageHeader
        title="Inventory"
        description="Stock value, availability, stockout and overstock risk, and supplier lead times."
        meta={
          data ? (
            <span className="inline-flex items-center gap-1.5">
              <CalendarRangeIcon className="size-4" aria-hidden />
              {data.period.label}; positions as of {formatDate(data.risks.as_of ?? data.data_end)}
            </span>
          ) : null
        }
      />
      {!filters.customReady ? (
        <EmptyState title="Choose a date range" description="Pick a start and end date in the filter row." />
      ) : query.isPending ? (
        <div className="space-y-6">
          <TableSkeleton rows={2} columns={4} />
          <Panel>
            <ChartSkeleton />
          </Panel>
        </div>
      ) : query.error || !data ? (
        <Panel>
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        </Panel>
      ) : (
        <div className="space-y-6">
          <section aria-label="Inventory figures" className={query.isPlaceholderData ? "opacity-55" : undefined}>
            <KpiLedger kpis={inventoryKpis(data)} currency={data.currency} />
          </section>

          <div className="grid gap-6 xl:grid-cols-2">
            {data.overview.status === "ok" ? (
              <InventoryValuePanel inventory={data.overview} currency={data.currency} dimmed={query.isPlaceholderData} />
            ) : (
              <Panel title="Inventory value">
                <EmptyState compact title="No snapshots in this period" description={data.overview.note} />
              </Panel>
            )}
            <StockoutRatePanel data={data} />
          </div>

          <Panel
            title="Stockout risk"
            description="Positions whose cover (on hand plus open orders) may run out before a reorder could arrive"
            actions={
              data.risks.risk_counts ? (
                <div className="flex flex-wrap gap-1.5">
                  {(["stocked_out", "high", "medium"] as const).map((r) =>
                    data.risks.risk_counts?.[r] ? (
                      <span key={r} className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <RiskBadge risk={r} /> {data.risks.risk_counts[r]}
                      </span>
                    ) : null,
                  )}
                </div>
              ) : null
            }
            footer={<MethodNotes method={data.risks.method} limitations={data.risks.limitations} />}
            dimmed={query.isPlaceholderData}
          >
            {data.risks.status === "ok" ? (
              <StockoutRiskTable rows={data.risks.stockout_risks} currency={data.currency} />
            ) : (
              <EmptyState compact title="No recent inventory positions" description={data.risks.note} />
            )}
          </Panel>

          <Panel
            title="Overstock"
            description={`Stock beyond the cover target, valued at cost${
              data.risks.overstock_value_total ? `: ${formatMoney(data.risks.overstock_value_total, data.currency, { compact: true })} in total` : ""
            }`}
            dimmed={query.isPlaceholderData}
          >
            <OverstockTable rows={data.risks.overstock} currency={data.currency} />
          </Panel>

          {has(PERMISSIONS.suppliersRead) ? (
            <>
              <SectionHeading title="Suppliers" description="Lead times from received purchase orders in the period" />
              <SupplierSection />
            </>
          ) : null}
        </div>
      )}
    </>
  );
}

function StockoutRatePanel({ data }: { data: InventoryReport }) {
  const [view, toggle] = useChartView("Daily out-of-stock rate");
  const series = data.recent_stockouts.series ?? [];
  const columns: Column<{ date: string; rate: number }>[] = [
    { key: "date", header: "Day", cell: (r) => formatDate(r.date), sortValue: (r) => r.date },
    { key: "rate", header: "Out-of-stock rate", align: "right", cell: (r) => formatPercent(r.rate, { decimals: 2 }), sortValue: (r) => r.rate },
  ];
  return (
    <Panel
      title="Out-of-stock rate"
      description="Share of positions with no stock, last 30 days of snapshots"
      actions={toggle}
      footer={data.recent_stockouts.note ?? undefined}
    >
      {series.length === 0 ? (
        <EmptyState compact title="No daily snapshots in the last 30 days" />
      ) : view === "chart" ? (
        <TrendChart
          ariaLabel="Daily out-of-stock rate"
          data={series}
          xKey="date"
          xFormat={formatShortDate}
          tooltipTitle={formatDate}
          yFormat={(v) => formatPercent(v, { decimals: 2 })}
          series={[{ key: "rate", label: "Out-of-stock rate", color: SERIES_COLORS[0], kind: "line", format: (v) => formatPercent(v, { decimals: 2 }) }]}
          legend={false}
          height={240}
          yWidth={58}
        />
      ) : (
        <DataTable caption="Daily out-of-stock rate" columns={columns} rows={series} rowKey={(r) => r.date} dense maxHeight={300} defaultSort={{ key: "date", dir: "desc" }} />
      )}
    </Panel>
  );
}

function SupplierSection() {
  const filters = useFilters();
  const query = useOrgQuery<SupplierReport>("/analytics/suppliers", {
    query: filters.apiQuery,
    enabled: filters.customReady,
    keepPrevious: true,
  });
  return (
    <QueryView query={query} loading={<Panel><TableSkeleton /></Panel>}>
      {(data) =>
        data.status !== "ok" || data.suppliers.length === 0 ? (
          <Panel>
            <EmptyState title="No purchase orders in this period" description="Lead times are measured from received purchase orders." />
          </Panel>
        ) : (
          <Panel
            title="Supplier lead times"
            description={`${data.suppliers.filter((s) => s.alert).length} of ${data.suppliers.length} suppliers are slowing down`}
            footer={data.method ? <NoteList notes={[data.method]} /> : undefined}
            dimmed={query.isPlaceholderData}
          >
            <SupplierLeadTimes suppliers={data.suppliers} currency={data.currency} />
          </Panel>
        )
      }
    </QueryView>
  );
}
