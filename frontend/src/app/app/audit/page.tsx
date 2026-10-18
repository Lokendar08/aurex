"use client";

import { GaugeIcon, ScrollTextIcon, SearchIcon } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";

import { RequireAccess } from "@/components/app/access";
import { AppPage } from "@/components/app/app-page";
import { StatusBadge } from "@/components/app/badges";
import { DataTable, type Column } from "@/components/app/data-table";
import { JsonPreview } from "@/components/app/json-preview";
import { PageHeader, Panel } from "@/components/app/page";
import { Pagination } from "@/components/app/pagination";
import { useSession } from "@/components/app/session-provider";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useOrgQuery } from "@/hooks/use-org-query";
import { formatDateTime, formatRelative, humanize } from "@/lib/app/format";
import { PERMISSIONS } from "@/lib/app/nav";
import type { AuditEvent, AuditPage as AuditPageData } from "@/lib/app/types";

export default function AuditPage() {
  return (
    <AppPage>
      <RequireAccess area="the audit trail" permission={PERMISSIONS.auditRead}>
        <Audit />
      </RequireAccess>
    </AppPage>
  );
}

const PAGE_SIZE = 50;
const ENTITY_TYPES = [
  "integration",
  "sync_job",
  "uploaded_file",
  "entity_authority",
  "organization",
  "company",
  "store",
  "department",
  "membership",
  "invitation",
];
const ACTION_PRESETS = ["auth.", "integration.", "data.", "member.", "organization.", "company.", "store."];

function Audit() {
  const { has } = useSession();
  const id = useId();
  const [actionDraft, setActionDraft] = useState("");
  const [action, setAction] = useState("");
  const [entityType, setEntityType] = useState("all");
  const [page, setPage] = useState(0);
  const query = useOrgQuery<AuditPageData>("/audit-events", {
    query: {
      action: action || undefined,
      entity_type: entityType === "all" ? undefined : entityType,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    },
    keepPrevious: true,
  });

  const columns: Column<AuditEvent>[] = [
    {
      key: "when",
      header: "When",
      cell: (r) => (
        <span className="block whitespace-nowrap" title={formatDateTime(r.created_at)}>
          {formatDateTime(r.created_at)}
          <span className="block text-xs text-muted-foreground">{formatRelative(r.created_at)}</span>
        </span>
      ),
    },
    { key: "action", header: "Action", cell: (r) => <span className="font-mono text-xs">{r.action}</span> },
    { key: "actor", header: "Actor", cell: (r) => <span className="block max-w-[16rem] truncate" title={r.actor ?? undefined}>{r.actor ?? "System"}</span> },
    {
      key: "entity",
      header: "Entity",
      cell: (r) =>
        r.entity_type ? (
          <span className="block">
            {humanize(r.entity_type)}
            {r.entity_id ? <span className="block max-w-[12rem] truncate font-mono text-xs text-muted-foreground">{r.entity_id}</span> : null}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: "outcome",
      header: "Outcome",
      cell: (r) => <StatusBadge tone={r.outcome === "success" ? "good" : r.outcome === "failure" ? "danger" : "neutral"}>{humanize(r.outcome)}</StatusBadge>,
    },
    { key: "ip", header: "IP address", cell: (r) => <span className="font-mono text-xs text-muted-foreground">{r.ip_address ?? "—"}</span> },
    {
      key: "details",
      header: "Details",
      cell: (r) => (r.summary || (r.details && Object.keys(r.details).length) ? <JsonPreview label="View" summary={r.summary} value={r.details} /> : <span className="text-muted-foreground">—</span>),
    },
  ];

  return (
    <>
      <PageHeader
        title="Audit trail"
        description="Every change to integrations, data imports, members and settings in this organization, with who made it and when. Records cannot be edited."
        actions={
          has(PERMISSIONS.dataQualityRead) ? (
            <Button asChild variant="outline">
              <Link href="/app/data-quality">
                <GaugeIcon aria-hidden />
                Data quality
              </Link>
            </Button>
          ) : null
        }
      />
      <Panel
        title="Events"
        description={query.data ? `${query.data.total.toLocaleString("en-IN")} events match` : undefined}
        dimmed={query.isPlaceholderData}
      >
        <form
          className="mb-4 flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            setPage(0);
            setAction(actionDraft.trim());
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-action`} className="text-xs text-muted-foreground">
              Action starts with
            </Label>
            <div className="flex gap-2">
              <Input
                id={`${id}-action`}
                value={actionDraft}
                onChange={(e) => setActionDraft(e.target.value)}
                placeholder="integration."
                list={`${id}-actions`}
                className="w-52 bg-background"
                maxLength={80}
              />
              <datalist id={`${id}-actions`}>
                {ACTION_PRESETS.map((a) => (
                  <option key={a} value={a} />
                ))}
              </datalist>
              <Button type="submit" variant="secondary">
                <SearchIcon aria-hidden />
                Filter
              </Button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-entity`} className="text-xs text-muted-foreground">
              Entity type
            </Label>
            <Select
              value={entityType}
              onValueChange={(value) => {
                setPage(0);
                setEntityType(value);
              }}
            >
              <SelectTrigger id={`${id}-entity`} className="w-48 bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                <SelectItem value="all">All entity types</SelectItem>
                {ENTITY_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {humanize(t)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {action || entityType !== "all" ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setActionDraft("");
                setAction("");
                setEntityType("all");
                setPage(0);
              }}
            >
              Clear filters
            </Button>
          ) : null}
        </form>

        {query.isPending ? (
          <TableSkeleton rows={8} columns={6} />
        ) : query.error || !query.data ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : (
          <>
            <DataTable
              caption="Audit events"
              columns={columns}
              rows={query.data.events}
              rowKey={(r) => String(r.id)}
              dense
              empty={
                <EmptyState
                  compact
                  icon={ScrollTextIcon}
                  title={action || entityType !== "all" ? "No events match these filters" : "No events recorded yet"}
                  description="Changes to integrations, imports, members and settings are recorded here as they happen."
                />
              }
            />
            {query.data.total > PAGE_SIZE ? (
              <Pagination className="mt-3" page={page} pageSize={PAGE_SIZE} total={query.data.total} onPageChange={setPage} disabled={query.isFetching} />
            ) : null}
          </>
        )}
      </Panel>
    </>
  );
}
