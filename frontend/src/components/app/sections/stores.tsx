"use client";

import { BarList } from "@/components/app/charts/bar-list";
import { useChartView } from "@/components/app/charts/chart-parts";
import { DataTable, type Column } from "@/components/app/data-table";
import { ChangeIndicator } from "@/components/app/kpi";
import { NoteList, Panel } from "@/components/app/page";
import { EmptyState } from "@/components/app/states";
import { formatMoney, formatNumber, formatPercent } from "@/lib/app/format";
import type { CategoryRow, StoreRow } from "@/lib/app/types";

function GrowthCell({ value, comparable }: { value: number | null | undefined; comparable?: boolean }) {
  if (comparable === false) return <span className="text-xs text-muted-foreground">New store</span>;
  if (value === null || value === undefined) return <span className="text-muted-foreground">—</span>;
  return <ChangeIndicator change={value}>{formatPercent(value, { signed: true })}</ChangeIndicator>;
}

export function storeColumns(currency: string, finance: boolean): Column<StoreRow>[] {
  const columns: Column<StoreRow>[] = [
    {
      key: "store",
      header: "Store",
      sticky: true,
      cell: (r) => (
        <span className="block min-w-[10rem]">
          <span className="font-medium">{r.name}</span>
          <span className="block text-xs text-muted-foreground">
            {r.code}
            {r.city ? `, ${r.city}` : ""}
          </span>
        </span>
      ),
      sortValue: (r) => r.code,
    },
    { key: "net", header: "Net sales", align: "right", cell: (r) => formatMoney(r.net_sales, currency, { compact: true }), sortValue: (r) => r.net_sales },
    {
      key: "growth",
      header: "Growth",
      align: "right",
      cell: (r) => <GrowthCell value={r.growth} comparable={r.comparable_store} />,
      sortValue: (r) => (r.comparable_store ? r.growth : null),
    },
  ];
  if (finance) {
    columns.push(
      { key: "gm", header: "Gross margin", align: "right", cell: (r) => formatPercent(r.gross_margin), sortValue: (r) => r.gross_margin },
      {
        key: "contribution",
        header: "Store contribution",
        align: "right",
        cell: (r) => formatMoney(r.store_contribution, currency, { compact: true }),
        sortValue: (r) => r.store_contribution,
      },
      {
        key: "cm",
        header: "Contribution margin",
        align: "right",
        cell: (r) => formatPercent(r.store_contribution_margin),
        sortValue: (r) => r.store_contribution_margin,
      },
    );
  }
  columns.push(
    {
      key: "sqft",
      header: "Sales / sq ft (yr)",
      align: "right",
      cell: (r) => formatMoney(r.sales_per_sqft_annualized, currency),
      sortValue: (r) => r.sales_per_sqft_annualized,
    },
    {
      key: "splh",
      header: "Sales / labor hour",
      align: "right",
      cell: (r) => formatMoney(r.sales_per_labor_hour, currency),
      sortValue: (r) => r.sales_per_labor_hour,
    },
    {
      key: "txn",
      header: "Transactions",
      align: "right",
      cell: (r) => formatNumber(r.transactions, { currency }),
      sortValue: (r) => r.transactions,
    },
    {
      key: "basket",
      header: "Average basket",
      align: "right",
      cell: (r) => formatMoney(r.average_basket, currency),
      sortValue: (r) => r.average_basket,
    },
  );
  return columns;
}

/** Store ranking (bars) with a full productivity table behind the toggle. */
export function StoresPanel({
  stores,
  currency,
  finance,
  notes,
  dimmed,
  className,
  title = "Stores",
  initialView = "chart",
}: {
  stores: StoreRow[];
  currency: string;
  finance: boolean;
  notes?: string[];
  dimmed?: boolean;
  className?: string;
  title?: string;
  initialView?: "chart" | "table";
}) {
  const [view, toggle] = useChartView(title, initialView);
  const ranked = [...stores].sort((a, b) => (b.net_sales ?? -Infinity) - (a.net_sales ?? -Infinity));
  return (
    <Panel
      title={title}
      description={finance ? "Net sales by store; the table adds margin, contribution and productivity" : "Net sales by store; the table adds productivity"}
      actions={toggle}
      dimmed={dimmed}
      className={className}
      footer={notes?.length ? <NoteList notes={notes} /> : undefined}
    >
      {stores.length === 0 ? (
        <EmptyState compact title="No stores in this selection" />
      ) : view === "chart" ? (
        <BarList
          label="Net sales by store"
          items={ranked.map((s) => ({
            key: s.store_id,
            label: s.name,
            sublabel: `${s.code}${s.city ? `, ${s.city}` : ""}`,
            value: s.net_sales,
            display: formatMoney(s.net_sales, currency, { compact: true }),
            aside: s.comparable_store ? formatPercent(s.growth, { signed: true }) : "New",
          }))}
        />
      ) : (
        <DataTable
          caption="Store productivity"
          columns={storeColumns(currency, finance)}
          rows={stores}
          rowKey={(r) => r.store_id}
          defaultSort={{ key: "net", dir: "desc" }}
          dense
        />
      )}
    </Panel>
  );
}

/** Category mix: share of net sales per category (bars), growth alongside. */
export function CategoryMixPanel({
  categories,
  currency,
  dimmed,
  className,
}: {
  categories: CategoryRow[];
  currency: string;
  dimmed?: boolean;
  className?: string;
}) {
  const [view, toggle] = useChartView("Category mix");
  const hasMargin = categories.some((c) => c.gross_margin !== undefined);
  const columns: Column<CategoryRow>[] = [
    { key: "category", header: "Category", cell: (r) => <span className="font-medium">{r.category}</span>, sortValue: (r) => r.category },
    { key: "net", header: "Net sales", align: "right", cell: (r) => formatMoney(r.net_sales, currency, { compact: true }), sortValue: (r) => r.net_sales },
    { key: "share", header: "Share", align: "right", cell: (r) => formatPercent(r.share), sortValue: (r) => r.share },
    { key: "units", header: "Units", align: "right", cell: (r) => formatNumber(r.units, { currency }), sortValue: (r) => r.units },
    ...(hasMargin
      ? [{ key: "gm", header: "Gross margin", align: "right" as const, cell: (r: CategoryRow) => formatPercent(r.gross_margin), sortValue: (r: CategoryRow) => r.gross_margin }]
      : []),
    {
      key: "growth",
      header: "Growth",
      align: "right",
      cell: (r) => <GrowthCell value={r.growth} />,
      sortValue: (r) => r.growth,
    },
  ];
  return (
    <Panel title="Category mix" description="Share of net sales by category" actions={toggle} dimmed={dimmed} className={className}>
      {categories.length === 0 ? (
        <EmptyState compact title="No category sales in this period" />
      ) : view === "chart" ? (
        <BarList
          label="Share of net sales by category"
          max={Math.max(...categories.map((c) => c.share ?? 0))}
          items={categories.map((c) => ({
            key: c.category_code ?? c.category,
            label: c.category,
            value: c.share,
            display: formatPercent(c.share),
            aside: formatMoney(c.net_sales, currency, { compact: true }),
          }))}
        />
      ) : (
        <DataTable caption="Category performance" columns={columns} rows={categories} rowKey={(r) => r.category_code ?? r.category} defaultSort={{ key: "net", dir: "desc" }} dense />
      )}
    </Panel>
  );
}
