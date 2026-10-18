"use client";

import { CircleCheckIcon, CircleXIcon, LoaderCircleIcon, RefreshCwIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { JobStatusBadge } from "@/components/app/badges";
import { toastError } from "@/components/app/decision-lab/common";
import { useSession } from "@/components/app/session-provider";
import { Button } from "@/components/ui/button";
import { useInvalidateOrg, useOrgMutation, useOrgQuery } from "@/hooks/use-org-query";
import { formatDateTime, formatDuration, formatRelative } from "@/lib/app/format";
import type { BackgroundJobStatus, ForecastJob } from "@/lib/app/forecasts-types";

const DONE = new Set(["succeeded", "failed", "cancelled"]);

function elapsed(job: Pick<BackgroundJobStatus, "created_at" | "finished_at">): string {
  const start = new Date(job.created_at).getTime();
  const end = job.finished_at ? new Date(job.finished_at).getTime() : Date.now();
  return formatDuration(Math.max(0, (end - start) / 1000));
}

/**
 * Retrain button plus live job status. Training runs as a background job (POST /forecasts/train
 * → 202 {job_id}); the status is polled until it finishes, then every forecast view refreshes.
 */
export function useTraining(companyId?: string, recent?: ForecastJob[]) {
  const { has, membership } = useSession();
  const invalidate = useInvalidateOrg();
  const canRun = has("forecasts:run");
  const storeScoped = Boolean(membership?.store_scope && membership.store_scope.length);
  const runningRecent = recent?.find((j) => j.status === "queued" || j.status === "running")?.id ?? null;
  const [jobId, setJobId] = useState<string | null>(null);
  const [notified, setNotified] = useState<string | null>(null);
  const activeId = jobId ?? runningRecent;

  const job = useOrgQuery<BackgroundJobStatus>(activeId ? `/jobs/${activeId}` : null, {
    refetchInterval: (query) => (query.state.data && DONE.has(query.state.data.status) ? false : 2000),
    staleTime: 0,
  });
  const train = useOrgMutation<{ company_id?: string; targets?: string[] }, { job_id: string; status: string }>((body, call) =>
    call("/forecasts/train", { json: body }),
  );

  const status = job.data?.status;
  if (job.data && activeId && DONE.has(job.data.status) && notified !== activeId) {
    setNotified(activeId);
    void invalidate("/forecasts");
    if (job.data.status === "succeeded") toast.success("Forecast models retrained", { description: "Every forecast on this page now uses the new versions." });
    else toast.error("Training failed", { description: job.data.error ?? "See the job details." });
  }

  function start(targets?: string[]) {
    train.mutate(
      { company_id: companyId, targets },
      {
        onSuccess: (res) => {
          setJobId(res.job_id);
          setNotified(null);
          toast.message(res.status === "already_running" ? "Training is already running" : "Training started", {
            description: "Models are re-validated on rolling-origin backtests. This can take a few minutes.",
          });
        },
        onError: (error) => toastError(error, "Training didn't start"),
      },
    );
  }

  const busy = train.isPending || (Boolean(activeId) && (!status || !DONE.has(status)));
  return {
    canRun,
    storeScoped,
    allowed: canRun && !storeScoped,
    reason: !canRun ? "Your role can view forecasts but not retrain them." : storeScoped ? "Store-scoped members cannot retrain company forecasts." : null,
    busy,
    job: job.data ?? null,
    start,
  };
}

export function TrainButton({ training, label = "Retrain models", targets }: { training: ReturnType<typeof useTraining>; label?: string; targets?: string[] }) {
  if (!training.allowed) return null;
  return (
    <Button variant="outline" onClick={() => training.start(targets)} disabled={training.busy}>
      {training.busy ? <LoaderCircleIcon className="animate-spin" aria-hidden /> : <RefreshCwIcon aria-hidden />}
      {training.busy ? "Training…" : label}
    </Button>
  );
}

export function TrainingStatus({ training, recent }: { training: ReturnType<typeof useTraining>; recent?: ForecastJob[] }) {
  const job = training.job;
  const last = recent?.[0];
  if (job) {
    const done = DONE.has(job.status);
    return (
      <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground" role="status">
        <JobStatusBadge status={job.status} />
        {done ? (
          <>
            {job.status === "succeeded" ? <CircleCheckIcon className="size-4 text-success" aria-hidden /> : <CircleXIcon className="size-4 text-destructive" aria-hidden />}
            Training {job.status === "succeeded" ? "finished" : "failed"} {formatRelative(job.finished_at)} after {elapsed(job)}
          </>
        ) : (
          <>Training for {elapsed(job)}; this page refreshes when it finishes</>
        )}
      </p>
    );
  }
  if (last) {
    return (
      <p className="text-sm text-muted-foreground">
        Last training run {last.status === "succeeded" ? "finished" : last.status} {formatRelative(last.finished_at ?? last.created_at)} ({formatDateTime(last.finished_at ?? last.created_at)})
      </p>
    );
  }
  return null;
}
