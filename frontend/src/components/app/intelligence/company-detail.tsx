"use client";

import { ArrowLeftIcon, CircleAlertIcon, GlobeIcon, NewspaperIcon } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { PermissionGate } from "@/components/app/access";
import { StatusBadge } from "@/components/app/badges";
import { SERIES_COLORS } from "@/components/app/charts/palette";
import { TrendChart } from "@/components/app/charts/trend-chart";
import { DataTable } from "@/components/app/data-table";
import { DefinitionButton } from "@/components/app/kpi";
import { DetailList, NoteList, PageHeader, Panel, SectionHeading } from "@/components/app/page";
import { EmptyState, Notice, SkeletonBlock, TableSkeleton } from "@/components/app/states";
import { ExternalLink, QueryError } from "@/components/app/decision-lab/common";
import { Button } from "@/components/ui/button";
import { useOrgQuery } from "@/hooks/use-org-query";
import { formatDate, formatNumber, formatPercent, formatRatio, MISSING } from "@/lib/app/format";
import {
  DERIVED_FORMULAS,
  formatBaseAmount,
  formatReported,
  METRIC_ORDER,
  metricLabel,
  monthName,
  UNIT_LABELS,
} from "@/lib/app/intelligence-format";
import type { CompanyDetail, DerivedYear, Observation } from "@/lib/app/intelligence-types";
import { cn } from "@/lib/utils";

import { AddObservationDialog } from "./forms";
import { ListingBadge, MarketDataNote, MarketSnapshotBlock, SourceCitation, VerificationTag } from "./parts";

function MetricPanel({ metric, observations, currency }: { metric: string; observations: Observation[]; currency: string | null }) {
  const rows = [...observations].sort((a, b) => a.period_end.localeCompare(b.period_end));
  const bases = Array.from(new Set(rows.map((r) => r.basis)));
  const mainBasis = bases.sort((a, b) => rows.filter((r) => r.basis === b).length - rows.filter((r) => r.basis === a).length)[0];
  const units = Array.from(new Set(rows.filter((r) => r.basis === mainBasis).map((r) => r.unit)));
  const chartRows = rows.filter((r) => r.basis === mainBasis && r.unit === units[0]);
  const negative = chartRows.some((r) => (r.value ?? 0) < 0);
  return (
    <Panel
      title={metricLabel(metric)}
      description={`Reported by fiscal year · ${UNIT_LABELS[units[0]] ?? units[0] ?? "unit not stated"} · ${mainBasis ?? "basis not stated"} basis`}
      footer={
        bases.length > 1 || units.length > 1
          ? `The chart shows the ${mainBasis} figures in ${UNIT_LABELS[units[0]] ?? units[0]}; the table lists every basis and unit as reported.`
          : undefined
      }
    >
      {chartRows.length > 1 ? (
        <div className="mb-5">
          <TrendChart
          ariaLabel={`${metricLabel(metric)} by fiscal year`}
          data={chartRows.map((r) => ({ fy: r.fiscal_year, value: r.value }))}
          xKey="fy"
          yFormat={(v) => formatNumber(v, { compact: true })}
          series={[{ key: "value", label: metricLabel(metric), color: SERIES_COLORS[0], kind: "bar", format: (v) => formatReported(v, units[0], currency) }]}
          height={220}
          zeroLine={negative}
          legend={false}
        />
        </div>
      ) : null}
        <DataTable
          caption={`${metricLabel(metric)} as reported, with sources`}
          dense
          rows={[...rows].reverse()}
          rowKey={(r) => `${r.fiscal_year}-${r.basis}-${r.unit}`}
          columns={[
            { key: "fy", header: "Fiscal year", cell: (r) => <span className="font-medium whitespace-nowrap">{r.fiscal_year}</span>, sortValue: (r) => r.period_end },
            { key: "end", header: "Period end", cell: (r) => <span className="whitespace-nowrap">{formatDate(r.period_end)}</span> },
            { key: "basis", header: "Basis", cell: (r) => r.basis },
            { key: "value", header: "Value", align: "right", cell: (r) => formatReported(r.value, r.unit, r.currency ?? currency), sortValue: (r) => r.value_base_units ?? r.value },
            {
              key: "source",
              header: "Source",
              cell: (r) => (
                <div className="max-w-[22rem] min-w-[12rem] space-y-1">
                  <SourceCitation url={r.source_url} name={r.source_name} />
                  <div className="flex flex-wrap items-center gap-1.5">
                    <VerificationTag status={r.verification_status} />
                    {r.source_type ? <span className="text-xs text-muted-foreground">{r.source_type.replace(/_/g, " ")}</span> : null}
                  </div>
                  {r.notes ? <p className="text-xs leading-snug text-muted-foreground">{r.notes}</p> : null}
                </div>
              ),
            },
          ]}
        />
    </Panel>
  );
}

function DerivedPanel({ derived }: { derived: DerivedYear[] }) {
  const rows = [...derived].reverse();
  const definition = (key: string) => DERIVED_FORMULAS.find((f) => f.key === key);
  const header = (key: string, label: string) => (
    <span className="inline-flex items-center gap-1">
      {label}
      <DefinitionButton label={label} formula={definition(key)?.formula} />
    </span>
  );
  return (
    <Panel
      title="Derived metrics"
      description="Computed by AUREX from the reported figures above, only where both inputs share a basis and unit"
      footer={<NoteList notes={DERIVED_FORMULAS.map((f) => `${f.label} = ${f.formula}.`)} />}
    >
      {rows.length ? (
        <DataTable
          caption="Derived metrics by fiscal year"
          dense
          rows={rows}
          rowKey={(r) => `${r.fiscal_year}-${r.basis}`}
          columns={[
            { key: "fy", header: "Fiscal year", cell: (r) => <span className="font-medium">{r.fiscal_year}</span> },
            { key: "rev", header: "Revenue", align: "right", cell: (r) => formatBaseAmount(r.revenue, r.currency) },
            {
              key: "g",
              header: header("revenue_growth", "Growth"),
              label: "Revenue growth",
              align: "right",
              cell: (r) => (r.revenue_growth_note ? <span title={r.revenue_growth_note}>{MISSING}</span> : formatPercent(r.revenue_growth ?? null, { signed: true })),
            },
            {
              key: "gm",
              header: header("gross_margin", "Gross margin"),
              label: "Gross margin",
              align: "right",
              cell: (r) => formatPercent(r.gross_margin ?? r.gross_margin_derived ?? null),
            },
            { key: "em", header: header("ebitda_margin", "EBITDA margin"), label: "EBITDA margin", align: "right", cell: (r) => formatPercent(r.ebitda_margin ?? null) },
            { key: "nm", header: header("net_margin", "Net margin"), label: "Net margin", align: "right", cell: (r) => formatPercent(r.net_margin ?? null) },
            { key: "st", header: "Stores", align: "right", cell: (r) => formatNumber(r.store_count ?? null, { decimals: 0 }) },
            { key: "rps", header: header("revenue_per_store", "Revenue per store"), label: "Revenue per store", align: "right", cell: (r) => formatBaseAmount(r.revenue_per_store ?? null, r.currency) },
            { key: "it", header: header("inventory_turnover", "Inventory turnover"), label: "Inventory turnover", align: "right", cell: (r) => formatRatio(r.inventory_turnover ?? null) },
          ]}
        />
      ) : (
        <EmptyState compact title="No derived metrics" description="Revenue for at least one fiscal year is needed." />
      )}
    </Panel>
  );
}

export function CompanyDetailView({ companyKey }: { companyKey: string }) {
  const query = useOrgQuery<CompanyDetail>(`/intelligence/companies/${encodeURIComponent(companyKey)}`, { staleTime: 10 * 60_000, retry: false });
  const [metric, setMetric] = useState<string | null>(null);
  const data = query.data;
  const metrics = useMemo(() => {
    if (!data) return [];
    const keys = Object.keys(data.financials).filter((k) => data.financials[k]?.length);
    return keys.sort((a, b) => (METRIC_ORDER.indexOf(a) === -1 ? 99 : METRIC_ORDER.indexOf(a)) - (METRIC_ORDER.indexOf(b) === -1 ? 99 : METRIC_ORDER.indexOf(b)));
  }, [data]);
  const selected = metric && metrics.includes(metric) ? metric : (metrics[0] ?? null);

  if (query.isPending) {
    return (
      <div className="space-y-6" aria-busy="true">
        <SkeletonBlock className="h-10 w-80" />
        <SkeletonBlock className="h-4 w-full max-w-xl" />
        <div className="grid gap-6 lg:grid-cols-2">
          <SkeletonBlock className="h-48" />
          <SkeletonBlock className="h-48" />
        </div>
        <TableSkeleton rows={6} columns={5} />
      </div>
    );
  }
  if (query.error || !data) {
    return (
      <>
        <PageHeader title="Company profile" />
        <Panel>
          <QueryError error={query.error} onRetry={() => void query.refetch()} />
        </Panel>
      </>
    );
  }

  return (
    <>
      <Link href="/app/intelligence" className="mb-3 inline-flex items-center gap-1.5 rounded-md text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">
        <ArrowLeftIcon className="size-4" aria-hidden />
        Company Intelligence
      </Link>
      <PageHeader
        title={data.display_name}
        description={data.description ?? undefined}
        meta={
          <>
            <ListingBadge company={data} />
            {data.custom ? <StatusBadge tone="info">Tracked by your team</StatusBadge> : null}
            {data.legal_name ? <span>{data.legal_name}</span> : null}
            {data.website ? (
              <ExternalLink href={data.website}>
                <span className="inline-flex items-center gap-1">
                  <GlobeIcon className="size-3.5" aria-hidden />
                  Website
                </span>
              </ExternalLink>
            ) : null}
          </>
        }
        actions={
          data.custom ? (
            <PermissionGate permission="intelligence:manage">
              <AddObservationDialog companyKey={data.key} currency={data.reporting_currency} />
            </PermissionGate>
          ) : null
        }
      />

      <div className="space-y-6">
        <div className="grid gap-6 lg:grid-cols-2">
          <Panel title="Profile">
            <DetailList
              items={[
                { label: "Country", value: data.country ?? MISSING },
                { label: "Sector", value: data.sector ?? MISSING },
                { label: "Fiscal year ends", value: monthName(data.fiscal_year_end_month) },
                { label: "Reporting currency", value: data.reporting_currency ?? MISSING },
                { label: "Reporting basis", value: data.reporting_basis ?? MISSING },
                { label: "Also known as", value: data.aliases.length ? data.aliases.join(", ") : MISSING },
              ]}
            />
          </Panel>
          <Panel title="Share price" description="Dated snapshots with their source; never estimated">
            <div className="space-y-3">
              <MarketSnapshotBlock company={data} marketData={data.market_data} />
              {data.price_performance?.note ? <p className="text-xs text-muted-foreground">Price performance: {data.price_performance.note}</p> : null}
              <MarketDataNote status={data.market_data} />
              {data.securities.length ? (
                <DataTable
                  caption="Listed securities"
                  dense
                  rows={data.securities}
                  rowKey={(r) => `${r.exchange}-${r.ticker}`}
                  columns={[
                    { key: "ex", header: "Exchange", cell: (r) => r.exchange },
                    { key: "t", header: "Ticker", cell: (r) => <code className="font-mono text-xs">{r.ticker}</code> },
                    { key: "isin", header: "ISIN", cell: (r) => r.isin ?? "Not verified" },
                    { key: "ld", header: "Listed", cell: (r) => formatDate(r.listing_date) },
                    { key: "v", header: "Status", cell: (r) => <VerificationTag status={r.verification_status} /> },
                    { key: "s", header: "Source", cell: (r) => <SourceCitation url={r.source_url} /> },
                  ]}
                />
              ) : null}
            </div>
          </Panel>
        </div>

        {data.measures_note ? <Notice title="Different measures, shown separately">{data.measures_note}</Notice> : null}

        <SectionHeading
          title="Reported financials"
          description={`As filed, in ${data.reporting_currency ?? "the reporting currency"}; fiscal years end in ${monthName(data.fiscal_year_end_month)}`}
        />
        {metrics.length ? (
          <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[14rem_minmax(0,1fr)]">
            <nav aria-label="Reported measures" className="min-w-0 lg:sticky lg:top-20 lg:self-start">
              <ul className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
                {metrics.map((m) => (
                  <li key={m} className="shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-current={m === selected ? "true" : undefined}
                      onClick={() => setMetric(m)}
                      className={cn("w-full justify-between font-normal", m === selected && "bg-muted font-medium text-foreground")}
                    >
                      <span className="truncate">{metricLabel(m)}</span>
                      <span className="text-xs text-muted-foreground tabular">{data.financials[m].length}</span>
                    </Button>
                  </li>
                ))}
              </ul>
            </nav>
            {selected ? <MetricPanel key={selected} metric={selected} observations={data.financials[selected]} currency={data.reporting_currency} /> : null}
          </div>
        ) : (
          <Panel>
            <EmptyState
              compact
              title="No reported figures yet"
              description={data.custom ? "Add figures from filings with their source links." : "No verified figures are stored for this company."}
            />
          </Panel>
        )}

        <DerivedPanel derived={data.derived} />

        <div className="grid gap-6 lg:grid-cols-2">
          <Panel title="Market share estimates" description="Third-party research; market definitions differ between sources">
            {data.market_share_estimates.length ? (
              <ul className="divide-y">
                {data.market_share_estimates.map((m, i) => (
                  <li key={i} className="space-y-1 py-3 first:pt-0 last:pb-0">
                    <p className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-[0.8125rem] font-medium">{m.scope}</span>
                      <span className="text-lg font-semibold tabular">{m.value_pct !== null ? `${formatNumber(m.value_pct, { decimals: 1 })}%` : MISSING}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">As of {m.as_of ?? "date not stated"}</p>
                    {m.notes ? <p className="text-xs text-muted-foreground">{m.notes}</p> : null}
                    <SourceCitation url={m.source_url} name={m.source_name} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No cited market share estimate is stored.</p>
            )}
            <p className="mt-3 text-xs text-muted-foreground">An estimate measures share of a defined market; it is not revenue growth and not share-price performance.</p>
          </Panel>
          <Panel title="Data gaps" description="What is missing or uncertain in this profile">
            {data.data_gaps.length ? (
              <ul className="space-y-2">
                {data.data_gaps.map((gap, i) => (
                  <li key={i} className="flex items-start gap-2 text-[0.8125rem] leading-relaxed">
                    <CircleAlertIcon className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                    {gap}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No gaps recorded.</p>
            )}
          </Panel>
        </div>

        <Panel
          title="Related news"
          actions={
            <Button asChild variant="outline" size="sm">
              <Link href={`/app/news?company=${encodeURIComponent(data.key)}`}>
                <NewspaperIcon aria-hidden />
                All news
              </Link>
            </Button>
          }
        >
          {data.news.length ? (
            <ul className="divide-y">
              {data.news.map((a) => (
                <li key={a.id} className="flex flex-wrap items-start justify-between gap-2 py-2.5 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <ExternalLink href={a.url} className="text-[0.8125rem]">
                      {a.title}
                    </ExternalLink>
                    <p className="text-xs text-muted-foreground">
                      {a.source_name} · {formatDate(a.published_at)}
                    </p>
                  </div>
                  {a.is_official_announcement ? <StatusBadge tone="info">Official announcement</StatusBadge> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No articles mention this company yet.</p>
          )}
        </Panel>
      </div>
    </>
  );
}
