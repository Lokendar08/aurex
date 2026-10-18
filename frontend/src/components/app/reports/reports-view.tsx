"use client";

import {
  CircleCheckIcon,
  CircleXIcon,
  ClockIcon,
  DownloadIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  LoaderCircleIcon,
  LockIcon,
  Trash2Icon,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useId, useState } from "react";
import { toast } from "sonner";

import { StatusBadge, type Tone } from "@/components/app/badges";
import { DataTable, type Column } from "@/components/app/data-table";
import { FormError, TextField } from "@/components/app/form";
import { NoteList, PageHeader, Panel } from "@/components/app/page";
import { useSession } from "@/components/app/session-provider";
import { EmptyState, Notice, TableSkeleton } from "@/components/app/states";
import { HashValue, QueryError, SyntheticBadge, toastError } from "@/components/app/decision-lab/common";
import { ScopePicker, type Scope } from "@/components/app/decision-lab/scope-picker";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useFilterOptions } from "@/hooks/use-filter-options";
import { useInvalidateOrg, useOrgMutation, useOrgQuery } from "@/hooks/use-org-query";
import { orgPath } from "@/lib/api";
import { errorText } from "@/lib/app/decision-lab-format";
import type { SavedScenario } from "@/lib/app/decision-lab-types";
import { formatBytes, formatDateTime, formatRelative, humanize } from "@/lib/app/format";
import { downloadReport } from "@/lib/app/reports-download";
import type { CompaniesResponse } from "@/lib/app/intelligence-types";
import {
  PERMISSION_LABELS,
  REPORT_DESCRIPTIONS,
  REPORT_PARAMETERS,
  type Report,
  type ReportFormat,
  type ReportsResponse,
} from "@/lib/app/reports-types";
import { cn } from "@/lib/utils";

const STATUS: Record<string, { tone: Tone; label: string; icon: typeof ClockIcon }> = {
  queued: { tone: "neutral", label: "Queued", icon: ClockIcon },
  running: { tone: "info", label: "Generating", icon: LoaderCircleIcon },
  completed: { tone: "good", label: "Ready", icon: CircleCheckIcon },
  failed: { tone: "danger", label: "Failed", icon: CircleXIcon },
};

const FORMAT_LABELS: Record<string, string> = { pdf: "PDF", csv: "CSV", xlsx: "Excel" };

function ReportStatusBadge({ status }: { status: string }) {
  const info = STATUS[status] ?? { tone: "neutral" as Tone, label: humanize(status), icon: ClockIcon };
  return (
    <StatusBadge tone={info.tone} icon={info.icon} className={cn(status === "running" && "[&_svg]:animate-spin")}>
      {info.label}
    </StatusBadge>
  );
}

function MultiCheck({
  legend,
  items,
  selected,
  onChange,
  empty,
  max,
}: {
  legend: string;
  items: { value: string; label: string; hint?: string }[];
  selected: string[];
  onChange: (values: string[]) => void;
  empty: string;
  max?: number;
}) {
  const baseId = useId();
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{legend}</legend>
      {items.length ? (
        <ul className="grid max-h-56 gap-1 overflow-y-auto rounded-lg bg-muted/40 p-1.5 sm:grid-cols-2">
          {items.map((item) => {
            const id = `${baseId}-${item.value}`;
            const checked = selected.includes(item.value);
            return (
              <li key={item.value}>
                <label htmlFor={id} className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-background">
                  <Checkbox
                    id={id}
                    className="mt-0.5"
                    checked={checked}
                    disabled={!checked && max !== undefined && selected.length >= max}
                    onCheckedChange={(v) => onChange(v === true ? [...selected, item.value] : selected.filter((x) => x !== item.value))}
                  />
                  <span className="min-w-0">
                    <span className="block truncate">{item.label}</span>
                    {item.hint ? <span className="block truncate text-xs text-muted-foreground">{item.hint}</span> : null}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{empty}</p>
      )}
    </fieldset>
  );
}

function Generator({ data, onCreated }: { data: ReportsResponse; onCreated: (report: Report) => void }) {
  const firstAllowed = data.types.find((t) => t.allowed)?.key ?? data.types[0]?.key ?? "executive";
  const [type, setType] = useState(firstAllowed);
  const [format, setFormat] = useState<ReportFormat>("pdf");
  const [title, setTitle] = useState("");
  const [scope, setScope] = useState<Scope>({ storeIds: [] });
  const [period, setPeriod] = useState("last_12m");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [scenarioIds, setScenarioIds] = useState<string[]>([]);
  const [companyKeys, setCompanyKeys] = useState<string[]>([]);
  const [localError, setLocalError] = useState<string | null>(null);
  const typeGroupId = useId();
  const periodId = useId();
  const options = useFilterOptions(scope.companyId);
  const spec = REPORT_PARAMETERS[type] ?? REPORT_PARAMETERS.executive;
  const scenarios = useOrgQuery<{ scenarios: SavedScenario[] }>("/scenarios", { enabled: Boolean(spec.scenarios), staleTime: 60_000 });
  const companies = useOrgQuery<CompaniesResponse>("/intelligence/companies", { enabled: Boolean(spec.companies), staleTime: 10 * 60_000 });
  const create = useOrgMutation<Record<string, unknown>, Report>((body, call) => call("/reports", { json: body }));
  const selectedType = data.types.find((t) => t.key === type);
  const periods = (options.data?.periods ?? []).filter((p) => spec.custom || p.key !== "custom");

  function submit() {
    setLocalError(null);
    if (!selectedType?.allowed) return setLocalError("Your role cannot generate this report type.");
    const parameters: Record<string, unknown> = {};
    if (spec.scope && scope.companyId) parameters.company_id = scope.companyId;
    if (spec.stores && scope.storeIds.length) parameters.store_ids = scope.storeIds;
    if (spec.period) {
      parameters.period = period;
      if (period === "custom") {
        if (!start || !end) return setLocalError("Choose a start and end date for the custom range.");
        if (start > end) return setLocalError("The start date must be before the end date.");
        parameters.start = start;
        parameters.end = end;
      }
    }
    if (spec.scenarios && scenarioIds.length) parameters.scenario_ids = scenarioIds;
    if (spec.companies && companyKeys.length) parameters.company_keys = companyKeys;
    create.mutate(
      { report_type: type, format, title: title.trim() || undefined, parameters },
      {
        onSuccess: (report) => {
          toast.success("Report requested", { description: `${report.title} (${FORMAT_LABELS[report.format] ?? report.format}) is being generated.` });
          setTitle("");
          onCreated(report);
        },
      },
    );
  }

  return (
    <Panel title="Generate a report" description="Built from the same calculations as the screens, with your permissions and store scope">
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <fieldset className="space-y-2">
          <legend id={typeGroupId} className="text-sm font-medium">
            Report
          </legend>
          <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-labelledby={typeGroupId}>
            {data.types.map((t) => {
              const active = t.key === type;
              return (
                <button
                  key={t.key}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  disabled={!t.allowed}
                  onClick={() => setType(t.key)}
                  className={cn(
                    "rounded-lg px-3 py-2.5 text-left ring-1 transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed",
                    active ? "bg-brand-50 ring-primary/60 dark:bg-brand-800/25" : "ring-foreground/12 hover:bg-muted/60",
                    !t.allowed && "opacity-60",
                  )}
                >
                  <span className="flex items-center justify-between gap-2 text-sm font-medium">
                    {t.title}
                    {!t.allowed ? <LockIcon className="size-3.5 text-muted-foreground" aria-hidden /> : null}
                  </span>
                  <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
                    {t.allowed ? REPORT_DESCRIPTIONS[t.key] : `Needs report generation and ${PERMISSION_LABELS[t.permission] ?? t.permission}.`}
                  </span>
                </button>
              );
            })}
          </div>
        </fieldset>

        <div className="space-y-1.5">
          <p className="text-sm font-medium" id={`${typeGroupId}-format`}>
            Format
          </p>
          <ToggleGroup
            type="single"
            variant="outline"
            spacing={0}
            value={format}
            onValueChange={(v) => v && setFormat(v as ReportFormat)}
            aria-labelledby={`${typeGroupId}-format`}
          >
            {data.formats.map((f) => (
              <ToggleGroupItem key={f} value={f} className="px-3">
                {f === "pdf" ? <FileTextIcon aria-hidden /> : <FileSpreadsheetIcon aria-hidden />}
                {FORMAT_LABELS[f] ?? f.toUpperCase()}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>

        {spec.scope ? (
          <ScopePicker
            scope={spec.stores ? scope : { ...scope, storeIds: [] }}
            onChange={(next) => setScope(spec.stores ? next : { companyId: next.companyId, storeIds: [] })}
            options={options.data}
          />
        ) : null}

        {spec.period ? (
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor={periodId}>Period</Label>
              <Select value={period} onValueChange={setPeriod}>
                <SelectTrigger id={periodId} className="w-full bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  {periods.map((p) => (
                    <SelectItem key={p.key} value={p.key}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {period === "custom" ? (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor={`${periodId}-start`}>From</Label>
                  <Input id={`${periodId}-start`} type="date" value={start} min={options.data?.data_start ?? undefined} max={options.data?.data_end ?? undefined} onChange={(e) => setStart(e.target.value)} className="bg-background" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`${periodId}-end`}>To</Label>
                  <Input id={`${periodId}-end`} type="date" value={end} min={options.data?.data_start ?? undefined} max={options.data?.data_end ?? undefined} onChange={(e) => setEnd(e.target.value)} className="bg-background" />
                </div>
              </>
            ) : null}
          </div>
        ) : null}

        {spec.scenarios ? (
          <MultiCheck
            legend="Scenarios"
            items={(scenarios.data?.scenarios ?? []).map((s) => ({ value: s.id, label: s.name, hint: `v${s.version} · ${s.horizon_months} months` }))}
            selected={scenarioIds}
            onChange={setScenarioIds}
            max={12}
            empty={scenarios.isPending ? "Loading scenarios…" : "No saved scenarios. Save some in the Decision Lab first."}
          />
        ) : null}
        {spec.scenarios ? <p className="-mt-3 text-xs text-muted-foreground">Leave all unchecked to include the 12 most recently updated scenarios.</p> : null}

        {spec.companies ? (
          <MultiCheck
            legend="Peer companies"
            items={(companies.data?.companies ?? []).map((c) => ({ value: c.key, label: c.display_name }))}
            selected={companyKeys}
            onChange={setCompanyKeys}
            empty={companies.isPending ? "Loading companies…" : "No company profiles available."}
          />
        ) : null}

        <TextField label="Title" value={title} onChange={setTitle} maxLength={300} hint={`Optional. Defaults to “${selectedType?.title ?? "Report"} – company name”.`} />
        <FormError message={localError ?? (create.error ? errorText(create.error) : null)} />
        <Button type="submit" disabled={create.isPending || !selectedType?.allowed}>
          {create.isPending ? <LoaderCircleIcon className="animate-spin" aria-hidden /> : <FileTextIcon aria-hidden />}
          Generate {FORMAT_LABELS[format] ?? format}
        </Button>
      </form>
    </Panel>
  );
}

export function ReportsView() {
  const { has, orgId, user, membership } = useSession();
  const params = useSearchParams();
  const highlight = params.get("highlight");
  const invalidate = useInvalidateOrg();
  const [deleteTarget, setDeleteTarget] = useState<Report | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const canGenerate = has("reports:generate");
  const canManageOrg = has("org:manage");
  const query = useOrgQuery<ReportsResponse>("/reports", {
    staleTime: 10_000,
    refetchInterval: (q) => (q.state.data?.reports.some((r) => r.status === "queued" || r.status === "running") ? 2000 : false),
  });
  const remove = useOrgMutation<string, void>((id, call) => call(`/reports/${id}`, { method: "DELETE" }));
  const data = query.data;
  const reports = data?.reports ?? [];

  async function download(report: Report) {
    setDownloading(report.id);
    try {
      const result = await downloadReport(orgPath(orgId as string, `/reports/${report.id}/download`), `${report.title}.${report.format}`);
      if (result.handedOver) {
        toast.message("Your download manager took over this file", {
          description: report.sha256 ? `Compare the saved file's SHA-256 with ${report.sha256.slice(0, 12)}… shown in the list.` : "Check the saved file in your download manager.",
        });
      } else if (result.verified === false) {
        toast.error("Checksum mismatch", { description: "The downloaded file does not match the stored SHA-256. Generate the report again." });
      } else {
        toast.success(`Downloaded ${result.filename}`, {
          description: `${formatBytes(result.bytes)}${result.verified ? " · SHA-256 verified against the stored checksum" : ""}`,
        });
      }
    } catch (error) {
      toastError(error, "The download failed");
    } finally {
      setDownloading(null);
    }
  }

  const columns: Column<Report>[] = [
    {
      key: "title",
      header: "Report",
      cell: (r) => (
        <div className="min-w-[14rem]">
          <p className="font-medium">{r.title}</p>
          <p className="text-xs text-muted-foreground">
            {data?.types.find((t) => t.key === r.report_type)?.title ?? humanize(r.report_type)} · {FORMAT_LABELS[r.format] ?? r.format}
            {r.created_by === user.id ? " · requested by you" : ""}
          </p>
          {r.status === "failed" && r.error ? <p className="mt-0.5 text-xs text-destructive">{r.error}</p> : null}
        </div>
      ),
      sortValue: (r) => r.title,
    },
    { key: "status", header: "Status", cell: (r) => <ReportStatusBadge status={r.status} />, sortValue: (r) => r.status },
    {
      key: "created",
      header: "Requested",
      cell: (r) => (
        <span className="whitespace-nowrap" title={formatDateTime(r.created_at)}>
          {formatRelative(r.created_at)}
        </span>
      ),
      sortValue: (r) => r.created_at,
    },
    { key: "size", header: "Size", align: "right", cell: (r) => formatBytes(r.file_size), sortValue: (r) => r.file_size },
    { key: "sha", header: "SHA-256", cell: (r) => (r.sha256 ? <HashValue value={r.sha256} chars={10} copy={false} /> : <span className="text-muted-foreground">Not available</span>) },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      label: "Actions",
      cell: (r) => (
        <div className="flex justify-end gap-1">
          <Button variant="outline" size="sm" disabled={r.status !== "completed" || downloading === r.id} onClick={() => void download(r)} aria-label={`Download ${r.title}`}>
            {downloading === r.id ? <LoaderCircleIcon className="animate-spin" aria-hidden /> : <DownloadIcon aria-hidden />}
            Download
          </Button>
          {canGenerate && (r.created_by === user.id || canManageOrg) ? (
            <Button variant="ghost" size="icon-sm" onClick={() => setDeleteTarget(r)} aria-label={`Delete ${r.title}`}>
              <Trash2Icon aria-hidden />
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Reports"
        description="PDF, CSV and Excel reports generated from validated calculations. Each file is stored with a SHA-256 checksum and carries its data date and sources."
        meta={membership?.is_demo ? <SyntheticBadge label="Reports carry the synthetic-data label" /> : null}
      />
      {query.isPending ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,30rem)_minmax(0,1fr)]">
          <Panel>
            <TableSkeleton rows={6} columns={2} />
          </Panel>
          <Panel>
            <TableSkeleton rows={6} columns={5} />
          </Panel>
        </div>
      ) : query.error || !data ? (
        <Panel>
          <QueryError error={query.error} onRetry={() => void query.refetch()} />
        </Panel>
      ) : (
        <div className={cn("grid items-start gap-6", canGenerate && "xl:grid-cols-[minmax(0,30rem)_minmax(0,1fr)]")}>
          {canGenerate ? (
            <Generator data={data} onCreated={() => void query.refetch()} />
          ) : (
            <Notice title="View only">Your role can download reports shared with it but not generate new ones.</Notice>
          )}
          <Panel
            title="Generated reports"
            description="Reports you requested, and company-wide reports your role may read"
            footer={
              <NoteList
                notes={[
                  "Reports are generated with the requester's permissions and store scope at build time.",
                  membership?.is_demo ? "Reports of this demonstration organization are labelled as synthetic data inside the file." : null,
                  "Compare the SHA-256 shown here with the downloaded file to confirm it is unchanged.",
                ].filter((n): n is string => Boolean(n))}
              />
            }
          >
            {reports.length ? (
              <DataTable
                caption="Generated reports"
                columns={columns}
                rows={reports}
                rowKey={(r) => r.id}
                dense
                pageSize={15}
                rowClassName={(r) => (r.id === highlight ? "bg-brand-50/70 dark:bg-brand-800/20" : undefined)}
              />
            ) : (
              <EmptyState compact icon={FileTextIcon} title="No reports yet" description={canGenerate ? "Generate one with the form." : "Reports generated by your colleagues appear here when your role may read them."} />
            )}
          </Panel>
        </div>
      )}

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this report?</AlertDialogTitle>
            <AlertDialogDescription>“{deleteTarget?.title}” and its file are permanently removed. You can generate it again later.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={remove.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (!deleteTarget) return;
                const target = deleteTarget;
                remove.mutate(target.id, {
                  onSuccess: () => {
                    setDeleteTarget(null);
                    void invalidate("/reports");
                    toast.success("Report deleted");
                  },
                  onError: (error) => toastError(error, "The report wasn't deleted"),
                });
              }}
            >
              {remove.isPending ? "Deleting…" : "Delete report"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
