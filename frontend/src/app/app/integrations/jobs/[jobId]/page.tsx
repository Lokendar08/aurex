"use client";

import { ArrowLeftIcon, LoaderCircleIcon, RotateCcwIcon } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { PermissionGate, RequireAccess } from "@/components/app/access";
import { AppPage } from "@/components/app/app-page";
import { JobStatusBadge, StatusBadge } from "@/components/app/badges";
import { DataTable, type Column } from "@/components/app/data-table";
import { ACTIVE_JOB, entityStats, EntityStatsTable } from "@/components/app/integrations/jobs";
import { JsonPreview } from "@/components/app/json-preview";
import { DetailList, PageHeader, Panel } from "@/components/app/page";
import { Pagination } from "@/components/app/pagination";
import { EmptyState, ErrorState, Notice, TableSkeleton } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useInvalidateOrg, useOrgMutation, useOrgQuery } from "@/hooks/use-org-query";
import { formatBytes, formatDateTime, formatDuration, formatNumber, humanize } from "@/lib/app/format";
import { errorCodeLabel, triggerLabel } from "@/lib/app/labels";
import { PERMISSIONS } from "@/lib/app/nav";
import type { SyncError, SyncJob, SyncJobDetail } from "@/lib/app/types";

export default function SyncJobPage() {
  return (
    <AppPage>
      <RequireAccess area="the Integration Hub" permission={PERMISSIONS.integrationsRead}>
        <JobView />
      </RequireAccess>
    </AppPage>
  );
}

function JobView() {
  const { jobId } = useParams<{ jobId: string }>();
  const router = useRouter();
  const invalidate = useInvalidateOrg();
  const job = useOrgQuery<SyncJobDetail>(`/sync-jobs/${jobId}`, {
    refetchInterval: (q) => (q.state.data && !ACTIVE_JOB.has(q.state.data.status) ? false : 1500),
  });
  const retry = useOrgMutation<void, SyncJob>((_, call) => call(`/sync-jobs/${jobId}/retry`, { method: "POST" }), {
    onSuccess: (created) => {
      toast.success("Retry queued");
      void invalidate("/sync-jobs", "/integrations");
      router.push(`/app/integrations/jobs/${created.id}`);
    },
    onError: (error) => toast.error(error.message),
  });

  const back = (
    <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
      <Link href={job.data ? `/app/integrations/${job.data.integration_id}` : "/app/integrations?tab=history"}>
        <ArrowLeftIcon aria-hidden />
        {job.data?.integration ?? "Integration Hub"}
      </Link>
    </Button>
  );

  if (job.isPending) {
    return (
      <>
        {back}
        <PageHeader title="Sync job" />
        <Panel>
          <TableSkeleton rows={6} columns={4} />
        </Panel>
      </>
    );
  }
  if (job.error || !job.data) {
    return (
      <>
        {back}
        <PageHeader title="Sync job" />
        <Panel>
          <ErrorState error={job.error} onRetry={() => void job.refetch()} />
        </Panel>
      </>
    );
  }

  const data = job.data;
  const active = ACTIVE_JOB.has(data.status);
  const retryable = data.status === "failed" || data.status === "partially_succeeded";
  const stats = entityStats(data);

  return (
    <>
      {back}
      <PageHeader
        title={`${triggerLabel(data.trigger)}: ${data.integration ?? "integration"}`}
        description={
          active
            ? "This job is still running. The page refreshes until it finishes."
            : `Finished ${formatDateTime(data.finished_at)} after ${formatDuration(data.duration_seconds)}.`
        }
        meta={
          <>
            <JobStatusBadge status={data.status} />
            <span>
              Attempt {data.attempt} of {data.max_attempts}
            </span>
            {data.retry_of_id ? (
              <Link href={`/app/integrations/jobs/${data.retry_of_id}`} className="text-primary underline-offset-4 hover:underline">
                Retry of an earlier job
              </Link>
            ) : null}
          </>
        }
        actions={
          retryable ? (
            <PermissionGate permission={PERMISSIONS.integrationsManage}>
              <Button onClick={() => retry.mutate()} disabled={retry.isPending}>
                {retry.isPending ? <LoaderCircleIcon className="animate-spin" aria-hidden /> : <RotateCcwIcon aria-hidden />}
                Retry
              </Button>
            </PermissionGate>
          ) : null
        }
      />
      <div className="space-y-6">
        {data.error_message ? (
          <Notice tone="danger" title="The job reported an error">
            {data.error_message}
          </Notice>
        ) : null}

        <div className="grid gap-px overflow-hidden rounded-xl bg-border ring-1 ring-foreground/10 sm:grid-cols-3 lg:grid-cols-5">
          {(
            [
              ["Received", data.records.received],
              ["Inserted", data.records.inserted],
              ["Updated", data.records.updated],
              ["Unchanged", data.records.unchanged],
              ["Rejected", data.records.rejected],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="bg-card px-4 py-4">
              <p className="text-[0.8125rem] text-muted-foreground">{label}</p>
              <p className={`mt-1 text-2xl leading-none font-semibold ${label === "Rejected" && value > 0 ? "text-destructive" : ""}`}>
                {active ? "…" : formatNumber(value)}
              </p>
            </div>
          ))}
        </div>

        <div className="grid gap-6 xl:grid-cols-3">
          <Panel className="xl:col-span-2" title="Records by type" description="What happened to the rows of each record type">
            {active && !stats.length ? <p className="text-sm text-muted-foreground">Counting rows…</p> : <EntityStatsTable stats={stats} />}
          </Panel>
          <Panel title="Job details">
            <DetailList
              className="sm:grid-cols-1"
              items={[
                { label: "Trigger", value: triggerLabel(data.trigger) },
                { label: "Record types", value: data.entity_types.length ? data.entity_types.map(humanize).join(", ") : "All supported types" },
                { label: "Queued", value: formatDateTime(data.queued_at) },
                { label: "Started", value: formatDateTime(data.started_at) },
                { label: "Finished", value: active ? "Still running" : formatDateTime(data.finished_at) },
                ...(data.file
                  ? [
                      {
                        label: "File",
                        value: (
                          <span>
                            {data.file.filename} ({formatBytes(data.file.bytes)})
                            <span className="block font-mono text-xs break-all text-muted-foreground">SHA-256 {data.file.sha256}</span>
                          </span>
                        ),
                      },
                    ]
                  : []),
                { label: "Errors logged", value: formatNumber(data.logged_errors) },
              ]}
            />
          </Panel>
        </div>

        <ErrorLog jobId={data.id} total={data.logged_errors} codes={Array.from(new Set(stats.flatMap((s) => Object.keys(s.error_counts ?? {}))))} />
      </div>
    </>
  );
}

const ERROR_PAGE = 25;

function ErrorLog({ jobId, total, codes }: { jobId: string; total: number; codes: string[] }) {
  const [page, setPage] = useState(0);
  const [code, setCode] = useState("all");
  const errors = useOrgQuery<{ total: number; errors: SyncError[] }>(`/sync-jobs/${jobId}/errors`, {
    query: { limit: ERROR_PAGE, offset: page * ERROR_PAGE, code: code === "all" ? undefined : code },
    keepPrevious: true,
  });
  const columns: Column<SyncError>[] = [
    { key: "row", header: "Row", align: "right", cell: (r) => (r.row_number === null ? "—" : formatNumber(r.row_number)) },
    { key: "type", header: "Record type", cell: (r) => (r.entity_type ? humanize(r.entity_type) : "—") },
    { key: "field", header: "Field", cell: (r) => (r.field ? <span className="font-mono text-xs">{r.field}</span> : "—") },
    {
      key: "code",
      header: "Problem",
      cell: (r) => (
        <span className="block min-w-[10rem]">
          {errorCodeLabel(r.code)}
          <span className="block font-mono text-xs text-muted-foreground">{r.code}</span>
        </span>
      ),
    },
    { key: "message", header: "Message", cell: (r) => <span className="block min-w-[16rem] whitespace-normal">{r.message}</span> },
    {
      key: "severity",
      header: "Severity",
      cell: (r) => <StatusBadge tone={r.severity === "error" ? "danger" : "warning"}>{humanize(r.severity)}</StatusBadge>,
    },
    {
      key: "raw",
      header: "Row excerpt",
      cell: (r) =>
        r.raw_excerpt ? (
          <JsonPreview label="View row" title={`Row ${r.row_number ?? ""}`.trim()} summary={r.source_record_id ? `Source record ${r.source_record_id}` : null} value={r.raw_excerpt} />
        ) : (
          <span className="text-xs text-muted-foreground">Hidden for your role</span>
        ),
    },
  ];
  return (
    <Panel
      title="Error log"
      description={total ? `${formatNumber(total)} problems were logged. Rejected rows were not loaded; fix them in the source and upload again.` : "Rows that failed validation are listed here."}
      dimmed={errors.isPlaceholderData}
      actions={
        codes.length > 1 ? (
          <div className="flex items-center gap-2">
            <Label htmlFor="error-code" className="text-xs text-muted-foreground">
              Problem
            </Label>
            <Select
              value={code}
              onValueChange={(value) => {
                setPage(0);
                setCode(value);
              }}
            >
              <SelectTrigger id="error-code" size="sm" className="w-56 bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" align="end">
                <SelectItem value="all">All problems</SelectItem>
                {codes.map((c) => (
                  <SelectItem key={c} value={c}>
                    {errorCodeLabel(c)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null
      }
    >
      {errors.isPending ? (
        <TableSkeleton rows={5} columns={6} />
      ) : errors.error || !errors.data ? (
        <ErrorState compact error={errors.error} onRetry={() => void errors.refetch()} />
      ) : (
        <>
          <DataTable
            caption="Validation errors"
            columns={columns}
            rows={errors.data.errors}
            rowKey={(r) => String(r.id)}
            dense
            empty={<EmptyState compact title="No errors logged" description="Every row in this job passed validation." />}
          />
          {errors.data.total > ERROR_PAGE ? (
            <Pagination className="mt-3" page={page} pageSize={ERROR_PAGE} total={errors.data.total} onPageChange={setPage} disabled={errors.isFetching} />
          ) : null}
        </>
      )}
    </Panel>
  );
}
