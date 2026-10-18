"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useId, useState } from "react";

import { RequireAccess } from "@/components/app/access";
import { AppPage } from "@/components/app/app-page";
import { Waterfall } from "@/components/app/charts/waterfall";
import { DataTable, type Column } from "@/components/app/data-table";
import { ChangeIndicator } from "@/components/app/kpi";
import { NoteList, PageHeader, Panel, Stat } from "@/components/app/page";
import { CategoryMixPanel, StoresPanel } from "@/components/app/sections/stores";
import { useSession } from "@/components/app/session-provider";
import { EmptyState, ErrorState, QueryView, TableSkeleton } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useFilterOptions } from "@/hooks/use-filter-options";
import { useFilters } from "@/hooks/use-filters";
import { useOrgQuery, type QueryParams } from "@/hooks/use-org-query";
import { formatDate, formatMoney, formatNumber, formatPercent } from "@/lib/app/format";
import { PERMISSIONS } from "@/lib/app/nav";
import type { CategoriesReport, ProductRow, RevenueBridge, StoresReport } from "@/lib/app/types";

export default function AnalyticsPage() {
  return (
    <AppPage>
      <RequireAccess area="Analytics" permission={PERMISSIONS.salesRead}>
        <Analytics />
      </RequireAccess>
    </AppPage>
  );
}

const VIEWS = ["stores", "categories", "bridge"] as const;
type View = (typeof VIEWS)[number];

function Analytics() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const requested = params.get("view") as View | null;
  const view: View = requested && VIEWS.includes(requested) ? requested : "stores";

  function setView(next: string) {
    const query = new URLSearchParams(params.toString());
    if (next === "stores") query.delete("view");
    else query.set("view", next);
    const qs = query.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  return (
    <>
      <PageHeader
        title="Analytics"
        description="Store and category performance, product rankings, and what drove the change in net sales between two periods."
      />
      <Tabs value={view} onValueChange={setView}>
        <TabsList className="mb-4 max-w-full flex-wrap justify-start group-data-horizontal/tabs:h-auto">
          <TabsTrigger value="stores">Stores</TabsTrigger>
          <TabsTrigger value="categories">Categories and products</TabsTrigger>
          <TabsTrigger value="bridge">Revenue bridge</TabsTrigger>
        </TabsList>
        <TabsContent value="stores">
          <StoresView />
        </TabsContent>
        <TabsContent value="categories">
          <CategoriesView />
        </TabsContent>
        <TabsContent value="bridge">
          <BridgeView />
        </TabsContent>
      </Tabs>
    </>
  );
}

function StoresView() {
  const { has } = useSession();
  const filters = useFilters();
  const query = useOrgQuery<StoresReport>("/analytics/stores", { query: filters.apiQuery, enabled: filters.customReady, keepPrevious: true });
  if (!filters.customReady) return <EmptyState title="Choose a date range" description="Pick a start and end date in the filter row." />;
  return (
    <QueryView query={query} loading={<Panel><TableSkeleton rows={8} columns={7} /></Panel>}>
      {(data) => (
        <div className="space-y-6">
          <StoresPanel
            title={`Store productivity, ${data.period.label}`}
            stores={data.stores}
            currency={data.currency}
            finance={has(PERMISSIONS.financeRead)}
            notes={data.notes}
            dimmed={query.isPlaceholderData}
            initialView="table"
          />
        </div>
      )}
    </QueryView>
  );
}

const PRODUCT_LISTS = [
  { key: "top", label: "Top sellers" },
  { key: "bottom", label: "Lowest sales" },
  { key: "fastest_growing", label: "Fastest growth" },
  { key: "declining", label: "Slowest growth" },
] as const;

function CategoriesView() {
  const filters = useFilters();
  const [list, setList] = useState<(typeof PRODUCT_LISTS)[number]["key"]>("top");
  const query = useOrgQuery<CategoriesReport>("/analytics/categories", { query: filters.apiQuery, enabled: filters.customReady, keepPrevious: true });
  if (!filters.customReady) return <EmptyState title="Choose a date range" description="Pick a start and end date in the filter row." />;
  return (
    <QueryView query={query} loading={<Panel><TableSkeleton rows={8} columns={6} /></Panel>}>
      {(data) => {
        const currency = data.currency;
        const rows = data.products[list] ?? [];
        const hasMargin = rows.some((r) => r.gross_margin !== undefined);
        const columns: Column<ProductRow>[] = [
          {
            key: "product",
            header: "Product",
            cell: (r) => (
              <span className="block min-w-[12rem]">
                <span className="font-medium">{r.product ?? "Unknown product"}</span>
                <span className="block text-xs text-muted-foreground">
                  <span className="font-mono">{r.sku}</span>
                  {r.category ? `, ${r.category}` : ""}
                </span>
              </span>
            ),
            sortValue: (r) => r.product,
          },
          { key: "net", header: "Net sales", align: "right", cell: (r) => formatMoney(r.net_sales, currency, { compact: true }), sortValue: (r) => r.net_sales },
          { key: "units", header: "Units", align: "right", cell: (r) => formatNumber(r.units, { currency }), sortValue: (r) => r.units },
          ...(hasMargin
            ? [{ key: "gm", header: "Gross margin", align: "right" as const, cell: (r: ProductRow) => formatPercent(r.gross_margin), sortValue: (r: ProductRow) => r.gross_margin }]
            : []),
          {
            key: "growth",
            header: "Growth",
            align: "right",
            cell: (r) => (r.growth === null ? <span className="text-muted-foreground">No prior sales</span> : <ChangeIndicator change={r.growth}>{formatPercent(r.growth, { signed: true })}</ChangeIndicator>),
            sortValue: (r) => r.growth,
          },
        ];
        return (
          <div className="space-y-6">
            <CategoryMixPanel categories={data.categories} currency={currency} dimmed={query.isPlaceholderData} />
            <Panel
              title="Products"
              description={`${data.period.label}; growth compares with the same period last year`}
              dimmed={query.isPlaceholderData}
              actions={
                <ToggleGroup
                  type="single"
                  size="sm"
                  variant="outline"
                  spacing={0}
                  value={list}
                  onValueChange={(value) => value && setList(value as typeof list)}
                  aria-label="Product ranking"
                  className="flex-wrap"
                >
                  {PRODUCT_LISTS.map((l) => (
                    <ToggleGroupItem key={l.key} value={l.key}>
                      {l.label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              }
            >
              <DataTable caption={PRODUCT_LISTS.find((l) => l.key === list)?.label ?? "Products"} columns={columns} rows={rows} rowKey={(r, i) => `${r.sku ?? "unknown"}-${i}`} dense empty={<EmptyState compact title="No products in this list" />} />
            </Panel>
          </div>
        );
      }}
    </QueryView>
  );
}

// ---------------------------------------------------------------------------------------------
// Revenue bridge
// ---------------------------------------------------------------------------------------------

const BRIDGE_PRESETS = ["last_30d", "last_90d", "mtd", "qtd", "ytd", "last_12m", "last_fy"];

function BridgeView() {
  const filters = useFilters();
  const options = useFilterOptions(filters.companyId);
  const [preset, setPreset] = useState<string>("last_30d");
  const [custom, setCustom] = useState<{ base_start: string; base_end: string; current_start: string; current_end: string } | null>(null);
  const [draft, setDraft] = useState({ base_start: "", base_end: "", current_start: "", current_end: "" });
  const [breakdown, setBreakdown] = useState<"store" | "category" | "pvm">("store");
  const formId = useId();

  const query: QueryParams = { company_id: filters.companyId, store_ids: filters.storeIds.length ? filters.storeIds : undefined };
  if (custom) Object.assign(query, custom);
  else query.period = preset;
  const bridge = useOrgQuery<RevenueBridge>("/analytics/revenue-bridge", { query, keepPrevious: true });

  const presets = (options.data?.periods ?? []).filter((p) => BRIDGE_PRESETS.includes(p.key) || p.key.startsWith("fy:"));
  const draftValid =
    draft.base_start && draft.base_end && draft.current_start && draft.current_end && draft.base_start <= draft.base_end && draft.current_start <= draft.current_end;

  return (
    <div className="space-y-6">
      <Panel title="Periods to compare" description="Presets compare a period with the same days one year earlier. A custom comparison takes any two ranges.">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
          <div className="space-y-1.5">
            <Label htmlFor={`${formId}-preset`} className="text-xs text-muted-foreground">
              Preset
            </Label>
            <Select
              value={custom ? "custom" : preset}
              onValueChange={(value) => {
                if (value === "custom") {
                  const today = options.data?.data_end ?? "";
                  setDraft((d) => (d.current_end ? d : { ...d, current_end: today }));
                  setCustom({ base_start: "", base_end: "", current_start: "", current_end: "" });
                } else {
                  setCustom(null);
                  setPreset(value);
                }
              }}
            >
              <SelectTrigger id={`${formId}-preset`} className="w-64 bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                {presets.map((p) => (
                  <SelectItem key={p.key} value={p.key}>
                    {p.label} vs a year earlier
                  </SelectItem>
                ))}
                <SelectItem value="custom">Custom comparison</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {custom ? (
            <form
              className="grid flex-1 gap-3 sm:grid-cols-2 xl:grid-cols-[repeat(4,minmax(0,1fr))_auto] xl:items-end"
              onSubmit={(event) => {
                event.preventDefault();
                if (draftValid) setCustom({ ...draft });
              }}
            >
              {(
                [
                  ["base_start", "Base period from"],
                  ["base_end", "Base period to"],
                  ["current_start", "Current period from"],
                  ["current_end", "Current period to"],
                ] as const
              ).map(([key, label]) => (
                <div key={key} className="space-y-1.5">
                  <Label htmlFor={`${formId}-${key}`} className="text-xs text-muted-foreground">
                    {label}
                  </Label>
                  <Input
                    id={`${formId}-${key}`}
                    type="date"
                    value={draft[key]}
                    min={options.data?.data_start ?? undefined}
                    max={options.data?.data_end ?? undefined}
                    onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                    className="bg-background"
                  />
                </div>
              ))}
              <Button type="submit" disabled={!draftValid}>
                Compare
              </Button>
            </form>
          ) : null}
        </div>
      </Panel>

      {custom && !custom.base_start ? (
        <EmptyState title="Choose both periods" description="Enter a base period and a current period, then select Compare." />
      ) : bridge.isPending ? (
        <Panel>
          <TableSkeleton rows={8} columns={3} />
        </Panel>
      ) : bridge.error || !bridge.data ? (
        <Panel>
          <ErrorState error={bridge.error} onRetry={() => void bridge.refetch()} />
        </Panel>
      ) : (
        <BridgeResult data={bridge.data} breakdown={breakdown} onBreakdown={setBreakdown} dimmed={bridge.isPlaceholderData} />
      )}
    </div>
  );
}

function BridgeResult({
  data,
  breakdown,
  onBreakdown,
  dimmed,
}: {
  data: RevenueBridge;
  breakdown: "store" | "category" | "pvm";
  onBreakdown: (b: "store" | "category" | "pvm") => void;
  dimmed: boolean;
}) {
  const currency = data.currency;
  const money = (v: number) => formatMoney(v, currency, { compact: true });
  const signed = (v: number) => formatMoney(v, currency, { compact: true, signed: true });
  const baseLabel = `${formatDate(data.base_period.start)} – ${formatDate(data.base_period.end)}`;
  const currentLabel = `${formatDate(data.current_period.start)} – ${formatDate(data.current_period.end)}`;

  const steps =
    breakdown === "store"
      ? [...data.by_store]
          .sort((a, b) => b.change - a.change)
          .map((s) => ({
            key: s.store,
            label: s.name,
            sublabel: `${s.store}: transactions ${formatPercent(s.transactions_change_pct, { signed: true })}, basket ${formatPercent(s.basket_change_pct, { signed: true })}`,
            delta: s.change,
          }))
      : breakdown === "category"
        ? [...data.by_category].sort((a, b) => b.change - a.change).map((c) => ({ key: c.category, label: c.category, sublabel: formatPercent(c.change_pct, { signed: true }), delta: c.change }))
        : [
            { key: "volume", label: "Volume", sublabel: "More or fewer units at base prices", delta: data.price_volume_mix.volume },
            { key: "mix", label: "Mix", sublabel: "Shift between cheaper and dearer products", delta: data.price_volume_mix.mix },
            { key: "price", label: "Price", sublabel: "Change in net price per unit", delta: data.price_volume_mix.price },
            {
              key: "new",
              label: "New or discontinued products",
              sublabel: "Products sold in only one of the periods",
              delta: data.price_volume_mix.new_or_discontinued_products,
            },
          ];

  const storeColumns2: Column<RevenueBridge["by_store"][number]>[] = [
    { key: "store", header: "Store", cell: (r) => <span className="font-medium">{r.name}</span>, sortValue: (r) => r.store },
    { key: "base", header: "Base", align: "right", cell: (r) => money(r.base), sortValue: (r) => r.base },
    { key: "current", header: "Current", align: "right", cell: (r) => money(r.current), sortValue: (r) => r.current },
    { key: "change", header: "Change", align: "right", cell: (r) => signed(r.change), sortValue: (r) => r.change },
    { key: "pct", header: "Change %", align: "right", cell: (r) => <ChangeIndicator change={r.change_pct}>{formatPercent(r.change_pct, { signed: true })}</ChangeIndicator>, sortValue: (r) => r.change_pct },
    { key: "txn", header: "Transactions", align: "right", cell: (r) => formatPercent(r.transactions_change_pct, { signed: true }), sortValue: (r) => r.transactions_change_pct },
    { key: "basket", header: "Basket", align: "right", cell: (r) => formatPercent(r.basket_change_pct, { signed: true }), sortValue: (r) => r.basket_change_pct },
  ];

  return (
    <div className="space-y-6">
      <div className={dimmed ? "opacity-55" : undefined}>
        <div className="grid gap-px overflow-hidden rounded-xl bg-border ring-1 ring-foreground/10 sm:grid-cols-3">
          <div className="bg-card p-4 sm:p-5">
            <Stat label="Base period" value={money(data.base_period.net_sales)} hint={baseLabel} />
          </div>
          <div className="bg-card p-4 sm:p-5">
            <Stat label="Current period" value={money(data.current_period.net_sales)} hint={currentLabel} />
          </div>
          <div className="bg-card p-4 sm:p-5">
            <Stat
              label="Change in net sales"
              value={signed(data.change)}
              hint={<ChangeIndicator change={data.change_pct}>{formatPercent(data.change_pct, { signed: true })}</ChangeIndicator>}
            />
          </div>
        </div>
      </div>
      <Panel
        title="What drove the change"
        description="Each bar moves the running total from the base period to the current period"
        dimmed={dimmed}
        actions={
          <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            spacing={0}
            value={breakdown}
            onValueChange={(value) => value && onBreakdown(value as typeof breakdown)}
            aria-label="Break the change down by"
          >
            <ToggleGroupItem value="store">By store</ToggleGroupItem>
            <ToggleGroupItem value="category">By category</ToggleGroupItem>
            <ToggleGroupItem value="pvm">Price, volume, mix</ToggleGroupItem>
          </ToggleGroup>
        }
        footer={<NoteList notes={[data.method]} />}
      >
        {steps.length === 0 ? (
          <EmptyState compact title="No sales in either period" />
        ) : (
          <Waterfall
            ariaLabel={`Net sales bridge ${breakdown === "store" ? "by store" : breakdown === "category" ? "by category" : "by price, volume and mix"}`}
            base={data.base_period.net_sales}
            current={data.current_period.net_sales}
            baseLabel="Base period"
            currentLabel="Current period"
            steps={steps}
            format={money}
            formatSigned={signed}
          />
        )}
      </Panel>
      {breakdown === "store" ? (
        <Panel title="Store detail" description="Change split into transactions and average basket">
          <DataTable caption="Store bridge detail" columns={storeColumns2} rows={data.by_store} rowKey={(r) => r.store} defaultSort={{ key: "change", dir: "desc" }} dense />
        </Panel>
      ) : null}
    </div>
  );
}

