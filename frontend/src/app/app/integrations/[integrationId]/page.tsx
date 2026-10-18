"use client";

import {
  ArrowLeftIcon,
  CircleCheckIcon,
  CircleXIcon,
  ExternalLinkIcon,
  KeyRoundIcon,
  LoaderCircleIcon,
  PlayIcon,
  PowerIcon,
  PowerOffIcon,
  RefreshCwIcon,
  Trash2Icon,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { PermissionGate, RequireAccess } from "@/components/app/access";
import { AppPage } from "@/components/app/app-page";
import { IntegrationStatusBadge, integrationStatusInfo, SyntheticFeedBadge, VerificationBadge } from "@/components/app/badges";
import { ResearchDetails, useEntities } from "@/components/app/integrations/catalog";
import { ACTIVE_JOB, JobsTable } from "@/components/app/integrations/jobs";
import { UploadPanel } from "@/components/app/integrations/upload-panel";
import { DetailList, NoteList, PageHeader, Panel } from "@/components/app/page";
import { Pagination } from "@/components/app/pagination";
import { useSession } from "@/components/app/session-provider";
import { EmptyState, ErrorState, Notice, TableSkeleton } from "@/components/app/states";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useInvalidateOrg, useOrgMutation, useOrgQuery } from "@/hooks/use-org-query";
import { formatDateTime, formatRelative, humanize } from "@/lib/app/format";
import { acceptsUploads, canPull, LIVE_PROVIDERS, methodLabel } from "@/lib/app/labels";
import { PERMISSIONS } from "@/lib/app/nav";
import type { Integration, IntegrationDetail, SyncJob, TestResult } from "@/lib/app/types";

export default function IntegrationDetailPage() {
  return (
    <AppPage>
      <RequireAccess area="the Integration Hub" permission={PERMISSIONS.integrationsRead}>
        <Detail />
      </RequireAccess>
    </AppPage>
  );
}

const SCHEDULES = [
  { value: "none", label: "No schedule" },
  { value: "15", label: "Every 15 minutes" },
  { value: "60", label: "Every hour" },
  { value: "360", label: "Every 6 hours" },
  { value: "1440", label: "Every day" },
  { value: "10080", label: "Every week" },
];

function scheduleLabel(minutes: number | null) {
  if (!minutes) return "No schedule";
  return SCHEDULES.find((s) => Number(s.value) === minutes)?.label ?? `Every ${minutes} minutes`;
}

function Back() {
  return (
    <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
      <Link href="/app/integrations">
        <ArrowLeftIcon aria-hidden />
        Integration Hub
      </Link>
    </Button>
  );
}

function Detail() {
  const { integrationId } = useParams<{ integrationId: string }>();
  const query = useOrgQuery<IntegrationDetail>(`/integrations/${integrationId}`, {
    refetchInterval: (q) => (q.state.data?.recent_jobs.some((j) => ACTIVE_JOB.has(j.status)) ? 2500 : false),
  });
  if (query.isPending) {
    return (
      <>
        <Back />
        <PageHeader title="Connection" />
        <Panel>
          <TableSkeleton rows={6} columns={3} />
        </Panel>
      </>
    );
  }
  if (query.error || !query.data) {
    return (
      <>
        <Back />
        <PageHeader title="Connection" />
        <Panel>
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        </Panel>
      </>
    );
  }
  return <IntegrationView integration={query.data} />;
}

function TestResultView({ result, testedAt }: { result: TestResult | null; testedAt: string | null }) {
  if (!result || (!result.message && !result.checks?.length && !result.last_verified_event_at)) {
    return <p className="text-sm text-muted-foreground">No connection test has been run yet.</p>;
  }
  return (
    <div className="space-y-2 text-sm">
      <p className="flex items-start gap-2">
        {result.ok ? (
          <CircleCheckIcon className="mt-0.5 size-4 shrink-0 text-success" aria-label="Passed" />
        ) : result.ok === false ? (
          <CircleXIcon className="mt-0.5 size-4 shrink-0 text-destructive" aria-label="Failed" />
        ) : null}
        <span>
          {result.message ?? (result.last_verified_event_at ? `Last verified signed event ${formatRelative(result.last_verified_event_at)}` : "")}
          {testedAt ? <span className="block text-xs text-muted-foreground">Tested {formatDateTime(testedAt)}</span> : null}
        </span>
      </p>
      {result.checks?.length ? (
        <ul className="space-y-1 rounded-lg bg-muted/50 px-3 py-2 text-[0.8125rem]">
          {result.checks.map((check, i) => (
            <li key={`${check.name}-${i}`} className="flex items-start gap-2">
              {check.ok ? (
                <CircleCheckIcon className="mt-0.5 size-3.5 shrink-0 text-success" aria-label="Passed" />
              ) : (
                <CircleXIcon className="mt-0.5 size-3.5 shrink-0 text-destructive" aria-label="Failed" />
              )}
              <span>
                {humanize(check.name)}
                {typeof check.detail === "string" && check.detail ? <span className="text-muted-foreground">: {check.detail}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function ConfigValue({ value }: { value: unknown }) {
  if (value === null || value === undefined || value === "") return <span className="text-muted-foreground">Not set</span>;
  if (typeof value === "object") {
    const keys = Object.keys(value as object);
    if (!keys.length) return <span className="text-muted-foreground">Empty</span>;
    return <pre className="max-h-48 overflow-auto rounded-md bg-muted px-2.5 py-1.5 font-mono text-xs whitespace-pre-wrap break-all">{JSON.stringify(value, null, 2)}</pre>;
  }
  return <span className="font-mono text-xs break-all">{String(value)}</span>;
}

function IntegrationView({ integration }: { integration: IntegrationDetail }) {
  const router = useRouter();
  const { has } = useSession();
  const invalidate = useInvalidateOrg();
  const entities = useEntities();
  const canManage = has(PERMISSIONS.integrationsManage);
  const canImport = has(PERMISSIONS.dataImport);
  const [schedule, setSchedule] = useState(integration.schedule_minutes ? String(integration.schedule_minutes) : "none");
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const disabled = integration.status === "disabled";
  const live = LIVE_PROVIDERS.has(integration.provider_key);
  const pullable = canPull(integration.provider_key);
  const uploads = acceptsUploads(integration.provider_key, integration.availability);
  const statusInfo = integrationStatusInfo(integration.status);
  const refresh = () => invalidate(`/integrations/${integration.id}`, "/integrations", "/sync-jobs");

  const test = useOrgMutation<void, { result: TestResult; integration: Integration }>(
    (_, call) => call(`/integrations/${integration.id}/test`, { method: "POST" }),
    {
      onSuccess: (data) => {
        if (data.result.ok) toast.success(data.result.message ?? "Connection test passed");
        else toast.error(data.result.message ?? "Connection test failed");
        void refresh();
      },
      onError: (error) => toast.error(error.message),
    },
  );
  const sync = useOrgMutation<void, SyncJob>((_, call) => call(`/integrations/${integration.id}/sync`, { method: "POST", json: {} }), {
    onSuccess: (job) => {
      toast.success("Sync queued");
      void refresh();
      router.push(`/app/integrations/jobs/${job.id}`);
    },
    onError: (error) => toast.error(error.message),
  });
  const update = useOrgMutation<Record<string, unknown>, Integration>(
    (body, call) => call(`/integrations/${integration.id}`, { method: "PATCH", json: body }),
    {
      onSuccess: (_, body) => {
        toast.success("disabled" in body ? (body.disabled ? "Connection disabled" : "Connection enabled") : "Schedule saved");
        void refresh();
      },
      onError: (error) => toast.error(error.message),
    },
  );
  const remove = useOrgMutation<void>((_, call) => call(`/integrations/${integration.id}`, { method: "DELETE" }), {
    onSuccess: () => {
      toast.success(`${integration.display_name} deleted`);
      router.push("/app/integrations");
      // Refresh the list only: refetching this (deleted) connection's own queries would just 404.
      void invalidate("/integrations$", "/sync-jobs");
    },
    onError: (error) => toast.error(error.message),
  });
  const rotate = useOrgMutation<void, { signing_secret: string; note: string }>(
    (_, call) => call(`/integrations/${integration.id}/webhook-secret`, { method: "POST" }),
    {
      onSuccess: (data) => {
        setNewSecret(data.signing_secret);
        void refresh();
      },
      onError: (error) => toast.error(error.message),
    },
  );

  const credentialFields = Object.keys(integration.credentials ?? {});
  const configEntries = Object.entries(integration.config ?? {});

  return (
    <>
      <Back />
      <PageHeader
        title={integration.display_name}
        description={integration.status_detail ?? statusInfo.hint}
        meta={
          <>
            <IntegrationStatusBadge status={integration.status} />
            {integration.is_demo ? <SyntheticFeedBadge /> : null}
            <span>{integration.provider_name}</span>
            {integration.methods.length ? <span>{integration.methods.map(methodLabel).join(", ")}</span> : null}
          </>
        }
        actions={
          <PermissionGate permission={PERMISSIONS.integrationsManage}>
            {!disabled ? (
              <Button variant="outline" onClick={() => test.mutate()} disabled={test.isPending}>
                {test.isPending ? <LoaderCircleIcon className="animate-spin" aria-hidden /> : <PlayIcon aria-hidden />}
                Test connection
              </Button>
            ) : null}
            {pullable && integration.status === "connected" ? (
              <Button onClick={() => sync.mutate()} disabled={sync.isPending}>
                {sync.isPending ? <LoaderCircleIcon className="animate-spin" aria-hidden /> : <RefreshCwIcon aria-hidden />}
                Sync now
              </Button>
            ) : null}
          </PermissionGate>
        }
      />

      <div className="space-y-6">
        {integration.is_demo ? (
          <Notice title="Synthetic demo feed">
            This connection is the built-in generator for the fictional NovaMart retailer. It is not an external system and its data is synthetic.
          </Notice>
        ) : null}
        {pullable && integration.status !== "connected" && !disabled && !integration.is_demo ? (
          <Notice tone="warning" title="Not syncing yet">
            Syncing starts only after a connection test passes against the real endpoint.{" "}
            {integration.status === "awaiting_credentials" ? "Add the credentials the vendor issued, then run a test." : "Run a connection test."}
          </Notice>
        ) : null}

        <div className="grid gap-6 xl:grid-cols-2">
          <Panel title="Status" description={statusInfo.hint}>
            <div className="space-y-5">
              <DetailList
                items={[
                  { label: "Status", value: <IntegrationStatusBadge status={integration.status} /> },
                  {
                    label: "Last successful sync",
                    value: integration.last_successful_sync_at ? (
                      <span title={formatDateTime(integration.last_successful_sync_at)}>{formatRelative(integration.last_successful_sync_at)}</span>
                    ) : (
                      "Never"
                    ),
                  },
                  {
                    label: "Last sync attempt",
                    value: integration.last_sync_at ? <span title={formatDateTime(integration.last_sync_at)}>{formatRelative(integration.last_sync_at)}</span> : "Never",
                  },
                  { label: "Created", value: formatDateTime(integration.created_at) },
                  {
                    label: "Stored credentials",
                    value: credentialFields.length ? (
                      <span className="inline-flex flex-wrap items-center gap-1.5">
                        <KeyRoundIcon className="size-3.5 text-muted-foreground" aria-hidden />
                        {credentialFields.map(humanize).join(", ")}
                      </span>
                    ) : (
                      "None"
                    ),
                  },
                  ...(integration.provider_key === "webhook_push"
                    ? [{ label: "Signing secret", value: integration.has_webhook_secret ? "Set (shown once when created)" : "Not set" }]
                    : []),
                ]}
              />
              <div>
                <p className="mb-1.5 text-xs text-muted-foreground">Last connection test</p>
                <TestResultView result={integration.last_test_result} testedAt={integration.last_tested_at} />
              </div>
            </div>
          </Panel>

          <Panel title="Controls" description="Schedule and availability of this connection">
            <div className="space-y-5">
              {live ? (
                <div className="space-y-1.5">
                  <Label htmlFor="schedule" className="text-sm">
                    Sync schedule
                  </Label>
                  {canManage ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <Select value={schedule} onValueChange={setSchedule} disabled={disabled}>
                        <SelectTrigger id="schedule" className="w-56 bg-background">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent position="popper">
                          {SCHEDULES.map((s) => (
                            <SelectItem key={s.value} value={s.value}>
                              {s.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        variant="secondary"
                        disabled={update.isPending || schedule === (integration.schedule_minutes ? String(integration.schedule_minutes) : "none")}
                        onClick={() =>
                          update.mutate(schedule === "none" ? { clear_schedule: true } : { schedule_minutes: Number(schedule) })
                        }
                      >
                        Save schedule
                      </Button>
                    </div>
                  ) : (
                    <p className="text-sm">{scheduleLabel(integration.schedule_minutes)}</p>
                  )}
                  <p className="text-xs text-muted-foreground">Scheduled syncs run only while the connection is connected.</p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {uploads
                    ? "This connection receives data through file uploads, so there is no schedule."
                    : integration.provider_key === "webhook_push"
                      ? "This connection receives pushed events, so there is nothing to schedule."
                      : "This feed is refreshed by the platform."}
                </p>
              )}

              {integration.provider_key === "webhook_push" && canManage ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium">Signing secret</p>
                  {newSecret ? (
                    <div className="space-y-1.5">
                      <code className="block rounded-md bg-muted px-3 py-2 font-mono text-xs break-all">{newSecret}</code>
                      <p className="text-xs text-muted-foreground">Shown once. The previous secret stopped working immediately.</p>
                    </div>
                  ) : (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="outline" size="sm">
                          <KeyRoundIcon aria-hidden />
                          Rotate signing secret
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Rotate the signing secret?</AlertDialogTitle>
                          <AlertDialogDescription>
                            The current secret stops working immediately. Events signed with it will be rejected until the sender uses the new one.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Keep current secret</AlertDialogCancel>
                          <AlertDialogAction onClick={() => rotate.mutate()}>Rotate secret</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </div>
              ) : null}

              <PermissionGate permission={PERMISSIONS.integrationsManage}>
                <div className="flex flex-wrap gap-2 border-t pt-4">
                  {disabled ? (
                    <Button variant="outline" onClick={() => update.mutate({ disabled: false })} disabled={update.isPending}>
                      <PowerIcon aria-hidden />
                      Enable connection
                    </Button>
                  ) : (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="outline">
                          <PowerOffIcon aria-hidden />
                          Disable connection
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Disable {integration.display_name}?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Tests, syncs, uploads and scheduled runs stop. Data it already supplied stays in place with its provenance.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Keep enabled</AlertDialogCancel>
                          <AlertDialogAction onClick={() => update.mutate({ disabled: true })}>Disable</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                  {!integration.is_demo ? (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="destructive">
                          <Trash2Icon aria-hidden />
                          Delete
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete {integration.display_name}?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Only connections that never supplied data can be deleted. If this one has, disable it instead so its data keeps its provenance.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction variant="destructive" onClick={() => remove.mutate()}>
                            Delete connection
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  ) : null}
                </div>
              </PermissionGate>
            </div>
          </Panel>
        </div>

        {uploads && canImport && !disabled ? (
          entities.data ? (
            <UploadPanel
              integration={integration}
              entities={entities.data.entities}
              defaultEntity={
                (typeof integration.config?.entity_type === "string" ? integration.config.entity_type : null) ??
                integration.recent_jobs.find((j) => j.entity_types.length)?.entity_types[0] ??
                null
              }
            />
          ) : entities.error ? (
            <Panel title="Upload a file">
              <ErrorState compact error={entities.error} onRetry={() => void entities.refetch()} />
            </Panel>
          ) : (
            <Panel title="Upload a file">
              <TableSkeleton rows={3} columns={2} />
            </Panel>
          )
        ) : uploads && !canImport ? (
          <Notice>Uploading files needs the data import permission, which your role does not include.</Notice>
        ) : null}

        <JobsPanel integrationId={integration.id} />

        <div className="grid gap-6 xl:grid-cols-2">
          <Panel title="Configuration" description="Settings stored with the connection. Secrets are never shown.">
            {integration.config === null ? (
              <p className="text-sm text-muted-foreground">Configuration is visible to members who can manage integrations.</p>
            ) : configEntries.length ? (
              <DetailList className="sm:grid-cols-1" items={configEntries.map(([key, value]) => ({ label: humanize(key), value: <ConfigValue value={value} /> }))} />
            ) : (
              <p className="text-sm text-muted-foreground">No settings.</p>
            )}
          </Panel>
          {integration.provider ? (
            <Panel
              title="About the provider"
              description={integration.provider.summary}
              actions={<VerificationBadge status={integration.provider.verification_status} />}
            >
              <div className="space-y-4 text-sm">
                {integration.provider.activation_requirements.length ? (
                  <div>
                    <p className="mb-1.5 font-medium">Activation requirements</p>
                    <NoteList notes={integration.provider.activation_requirements} />
                  </div>
                ) : null}
                {integration.provider.docs_url ? (
                  <a
                    href={integration.provider.docs_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline"
                  >
                    Vendor documentation
                    <ExternalLinkIcon className="size-3.5" aria-hidden />
                    <span className="sr-only">(opens in a new tab)</span>
                  </a>
                ) : null}
                {integration.provider.research ? <ResearchDetails research={integration.provider.research} /> : null}
                {!integration.provider.activation_requirements.length && !integration.provider.docs_url && !integration.provider.research ? (
                  <p className="text-muted-foreground">No additional vendor research is recorded for this provider.</p>
                ) : null}
              </div>
            </Panel>
          ) : null}
        </div>
      </div>
    </>
  );
}

const JOB_PAGE = 10;

function JobsPanel({ integrationId }: { integrationId: string }) {
  const [page, setPage] = useState(0);
  const jobs = useOrgQuery<{ total: number; jobs: SyncJob[] }>(`/integrations/${integrationId}/jobs`, {
    query: { limit: JOB_PAGE, offset: page * JOB_PAGE },
    keepPrevious: true,
    refetchInterval: (q) => (q.state.data?.jobs.some((j) => ACTIVE_JOB.has(j.status)) ? 2500 : false),
  });
  return (
    <Panel title="Sync history" description="Every test-triggered sync, scheduled run and upload for this connection" dimmed={jobs.isPlaceholderData}>
      {jobs.isPending ? (
        <TableSkeleton rows={4} columns={8} />
      ) : jobs.error || !jobs.data ? (
        <ErrorState compact error={jobs.error} onRetry={() => void jobs.refetch()} />
      ) : (
        <>
          <JobsTable
            jobs={jobs.data.jobs}
            empty={<EmptyState compact title="No syncs yet" description="Uploads and syncs for this connection will be listed here." />}
          />
          {jobs.data.total > JOB_PAGE ? (
            <Pagination className="mt-3" page={page} pageSize={JOB_PAGE} total={jobs.data.total} onPageChange={setPage} disabled={jobs.isFetching} />
          ) : null}
        </>
      )}
    </Panel>
  );
}
