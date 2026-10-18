"use client";

import {
  ArrowLeftIcon,
  BanIcon,
  CircleAlertIcon,
  FlaskConicalIcon,
  GaugeIcon,
  HammerIcon,
  ListTodoIcon,
  LoaderCircleIcon,
  SendIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
  TriangleAlertIcon,
} from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { StatusBadge } from "@/components/app/badges";
import { BarList } from "@/components/app/charts/bar-list";
import { CONTEXT_COLOR } from "@/components/app/charts/palette";
import { DetailList, NoteList, PageHeader, Panel } from "@/components/app/page";
import { useSession } from "@/components/app/session-provider";
import { EmptyState, Notice, SkeletonBlock } from "@/components/app/states";
import { QueryError, RangeStrip, rangeDomain, toastError } from "@/components/app/decision-lab/common";
import { Button } from "@/components/ui/button";
import { useFilterOptions } from "@/hooks/use-filter-options";
import { useInvalidateOrg, useOrgMutation, useOrgQuery } from "@/hooks/use-org-query";
import { formatEvidenceValue, isNum } from "@/lib/app/decision-lab-format";
import { formatDate, formatDateTime, formatNumber, formatPercent, humanize } from "@/lib/app/format";
import { MONEY_METRICS, SOURCE_LABELS, type MeasureResult, type Outcome, type Recommendation, type RecommendationDetail } from "@/lib/app/workflows-types";

import { CreateTaskDialog, ImplementedDialog, NoteDialog } from "./dialogs";
import { ConfidenceBadge, formatImpact, impactMetricLabel, Pipeline, PriorityBadge, RecStatusBadge, useMembers } from "./shared";
import { TaskStatusSelect, useCreateTask } from "./tasks";

const HISTORY_LABELS: Record<string, string> = {
  "recommendation.created": "Created",
  "recommendation.created_from_scenario": "Created from a Decision Lab scenario",
  "recommendation.submitted": "Submitted for approval",
  "recommendation.approved": "Approved",
  "recommendation.rejected": "Rejected",
  "recommendation.started": "Implementation started",
  "recommendation.implemented": "Marked implemented",
  "recommendation.measured": "Outcome measured",
  "recommendation.dismissed": "Dismissed",
};

function EvidenceBlock({ item, currency }: { item: Record<string, unknown>; currency: string }) {
  const type = typeof item.type === "string" ? item.type : "evidence";
  const rows = Array.isArray(item.items) ? (item.items as Record<string, unknown>[]) : [];
  const warnings = Array.isArray(item.warnings) ? (item.warnings as string[]) : [];
  const scalars = Object.entries(item).filter(([k, v]) => !["type", "items", "warnings", "summary", "method"].includes(k) && v !== null && typeof v !== "object");
  const columns = rows.length ? Object.keys(rows[0]) : [];
  return (
    <div className="space-y-2 rounded-lg bg-muted/45 px-3.5 py-3">
      <p className="text-xs font-semibold text-muted-foreground">{humanize(type)}</p>
      {typeof item.summary === "string" ? <p className="text-[0.8125rem]">{item.summary}</p> : null}
      {scalars.length ? (
        <dl className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
          {scalars.map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs text-muted-foreground">{humanize(k)}</dt>
              <dd className="text-[0.8125rem] font-medium">{formatEvidenceValue(k.replace(/_/g, " "), v, currency)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {rows.length ? (
        <div className="relative w-full overflow-x-auto rounded-md bg-card ring-1 ring-foreground/8" tabIndex={0} role="region" aria-label={`${humanize(type)} items`}>
          <table className="w-full border-collapse text-xs">
            <thead className="bg-muted/60">
              <tr>
                {columns.map((c) => (
                  <th key={c} scope="col" className="px-2.5 py-1.5 text-left font-medium whitespace-nowrap text-muted-foreground">
                    {humanize(c)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-t">
                  {columns.map((c) => (
                    <td key={c} className="px-2.5 py-1.5 whitespace-nowrap tabular">
                      {formatEvidenceValue(c.replace(/_/g, " "), row[c], currency)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {warnings.map((w, i) => (
        <p key={i} className="flex items-start gap-1.5 text-xs">
          <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
          {w}
        </p>
      ))}
      {typeof item.method === "string" ? <p className="text-xs text-muted-foreground">Method: {item.method}</p> : null}
    </div>
  );
}

function ImpactPanel({ rec, currency }: { rec: Recommendation; currency: string }) {
  const impact = rec.predicted_impact;
  const scenarioId = rec.source === "scenario" ? (rec.source_ref?.scenario_id as string | undefined) : undefined;
  if (!impact || !impact.metric) {
    return (
      <Panel title="Predicted impact">
        <p className="text-sm text-muted-foreground">No quantified prediction was attached.</p>
      </Panel>
    );
  }
  const metric = impact.metric;
  const p10 = impact.interval?.p10;
  const p90 = impact.interval?.p90;
  return (
    <Panel
      title="Predicted impact"
      description={impactMetricLabel(metric)}
      footer={
        scenarioId ? (
          <span className="inline-flex items-center gap-1.5">
            <FlaskConicalIcon className="size-3.5" aria-hidden />
            From Decision Lab scenario version {String(rec.source_ref?.scenario_version ?? "")}.{" "}
            <Link href={`/app/decision-lab?scenario=${scenarioId}`} className="font-medium text-primary underline-offset-3 hover:underline">
              Open the scenario
            </Link>
          </span>
        ) : impact.note ? (
          impact.note
        ) : undefined
      }
    >
      <div className="space-y-4">
        {isNum(impact.predicted_delta) ? (
          <div>
            <p className="text-3xl leading-none font-semibold tracking-[-0.02em]">{formatImpact(metric, impact.predicted_delta, currency)}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Predicted change{impact.horizon_months ? ` over ${impact.horizon_months} months` : ""}
            </p>
          </div>
        ) : isNum(impact.baseline_value) && isNum(impact.predicted_value) ? (
          <div>
            <p className="text-2xl leading-tight font-semibold">
              {formatImpact(metric, impact.baseline_value, currency, false)} → {formatImpact(metric, impact.predicted_value, currency, false)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">From the value when recommended to the predicted value</p>
          </div>
        ) : null}
        {isNum(p10) && isNum(p90) ? (
          <div>
            <p className="mb-1.5 text-xs text-muted-foreground">P10 to P90 range</p>
            <RangeStrip label="Predicted change" low={p10} mid={impact.predicted_delta ?? null} high={p90} format={(v) => formatImpact(metric, v, currency)} domain={rangeDomain([p10, p90])} />
          </div>
        ) : null}
        <DetailList
          items={[
            ...(isNum(impact.net_sales_delta) ? [{ label: "Net sales change", value: formatImpact("net_sales", impact.net_sales_delta, currency) }] : []),
            ...(isNum(impact.investment) ? [{ label: "Investment", value: formatImpact("net_profit", impact.investment, currency, false) }] : []),
            ...(impact.payback_months !== undefined ? [{ label: "Payback", value: isNum(impact.payback_months) ? `Month ${impact.payback_months}` : "No payback within the horizon" }] : []),
            ...(impact.direction ? [{ label: "Better when", value: impact.direction === "down" ? "Lower" : "Higher" }] : []),
          ]}
        />
      </div>
    </Panel>
  );
}

function OutcomePanel({
  rec,
  currency,
  lastMeasure,
  canMeasure,
  measuring,
  onMeasure,
}: {
  rec: RecommendationDetail;
  currency: string;
  lastMeasure: MeasureResult | null;
  canMeasure: boolean;
  measuring: boolean;
  onMeasure: () => void;
}) {
  const outcome: Outcome | undefined = rec.outcomes[0];
  const measurable = rec.status === "implemented" || rec.status === "measured";
  const action =
    canMeasure && measurable ? (
      <Button size="sm" variant="outline" onClick={onMeasure} disabled={measuring}>
        {measuring ? <LoaderCircleIcon className="animate-spin" aria-hidden /> : <GaugeIcon aria-hidden />}
        {outcome ? "Measure again" : "Measure outcome"}
      </Button>
    ) : undefined;
  let body: ReactNode;
  if (lastMeasure?.status === "pending_data") {
    body = (
      <EmptyState
        compact
        icon={GaugeIcon}
        title="Waiting for data"
        description={`${lastMeasure.message ?? "No data has arrived for the measurement window yet."} The window runs ${formatDate(rec.measurement_start)} to ${formatDate(rec.measurement_end)}.`}
      />
    );
  } else if (outcome) {
    const money = MONEY_METRICS.has(outcome.metric);
    const fmt = (v: number | null) => (money ? formatImpact(outcome.metric, v, currency, false) : formatNumber(v, { decimals: 1 }));
    body = (
      <div className="space-y-4">
        <p className="text-xs text-muted-foreground">
          {impactMetricLabel(outcome.metric)} from {formatDate(outcome.window_start)} to {formatDate(outcome.window_end)} · measured {formatDateTime(outcome.measured_at)}
        </p>
        <BarList
          label="Baseline forecast, predicted and actual values for the measurement window"
          items={[
            { key: "baseline", label: "Baseline forecast", value: outcome.baseline_value, display: fmt(outcome.baseline_value), highlight: false },
            { key: "predicted", label: "Predicted with the decision", value: outcome.predicted_value, display: fmt(outcome.predicted_value), highlight: false },
            { key: "actual", label: "Actual", value: outcome.actual_value, display: fmt(outcome.actual_value), highlight: true },
          ]}
          color={CONTEXT_COLOR}
        />
        <DetailList
          items={[
            { label: "Realised effect (actual − baseline)", value: fmt(outcome.realized_effect) },
            { label: "Predicted effect", value: fmt(outcome.predicted_effect) },
            { label: "Actual against prediction", value: fmt(outcome.variance_vs_predicted) },
            { label: "Share of the predicted effect realised", value: isNum(outcome.accuracy) ? formatPercent(outcome.accuracy, { decimals: 0 }) : "Not defined" },
          ]}
        />
        <NoteList notes={[outcome.method, outcome.notes].filter((n): n is string => Boolean(n))} />
        {lastMeasure?.status === "partial" ? <Notice tone="warning">Partial window: data ends before the measurement window closes, so this is an interim reading.</Notice> : null}
      </div>
    );
  } else if (measurable) {
    body = (
      <EmptyState
        compact
        icon={GaugeIcon}
        title="Not measured yet"
        description={`Measurement window ${formatDate(rec.measurement_start)} to ${formatDate(rec.measurement_end)}. Measure to compare the actual result with the prediction.`}
      />
    );
  } else {
    body = <p className="text-sm text-muted-foreground">Outcomes are measured after the recommendation is marked implemented.</p>;
  }
  return (
    <Panel title="Predicted against actual" description="Did the decision deliver what was predicted?" actions={action}>
      {body}
    </Panel>
  );
}

type ActionKey = "submit" | "approve" | "reject" | "dismiss" | null;

export function RecommendationDetailView({ id }: { id: string }) {
  const { has } = useSession();
  const invalidate = useInvalidateOrg();
  const options = useFilterOptions();
  const currency = options.data?.companies.find((c) => c.id === options.data?.company_id)?.currency ?? "INR";
  const canWrite = has("recommendations:write");
  const canApprovePerm = has("recommendations:approve");
  const canManageTasks = has("tasks:manage");
  const { canList, members, nameOf } = useMembers();
  const [action, setAction] = useState<ActionKey>(null);
  const [implementedOpen, setImplementedOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const [lastMeasure, setLastMeasure] = useState<MeasureResult | null>(null);

  const query = useOrgQuery<RecommendationDetail>(`/recommendations/${id}`, { staleTime: 15_000, retry: false });
  const refresh = () => void invalidate("/recommendations", "/workflows", "/notifications", "/tasks");
  const transition = useOrgMutation<{ path: string; body?: Record<string, unknown> }, Recommendation>(({ path, body }, call) =>
    call(`/recommendations/${id}/${path}`, { method: "POST", json: body ?? {} }),
  );
  const measure = useOrgMutation<void, MeasureResult>((_, call) => call(`/recommendations/${id}/measure`, { method: "POST" }));
  const createTask = useCreateTask(() => setTaskOpen(false));

  const rec = query.data;
  if (query.isPending) {
    return (
      <div className="space-y-6" aria-busy="true">
        <SkeletonBlock className="h-8 w-2/3" />
        <SkeletonBlock className="h-8 w-full" />
        <div className="grid gap-6 lg:grid-cols-2">
          <SkeletonBlock className="h-56" />
          <SkeletonBlock className="h-56" />
        </div>
      </div>
    );
  }
  if (query.error || !rec) {
    return (
      <>
        <PageHeader title="Recommendation" />
        <Panel>
          <QueryError error={query.error} onRetry={() => void query.refetch()} />
        </Panel>
      </>
    );
  }

  function run(path: string, body: Record<string, unknown> | undefined, message: string, done?: () => void) {
    transition.mutate(
      { path, body },
      {
        onSuccess: () => {
          refresh();
          toast.success(message);
          done?.();
        },
      },
    );
  }

  const ownBlocked = canApprovePerm && !rec.can_approve && rec.status === "pending_approval";
  const buttons: ReactNode[] = [];
  if (canWrite && rec.status === "proposed") {
    buttons.push(
      <Button key="submit" onClick={() => { transition.reset(); setAction("submit"); }}>
        <SendIcon aria-hidden />
        Submit for approval
      </Button>,
    );
  }
  if (rec.can_approve && rec.status === "pending_approval") {
    buttons.push(
      <Button key="approve" onClick={() => { transition.reset(); setAction("approve"); }}>
        <ThumbsUpIcon aria-hidden />
        Approve
      </Button>,
      <Button key="reject" variant="outline" onClick={() => { transition.reset(); setAction("reject"); }}>
        <ThumbsDownIcon aria-hidden />
        Reject
      </Button>,
    );
  }
  if (canWrite && rec.status === "approved") {
    buttons.push(
      <Button key="start" disabled={transition.isPending} onClick={() => run("start", undefined, "Implementation started")}>
        <HammerIcon aria-hidden />
        Start implementation
      </Button>,
    );
  }
  if (canWrite && (rec.status === "approved" || rec.status === "in_progress")) {
    buttons.push(
      <Button key="implemented" variant={rec.status === "in_progress" ? "default" : "outline"} onClick={() => { transition.reset(); setImplementedOpen(true); }}>
        <GaugeIcon aria-hidden />
        Mark implemented
      </Button>,
    );
  }
  if (canManageTasks && !["rejected", "dismissed"].includes(rec.status)) {
    buttons.push(
      <Button key="task" variant="outline" onClick={() => { createTask.reset(); setTaskOpen(true); }}>
        <ListTodoIcon aria-hidden />
        New task
      </Button>,
    );
  }
  if (canWrite && (rec.status === "proposed" || rec.status === "pending_approval")) {
    buttons.push(
      <Button key="dismiss" variant="ghost" onClick={() => { transition.reset(); setAction("dismiss"); }}>
        <BanIcon aria-hidden />
        Dismiss
      </Button>,
    );
  }

  const dialog = {
    submit: { title: "Submit for approval?", description: "Every other member with approval rights is asked to decide. You cannot approve it yourself.", confirm: "Submit for approval", path: "submit", message: "Submitted for approval" },
    approve: { title: "Approve this recommendation?", description: "The requester is notified, and the work can start.", confirm: "Approve", path: "decision", message: "Recommendation approved" },
    reject: { title: "Reject this recommendation?", description: "The requester is notified with your note.", confirm: "Reject", path: "decision", message: "Recommendation rejected" },
    dismiss: { title: "Dismiss this recommendation?", description: "It leaves the pipeline without a decision. The audit trail keeps it.", confirm: "Dismiss", path: "dismiss", message: "Recommendation dismissed" },
  } as const;
  const current = action ? dialog[action] : null;

  return (
    <>
      <Link href="/app/workflows" className="mb-3 inline-flex items-center gap-1.5 rounded-md text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">
        <ArrowLeftIcon className="size-4" aria-hidden />
        Workflows
      </Link>
      <PageHeader
        title={rec.title}
        description={rec.summary}
        meta={
          <>
            <RecStatusBadge status={rec.status} />
            <PriorityBadge priority={rec.priority} />
            <ConfidenceBadge confidence={rec.confidence} />
            <StatusBadge>{humanize(rec.category)}</StatusBadge>
            {rec.store_code ? <StatusBadge tone="info">{rec.store_code}</StatusBadge> : null}
            <span>{SOURCE_LABELS[rec.source] ?? humanize(rec.source)}</span>
            <span>
              Created {formatDateTime(rec.created_at)} by {nameOf(rec.created_by)}
            </span>
          </>
        }
      />
      <div className="space-y-6">
        <Pipeline status={rec.status} />
        {buttons.length ? <div className="flex flex-wrap gap-2">{buttons}</div> : null}
        {ownBlocked ? (
          <Notice title="Separation of duties">You created this recommendation, so another member with approval rights has to decide on it.</Notice>
        ) : null}
        {rec.status === "pending_approval" && !canApprovePerm ? <Notice>Waiting for a member with approval rights to decide.</Notice> : null}

        <div className="grid gap-6 lg:grid-cols-2">
          <ImpactPanel rec={rec} currency={currency} />
          <OutcomePanel
            rec={rec}
            currency={currency}
            lastMeasure={lastMeasure}
            canMeasure={canWrite}
            measuring={measure.isPending}
            onMeasure={() =>
              measure.mutate(undefined, {
                onSuccess: (res) => {
                  setLastMeasure(res);
                  refresh();
                  if (res.status === "pending_data") toast.message("No data for the measurement window yet");
                  else toast.success(res.status === "measured" ? "Outcome measured" : "Interim outcome measured");
                },
                onError: (error) => toastError(error, "The outcome couldn't be measured"),
              })
            }
          />
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Panel title="Evidence" description="What the recommendation is based on">
            {rec.evidence.length ? (
              <div className="space-y-3">
                {rec.evidence.map((item, i) => (
                  <EvidenceBlock key={i} item={item} currency={currency} />
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No evidence attached.</p>
            )}
          </Panel>
          <Panel title="Assumptions" description="What has to hold for the prediction to come true">
            {rec.assumptions.length ? <NoteList notes={rec.assumptions} className="text-[0.8125rem] text-foreground/85" /> : <p className="text-sm text-muted-foreground">No assumptions recorded.</p>}
            {rec.measurement_start ? (
              <DetailList
                className="mt-4 border-t pt-4"
                items={[
                  { label: "Implemented", value: formatDate(rec.implemented_at) },
                  { label: "Measurement window", value: `${formatDate(rec.measurement_start)} to ${formatDate(rec.measurement_end)}` },
                ]}
              />
            ) : null}
          </Panel>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Panel title="Approvals" description="Who was asked, and who decided">
            {rec.approvals.length ? (
              <ul className="divide-y">
                {rec.approvals.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-start justify-between gap-2 py-2.5 first:pt-0 last:pb-0">
                    <div>
                      <p className="text-[0.8125rem] font-medium">{a.approver ?? "Approver"}</p>
                      <p className="text-xs text-muted-foreground">
                        Requested {formatDateTime(a.requested_at)}
                        {a.decided_at ? ` · decided ${formatDateTime(a.decided_at)}` : ""}
                      </p>
                      {a.note ? <p className="mt-0.5 text-xs text-muted-foreground">Note: {a.note}</p> : null}
                    </div>
                    <StatusBadge tone={a.status === "approved" ? "good" : a.status === "rejected" ? "danger" : a.status === "pending" ? "warning" : "neutral"}>
                      {humanize(a.status)}
                    </StatusBadge>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Not submitted for approval yet.</p>
            )}
          </Panel>
          <Panel title="Timeline" description="Every step, from the audit trail">
            {rec.history.length ? (
              <ol className="relative space-y-3 border-l pl-4">
                {rec.history.map((h, i) => (
                  <li key={i} className="relative">
                    <span aria-hidden className="absolute top-1.5 -left-[1.3rem] size-2 rounded-full bg-primary ring-4 ring-card" />
                    <p className="text-[0.8125rem] font-medium">{HISTORY_LABELS[h.action] ?? humanize(h.action.replace("recommendation.", ""))}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDateTime(h.at)}
                      {h.actor ? ` · ${h.actor}` : ""}
                    </p>
                    {h.details && typeof h.details.note === "string" && h.details.note ? <p className="text-xs text-muted-foreground">Note: {h.details.note}</p> : null}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-muted-foreground">No history recorded.</p>
            )}
          </Panel>
        </div>

        <Panel title="Tasks" description="Work linked to this recommendation">
          {rec.tasks.length ? (
            <ul className="divide-y">
              {rec.tasks.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="text-[0.8125rem] font-medium">{t.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {nameOf(t.assignee_id)} · {t.due_date ? `due ${formatDate(t.due_date)}` : "no due date"}
                    </p>
                  </div>
                  <TaskStatusSelect task={t} disabled={!canManageTasks} />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState compact icon={ListTodoIcon} title="No tasks yet" description={canManageTasks ? "Create tasks to carry out the decision." : undefined} />
          )}
        </Panel>
        {rec.status === "rejected" ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CircleAlertIcon className="size-4" aria-hidden />
            Rejected {formatDateTime(rec.decided_at)}.
          </p>
        ) : null}
      </div>

      <NoteDialog
        open={Boolean(current)}
        onOpenChange={(open) => !open && setAction(null)}
        title={current?.title ?? ""}
        description={current?.description ?? ""}
        confirmLabel={current?.confirm ?? "Confirm"}
        destructive={action === "reject" || action === "dismiss"}
        submitting={transition.isPending}
        error={transition.error}
        onConfirm={(note) => {
          if (!current || !action) return;
          const body = action === "approve" || action === "reject" ? { approve: action === "approve", note } : { note };
          run(current.path, body, current.message, () => setAction(null));
        }}
      />
      <ImplementedDialog
        open={implementedOpen}
        onOpenChange={setImplementedOpen}
        submitting={transition.isPending}
        error={transition.error}
        onConfirm={(input) => run("implemented", input, "Marked implemented: the measurement window has started", () => setImplementedOpen(false))}
      />
      <CreateTaskDialog
        open={taskOpen}
        onOpenChange={setTaskOpen}
        members={members}
        canAssign={canList}
        recommendations={[]}
        fixedRecommendation={{ id: rec.id, title: rec.title }}
        submitting={createTask.isPending}
        error={createTask.error}
        onSubmit={(task) => createTask.mutate({ ...task, recommendation_id: rec.id })}
      />
    </>
  );
}
