"use client";

import { DownloadIcon, FileSpreadsheetIcon, LoaderCircleIcon, TriangleAlertIcon, UploadIcon } from "lucide-react";
import Link from "next/link";
import { useId, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { JobStatusBadge } from "@/components/app/badges";
import { Panel } from "@/components/app/page";
import { useOrgId } from "@/components/app/session-provider";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useInvalidateOrg, useOrgQuery } from "@/hooks/use-org-query";
import { api, apiDownload, ApiError, orgPath } from "@/lib/api";
import { formatBytes, formatNumber } from "@/lib/app/format";
import type { EntitySpec, Integration, SyncJob, SyncJobDetail } from "@/lib/app/types";

import { ACTIVE_JOB } from "./jobs";

const MAX_BYTES = 25 * 1024 * 1024;
const ACCEPT = ".csv,.xlsx,.xlsm,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function UploadResult({ jobId }: { jobId: string }) {
  const job = useOrgQuery<SyncJobDetail>(`/sync-jobs/${jobId}`, {
    refetchInterval: (query) => (query.state.data && !ACTIVE_JOB.has(query.state.data.status) ? false : 1500),
  });
  const data = job.data;
  return (
    <div role="status" aria-live="polite" className="rounded-lg bg-muted/60 px-3.5 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">Import job</span>
        {data ? <JobStatusBadge status={data.status} /> : <JobStatusBadge status="queued" />}
        <Link href={`/app/integrations/jobs/${jobId}`} className="ml-auto font-medium text-primary underline-offset-4 hover:underline">
          View job and error log
        </Link>
      </div>
      {data && !ACTIVE_JOB.has(data.status) ? (
        <p className="mt-1.5 text-muted-foreground">
          {formatNumber(data.records.received)} rows received: {formatNumber(data.records.inserted)} inserted, {formatNumber(data.records.updated)} updated,{" "}
          {formatNumber(data.records.unchanged)} unchanged, {formatNumber(data.records.rejected)} rejected.
          {data.error_message ? ` ${data.error_message}` : ""}
        </p>
      ) : (
        <p className="mt-1.5 text-muted-foreground">Validating and loading the file. This usually takes a few seconds.</p>
      )}
    </div>
  );
}

/**
 * File import for file-based connections and vendor profiles that are waiting for API access:
 * choose the record type, download its CSV template, upload CSV or XLSX. Rows are validated one by
 * one and loaded idempotently; rejected rows are listed in the job's error log.
 */
export function UploadPanel({
  integration,
  entities,
  defaultEntity,
}: {
  integration: Integration;
  entities: EntitySpec[];
  /** The connection's usual record type (its configured default, or the type of its last import). */
  defaultEntity?: string | null;
}) {
  const orgId = useOrgId();
  const invalidate = useInvalidateOrg();
  const formId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const supported = entities.filter((e) => integration.supported_entities.includes(e.key));
  const [entity, setEntity] = useState<string>(
    defaultEntity && supported.some((e) => e.key === defaultEntity) ? defaultEntity : supported.length === 1 ? supported[0].key : "",
  );
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<{ message: string; jobId?: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const spec = supported.find((e) => e.key === entity);
  const required = spec?.fields.filter((f) => f.required).map((f) => f.name) ?? [];

  // A finished upload's message should not greet the member when they come back to this page later.
  const shownResult = useRef(false);
  useLayoutEffect(
    () => () => {
      if (shownResult.current) {
        shownResult.current = false;
        setJobId(null);
        setError(null);
      }
    },
    [],
  );

  function chooseFile(next: File | null) {
    setError(null);
    if (next && !/\.(csv|xlsx|xlsm)$/i.test(next.name)) {
      setError({ message: "Choose a .csv or .xlsx file." });
      setFile(null);
      return;
    }
    if (next && next.size > MAX_BYTES) {
      setError({ message: `The file is ${formatBytes(next.size)}; the limit is 25 MB.` });
      setFile(null);
      return;
    }
    setFile(next);
  }

  async function downloadTemplate() {
    if (!entity) return;
    setDownloading(true);
    try {
      await apiDownload(orgPath(orgId, `/integrations/templates/${encodeURIComponent(entity)}.csv`), `aurex_${entity}_template.csv`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "The template could not be downloaded");
    } finally {
      setDownloading(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!file || !entity || pending) return;
    setPending(true);
    setError(null);
    setJobId(null);
    const body = new FormData();
    body.append("file", file);
    body.append("entity_type", entity);
    try {
      const result = await api<{ uploaded_file_id: string; job: SyncJob }>(orgPath(orgId, `/integrations/${integration.id}/uploads`), {
        method: "POST",
        body,
      });
      shownResult.current = true;
      setJobId(result.job.id);
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      toast.success(`${file.name} uploaded`);
      void invalidate(`/integrations/${integration.id}`, "/integrations", "/sync-jobs");
    } catch (err) {
      shownResult.current = true;
      if (err instanceof ApiError && err.code === "duplicate_file") {
        const details = (err.details ?? {}) as { sync_job_id?: string | null };
        setError({ message: err.message, jobId: details.sync_job_id ?? undefined });
      } else {
        setError({ message: err instanceof Error ? err.message : "Upload failed" });
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Panel
      title="Upload a file"
      description="CSV or Excel exports, validated row by row. Re-importing the same rows updates them instead of duplicating."
    >
      <form id={formId} onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 md:grid-cols-[minmax(0,16rem)_minmax(0,1fr)] md:items-end">
          <div className="space-y-1.5">
            <Label htmlFor={`${formId}-entity`} className="text-sm">
              Record type
            </Label>
            <Select value={entity} onValueChange={setEntity}>
              <SelectTrigger id={`${formId}-entity`} className="w-full bg-background">
                <SelectValue placeholder="Choose a record type" />
              </SelectTrigger>
              <SelectContent position="popper">
                {supported.map((e) => (
                  <SelectItem key={e.key} value={e.key}>
                    {e.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Button type="button" variant="outline" onClick={() => void downloadTemplate()} disabled={!entity || downloading}>
              {downloading ? <LoaderCircleIcon className="animate-spin" aria-hidden /> : <DownloadIcon aria-hidden />}
              Download CSV template
            </Button>
          </div>
        </div>
        {required.length ? (
          <p className="text-xs leading-relaxed text-muted-foreground">
            Required columns: <span className="font-mono text-foreground">{required.join(", ")}</span>. Dates use ISO format (2026-01-31)
            unless the connection sets another date format.
          </p>
        ) : null}

        <div className="space-y-1.5">
          <Label htmlFor={`${formId}-file`} className="text-sm">
            File
          </Label>
          <label
            htmlFor={`${formId}-file`}
            className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-input bg-muted/30 px-4 py-6 text-center text-sm transition-colors hover:bg-muted/50 has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              chooseFile(e.dataTransfer.files?.[0] ?? null);
            }}
          >
            <FileSpreadsheetIcon className="size-6 text-muted-foreground" aria-hidden />
            {file ? (
              <span>
                <span className="font-medium">{file.name}</span> <span className="text-muted-foreground">({formatBytes(file.size)})</span>
              </span>
            ) : (
              <span className="text-muted-foreground">Choose a .csv or .xlsx file, or drop it here (25 MB maximum)</span>
            )}
            <input
              ref={inputRef}
              id={`${formId}-file`}
              type="file"
              accept={ACCEPT}
              className="sr-only"
              onChange={(e) => chooseFile(e.target.files?.[0] ?? null)}
            />
          </label>
        </div>

        {error ? (
          <div role="alert" className="flex items-start gap-2.5 rounded-lg bg-destructive/6 px-3.5 py-3 text-sm ring-1 ring-destructive/25">
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
            <span>
              {error.message}
              {error.jobId ? (
                <>
                  {" "}
                  <Link href={`/app/integrations/jobs/${error.jobId}`} className="font-medium text-primary underline-offset-4 hover:underline">
                    Open the earlier import
                  </Link>
                </>
              ) : null}
            </span>
          </div>
        ) : null}
        {jobId ? <UploadResult jobId={jobId} /> : null}

        <Button type="submit" disabled={!file || !entity || pending}>
          {pending ? <LoaderCircleIcon className="animate-spin" aria-hidden /> : <UploadIcon aria-hidden />}
          {pending ? "Uploading" : "Upload and import"}
        </Button>
      </form>
    </Panel>
  );
}
