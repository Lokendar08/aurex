"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ShieldCheckIcon } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { RequireAccess } from "@/components/app/access";
import { AppPage } from "@/components/app/app-page";
import { ActiveBadge, JobStatusBadge, StatusBadge } from "@/components/app/badges";
import { DataTable, type Column } from "@/components/app/data-table";
import { FormError, TextAreaField } from "@/components/app/form";
import { JsonPreview } from "@/components/app/json-preview";
import { DetailList, PageHeader, Panel, Stat } from "@/components/app/page";
import { useSession } from "@/components/app/session-provider";
import { EmptyState, Notice, QueryView, TableSkeleton } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useApiQuery } from "@/hooks/use-org-query";
import { api, type ApiError } from "@/lib/api";
import { formatBytes, formatDateTime, formatNumber, formatRelative, humanize } from "@/lib/app/format";
import type { AuditEvent, PlatformJob, PlatformOrganization, PlatformOverview, PlatformUser } from "@/lib/app/types";

export default function PlatformPage() {
  return (
    <AppPage>
      <RequireAccess area="platform administration" platform>
        <Platform />
      </RequireAccess>
    </AppPage>
  );
}

const TABS = ["overview", "organizations", "users", "jobs", "audit"] as const;

function Platform() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const requested = params.get("tab");
  const tab = (TABS as readonly string[]).includes(requested ?? "") ? (requested as string) : "overview";
  function setTab(next: string) {
    const query = new URLSearchParams(params.toString());
    if (next === "overview") query.delete("tab");
    else query.set("tab", next);
    const qs = query.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }
  return (
    <>
      <PageHeader title="Platform administration" description="Tenants, users, background jobs and platform-level audit events." />
      <Notice className="mb-6" title="Administrators cannot see tenant business data">
        Platform administration shows metadata and operational health only: counts, statuses and timings. Sales, finance and other
        business data are visible only to members an organization has invited.
      </Notice>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4 max-w-full flex-wrap justify-start group-data-horizontal/tabs:h-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="organizations">Organizations</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="jobs">Background jobs</TabsTrigger>
          <TabsTrigger value="audit">Audit</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <Overview />
        </TabsContent>
        <TabsContent value="organizations">
          <Organizations />
        </TabsContent>
        <TabsContent value="users">
          <Users />
        </TabsContent>
        <TabsContent value="jobs">
          <Jobs />
        </TabsContent>
        <TabsContent value="audit">
          <PlatformAudit />
        </TabsContent>
      </Tabs>
    </>
  );
}

function CountList({ counts, empty }: { counts: Record<string, number>; empty: string }) {
  const entries = Object.entries(counts);
  if (!entries.length) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <dl className="divide-y rounded-lg ring-1 ring-foreground/8">
      {entries
        .sort((a, b) => b[1] - a[1])
        .map(([key, value]) => (
          <div key={key} className="flex items-center justify-between px-3 py-2 text-sm">
            <dt>{humanize(key)}</dt>
            <dd className="font-semibold tabular">{formatNumber(value)}</dd>
          </div>
        ))}
    </dl>
  );
}

function Overview() {
  const overview = useApiQuery<PlatformOverview>("/platform/overview");
  return (
    <QueryView query={overview} loading={<TableSkeleton rows={4} columns={4} />}>
      {(data) => (
        <div className="space-y-6">
          <div className="grid gap-px overflow-hidden rounded-xl bg-border ring-1 ring-foreground/10 sm:grid-cols-2 xl:grid-cols-4">
            <div className="bg-card p-5">
              <Stat label="Organizations" value={formatNumber(data.organizations)} />
            </div>
            <div className="bg-card p-5">
              <Stat label="Users" value={formatNumber(data.users)} />
            </div>
            <div className="bg-card p-5">
              <Stat label="Integrations" value={formatNumber(data.integrations)} />
            </div>
            <div className="bg-card p-5">
              <Stat label="Database size" value={formatBytes(data.database_bytes)} />
            </div>
          </div>
          <div className="grid gap-6 lg:grid-cols-3">
            <Panel title="Integrations by status">
              <CountList counts={data.integrations_by_status} empty="No integrations." />
            </Panel>
            <Panel title="Sync jobs, last 24 hours">
              <CountList counts={data.sync_jobs_24h} empty="No sync jobs in the last 24 hours." />
            </Panel>
            <Panel title="Background jobs, last 24 hours">
              <CountList counts={data.background_jobs_24h} empty="No background jobs in the last 24 hours." />
            </Panel>
          </div>
          <Panel title="Runtime">
            <DetailList
              items={[
                { label: "Environment", value: humanize(data.environment) },
                { label: "Task backend", value: humanize(data.task_backend) },
              ]}
            />
          </Panel>
        </div>
      )}
    </QueryView>
  );
}

/** Reason-required status change (suspend / activate an organization, deactivate / activate a user). */
function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setReason("");
          setError(null);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <form
          className="grid gap-4"
          onSubmit={async (event) => {
            event.preventDefault();
            if (reason.trim().length < 3) {
              setError("Give a reason of at least 3 characters. It is recorded in the platform audit trail.");
              return;
            }
            setPending(true);
            setError(null);
            try {
              await onConfirm(reason.trim());
              setReason("");
              onOpenChange(false);
            } catch (err) {
              setError(err instanceof Error ? err.message : "The change could not be saved");
            } finally {
              setPending(false);
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <TextAreaField label="Reason" required value={reason} onChange={setReason} maxLength={500} hint="Recorded in the platform audit trail" />
          <FormError message={error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant={destructive ? "destructive" : "default"} disabled={pending}>
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Organizations() {
  const queryClient = useQueryClient();
  const orgs = useApiQuery<{ organizations: PlatformOrganization[] }>("/platform/organizations", { query: { limit: 200 } });
  const [target, setTarget] = useState<PlatformOrganization | null>(null);
  const setStatus = useMutation<unknown, ApiError, { id: string; status: string; reason: string }>({
    mutationFn: ({ id, status, reason }) => api(`/platform/organizations/${id}/status`, { json: { status, reason } }),
    onSuccess: (_, vars) => {
      toast.success(vars.status === "suspended" ? "Organization suspended" : "Organization activated");
      void queryClient.invalidateQueries({ queryKey: ["api", "/platform/organizations"] });
      void queryClient.invalidateQueries({ queryKey: ["api", "/platform/audit-events"] });
    },
  });
  const columns: Column<PlatformOrganization>[] = [
    {
      key: "name",
      header: "Organization",
      cell: (o) => (
        <span className="block min-w-[12rem]">
          <span className="font-medium">{o.name}</span>
          {o.is_demo ? <StatusBadge tone="info" className="ml-2">Demo</StatusBadge> : null}
          <span className="block font-mono text-xs text-muted-foreground">{o.slug}</span>
        </span>
      ),
      sortValue: (o) => o.name,
    },
    { key: "status", header: "Status", cell: (o) => <ActiveBadge active={o.status === "active"} />, sortValue: (o) => o.status },
    { key: "members", header: "Members", align: "right", cell: (o) => formatNumber(o.members), sortValue: (o) => o.members },
    { key: "integrations", header: "Integrations", align: "right", cell: (o) => formatNumber(o.integrations), sortValue: (o) => o.integrations },
    {
      key: "sync",
      header: "Last successful sync",
      cell: (o) => <span title={formatDateTime(o.last_successful_sync_at)}>{o.last_successful_sync_at ? formatRelative(o.last_successful_sync_at) : "Never"}</span>,
      sortValue: (o) => o.last_successful_sync_at,
    },
    { key: "created", header: "Created", cell: (o) => formatDateTime(o.created_at), sortValue: (o) => o.created_at },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      cell: (o) => (
        <Button variant={o.status === "active" ? "ghost" : "outline"} size="sm" onClick={() => setTarget(o)}>
          {o.status === "active" ? "Suspend" : "Activate"}
        </Button>
      ),
    },
  ];
  return (
    <Panel title="Organizations" description="Suspending an organization blocks every member's access until it is activated again">
      <QueryView query={orgs} loading={<TableSkeleton rows={4} columns={6} />}>
        {(data) => (
          <DataTable caption="Organizations" columns={columns} rows={data.organizations} rowKey={(o) => o.id} dense empty={<EmptyState compact title="No organizations" />} />
        )}
      </QueryView>
      {target ? (
        <ReasonDialog
          open
          onOpenChange={(open) => !open && setTarget(null)}
          title={target.status === "active" ? `Suspend ${target.name}?` : `Activate ${target.name}?`}
          description={
            target.status === "active"
              ? "Every member loses access to this organization immediately. Its data is kept."
              : "Members regain access to the organization."
          }
          confirmLabel={target.status === "active" ? "Suspend organization" : "Activate organization"}
          destructive={target.status === "active"}
          onConfirm={(reason) => setStatus.mutateAsync({ id: target.id, status: target.status === "active" ? "suspended" : "active", reason }).then(() => undefined)}
        />
      ) : null}
    </Panel>
  );
}

function Users() {
  const { user: me } = useSession();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const users = useApiQuery<{ users: PlatformUser[] }>("/platform/users", { query: { q: search || undefined, limit: 200 }, keepPrevious: true });
  const [target, setTarget] = useState<PlatformUser | null>(null);
  const setActive = useMutation<unknown, ApiError, { id: string; is_active: boolean; reason: string }>({
    mutationFn: ({ id, is_active, reason }) => api(`/platform/users/${id}/status`, { json: { is_active, reason } }),
    onSuccess: (_, vars) => {
      toast.success(vars.is_active ? "User activated" : "User deactivated");
      void queryClient.invalidateQueries({ queryKey: ["api", "/platform/users"] });
      void queryClient.invalidateQueries({ queryKey: ["api", "/platform/audit-events"] });
    },
  });
  const columns: Column<PlatformUser>[] = [
    {
      key: "name",
      header: "User",
      cell: (u) => (
        <span className="block min-w-[13rem]">
          <span className="font-medium">
            {u.full_name}
            {u.id === me.id ? <span className="ml-1.5 text-xs font-normal text-muted-foreground">(you)</span> : null}
          </span>
          <span className="block text-xs text-muted-foreground">{u.email}</span>
        </span>
      ),
      sortValue: (u) => u.full_name,
    },
    {
      key: "type",
      header: "Type",
      cell: (u) => (
        <span className="flex flex-wrap gap-1">
          {u.is_platform_admin ? <StatusBadge tone="info">Platform admin</StatusBadge> : null}
          {u.is_demo ? <StatusBadge>Demo</StatusBadge> : null}
          {!u.is_platform_admin && !u.is_demo ? <span className="text-muted-foreground">Member</span> : null}
        </span>
      ),
    },
    { key: "status", header: "Status", cell: (u) => <ActiveBadge active={u.is_active} inactiveLabel="Deactivated" />, sortValue: (u) => (u.is_active ? 0 : 1) },
    { key: "memberships", header: "Organizations", align: "right", cell: (u) => formatNumber(u.memberships), sortValue: (u) => u.memberships },
    {
      key: "login",
      header: "Last sign-in",
      cell: (u) => <span title={formatDateTime(u.last_login_at)}>{u.last_login_at ? formatRelative(u.last_login_at) : "Never"}</span>,
      sortValue: (u) => u.last_login_at,
    },
    {
      key: "locked",
      header: "Locked",
      cell: (u) => (u.locked_until && new Date(u.locked_until) > new Date() ? <StatusBadge tone="warning">Until {formatDateTime(u.locked_until)}</StatusBadge> : "—"),
    },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      cell: (u) =>
        u.id === me.id ? null : (
          <Button variant={u.is_active ? "ghost" : "outline"} size="sm" onClick={() => setTarget(u)}>
            {u.is_active ? "Deactivate" : "Activate"}
          </Button>
        ),
    },
  ];
  return (
    <Panel title="Users" description="Deactivating a user ends all their sessions in every organization">
      <form
        className="mb-4 flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setSearch(draft.trim());
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="user-search" className="text-xs text-muted-foreground">
            Email contains
          </Label>
          <Input id="user-search" type="search" value={draft} onChange={(e) => setDraft(e.target.value)} className="w-64 bg-background" maxLength={120} />
        </div>
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>
      <QueryView query={users} loading={<TableSkeleton rows={8} columns={6} />}>
        {(data) => (
          <DataTable caption="Users" columns={columns} rows={data.users} rowKey={(u) => u.id} dense pageSize={25} empty={<EmptyState compact title="No users match" />} />
        )}
      </QueryView>
      {target ? (
        <ReasonDialog
          open
          onOpenChange={(open) => !open && setTarget(null)}
          title={target.is_active ? `Deactivate ${target.full_name}?` : `Activate ${target.full_name}?`}
          description={target.is_active ? "They are signed out everywhere and cannot sign in until activated." : "They can sign in again; any lockout is cleared."}
          confirmLabel={target.is_active ? "Deactivate user" : "Activate user"}
          destructive={target.is_active}
          onConfirm={(reason) => setActive.mutateAsync({ id: target.id, is_active: !target.is_active, reason }).then(() => undefined)}
        />
      ) : null}
    </Panel>
  );
}

function Jobs() {
  const [status, setStatus] = useState("all");
  const jobs = useApiQuery<{ jobs: PlatformJob[] }>("/platform/jobs", { query: { status: status === "all" ? undefined : status, limit: 100 }, keepPrevious: true });
  const columns: Column<PlatformJob>[] = [
    { key: "type", header: "Job", cell: (j) => <span className="font-mono text-xs">{j.job_type}</span>, sortValue: (j) => j.job_type },
    { key: "status", header: "Status", cell: (j) => <JobStatusBadge status={j.status} />, sortValue: (j) => j.status },
    { key: "attempts", header: "Attempts", align: "right", cell: (j) => formatNumber(j.attempts), sortValue: (j) => j.attempts },
    { key: "org", header: "Organization", cell: (j) => (j.org_id ? <span className="font-mono text-xs">{j.org_id.slice(0, 8)}</span> : "Platform") },
    { key: "created", header: "Created", cell: (j) => formatDateTime(j.created_at), sortValue: (j) => j.created_at },
    { key: "finished", header: "Finished", cell: (j) => formatDateTime(j.finished_at), sortValue: (j) => j.finished_at },
    { key: "error", header: "Error", cell: (j) => (j.error ? <JsonPreview label="View" title="Error" summary={j.error.slice(0, 2000)} value={null} /> : "—") },
  ];
  return (
    <Panel
      title="Background jobs"
      description="Syncs, model training and report generation queued by every tenant"
      actions={
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger size="sm" className="w-44 bg-background" aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" align="end">
            <SelectItem value="all">All statuses</SelectItem>
            {["queued", "running", "succeeded", "failed"].map((s) => (
              <SelectItem key={s} value={s}>
                {humanize(s)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    >
      <QueryView query={jobs} loading={<TableSkeleton rows={6} columns={6} />}>
        {(data) => (
          <DataTable caption="Background jobs" columns={columns} rows={data.jobs} rowKey={(j) => j.id} dense pageSize={25} empty={<EmptyState compact title="No background jobs" description="Jobs queued through the task backend appear here." />} />
        )}
      </QueryView>
    </Panel>
  );
}

function PlatformAudit() {
  const events = useApiQuery<{ events: AuditEvent[] }>("/platform/audit-events", { query: { limit: 200 } });
  const columns: Column<AuditEvent>[] = [
    { key: "when", header: "When", cell: (e) => formatDateTime(e.created_at), sortValue: (e) => e.created_at },
    { key: "action", header: "Action", cell: (e) => <span className="font-mono text-xs">{e.action}</span>, sortValue: (e) => e.action },
    { key: "actor", header: "Actor", cell: (e) => e.actor ?? "System", sortValue: (e) => e.actor },
    { key: "entity", header: "Entity", cell: (e) => (e.entity_type ? humanize(e.entity_type) : "—") },
    {
      key: "outcome",
      header: "Outcome",
      cell: (e) => <StatusBadge tone={e.outcome === "success" ? "good" : e.outcome === "failure" ? "danger" : "neutral"}>{humanize(e.outcome)}</StatusBadge>,
    },
    { key: "details", header: "Details", cell: (e) => (e.details && Object.keys(e.details).length ? <JsonPreview value={e.details} /> : "—") },
  ];
  return (
    <Panel
      title="Platform audit"
      description="Sign-ins and administrator actions that are not tied to one organization"
      actions={<ShieldCheckIcon className="size-4 text-muted-foreground" aria-hidden />}
    >
      <QueryView query={events} loading={<TableSkeleton rows={8} columns={5} />}>
        {(data) => <DataTable caption="Platform audit events" columns={columns} rows={data.events} rowKey={(e) => String(e.id)} dense pageSize={25} empty={<EmptyState compact title="No platform events yet" />} />}
      </QueryView>
    </Panel>
  );
}
