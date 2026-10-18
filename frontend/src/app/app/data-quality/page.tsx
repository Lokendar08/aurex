"use client";

import Link from "next/link";

import { RequireAccess } from "@/components/app/access";
import { AppPage } from "@/components/app/app-page";
import { JobStatusBadge, StatusBadge, SyntheticFeedBadge } from "@/components/app/badges";
import { BarList } from "@/components/app/charts/bar-list";
import { Meter } from "@/components/app/charts/sparkline";
import { DataTable, type Column } from "@/components/app/data-table";
import { factLabel } from "@/components/app/freshness";
import { NoteList, PageHeader, Panel, Stat } from "@/components/app/page";
import { useSession } from "@/components/app/session-provider";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/app/states";
import { useFilters } from "@/hooks/use-filters";
import { useOrgQuery } from "@/hooks/use-org-query";
import { formatDate, formatDateTime, formatNumber, formatPercent, formatRelative, humanize } from "@/lib/app/format";
import { errorCodeLabel } from "@/lib/app/labels";
import { PERMISSIONS } from "@/lib/app/nav";
import type { DataQuality, FreshnessEntry, FreshnessSource } from "@/lib/app/types";
import { cn } from "@/lib/utils";

export default function DataQualityPage() {
  return (
    <AppPage>
      <RequireAccess area="Data Quality" permission={PERMISSIONS.dataQualityRead}>
        <Quality />
      </RequireAccess>
    </AppPage>
  );
}

type SourceRow = FreshnessSource & { fact: string; factLatest: string | null; multiple: boolean };

function Quality() {
  const { has } = useSession();
  const { companyId } = useFilters();
  const query = useOrgQuery<DataQuality>("/data/quality", { query: companyId ? { company_id: companyId } : undefined });
  const canSeeIntegrations = has(PERMISSIONS.integrationsRead);

  const header = (
    <PageHeader
      title="Data quality"
      description="How fresh, complete and consistent the data behind every figure is: per source, per store and per import."
    />
  );
  if (query.isPending) {
    return (
      <>
        {header}
        <Panel>
          <TableSkeleton rows={10} columns={5} />
        </Panel>
      </>
    );
  }
  if (query.error || !query.data) {
    return (
      <>
        {header}
        <Panel>
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        </Panel>
      </>
    );
  }
  const data = query.data;
  const rejected = data.rejection_reasons.reduce((sum, r) => sum + r.count, 0);
  const sourceRows: SourceRow[] = data.freshness.flatMap((entry: FreshnessEntry) =>
    entry.sources.map((s) => ({ ...s, fact: entry.fact, factLatest: entry.latest_date, multiple: Boolean(entry.multiple_sources) })),
  );
  const missingFacts = data.freshness.filter((f) => f.status !== "ok").map((f) => factLabel(f.fact));

  const sourceColumns: Column<SourceRow>[] = [
    { key: "fact", header: "Data type", cell: (r) => <span className="font-medium">{factLabel(r.fact)}</span>, sortValue: (r) => r.fact },
    {
      key: "source",
      header: "Source",
      cell: (r) => (
        <span className="flex flex-wrap items-center gap-1.5">
          {canSeeIntegrations ? (
            <Link href={`/app/integrations/${r.integration_id}`} className="font-medium text-primary underline-offset-4 hover:underline">
              {r.name}
            </Link>
          ) : (
            <span>{r.name}</span>
          )}
          {r.is_demo ? <SyntheticFeedBadge /> : null}
        </span>
      ),
      sortValue: (r) => r.name,
    },
    { key: "latest", header: "Latest data", align: "right", cell: (r) => formatDate(r.latest_date), sortValue: (r) => r.latest_date },
    { key: "records", header: "Records", align: "right", cell: (r) => formatNumber(r.records), sortValue: (r) => r.records },
    {
      key: "ingested",
      header: "Last loaded",
      align: "right",
      cell: (r) => <span title={formatDateTime(r.last_ingested_at)}>{formatRelative(r.last_ingested_at)}</span>,
      sortValue: (r) => r.last_ingested_at,
    },
    {
      key: "multi",
      header: "Overlap",
      cell: (r) => (r.multiple ? <StatusBadge tone="info">Several sources</StatusBadge> : <span className="text-muted-foreground">—</span>),
      sortValue: (r) => (r.multiple ? 0 : 1),
    },
  ];
  const completenessColumns: Column<DataQuality["store_completeness"][number]>[] = [
    { key: "store", header: "Store", cell: (r) => <span className="font-medium">{r.store}</span>, sortValue: (r) => r.store },
    { key: "expected", header: "Expected days", align: "right", cell: (r) => formatNumber(r.expected_days), sortValue: (r) => r.expected_days },
    { key: "with", header: "Days with sales", align: "right", cell: (r) => formatNumber(r.days_with_sales), sortValue: (r) => r.days_with_sales },
    {
      key: "missing",
      header: "Missing days",
      align: "right",
      cell: (r) => <span className={cn(r.missing_days > 0 && "font-semibold text-destructive")}>{formatNumber(r.missing_days)}</span>,
      sortValue: (r) => r.missing_days,
    },
    {
      key: "completeness",
      header: "Completeness",
      cell: (r) => (
        <span className="flex min-w-[9rem] items-center gap-2">
          <Meter value={r.completeness * 100} label={`${r.store} completeness`} tone={r.completeness < 0.98 ? "warning" : "brand"} className="w-24" />
          <span className="text-xs tabular">{formatPercent(r.completeness, { decimals: 1 })}</span>
        </span>
      ),
      sortValue: (r) => r.completeness,
    },
  ];
  const jobColumns: Column<DataQuality["recent_jobs"][number]>[] = [
    {
      key: "integration",
      header: "Import",
      cell: (r) =>
        canSeeIntegrations ? (
          <Link href={`/app/integrations/jobs/${r.id}`} className="font-medium text-primary underline-offset-4 hover:underline">
            {r.integration}
          </Link>
        ) : (
          r.integration
        ),
    },
    { key: "trigger", header: "Trigger", cell: (r) => humanize(r.trigger) },
    { key: "status", header: "Status", cell: (r) => <JobStatusBadge status={r.status} /> },
    { key: "received", header: "Received", align: "right", cell: (r) => formatNumber(r.received) },
    { key: "inserted", header: "Inserted", align: "right", cell: (r) => formatNumber(r.inserted) },
    { key: "updated", header: "Updated", align: "right", cell: (r) => formatNumber(r.updated) },
    { key: "unchanged", header: "Unchanged", align: "right", cell: (r) => formatNumber(r.unchanged) },
    {
      key: "rejected",
      header: "Rejected",
      align: "right",
      cell: (r) => <span className={cn(r.rejected > 0 && "font-semibold text-destructive")}>{formatNumber(r.rejected)}</span>,
    },
    { key: "finished", header: "Finished", align: "right", cell: (r) => <span title={formatDateTime(r.finished_at)}>{formatRelative(r.finished_at)}</span> },
  ];

  return (
    <>
      {header}
      <div className="space-y-6">
        <div className="grid gap-px overflow-hidden rounded-xl bg-border ring-1 ring-foreground/10 sm:grid-cols-2 xl:grid-cols-4">
          <div className="bg-card p-4 sm:p-5">
            <Stat label="Sales data through" value={data.data_end ? formatDate(data.data_end) : "No sales yet"} hint={data.data_start ? `Starting ${formatDate(data.data_start)}` : undefined} />
          </div>
          <div className="bg-card p-4 sm:p-5">
            <Stat
              label="Cost coverage"
              value={formatPercent(data.cost_coverage, { decimals: 1 })}
              hint="Share of net sales whose cost of goods is known; margins use only covered sales"
            />
          </div>
          <div className="bg-card p-4 sm:p-5">
            <Stat
              label="Store-days with overlapping sources"
              value={formatNumber(data.store_days_with_multiple_sources)}
              hint="Counted once, from the system of record"
            />
          </div>
          <div className="bg-card p-4 sm:p-5">
            <Stat label="Rejected rows logged" value={formatNumber(rejected)} hint={`${data.rejection_reasons.length} distinct reasons`} />
          </div>
        </div>

        <Panel
          title="Freshness by source"
          description="Latest data date and record count for each data type and the integration that supplied it"
          footer={missingFacts.length ? `No data yet: ${missingFacts.join(", ")}.` : undefined}
        >
          <DataTable caption="Freshness by data type and source" columns={sourceColumns} rows={sourceRows} rowKey={(r) => `${r.fact}-${r.integration_id}`} dense defaultSort={{ key: "fact", dir: "asc" }} />
        </Panel>

        <div className="grid gap-6 xl:grid-cols-5">
          <Panel className="xl:col-span-3" title="Store completeness" description="Days with sales since each store opened (or since data starts)">
            <DataTable caption="Store completeness" columns={completenessColumns} rows={data.store_completeness} rowKey={(r) => r.store} dense defaultSort={{ key: "completeness", dir: "asc" }} />
          </Panel>
          <Panel className="xl:col-span-2" title="Why rows were rejected" description="Validation errors across all imports">
            {data.rejection_reasons.length ? (
              <BarList
                label="Rejected rows by reason"
                items={data.rejection_reasons.map((r) => ({ key: r.code, label: errorCodeLabel(r.code), sublabel: r.code, value: r.count, display: formatNumber(r.count) }))}
              />
            ) : (
              <EmptyState compact title="No rejected rows" description="Every imported row passed validation." />
            )}
          </Panel>
        </div>

        <Panel title="Recent imports" description="The last ten sync jobs across all integrations">
          <DataTable caption="Recent imports" columns={jobColumns} rows={data.recent_jobs} rowKey={(r) => r.id} dense empty={<EmptyState compact title="No imports yet" />} />
        </Panel>

        <Panel title="Rules applied to every import">
          <NoteList notes={data.rules} />
        </Panel>
      </div>
    </>
  );
}
