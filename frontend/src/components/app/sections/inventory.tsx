"use client";

import { TriangleAlertIcon } from "lucide-react";

import { RiskBadge, StatusBadge } from "@/components/app/badges";
import { useChartView } from "@/components/app/charts/chart-parts";
import { SERIES_COLORS } from "@/components/app/charts/palette";
import { Sparkline } from "@/components/app/charts/sparkline";
import { TrendChart } from "@/components/app/charts/trend-chart";
import { DataTable, type Column } from "@/components/app/data-table";
import { ChangeIndicator } from "@/components/app/kpi";
import { NoteList, Panel, Stat } from "@/components/app/page";
import { EmptyState } from "@/components/app/states";
import {
  formatDate,
  formatDays,
  formatMoney,
  formatNumber,
  formatPercent,
  formatRatio,
  formatShortDate,
  moneyTick,
} from "@/lib/app/format";
import type { InventoryOverview, InventoryPosition, StockoutRecent, SupplierRow } from "@/lib/app/types";

/** Inventory value, turnover, days of inventory and recent stockout rate. */
export function InventorySnapshotPanel({
  inventory,
  stockouts,
  currency,
  dimmed,
  className,
}: {
  inventory: InventoryOverview | null | undefined;
  stockouts: StockoutRecent | null | undefined;
  currency: string;
  dimmed?: boolean;
  className?: string;
}) {
  if (!inventory || inventory.status !== "ok") {
    return (
      <Panel title="Inventory" description="Stock value and availability" className={className}>
        <EmptyState
          compact
          title={inventory ? "No inventory snapshots in this period" : "Inventory is not part of your role"}
          description={inventory?.note ?? undefined}
        />
      </Panel>
    );
  }
  const turnover = inventory.inventory_turnover;
  return (
    <Panel
      title="Inventory"
      description={`${inventory.snapshots_used ?? 0} ${inventory.snapshot_cadence ?? ""} snapshots in the period`}
      dimmed={dimmed}
      className={className}
    >
      <div className="grid grid-cols-2 gap-x-4 gap-y-5">
        <Stat
          label="Latest stock value"
          value={formatMoney(inventory.latest_inventory_value, currency, { compact: true })}
          hint={inventory.latest_snapshot_date ? `At cost, ${formatDate(inventory.latest_snapshot_date)}` : undefined}
        />
        <Stat
          label="Days of inventory"
          value={inventory.days_of_inventory?.value === null || inventory.days_of_inventory?.value === undefined ? "Not available" : formatDays(inventory.days_of_inventory.value)}
          hint={inventory.days_of_inventory?.note ?? "Average inventory ÷ COGS × days"}
        />
        {turnover ? (
          <Stat
            label="Inventory turnover"
            value={turnover.value === null ? "Not available" : formatRatio(turnover.value)}
            hint={turnover.note ? `Annualized${turnover.note === "annualized" ? "" : `, ${turnover.note}`}` : undefined}
          />
        ) : null}
        <Stat
          label="Out-of-stock rate, 30 days"
          value={
            stockouts?.status === "ok" || stockouts?.status === "insufficient_granularity"
              ? formatPercent(stockouts.out_of_stock_rate, { decimals: 2 })
              : "Not available"
          }
          hint={stockouts?.note ?? (stockouts?.days_observed ? `${stockouts.days_observed} days observed` : undefined)}
        />
      </div>
      <div className="mt-5">
        <p className="mb-1 text-xs text-muted-foreground">Stock value over the period</p>
        <Sparkline data={inventory.series} dataKey="value" color={SERIES_COLORS[0]} />
      </div>
    </Panel>
  );
}

/** Inventory value series (daily or weekly snapshots). */
export function InventoryValuePanel({
  inventory,
  currency,
  dimmed,
  className,
}: {
  inventory: InventoryOverview;
  currency: string;
  dimmed?: boolean;
  className?: string;
}) {
  const [view, toggle] = useChartView("Inventory value");
  const columns: Column<{ date: string; value: number }>[] = [
    { key: "date", header: "Snapshot", cell: (r) => formatDate(r.date), sortValue: (r) => r.date },
    { key: "value", header: "Value at cost", align: "right", cell: (r) => formatMoney(r.value, currency), sortValue: (r) => r.value },
  ];
  return (
    <Panel title="Inventory value" description="Total stock at cost per snapshot" actions={toggle} dimmed={dimmed} className={className}>
      {inventory.series.length === 0 ? (
        <EmptyState compact title="No snapshots in this period" />
      ) : view === "chart" ? (
        <TrendChart
          ariaLabel="Inventory value over time"
          data={inventory.series}
          timeAxis
          xKey="date"
          xFormat={formatShortDate}
          tooltipTitle={formatDate}
          yFormat={moneyTick(currency)}
          series={[{ key: "value", label: "Inventory value", color: SERIES_COLORS[0], kind: "area", format: (v) => formatMoney(v, currency, { compact: true }) }]}
          legend={false}
          height={240}
        />
      ) : (
        <DataTable caption="Inventory value by snapshot" columns={columns} rows={inventory.series} rowKey={(r) => r.date} dense maxHeight={300} defaultSort={{ key: "date", dir: "desc" }} />
      )}
    </Panel>
  );
}

function coverText(value: number | null) {
  return value === null ? "No recent sales" : formatDays(value);
}

/** Positions whose cover (on hand + open orders) runs out before a reorder could arrive. */
export function StockoutRiskTable({ rows, currency, pageSize = 10 }: { rows: InventoryPosition[]; currency: string; pageSize?: number }) {
  const columns: Column<InventoryPosition>[] = [
    { key: "risk", header: "Risk", cell: (r) => <RiskBadge risk={r.risk} />, sortValue: (r) => ({ stocked_out: 0, high: 1, medium: 2 })[r.risk as string] ?? 3 },
    {
      key: "product",
      header: "Product",
      cell: (r) => (
        <span className="block min-w-[11rem]">
          <span className="font-medium">{r.product}</span>
          <span className="block text-xs text-muted-foreground">
            <span className="font-mono">{r.sku}</span>
            {r.category ? `, ${r.category}` : ""}
          </span>
        </span>
      ),
      sortValue: (r) => r.product,
    },
    { key: "store", header: "Store", cell: (r) => <span title={r.store}>{r.store_code}</span>, sortValue: (r) => r.store_code },
    { key: "on_hand", header: "On hand", align: "right", cell: (r) => formatNumber(r.on_hand_qty, { currency }), sortValue: (r) => r.on_hand_qty },
    { key: "on_order", header: "On order", align: "right", cell: (r) => formatNumber(r.on_order_qty, { currency }), sortValue: (r) => r.on_order_qty },
    { key: "demand", header: "Daily demand", align: "right", cell: (r) => formatNumber(r.avg_daily_demand, { decimals: 1 }), sortValue: (r) => r.avg_daily_demand },
    { key: "cover", header: "Days of cover", align: "right", cell: (r) => coverText(r.days_of_cover), sortValue: (r) => r.days_of_cover },
    { key: "lead", header: "Lead time", align: "right", cell: (r) => formatDays(r.lead_time_days), sortValue: (r) => r.lead_time_days },
    {
      key: "projected",
      header: "Projected stockout",
      align: "right",
      cell: (r) => (r.projected_stockout_date ? formatDate(r.projected_stockout_date) : "—"),
      sortValue: (r) => r.projected_stockout_date,
    },
    { key: "supplier", header: "Supplier", cell: (r) => <span className="block max-w-[14rem] truncate" title={r.supplier ?? undefined}>{r.supplier ?? "—"}</span>, sortValue: (r) => r.supplier },
  ];
  return (
    <DataTable
      caption="Stockout risks"
      columns={columns}
      rows={rows}
      rowKey={(r) => `${r.store_code}-${r.sku}`}
      defaultSort={{ key: "risk", dir: "asc" }}
      pageSize={pageSize}
      dense
      empty={<EmptyState compact title="No stockout risks" description="Every position has more cover than its supplier lead time plus buffer." />}
    />
  );
}

/** Positions with more stock than about two lead-time cycles of demand, valued at cost. */
export function OverstockTable({ rows, currency, pageSize = 10 }: { rows: InventoryPosition[]; currency: string; pageSize?: number }) {
  const columns: Column<InventoryPosition>[] = [
    {
      key: "product",
      header: "Product",
      cell: (r) => (
        <span className="block min-w-[11rem]">
          <span className="font-medium">{r.product}</span>
          <span className="block text-xs text-muted-foreground">
            <span className="font-mono">{r.sku}</span>
            {r.category ? `, ${r.category}` : ""}
          </span>
        </span>
      ),
      sortValue: (r) => r.product,
    },
    { key: "store", header: "Store", cell: (r) => <span title={r.store}>{r.store_code}</span>, sortValue: (r) => r.store_code },
    { key: "on_hand", header: "On hand", align: "right", cell: (r) => formatNumber(r.on_hand_qty, { currency }), sortValue: (r) => r.on_hand_qty },
    { key: "cover", header: "Days of cover", align: "right", cell: (r) => coverText(r.days_of_cover), sortValue: (r) => r.days_of_cover },
    { key: "excess_units", header: "Excess units", align: "right", cell: (r) => formatNumber(r.excess_units, { currency }), sortValue: (r) => r.excess_units },
    {
      key: "excess_value",
      header: "Excess value",
      align: "right",
      cell: (r) => <span className="font-medium">{formatMoney(r.excess_value, currency)}</span>,
      sortValue: (r) => r.excess_value,
    },
    { key: "value", header: "Stock value", align: "right", cell: (r) => formatMoney(r.inventory_value, currency), sortValue: (r) => r.inventory_value },
  ];
  return (
    <DataTable
      caption="Overstock positions"
      columns={columns}
      rows={rows}
      rowKey={(r) => `${r.store_code}-${r.sku}`}
      defaultSort={{ key: "excess_value", dir: "desc" }}
      pageSize={pageSize}
      dense
      empty={<EmptyState compact title="No overstock" description="No position holds more than its cover target." />}
    />
  );
}

/** Supplier lead times: average received lead time against contract, on-time rate and drift alerts. */
export function SupplierLeadTimes({ suppliers, currency }: { suppliers: SupplierRow[]; currency: string }) {
  const [view, toggle] = useChartView("Supplier lead times", "chart");
  const maxLead = Math.max(1, ...suppliers.map((s) => Math.max(s.avg_lead_days ?? 0, s.contracted_lead_days ?? 0, s.p90_lead_days ?? 0)));
  const columns: Column<SupplierRow>[] = [
    {
      key: "supplier",
      header: "Supplier",
      cell: (r) => (
        <span className="block min-w-[12rem]">
          <span className="font-medium">{r.supplier}</span>
          <span className="block font-mono text-xs text-muted-foreground">{r.supplier_code}</span>
        </span>
      ),
      sortValue: (r) => r.supplier,
    },
    { key: "orders", header: "Orders", align: "right", cell: (r) => formatNumber(r.orders, { currency }), sortValue: (r) => r.orders },
    { key: "open", header: "Open", align: "right", cell: (r) => formatNumber(r.open_orders, { currency }), sortValue: (r) => r.open_orders },
    { key: "spend", header: "Spend", align: "right", cell: (r) => formatMoney(r.spend, currency, { compact: true }), sortValue: (r) => r.spend },
    { key: "contracted", header: "Contracted", align: "right", cell: (r) => formatDays(r.contracted_lead_days), sortValue: (r) => r.contracted_lead_days },
    { key: "avg", header: "Average", align: "right", cell: (r) => formatDays(r.avg_lead_days), sortValue: (r) => r.avg_lead_days },
    { key: "p90", header: "90th pct.", align: "right", cell: (r) => formatDays(r.p90_lead_days), sortValue: (r) => r.p90_lead_days },
    { key: "recent", header: "Last 60 days", align: "right", cell: (r) => formatDays(r.recent_avg_lead_days), sortValue: (r) => r.recent_avg_lead_days },
    {
      key: "trend",
      header: "Change",
      align: "right",
      cell: (r) =>
        r.lead_time_change_recent_vs_prior === null ? (
          "—"
        ) : (
          <ChangeIndicator change={r.lead_time_change_recent_vs_prior} direction="down">
            {formatPercent(r.lead_time_change_recent_vs_prior, { signed: true })}
          </ChangeIndicator>
        ),
      sortValue: (r) => r.lead_time_change_recent_vs_prior,
    },
    { key: "ontime", header: "On time", align: "right", cell: (r) => formatPercent(r.on_time_rate), sortValue: (r) => r.on_time_rate },
    {
      key: "alert",
      header: "Alert",
      cell: (r) => (r.alert ? <StatusBadge tone="danger" icon={TriangleAlertIcon}>Slowing</StatusBadge> : <span className="text-muted-foreground">—</span>),
      sortValue: (r) => (r.alert ? 0 : 1),
    },
  ];
  return (
    <div className="space-y-3">
      <div className="flex justify-end">{toggle}</div>
      {view === "chart" ? (
        <ul className="space-y-3" aria-label="Average lead time by supplier against contracted lead time">
          {[...suppliers]
            .sort((a, b) => (b.avg_lead_days ?? 0) - (a.avg_lead_days ?? 0))
            .map((s) => {
              const avg = s.avg_lead_days;
              const contracted = s.contracted_lead_days;
              return (
                <li key={s.supplier_code} className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-x-3 gap-y-1">
                  <p className="min-w-0 truncate text-[0.8125rem] font-medium">
                    {s.supplier}
                    {s.alert ? (
                      <StatusBadge tone="danger" icon={TriangleAlertIcon} className="ml-2 align-middle">
                        Slowing
                      </StatusBadge>
                    ) : null}
                  </p>
                  <p className="text-right text-[0.8125rem] tabular">
                    <span className="font-semibold">{formatDays(avg)}</span>
                    <span className="ml-1.5 text-xs text-muted-foreground">contract {formatDays(contracted, 0)}</span>
                  </p>
                  <div className="relative col-span-2 h-2" aria-hidden>
                    {avg !== null ? (
                      <div
                        className="h-2 rounded-r-[4px]"
                        style={{ width: `${(avg / maxLead) * 100}%`, background: SERIES_COLORS[0] }}
                      />
                    ) : null}
                    {contracted !== null ? (
                      <span
                        className="absolute -top-1 h-4 w-0.5 rounded-full bg-foreground"
                        style={{ left: `calc(${(contracted / maxLead) * 100}% - 1px)` }}
                      />
                    ) : null}
                  </div>
                </li>
              );
            })}
        </ul>
      ) : (
        <DataTable caption="Supplier performance" columns={columns} rows={suppliers} rowKey={(r) => r.supplier_code} defaultSort={{ key: "spend", dir: "desc" }} dense />
      )}
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="h-2 w-3 rounded-r-[3px]" style={{ background: SERIES_COLORS[0] }} /> Average received lead time
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="h-3 w-0.5 rounded-full bg-foreground" /> Contracted lead time
        </li>
      </ul>
    </div>
  );
}

export function MethodNotes({ method, limitations }: { method?: string; limitations?: string[] }) {
  const notes = [...(method ? [method] : []), ...(limitations ?? [])];
  return <NoteList notes={notes} />;
}
