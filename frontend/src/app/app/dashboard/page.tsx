"use client";

import { CalendarRangeIcon } from "lucide-react";

import { RequireAccess } from "@/components/app/access";
import { AppPage } from "@/components/app/app-page";
import { SourcesPopover } from "@/components/app/freshness";
import { KpiLedger } from "@/components/app/kpi";
import { NoteList, PageHeader, Panel } from "@/components/app/page";
import { CashPanel, ExpenseBreakdownPanel, HealthPanel } from "@/components/app/sections/finance";
import { InventorySnapshotPanel } from "@/components/app/sections/inventory";
import { GrossProfitPanel, SalesTrendPanel } from "@/components/app/sections/sales";
import { CategoryMixPanel, StoresPanel } from "@/components/app/sections/stores";
import { useSession } from "@/components/app/session-provider";
import { ChartSkeleton, EmptyState, ErrorState, SkeletonBlock } from "@/components/app/states";
import { useFilters } from "@/hooks/use-filters";
import { useOrgQuery } from "@/hooks/use-org-query";
import { formatDate } from "@/lib/app/format";
import { PERMISSIONS } from "@/lib/app/nav";
import type { ExecutiveDashboard } from "@/lib/app/types";

export default function DashboardPage() {
  return (
    <AppPage>
      <RequireAccess area="the executive dashboard" permission={PERMISSIONS.dashboardRead}>
        <Dashboard />
      </RequireAccess>
    </AppPage>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading the dashboard">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-border ring-1 ring-foreground/10 lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="space-y-3 bg-card p-5">
            <SkeletonBlock className="h-3.5 w-24" />
            <SkeletonBlock className="h-7 w-28" />
            <SkeletonBlock className="h-3 w-36" />
          </div>
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="rounded-xl bg-card p-5 ring-1 ring-foreground/10 xl:col-span-2">
          <ChartSkeleton />
        </div>
        <SkeletonBlock className="h-80 rounded-xl" />
      </div>
    </div>
  );
}

function Dashboard() {
  const { has } = useSession();
  const filters = useFilters();
  const query = useOrgQuery<ExecutiveDashboard>("/dashboard/executive", {
    query: filters.apiQuery,
    enabled: filters.customReady,
    keepPrevious: true,
  });
  const data = query.data;
  const dimmed = query.isPlaceholderData;
  const finance = has(PERMISSIONS.financeRead);

  const header = (
    <PageHeader
      title="Executive dashboard"
      description={
        data
          ? `${data.company.name}: ${data.period.label}, compared with the ${data.period.comparison_label?.toLowerCase() ?? "comparison period"}.`
          : "Company performance for the selected period, compared with the same period last year."
      }
      meta={
        data ? (
          <>
            <span className="inline-flex items-center gap-1.5">
              <CalendarRangeIcon className="size-4" aria-hidden />
              {formatDate(data.period.start)} to {formatDate(data.period.end)}
            </span>
            <span>
              {data.scope.store_ids ? `${data.scope.store_ids.length} of the company’s stores` : "All stores"}
              {data.scope.member_store_scoped ? " assigned to you" : ""}
            </span>
          </>
        ) : null
      }
      actions={data ? <SourcesPopover entries={data.freshness} dataEnd={data.data_end} /> : null}
    />
  );

  if (!filters.customReady) {
    return (
      <>
        {header}
        <EmptyState title="Choose a date range" description="Pick a start and end date in the filter row to see the dashboard for a custom period." />
      </>
    );
  }
  if (query.isPending) {
    return (
      <>
        {header}
        <DashboardSkeleton />
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

  const currency = data.company.currency;
  const ledger = data.kpis.filter((k) => k.key !== "business_health");
  const comparisonLabel = data.period.comparison_label ? `(${data.period.comparison_label.toLowerCase()})` : undefined;

  return (
    <>
      {header}
      <div className="space-y-6">
        <section aria-label="Key figures" className={dimmed ? "opacity-55 transition-opacity" : "transition-opacity"}>
          <KpiLedger kpis={ledger} currency={currency} comparisonLabel={comparisonLabel} />
        </section>

        <div className="grid gap-6 xl:grid-cols-3">
          <SalesTrendPanel
            className="xl:col-span-2"
            series={data.series}
            granularity={data.period.granularity}
            currency={currency}
            dimmed={dimmed}
            comparisonLabel={data.period.comparison_label ?? "Comparison period"}
          />
          <HealthPanel health={data.health} dimmed={dimmed} />
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {finance ? (
            <GrossProfitPanel series={data.series} granularity={data.period.granularity} currency={currency} dimmed={dimmed} />
          ) : null}
          <CategoryMixPanel categories={data.categories} currency={currency} dimmed={dimmed} className={finance ? undefined : "lg:col-span-2"} />
        </div>

        <StoresPanel stores={data.stores} currency={currency} finance={finance} dimmed={dimmed} />

        <div className="grid gap-6 lg:grid-cols-2 2xl:grid-cols-3">
          {data.expenses ? <ExpenseBreakdownPanel expenses={data.expenses} currency={currency} dimmed={dimmed} /> : null}
          <InventorySnapshotPanel inventory={data.inventory} stockouts={data.stockouts_recent} currency={currency} dimmed={dimmed} />
          {data.cash ? <CashPanel cash={data.cash} currency={currency} dimmed={dimmed} /> : null}
        </div>

        {data.notes.length || data.synthetic_notice ? (
          <Panel title="Notes on these figures" description="How the numbers above were produced for this selection">
            <NoteList notes={[...data.notes, ...(data.synthetic_notice ? [data.synthetic_notice] : [])]} />
          </Panel>
        ) : null}
      </div>
    </>
  );
}
