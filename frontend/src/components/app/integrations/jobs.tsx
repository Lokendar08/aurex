"use client";

import { ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import { Fragment, useState } from "react";

import { JobStatusBadge } from "@/components/app/badges";
import { EmptyState } from "@/components/app/states";
import { formatDate, formatDateTime, formatDuration, formatNumber, formatRelative, humanize } from "@/lib/app/format";
import { errorCodeLabel, triggerLabel } from "@/lib/app/labels";
import type { EntityStats, SyncJob } from "@/lib/app/types";
import { cn } from "@/lib/utils";

export const ACTIVE_JOB = new Set(["queued", "running"]);

/** Per-entity statistics of a job (the `_aggregates` bookkeeping entry is left out). */
export function entityStats(job: Pick<SyncJob, "stats">): (EntityStats & { entity: string })[] {
  if (!job.stats) return [];
  return Object.entries(job.stats)
    .filter(([key]) => !key.startsWith("_"))
    .map(([key, value]) => ({ ...(value as EntityStats), entity: (value as EntityStats).entity ?? key }));
}

function Count({ value, danger }: { value: number | undefined | null; danger?: boolean }) {
  return <span className={cn("tabular", danger && (value ?? 0) > 0 && "font-semibold text-destructive")}>{formatNumber(value ?? null)}</span>;
}

/** Received / inserted / updated / unchanged / rejected for each record type in a job. */
export function EntityStatsTable({ stats }: { stats: (EntityStats & { entity: string })[] }) {
  if (!stats.length) return <p className="text-sm text-muted-foreground">No per-record-type statistics were reported.</p>;
  return (
    <div className="overflow-x-auto rounded-lg ring-1 ring-foreground/8" role="region" aria-label="Records by type" tabIndex={0}>
      <table className="w-full border-collapse text-[0.8125rem]">
        <caption className="sr-only">Records by type</caption>
        <thead className="bg-muted/60 text-muted-foreground">
          <tr className="border-b">
            <th scope="col" className="px-3 py-2 text-left font-medium">Record type</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Received</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Inserted</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Updated</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Unchanged</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Rejected</th>
            <th scope="col" className="px-3 py-2 text-left font-medium">Dates covered</th>
          </tr>
        </thead>
        <tbody>
          {stats.map((s) => (
            <Fragment key={s.entity}>
              <tr className="border-b last:border-b-0">
                <th scope="row" className="px-3 py-2 text-left font-medium">
                  {humanize(s.entity)}
                </th>
                <td className="px-3 py-2 text-right"><Count value={s.received} /></td>
                <td className="px-3 py-2 text-right"><Count value={s.inserted} /></td>
                <td className="px-3 py-2 text-right"><Count value={s.updated} /></td>
                <td className="px-3 py-2 text-right"><Count value={s.unchanged} /></td>
                <td className="px-3 py-2 text-right"><Count value={s.rejected} danger /></td>
                <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                  {s.min_date ? `${formatDate(s.min_date)}${s.max_date && s.max_date !== s.min_date ? ` to ${formatDate(s.max_date)}` : ""}` : "—"}
                </td>
              </tr>
              {(s.error_counts && Object.keys(s.error_counts).length) || s.notes?.length ? (
                <tr className="border-b bg-muted/25 last:border-b-0">
                  <td colSpan={7} className="px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                    {s.error_counts && Object.keys(s.error_counts).length ? (
                      <p>
                        <span className="font-medium text-foreground">Rejections: </span>
                        {Object.entries(s.error_counts)
                          .sort((a, b) => b[1] - a[1])
                          .map(([code, n]) => `${errorCodeLabel(code)} (${n})`)
                          .join(", ")}
                      </p>
                    ) : null}
                    {s.notes?.map((note) => (
                      <p key={note}>{note}</p>
                    ))}
                  </td>
                </tr>
              ) : null}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Sync history: one row per job with record counts. Rows expand to the per-record-type breakdown;
 * each job links to its page with the error log.
 */
export function JobsTable({ jobs, showIntegration, empty }: { jobs: SyncJob[]; showIntegration?: boolean; empty?: React.ReactNode }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  if (!jobs.length) return <>{empty ?? <EmptyState compact title="No syncs yet" description="Tests, syncs and uploads will be listed here." />}</>;
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <div className="overflow-x-auto rounded-lg ring-1 ring-foreground/8" role="region" aria-label="Sync history" tabIndex={0}>
      <table className="w-full border-collapse text-[0.8125rem]">
        <caption className="sr-only">Sync history</caption>
        <thead className="bg-muted/60 text-muted-foreground">
          <tr className="border-b">
            <th scope="col" className="w-8 px-2 py-2">
              <span className="sr-only">Details</span>
            </th>
            <th scope="col" className="px-3 py-2 text-left font-medium">Started</th>
            {showIntegration ? <th scope="col" className="px-3 py-2 text-left font-medium">Integration</th> : null}
            <th scope="col" className="px-3 py-2 text-left font-medium">Trigger</th>
            <th scope="col" className="px-3 py-2 text-left font-medium">Status</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Received</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Inserted</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Updated</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Unchanged</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Rejected</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Duration</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => {
            const expanded = open.has(job.id);
            const stats = entityStats(job);
            const when = job.started_at ?? job.queued_at;
            return (
              <Fragment key={job.id}>
                <tr className="border-b last:border-b-0 hover:bg-muted/30">
                  <td className="px-2 py-2 align-middle">
                    <button
                      type="button"
                      onClick={() => toggle(job.id)}
                      aria-expanded={expanded}
                      aria-label={expanded ? "Hide records by type" : "Show records by type"}
                      className="grid size-6 place-items-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      <ChevronRightIcon className={cn("size-4 transition-transform", expanded && "rotate-90")} aria-hidden />
                    </button>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <Link href={`/app/integrations/jobs/${job.id}`} className="font-medium text-primary underline-offset-4 hover:underline" title={formatDateTime(when)}>
                      {formatDateTime(when)}
                    </Link>
                    <span className="block text-xs text-muted-foreground">{formatRelative(when)}</span>
                  </td>
                  {showIntegration ? (
                    <td className="px-3 py-2">
                      <Link href={`/app/integrations/${job.integration_id}`} className="underline-offset-4 hover:underline">
                        {job.integration ?? "Integration"}
                      </Link>
                    </td>
                  ) : null}
                  <td className="px-3 py-2 whitespace-nowrap">
                    {triggerLabel(job.trigger)}
                    {job.attempt > 1 ? <span className="block text-xs text-muted-foreground">Attempt {job.attempt}</span> : null}
                  </td>
                  <td className="px-3 py-2">
                    <JobStatusBadge status={job.status} />
                  </td>
                  <td className="px-3 py-2 text-right"><Count value={job.records.received} /></td>
                  <td className="px-3 py-2 text-right"><Count value={job.records.inserted} /></td>
                  <td className="px-3 py-2 text-right"><Count value={job.records.updated} /></td>
                  <td className="px-3 py-2 text-right"><Count value={job.records.unchanged} /></td>
                  <td className="px-3 py-2 text-right"><Count value={job.records.rejected} danger /></td>
                  <td className="px-3 py-2 text-right whitespace-nowrap text-muted-foreground tabular">
                    {ACTIVE_JOB.has(job.status) ? "In progress" : formatDuration(job.duration_seconds)}
                  </td>
                </tr>
                {expanded ? (
                  <tr className="border-b bg-muted/20 last:border-b-0">
                    <td colSpan={showIntegration ? 11 : 10} className="px-3 py-3">
                      {job.error_message ? <p className="mb-2 text-sm text-destructive">{job.error_message}</p> : null}
                      <EntityStatsTable stats={stats} />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
