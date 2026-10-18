"use client";

import { BellIcon, ClipboardListIcon, InboxIcon } from "lucide-react";

import { AppPage } from "@/components/app/app-page";
import { StatusBadge } from "@/components/app/badges";
import { BarList } from "@/components/app/charts/bar-list";
import { KpiLedger } from "@/components/app/kpi";
import { PageHeader, Panel, SectionHeading } from "@/components/app/page";
import { SalesTrendPanel } from "@/components/app/sections/sales";
import { useSession } from "@/components/app/session-provider";
import { EmptyState, ErrorState, SkeletonBlock, TableSkeleton } from "@/components/app/states";
import { useFilterOptions } from "@/hooks/use-filter-options";
import { useFilters } from "@/hooks/use-filters";
import { useOrgQuery } from "@/hooks/use-org-query";
import { ApiError } from "@/lib/api";
import { formatDate, formatDateTime, formatMoney, formatNumber, humanize } from "@/lib/app/format";
import { PERMISSIONS } from "@/lib/app/nav";
import type { SalesSummary } from "@/lib/app/types";

export default function MyWorkPage() {
  return (
    <AppPage>
      <MyWork />
    </AppPage>
  );
}

function MyWork() {
  const { user, membership, has } = useSession();
  const filters = useFilters();
  const options = useFilterOptions(filters.companyId);
  const storeNames = options.data?.store_scoped ? options.data.stores.map((s) => `${s.code} ${s.name}`) : [];
  const firstName = user.full_name.split(" ")[0];

  return (
    <>
      <PageHeader
        title="My Work"
        description={
          storeNames.length
            ? `Hello ${firstName}. Sales for ${storeNames.join(", ")}, and the tasks assigned to you.`
            : `Hello ${firstName}. Your sales summary and the tasks assigned to you.`
        }
        meta={membership ? <span>{membership.role_label}</span> : null}
      />
      <div className="space-y-6">
        {has(PERMISSIONS.salesRead) ? (
          <SalesSection />
        ) : (
          <Panel>
            <EmptyState compact title="Sales figures are not part of your role" />
          </Panel>
        )}
        <SectionHeading title="Tasks and notifications" description="Work assigned to you and updates that need your attention" />
        <TasksSection />
      </div>
    </>
  );
}

function SalesSection() {
  const filters = useFilters();
  const query = useOrgQuery<SalesSummary>("/dashboard/sales-summary", {
    query: filters.apiQuery,
    enabled: filters.customReady,
    keepPrevious: true,
  });
  if (!filters.customReady) return <EmptyState title="Choose a date range" description="Pick a start and end date in the filter row." />;
  if (query.isPending) {
    return (
      <div className="space-y-6">
        <SkeletonBlock className="h-28 w-full" />
        <Panel>
          <TableSkeleton rows={6} columns={4} />
        </Panel>
      </div>
    );
  }
  if (query.error || !query.data) {
    return (
      <Panel>
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </Panel>
    );
  }
  const data = query.data;
  const currency = data.company.currency;
  const last7 = [...data.last_7_days].sort((a, b) => b.date.localeCompare(a.date));
  return (
    <div className="space-y-6">
      <section aria-label="Sales summary" className={query.isPlaceholderData ? "opacity-55" : undefined}>
        <KpiLedger
          kpis={data.kpis}
          currency={currency}
          comparisonLabel="(same period last year)"
          columns="grid-cols-1 min-[420px]:grid-cols-2 lg:grid-cols-4"
        />
      </section>
      <div className="grid gap-6 xl:grid-cols-3">
        <SalesTrendPanel
          className="xl:col-span-2"
          title={`Net sales, ${data.period.label}`}
          series={data.series}
          granularity={data.period.granularity}
          currency={currency}
          dimmed={query.isPlaceholderData}
        />
        <Panel
          title="Last 7 days"
          description={`Daily net sales up to ${formatDate(data.data_end)}`}
          footer={data.transactions !== null ? `${formatNumber(data.transactions, { currency })} transactions in the period` : undefined}
        >
          {last7.length === 0 ? (
            data.period.end < data.data_end ? (
              <EmptyState
                compact
                title="Outside the selected period"
                description={`The selected period ends on ${formatDate(data.period.end)}, before the latest seven days of data. Choose “Last 30 days” to see them.`}
              />
            ) : (
              <EmptyState compact title="No sales in the last 7 days" />
            )
          ) : (
            <BarList
              label="Net sales for each of the last 7 days"
              items={last7.map((d) => ({ key: d.date, label: formatDate(d.date), value: d.net_sales, display: formatMoney(d.net_sales, currency, { compact: true }) }))}
            />
          )}
        </Panel>
      </div>
    </div>
  );
}

type WorkItem = Record<string, unknown>;

function text(item: WorkItem, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

function WorkList({ items, kind }: { items: WorkItem[]; kind: "task" | "notification" }) {
  if (!items.length) {
    return (
      <EmptyState
        compact
        icon={kind === "task" ? ClipboardListIcon : BellIcon}
        title={kind === "task" ? "No tasks assigned to you" : "No notifications"}
        description={kind === "task" ? "Tasks created from approved recommendations appear here." : "You are all caught up."}
      />
    );
  }
  return (
    <ul className="divide-y">
      {items.map((item, index) => {
        const title = text(item, "title", "name", "summary", "message") ?? "Untitled";
        const detail = text(item, "description", "body", "detail");
        const status = text(item, "status", "state");
        const due = text(item, "due_date", "due_at");
        const created = text(item, "created_at", "sent_at");
        return (
          <li key={String(item.id ?? index)} className="flex items-start justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="font-medium">{title}</p>
              {detail ? <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{detail}</p> : null}
              <p className="mt-1 text-xs text-muted-foreground">
                {due ? `Due ${formatDate(due)}` : created ? formatDateTime(created) : null}
              </p>
            </div>
            {status ? <StatusBadge>{humanize(status)}</StatusBadge> : null}
          </li>
        );
      })}
    </ul>
  );
}

/** Tasks & notifications from the workflow service (GET /workflows/my-work). */
function TasksSection() {
  const query = useOrgQuery<Record<string, unknown>>("/workflows/my-work", { retry: false, staleTime: 60_000 });
  if (query.isPending) {
    return (
      <Panel>
        <TableSkeleton rows={3} columns={2} />
      </Panel>
    );
  }
  if (query.error) {
    if (query.error instanceof ApiError && query.error.status === 404) {
      return (
        <Panel>
          <EmptyState
            icon={InboxIcon}
            title="Your task inbox isn’t available yet"
            description="Tasks and notifications will appear here once the workflow service is enabled for your organization."
          />
        </Panel>
      );
    }
    return (
      <Panel>
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </Panel>
    );
  }
  const data = query.data ?? {};
  const tasks = Array.isArray(data.tasks) ? (data.tasks as WorkItem[]) : Array.isArray(data.items) ? (data.items as WorkItem[]) : [];
  const notifications = Array.isArray(data.notifications) ? (data.notifications as WorkItem[]) : [];
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Panel title="Tasks" description="Assigned to you">
        <WorkList items={tasks} kind="task" />
      </Panel>
      <Panel title="Notifications">
        <WorkList items={notifications} kind="notification" />
      </Panel>
    </div>
  );
}
