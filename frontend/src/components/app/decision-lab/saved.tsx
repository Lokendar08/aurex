"use client";

import {
  ClipboardPlusIcon,
  EllipsisIcon,
  FolderOpenIcon,
  LoaderCircleIcon,
  PencilIcon,
  RefreshCwIcon,
  Trash2Icon,
} from "lucide-react";
import { useId, useState } from "react";

import { StatusBadge } from "@/components/app/badges";
import { DataTable } from "@/components/app/data-table";
import { FormError, TextAreaField, TextField } from "@/components/app/form";
import { EmptyState } from "@/components/app/states";
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cleanAmount, formatDelta, formatProbability, errorText } from "@/lib/app/decision-lab-format";
import type { LeverType, SavedScenario, ScenarioDetail } from "@/lib/app/decision-lab-types";
import { formatDateTime, formatRelative, humanize } from "@/lib/app/format";
import type { FilterStore } from "@/lib/app/types";
import { cn } from "@/lib/utils";

import { HashValue } from "./common";
import { LEVER_LABELS } from "./lever-editor";
import { storeLabel } from "./scope-picker";

export function leverNames(levers: Record<string, unknown>[]): string[] {
  return levers.map((l) => {
    const label = typeof l.label === "string" && l.label.trim() && l.label !== l.type ? l.label : null;
    return label ?? LEVER_LABELS[l.type as LeverType] ?? humanize(String(l.type));
  });
}

export function ScenarioRow({
  scenario,
  currency,
  stores,
  scoped,
  selected,
  onToggleSelect,
  selectionDisabled,
  onOpen,
  onRerun,
  onEdit,
  onDelete,
  onRecommend,
  canWrite,
  canRecommend,
  busy,
  active,
}: {
  scenario: SavedScenario;
  currency: string;
  stores: FilterStore[];
  scoped: boolean;
  selected: boolean;
  onToggleSelect: (checked: boolean) => void;
  selectionDisabled: boolean;
  onOpen: () => void;
  onRerun: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onRecommend: () => void;
  canWrite: boolean;
  canRecommend: boolean;
  busy: boolean;
  active: boolean;
}) {
  const checkId = useId();
  const run = scenario.latest_run;
  const delta = run?.summary.delta;
  const net = cleanAmount(delta?.net_profit ?? null);
  const unc = run?.summary.uncertainty;
  const names = leverNames(scenario.levers);
  return (
    <li
      className={cn(
        "grid gap-3 px-4 py-3.5 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center sm:px-5",
        active && "bg-brand-50/60 dark:bg-brand-800/15",
      )}
    >
      <div className="flex items-start gap-3 sm:contents">
        <Checkbox
          id={checkId}
          className="mt-1 sm:mt-0"
          checked={selected}
          disabled={!selected && selectionDisabled}
          onCheckedChange={(value) => onToggleSelect(value === true)}
          aria-label={`Select ${scenario.name} for comparison`}
        />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <button
              type="button"
              onClick={onOpen}
              className="rounded-sm text-left text-[0.9375rem] font-semibold outline-none hover:text-primary hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {scenario.name}
            </button>
            <StatusBadge>v{scenario.version}</StatusBadge>
            {active ? <StatusBadge tone="info">Open</StatusBadge> : null}
            {run && run.summary.warnings > 0 ? (
              <StatusBadge tone="warning">
                {run.summary.warnings} warning{run.summary.warnings === 1 ? "" : "s"}
              </StatusBadge>
            ) : null}
          </div>
          <p className="mt-0.5 truncate text-[0.8125rem] text-muted-foreground">{names.join(" · ") || "No levers"}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {storeLabel(stores, scenario.store_ids ?? [], scoped)} · {scenario.horizon_months} months · updated{" "}
            {formatRelative(scenario.updated_at)}
          </p>
        </div>
      </div>
      <div className="flex items-center justify-between gap-4 sm:justify-end">
        <div className="text-right">
          <p className="text-xs text-muted-foreground">Net profit change</p>
          <p className={cn("font-semibold tabular", net !== null && net < 0 && "text-destructive")}>{formatDelta(net, currency)}</p>
          <p className="text-xs text-muted-foreground tabular">
            {unc ? `P10 ${formatDelta(unc.p10, currency)} · P90 ${formatDelta(unc.p90, currency)}` : "Not run yet"}
          </p>
          {run ? <p className="text-xs text-muted-foreground">Improves in {formatProbability(run.summary.probability_net_profit_positive)} of runs</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="outline" size="sm" onClick={onOpen}>
            <FolderOpenIcon aria-hidden />
            Open
          </Button>
          {canWrite || canRecommend ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label={`More actions for ${scenario.name}`} disabled={busy}>
                  {busy ? <LoaderCircleIcon className="animate-spin" aria-hidden /> : <EllipsisIcon aria-hidden />}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {canWrite ? (
                  <>
                    <DropdownMenuItem onSelect={onRerun}>
                      <RefreshCwIcon aria-hidden />
                      Re-run with latest data
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={onEdit}>
                      <PencilIcon aria-hidden />
                      Rename or describe
                    </DropdownMenuItem>
                  </>
                ) : null}
                {canRecommend ? (
                  <DropdownMenuItem onSelect={onRecommend}>
                    <ClipboardPlusIcon aria-hidden />
                    Create recommendation
                  </DropdownMenuItem>
                ) : null}
                {canWrite ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                      <Trash2Icon aria-hidden />
                      Delete
                    </DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </div>
    </li>
  );
}

export function ScenarioList({
  scenarios,
  ...rest
}: Omit<Parameters<typeof ScenarioRow>[0], "scenario" | "selected" | "onToggleSelect" | "onOpen" | "onRerun" | "onEdit" | "onDelete" | "onRecommend" | "busy" | "active" | "selectionDisabled"> & {
  scenarios: SavedScenario[];
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
  onOpen: (s: SavedScenario) => void;
  onRerun: (s: SavedScenario) => void;
  onEdit: (s: SavedScenario) => void;
  onDelete: (s: SavedScenario) => void;
  onRecommend: (s: SavedScenario) => void;
  busyId: string | null;
  activeId: string | null;
}) {
  const { selectedIds, onSelectionChange, onOpen, onRerun, onEdit, onDelete, onRecommend, busyId, activeId, ...row } = rest;
  if (!scenarios.length) {
    return (
      <EmptyState
        compact
        icon={FolderOpenIcon}
        title="No saved scenarios yet"
        description={row.canWrite ? "Run a simulation and save it to compare options, track versions and propose it for approval." : "Scenarios saved by your colleagues appear here."}
      />
    );
  }
  return (
    <ul className="divide-y">
      {scenarios.map((s) => (
        <ScenarioRow
          key={s.id}
          scenario={s}
          {...row}
          selected={selectedIds.includes(s.id)}
          selectionDisabled={selectedIds.length >= 6}
          onToggleSelect={(checked) =>
            onSelectionChange(checked ? [...selectedIds, s.id] : selectedIds.filter((id) => id !== s.id))
          }
          onOpen={() => onOpen(s)}
          onRerun={() => onRerun(s)}
          onEdit={() => onEdit(s)}
          onDelete={() => onDelete(s)}
          onRecommend={() => onRecommend(s)}
          busy={busyId === s.id}
          active={activeId === s.id}
        />
      ))}
    </ul>
  );
}

export type ScenarioMeta = { name: string; description: string; tags: string };

export function ScenarioDetailsDialog({
  open,
  onOpenChange,
  mode,
  initial,
  version,
  submitting,
  error,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit" | "version";
  initial: ScenarioMeta;
  version?: number;
  submitting: boolean;
  error: unknown;
  onSubmit: (meta: ScenarioMeta) => void;
}) {
  const [meta, setMeta] = useState<ScenarioMeta>(initial);
  const [touched, setTouched] = useState(false);
  const [lastOpen, setLastOpen] = useState(open);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setMeta(initial);
      setTouched(false);
    }
  }
  const nameError = touched && !meta.name.trim() ? "Give the scenario a name" : undefined;
  const title = mode === "create" ? "Save scenario" : mode === "version" ? "Save a new version" : "Rename or describe";
  const description =
    mode === "create"
      ? "Saving stores the levers, scope and settings, and runs the simulation once more so the result is reproducible."
      : `Saving creates version ${(version ?? 1) + 1} and re-runs the simulation with the latest data.`;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            setTouched(true);
            if (!meta.name.trim()) return;
            onSubmit({ ...meta, name: meta.name.trim() });
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <TextField label="Name" required value={meta.name} onChange={(name) => setMeta({ ...meta, name })} maxLength={200} error={nameError} />
          <TextAreaField
            label="Description"
            value={meta.description}
            onChange={(description) => setMeta({ ...meta, description })}
            rows={3}
            maxLength={4000}
            hint="Why this option is being considered (optional)."
          />
          <TextField
            label="Tags"
            value={meta.tags}
            onChange={(tags) => setMeta({ ...meta, tags })}
            hint="Comma-separated, up to 10 (optional)."
          />
          <FormError message={error ? errorText(error) : null} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? <LoaderCircleIcon className="animate-spin" aria-hidden /> : null}
              {submitting ? "Saving…" : mode === "create" ? "Save scenario" : "Save version"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function parseTags(text: string): string[] {
  return Array.from(new Set(text.split(",").map((t) => t.trim()).filter(Boolean))).slice(0, 10).map((t) => t.slice(0, 40));
}

export function DeleteScenarioDialog({
  scenario,
  onOpenChange,
  onConfirm,
  submitting,
}: {
  scenario: SavedScenario | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  submitting: boolean;
}) {
  return (
    <AlertDialog open={Boolean(scenario)} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{scenario?.name}”?</AlertDialogTitle>
          <AlertDialogDescription>
            The scenario leaves this list for everyone. Its saved runs and audit history are kept, and recommendations created from it are not affected.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={submitting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={submitting}
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
            }}
          >
            {submitting ? "Deleting…" : "Delete scenario"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function RecommendationDialog({
  scenario,
  onOpenChange,
  onSubmit,
  submitting,
  error,
}: {
  scenario: SavedScenario | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: { title?: string; summary?: string }) => void;
  submitting: boolean;
  error: unknown;
}) {
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [lastId, setLastId] = useState<string | null>(null);
  const currentId = scenario?.id ?? null;
  if (currentId !== lastId) {
    setLastId(currentId);
    setTitle(scenario ? `Implement scenario: ${scenario.name}` : "");
    setSummary(scenario?.description ?? "");
  }
  return (
    <Dialog open={Boolean(scenario)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit({ title: title.trim() || undefined, summary: summary.trim() || undefined });
          }}
        >
          <DialogHeader>
            <DialogTitle>Create a recommendation</DialogTitle>
            <DialogDescription>
              The recommendation carries this scenario&apos;s latest result (predicted impact, P10–P90 interval, evidence and assumptions) into
              Workflows, where it can be submitted for approval.
            </DialogDescription>
          </DialogHeader>
          <TextField label="Title" value={title} onChange={setTitle} maxLength={300} />
          <TextAreaField label="Summary" value={summary} onChange={setSummary} rows={3} maxLength={4000} hint="Optional. Defaults to the scenario description." />
          <FormError message={error ? errorText(error) : null} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? <LoaderCircleIcon className="animate-spin" aria-hidden /> : <ClipboardPlusIcon aria-hidden />}
              {submitting ? "Creating…" : "Create recommendation"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RunHistory({ detail, currency }: { detail: ScenarioDetail; currency: string }) {
  const history = detail.run_history ?? [];
  if (!history.length) return <p className="text-sm text-muted-foreground">No runs recorded.</p>;
  return (
    <DataTable
      caption={`Run history of ${detail.name}`}
      dense
      rows={history}
      rowKey={(r) => r.id}
      columns={[
        { key: "at", header: "Computed", cell: (r) => formatDateTime(r.computed_at), sortValue: (r) => r.computed_at },
        { key: "v", header: "Version", align: "right", cell: (r) => `v${r.scenario_version}`, sortValue: (r) => r.scenario_version },
        { key: "e", header: "Engine", cell: (r) => r.engine_version },
        { key: "np", header: "Net profit change", align: "right", cell: (r) => formatDelta(r.net_profit_delta, currency), sortValue: (r) => r.net_profit_delta },
        { key: "h", header: "Inputs hash", cell: (r) => <HashValue value={r.inputs_hash} chars={10} copy={false} /> },
      ]}
    />
  );
}
