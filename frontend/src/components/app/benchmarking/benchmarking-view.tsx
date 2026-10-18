"use client";

import { ChevronsUpDownIcon, FlaskRoundIcon, HeartPulseIcon, ScaleIcon } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useId, useLayoutEffect, useState } from "react";

import { StatusBadge, type Tone } from "@/components/app/badges";
import { Meter } from "@/components/app/charts/sparkline";
import { DataTable, type Column } from "@/components/app/data-table";
import { NoteList, PageHeader, Panel, SectionHeading } from "@/components/app/page";
import { useSession } from "@/components/app/session-provider";
import { EmptyState, Notice, SkeletonBlock, TableSkeleton } from "@/components/app/states";
import { QueryError } from "@/components/app/decision-lab/common";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { useOrgQuery } from "@/hooks/use-org-query";
import type { BenchmarkResponse, BenchmarkRow } from "@/lib/app/benchmarking-types";
import { formatDate, formatMoney, formatNumber, formatPercent, formatRatio, formatScore, humanize, MISSING } from "@/lib/app/format";
import { monthName } from "@/lib/app/intelligence-format";
import type { CompaniesResponse } from "@/lib/app/intelligence-types";
import { PERMISSIONS } from "@/lib/app/nav";

import { SignedBarList } from "./signed-bars";

const GRADES: Record<string, { tone: Tone; label: string }> = {
  strong: { tone: "good", label: "Strong" },
  stable: { tone: "info", label: "Stable" },
  watch: { tone: "warning", label: "Watch" },
  at_risk: { tone: "danger", label: "At risk" },
};

type RatioMetric = { key: keyof BenchmarkRow; label: string; format: (v: number | null) => string; description: string };

const RATIO_METRICS: RatioMetric[] = [
  { key: "revenue_growth", label: "Revenue growth", format: (v) => formatPercent(v, { signed: true }), description: "Latest fiscal year against the one before; includes new stores" },
  { key: "gross_margin", label: "Gross margin", format: (v) => formatPercent(v), description: "Gross profit ÷ revenue (derived for some companies)" },
  { key: "ebitda_margin", label: "EBITDA margin", format: (v) => formatPercent(v), description: "EBITDA ÷ revenue; EBITDA definitions differ by standard" },
  { key: "net_margin", label: "Net margin", format: (v) => formatPercent(v), description: "Net profit ÷ revenue" },
  { key: "store_growth", label: "Store growth", format: (v) => formatPercent(v, { signed: true }), description: "Change in store count over the year" },
  { key: "inventory_turnover", label: "Inventory turnover", format: (v) => formatRatio(v), description: "Cost of goods sold ÷ average inventory, times a year" },
];

function name(row: BenchmarkRow): string {
  return row.display_name;
}

function CompanyBadges({ row }: { row: BenchmarkRow }) {
  return (
    <>
      {row.is_synthetic ? (
        <StatusBadge tone="info" icon={FlaskRoundIcon}>
          Synthetic
        </StatusBadge>
      ) : null}
      {row.own ? <StatusBadge tone="neutral">Your company</StatusBadge> : null}
    </>
  );
}

function CompanyPicker({
  companies,
  selected,
  onApply,
}: {
  companies: { key: string; name: string }[];
  selected: string[];
  onApply: (keys: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>(selected);
  const listId = useId();
  useLayoutEffect(() => () => setOpen(false), []);
  const label = selected.length === 0 ? "All companies" : `${selected.length} compan${selected.length === 1 ? "y" : "ies"}`;
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setDraft(selected);
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline" className="min-w-44 justify-between bg-background font-normal" aria-label={`Peer companies: ${label}`}>
          <span className="truncate">{label}</span>
          <ChevronsUpDownIcon className="text-muted-foreground" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 gap-0 p-0">
        <div className="border-b px-3 py-2.5">
          <p className="text-sm font-medium">Peer companies</p>
          <p className="text-xs text-muted-foreground">Leave all unchecked to compare every profile.</p>
        </div>
        <ul id={listId} className="max-h-72 overflow-y-auto p-1.5" aria-label="Companies">
          {companies.map((c) => {
            const id = `${listId}-${c.key}`;
            return (
              <li key={c.key}>
                <label htmlFor={id} className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
                  <Checkbox id={id} checked={draft.includes(c.key)} onCheckedChange={(v) => setDraft((d) => (v === true ? [...d, c.key] : d.filter((k) => k !== c.key)))} />
                  {c.name}
                </label>
              </li>
            );
          })}
        </ul>
        <div className="flex justify-between gap-2 border-t px-3 py-2">
          <Button variant="ghost" size="sm" onClick={() => setDraft([])} disabled={!draft.length}>
            Clear
          </Button>
          <Button
            size="sm"
            onClick={() => {
              onApply(draft.length === companies.length ? [] : draft);
              setOpen(false);
            }}
          >
            Apply
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function HealthCard({ row, method }: { row: BenchmarkRow; method: string }) {
  const h = row.health;
  const grade = h?.grade ? (GRADES[h.grade] ?? { tone: "neutral" as Tone, label: humanize(h.grade) }) : null;
  return (
    <article className="rounded-xl bg-card ring-1 ring-foreground/10" aria-label={`Health score of ${name(row)}`}>
      <header className="flex flex-wrap items-start justify-between gap-2 border-b px-4 py-3">
        <div className="min-w-0">
          <p className="truncate font-heading text-sm font-semibold">{name(row)}</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <CompanyBadges row={row} />
          </div>
        </div>
        <div className="text-right">
          <p className="text-2xl leading-none font-semibold">{h?.score !== null && h?.score !== undefined ? formatScore(h.score) : MISSING}</p>
          {grade ? (
            <StatusBadge tone={grade.tone} className="mt-1">
              {grade.label}
            </StatusBadge>
          ) : null}
        </div>
      </header>
      <div className="space-y-3 px-4 py-3">
        {h?.components.length ? (
          <ul className="space-y-2.5">
            {h.components.map((c) => (
              <li key={c.key}>
                <div className="flex items-baseline justify-between gap-2 text-[0.8125rem]">
                  <span className="font-medium">{humanize(c.key)}</span>
                  <span className="tabular">
                    {formatScore(c.score)} <span className="text-xs text-muted-foreground">/ 100</span>
                  </span>
                </div>
                <Meter value={c.score} label={`${humanize(c.key)} score`} className="mt-1" />
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {c.raw_label} {c.raw_label.includes("x/yr") ? formatRatio(c.raw) : c.raw_label.includes("growth") || c.raw_label.includes("margin") || c.raw_label.includes("coverage") ? formatPercent(c.raw) : formatNumber(c.raw, { decimals: 2 })} · weight{" "}
                  {formatPercent(c.effective_weight, { decimals: 0 })}
                  {Math.abs(c.effective_weight - c.weight) > 0.001 ? ` (normally ${formatPercent(c.weight, { decimals: 0 })})` : ""}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No component could be scored.</p>
        )}
        {h?.excluded_components?.length ? (
          <p className="text-xs text-muted-foreground">Excluded for lack of data: {h.excluded_components.map((c) => humanize(c)).join(", ")}.</p>
        ) : null}
        <p className="text-xs text-muted-foreground">{method}</p>
      </div>
    </article>
  );
}

export function BenchmarkingView() {
  const { has } = useSession();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const selected = (params.get("companies") ?? "").split(",").filter(Boolean);
  const includeOwn = params.get("own") !== "0";
  const ownId = useId();
  const set = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v) next.set(k, v);
        else next.delete(k);
      }
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  const companies = useOrgQuery<CompaniesResponse>("/intelligence/companies", { staleTime: 10 * 60_000 });
  const query = useOrgQuery<BenchmarkResponse>("/benchmarking", {
    query: { company_keys: selected.length ? selected : undefined, include_own: includeOwn },
    keepPrevious: true,
    staleTime: 10 * 60_000,
  });
  const data = query.data;
  const rows = data?.rows ?? [];
  const companyOptions = (companies.data?.companies ?? []).map((c) => ({ key: c.key, name: c.display_name }));
  const currencies = Array.from(new Set(rows.map((r) => r.currency).filter((c): c is string => Boolean(c))));

  const columns: Column<BenchmarkRow>[] = [
    {
      key: "name",
      header: "Company",
      sticky: true,
      cell: (r) => (
        <div className="min-w-[11rem]">
          <p className="font-medium">{name(r)}</p>
          <div className="mt-0.5 flex flex-wrap gap-1">
            <CompanyBadges row={r} />
          </div>
        </div>
      ),
      sortValue: (r) => r.display_name,
    },
    {
      key: "fy",
      header: "Fiscal year",
      cell: (r) => (
        <span className="whitespace-nowrap">
          {r.fiscal_year ?? MISSING}
          <span className="block text-xs text-muted-foreground">to {formatDate(r.period_end)}</span>
        </span>
      ),
      sortValue: (r) => r.period_end,
    },
    { key: "cur", header: "Currency", cell: (r) => r.currency ?? MISSING },
    { key: "rev", header: "Revenue", align: "right", cell: (r) => formatMoney(r.revenue, r.currency ?? "INR", { compact: true }) },
    ...RATIO_METRICS.map(
      (m): Column<BenchmarkRow> => ({
        key: String(m.key),
        header: m.label,
        align: "right",
        cell: (r) => m.format(r[m.key] as number | null),
        sortValue: (r) => r[m.key] as number | null,
      }),
    ),
    { key: "stores", header: "Stores", align: "right", cell: (r) => formatNumber(r.store_count, { decimals: 0 }), sortValue: (r) => r.store_count },
    { key: "rps", header: "Revenue per store", align: "right", cell: (r) => formatMoney(r.revenue_per_store, r.currency ?? "INR", { compact: true }) },
    {
      key: "health",
      header: "Health score",
      align: "right",
      cell: (r) => (r.health?.score !== null && r.health?.score !== undefined ? formatScore(r.health.score) : MISSING),
      sortValue: (r) => r.health?.score ?? null,
    },
    { key: "src", header: "Source", cell: (r) => <span className="block max-w-[16rem] text-xs text-muted-foreground">{r.source ?? MISSING}</span> },
  ];

  return (
    <>
      <PageHeader
        title="Benchmarking"
        description="Your company against listed peers on comparable ratios. Each row uses its own latest fiscal year and reporting currency; read the comparability notes before drawing conclusions."
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <CompanyPicker companies={companyOptions} selected={selected} onApply={(keys) => set({ companies: keys.length ? keys.join(",") : null })} />
            {has(PERMISSIONS.financeRead) ? (
              <label htmlFor={ownId} className="flex items-center gap-2 text-sm">
                <Switch id={ownId} checked={includeOwn} onCheckedChange={(v) => set({ own: v ? null : "0" })} />
                Include my company
              </label>
            ) : null}
          </div>
        }
      />
      {query.isPending ? (
        <div className="space-y-6" aria-busy="true">
          <SkeletonBlock className="h-36 w-full" />
          <TableSkeleton rows={7} columns={8} />
        </div>
      ) : query.error || !data ? (
        <Panel>
          <QueryError error={query.error} onRetry={() => void query.refetch()} />
        </Panel>
      ) : (
        <div className={query.isPlaceholderData ? "space-y-6 opacity-55 transition-opacity" : "space-y-6 transition-opacity"}>
          <Notice tone="warning" title="Comparability notes">
            <NoteList notes={data.comparability_notes} />
            {data.fiscal_year_end_months.length > 1 ? (
              <p className="mt-2">Fiscal years end in {data.fiscal_year_end_months.map((m) => monthName(m)).join(" and ")}: the latest years cover different calendar periods.</p>
            ) : null}
          </Notice>

          {rows.length === 0 ? (
            <Panel>
              <EmptyState icon={ScaleIcon} title="No company has enough reported figures to compare" description="Choose other companies, or add reported figures to tracked companies." />
            </Panel>
          ) : (
            <>
              <Panel title="Comparison" description="Latest complete fiscal year of each company" contentClassName="pt-3">
                <DataTable caption="Benchmark comparison" columns={columns} rows={rows} rowKey={(r) => r.key} dense rowClassName={(r) => (r.own ? "bg-brand-50/50 dark:bg-brand-800/15" : undefined)} />
              </Panel>

              <SectionHeading title="Ratios side by side" description="Unit-free measures, so companies of any size and currency can be compared" />
              <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
                {RATIO_METRICS.map((m) => (
                  <Panel key={String(m.key)} title={m.label} description={m.description}>
                    <SignedBarList
                      label={`${m.label} by company`}
                      items={[...rows]
                        .sort((a, b) => ((b[m.key] as number | null) ?? -Infinity) - ((a[m.key] as number | null) ?? -Infinity))
                        .map((r) => ({
                          key: r.key,
                          label: name(r),
                          sublabel: `${r.fiscal_year ?? "Year not stated"}${r.is_synthetic ? " · synthetic" : ""}`,
                          value: r[m.key] as number | null,
                          display: m.format(r[m.key] as number | null),
                          highlight: r.own,
                        }))}
                    />
                  </Panel>
                ))}
              </div>

              <SectionHeading title="Scale" description="Absolute revenue is compared only within the same reporting currency; amounts are never converted" />
              <div className="grid gap-6 md:grid-cols-2">
                {currencies.map((currency) => {
                  const group = rows.filter((r) => r.currency === currency).sort((a, b) => (b.revenue ?? -Infinity) - (a.revenue ?? -Infinity));
                  return (
                    <Panel key={currency} title={`Revenue in ${currency}`} description={group.length === 1 ? "Only one company reports in this currency" : `${group.length} companies reporting in ${currency}`}>
                      <SignedBarList
                        label={`Revenue in ${currency}`}
                        items={group.map((r) => ({
                          key: r.key,
                          label: name(r),
                          sublabel: `${r.fiscal_year ?? ""}${r.store_count ? ` · ${formatNumber(r.store_count, { decimals: 0 })} stores` : ""}`,
                          value: r.revenue,
                          display: formatMoney(r.revenue, currency, { compact: true }),
                          highlight: r.own,
                        }))}
                      />
                    </Panel>
                  );
                })}
              </div>

              <SectionHeading
                title="Business health"
                description="A 0–100 composite of growth, profitability, liquidity, inventory and data quality; components without data are left out and the rest re-weighted"
                actions={
                  <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                    <HeartPulseIcon className="size-4" aria-hidden />
                    Not a credit rating or valuation
                  </span>
                }
              />
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {rows.map((r) => (
                  <HealthCard key={r.key} row={r} method={data.health_score_method} />
                ))}
              </div>
              <Notice title="Health score limitations">
                <NoteList notes={Array.from(new Set(rows.flatMap((r) => r.health?.limitations ?? []))).filter((n) => !n.startsWith("Excluded for lack of data"))} />
              </Notice>
            </>
          )}
        </div>
      )}
    </>
  );
}
