"use client";

import { CrosshairIcon, LoaderCircleIcon, PlusIcon, Trash2Icon, WandSparklesIcon } from "lucide-react";
import { useId, useMemo, useState } from "react";
import {
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";

import { StatusBadge } from "@/components/app/badges";
import { ChartLegend, TooltipCard, useChartView } from "@/components/app/charts/chart-parts";
import { AXIS_TEXT, CONTEXT_COLOR, GRID_COLOR, POSITIVE_COLOR, SERIES_COLORS } from "@/components/app/charts/palette";
import { DataTable } from "@/components/app/data-table";
import { FormError } from "@/components/app/form";
import { NoteList, Panel } from "@/components/app/page";
import { EmptyState, Notice } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cleanAmount, errorText, formatDelta, isNum } from "@/lib/app/decision-lab-format";
import {
  fieldDef,
  leverPayload,
  optimizableFields,
  parseNumber,
  rangeText,
  toApi,
  toDisplay,
  type FieldDef,
  type LeverDraft,
} from "@/lib/app/decision-lab-levers";
import type {
  OptimizeConstraint,
  OptimizeConstraintMetric,
  OptimizeObjective,
  OptimizePoint,
  OptimizeResult,
} from "@/lib/app/decision-lab-types";
import { formatMoney, formatNumber, formatPercent, formatPoints, moneyTick } from "@/lib/app/format";

import { LEVER_LABELS } from "./lever-editor";

const OBJECTIVES: { value: OptimizeObjective; label: string }[] = [
  { value: "net_profit", label: "Maximise net profit change" },
  { value: "risk_adjusted_net_profit", label: "Maximise downside-protected net profit (P10)" },
  { value: "ebitda", label: "Maximise EBITDA change" },
  { value: "free_cash_flow", label: "Maximise free cash flow change" },
  { value: "gross_profit", label: "Maximise gross profit change" },
  { value: "net_sales", label: "Maximise net sales change" },
];

const CONSTRAINT_METRICS: { value: OptimizeConstraintMetric; label: string; ratio?: boolean }[] = [
  { value: "net_profit", label: "Net profit" },
  { value: "net_sales", label: "Net sales" },
  { value: "gross_profit", label: "Gross profit" },
  { value: "ebitda", label: "EBITDA" },
  { value: "free_cash_flow", label: "Free cash flow" },
  { value: "gross_margin", label: "Gross margin", ratio: true },
  { value: "net_margin", label: "Net margin", ratio: true },
  { value: "investment", label: "Investment" },
];

type VariableDraft = { leverUid: string; field: string; min: string; max: string; steps: string };
type ConstraintDraft = { metric: OptimizeConstraintMetric; basis: "delta_total" | "scenario_total"; op: ">=" | "<="; value: string };

export function formatFieldValue(field: FieldDef | undefined, value: number, currency: string): string {
  if (!field) return formatNumber(value, { decimals: 2 });
  switch (field.kind) {
    case "percent":
      return formatPercent(value, { signed: field.key === "change_pct" });
    case "points":
      return formatPoints(value);
    case "money":
      return formatMoney(value, currency, { compact: true });
    case "month":
      return `Month ${value}`;
    case "days":
      return `${formatNumber(value, { signed: true, decimals: 1 })} days`;
    default:
      return formatNumber(value, { decimals: Number.isInteger(value) ? 0 : 2 });
  }
}

function unitSuffix(field: FieldDef | undefined): string {
  if (!field) return "";
  return field.kind === "percent" ? "%" : field.kind === "points" ? "pp" : field.kind === "days" ? "days" : "";
}

function Landscape({ result, variables, levers, currency }: { result: OptimizeResult; variables: VariableDraft[]; levers: LeverDraft[]; currency: string }) {
  const first = variables[0];
  const lever = levers.find((l) => l.uid === first?.leverUid);
  const index = lever ? levers.indexOf(lever) : -1;
  const field = lever ? fieldDef(lever.type, first.field) : undefined;
  const key = `${index}.${first?.field}`;
  const data = result.points
    .map((p) => ({ x: p.values[key], y: cleanAmount(p.objective), feasible: p.feasible, point: p }))
    .filter((d) => isNum(d.x) && isNum(d.y))
    .sort((a, b) => (a.x as number) - (b.x as number));
  const bestX = result.best?.values[key];
  const single = variables.length === 1;
  function renderTooltip(props: TooltipContentProps) {
    if (!props.active || !props.payload?.length) return null;
    const d = props.payload[0]?.payload as (typeof data)[number] | undefined;
    if (!d) return null;
    return (
      <TooltipCard
        title={Object.entries(d.point.values)
          .map(([k, v]) => {
            const [i, f] = k.split(".");
            const lv = levers[Number(i)];
            return `${lv ? LEVER_LABELS[lv.type] : k}: ${formatFieldValue(lv ? fieldDef(lv.type, f) : undefined, v, currency)}`;
          })
          .join(" · ")}
        rows={[{ key: "o", label: d.feasible ? "Objective (meets constraints)" : "Objective (breaks a constraint)", color: d.feasible ? SERIES_COLORS[0] : CONTEXT_COLOR, value: formatDelta(d.y, currency) }]}
      />
    );
  }
  if (!data.length) return <p className="text-sm text-muted-foreground">No evaluated point has an objective value to plot.</p>;
  return (
    <figure className="flex min-w-0 flex-col gap-3" aria-label="Objective value across the evaluated grid">
      <ChartLegend
        items={[
          { label: "Meets the constraints", color: SERIES_COLORS[0], shape: "rect" },
          { label: "Breaks a constraint", color: CONTEXT_COLOR, shape: "rect" },
          { label: "Best", color: POSITIVE_COLOR, shape: "line" },
        ]}
      />
      <div className="h-64 min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
            <CartesianGrid vertical={false} stroke={GRID_COLOR} />
            <XAxis
              dataKey="x"
              type="number"
              domain={["dataMin", "dataMax"]}
              tickFormatter={(v: number) => formatFieldValue(field, v, currency)}
              tickLine={false}
              axisLine={{ stroke: GRID_COLOR }}
              tick={{ fill: AXIS_TEXT, fontSize: 12 }}
              tickMargin={8}
            />
            <YAxis dataKey="y" tickFormatter={moneyTick(currency)} tickLine={false} axisLine={false} tick={{ fill: AXIS_TEXT, fontSize: 12 }} width={68} />
            <ReferenceLine y={0} stroke={AXIS_TEXT} strokeOpacity={0.5} />
            {isNum(bestX) ? <ReferenceLine x={bestX} stroke={POSITIVE_COLOR} strokeWidth={1.5} /> : null}
            <Tooltip content={renderTooltip} isAnimationActive={false} cursor={{ stroke: AXIS_TEXT, strokeWidth: 1 }} />
            {single ? <Line data={data} dataKey="y" stroke={CONTEXT_COLOR} strokeWidth={1.5} dot={false} isAnimationActive={false} /> : null}
            <Scatter data={data} dataKey="y" isAnimationActive={false}>
              {data.map((d, i) => (
                <Cell key={i} fill={d.feasible ? SERIES_COLORS[0] : CONTEXT_COLOR} />
              ))}
            </Scatter>
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {!single ? <p className="text-xs text-muted-foreground">Each dot is one combination; the other variables differ between dots at the same position.</p> : null}
    </figure>
  );
}

export function Optimizer({
  levers,
  currency,
  running,
  error,
  result,
  onRun,
  onApply,
}: {
  levers: LeverDraft[];
  currency: string;
  running: boolean;
  error: unknown;
  result: OptimizeResult | null;
  onRun: (body: {
    levers: Record<string, unknown>[];
    variables: { lever_index: number; field: string; min: number; max: number; steps: number }[];
    objective: OptimizeObjective;
    constraints: OptimizeConstraint[];
  }) => void;
  onApply: (levers: Record<string, unknown>[]) => void;
}) {
  const baseId = useId();
  const candidates = useMemo(
    () => levers.flatMap((l, index) => optimizableFields(l.type).map((f) => ({ lever: l, index, field: f }))),
    [levers],
  );
  const [variables, setVariables] = useState<VariableDraft[]>([]);
  const [objective, setObjective] = useState<OptimizeObjective>("net_profit");
  const [constraints, setConstraints] = useState<ConstraintDraft[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [view, toggle] = useChartView("Objective landscape");

  // Keep variables pointing at levers that still exist.
  const liveVariables = variables.filter((v) => levers.some((l) => l.uid === v.leverUid));

  if (!levers.length) {
    return (
      <Panel>
        <EmptyState
          icon={CrosshairIcon}
          title="Add levers in the builder first"
          description="The optimizer searches ranges of your levers' values (for example price change between −5% and +10%) for the best outcome within your constraints."
        />
      </Panel>
    );
  }
  if (!candidates.length) {
    return (
      <Panel>
        <EmptyState
          icon={CrosshairIcon}
          title="None of these levers has a field the optimizer can vary"
          description="Add a pricing, marketing, supplier, workforce, inventory, retention, product mix or new store lever."
        />
      </Panel>
    );
  }

  function defaultVariable(): VariableDraft {
    const c = candidates.find((cand) => !liveVariables.some((v) => v.leverUid === cand.lever.uid && v.field === cand.field.key)) ?? candidates[0];
    const f = c.field;
    const lo = f.kind === "percent" ? Math.max(f.min ?? -0.1, -0.1) : f.key === "count" ? 1 : f.key === "open_month" ? 1 : (f.min ?? 0);
    const hi = f.kind === "percent" ? Math.min(f.max ?? 0.1, 0.1) : f.key === "count" ? 3 : f.key === "open_month" ? 6 : f.key.includes("headcount") ? 10 : Math.min(f.max ?? 10, 10);
    return { leverUid: c.lever.uid, field: f.key, min: String(toDisplay(f.kind, lo)), max: String(toDisplay(f.kind, hi)), steps: "11" };
  }

  function submit() {
    setFormError(null);
    if (!liveVariables.length) return setFormError("Add at least one variable to optimise.");
    const template = levers.map((l) => leverPayload(l, LEVER_LABELS[l.type]));
    const vars = [];
    let combos = 1;
    for (const v of liveVariables) {
      const index = levers.findIndex((l) => l.uid === v.leverUid);
      const lever = levers[index];
      const field = fieldDef(lever.type, v.field);
      if (!field) return setFormError("Choose a field for each variable.");
      const min = toApi(field.kind, v.min);
      const max = toApi(field.kind, v.max);
      const steps = parseNumber(v.steps);
      if (min === null || max === null) return setFormError(`Enter a minimum and maximum for ${field.label.toLowerCase()}.`);
      if (max <= min) return setFormError(`The maximum must be above the minimum for ${field.label.toLowerCase()}.`);
      const outside = (field.min !== undefined && min < field.min) || (field.max !== undefined && max > field.max);
      if (outside) return setFormError(`${field.label} must stay ${rangeText(field)}.`);
      if (steps === null || !Number.isInteger(steps) || steps < 2 || steps > 51) return setFormError("Steps must be a whole number from 2 to 51.");
      combos *= steps;
      // The template needs a valid value for the varied field: start from the minimum.
      template[index] = { ...template[index], [v.field]: field.kind === "integer" || field.kind === "month" ? Math.round(min) : min };
      vars.push({ lever_index: index, field: v.field, min, max, steps });
    }
    if (combos > 2500) return setFormError(`That is ${formatNumber(combos)} combinations; reduce the steps so there are at most 2,500.`);
    const cons: OptimizeConstraint[] = [];
    for (const c of constraints) {
      const ratio = CONSTRAINT_METRICS.find((m) => m.value === c.metric)?.ratio;
      const value = ratio ? toApi("percent", c.value) : parseNumber(c.value);
      if (value === null) return setFormError("Enter a value for each constraint.");
      cons.push({ metric: c.metric, basis: c.basis, op: c.op, value });
    }
    onRun({ levers: template, variables: vars, objective, constraints: cons });
  }

  const best = result?.best ?? null;
  const tableRows: (OptimizePoint & { rank: number })[] = (result?.points ?? [])
    .filter((p) => isNum(p.objective))
    .sort((a, b) => (b.objective ?? 0) - (a.objective ?? 0))
    .slice(0, 50)
    .map((p, i) => ({ ...p, rank: i + 1 }));

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
      <Panel title="Goal" description="Vary up to three lever values on a grid and keep the best combination that meets your constraints">
        <div className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor={`${baseId}-objective`}>Objective</Label>
            <Select value={objective} onValueChange={(v) => setObjective(v as OptimizeObjective)}>
              <SelectTrigger id={`${baseId}-objective`} className="w-full bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                {OBJECTIVES.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">Variables</legend>
            {liveVariables.map((v, i) => {
              const lever = levers.find((l) => l.uid === v.leverUid);
              const field = lever ? fieldDef(lever.type, v.field) : undefined;
              const suffix = unitSuffix(field);
              const id = `${baseId}-var-${i}`;
              return (
                <div key={i} className="space-y-2 rounded-lg bg-muted/50 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor={`${id}-field`} className="text-[0.8125rem]">
                      Variable {i + 1}
                    </Label>
                    <Button variant="ghost" size="icon-xs" onClick={() => setVariables(liveVariables.filter((_, j) => j !== i))} aria-label={`Remove variable ${i + 1}`}>
                      <Trash2Icon aria-hidden />
                    </Button>
                  </div>
                  <Select
                    value={`${v.leverUid}|${v.field}`}
                    onValueChange={(value) => {
                      const [uid, key] = value.split("|");
                      const lv = levers.find((l) => l.uid === uid);
                      const f = lv ? fieldDef(lv.type, key) : undefined;
                      setVariables(
                        liveVariables.map((x, j) =>
                          j === i
                            ? { ...x, leverUid: uid, field: key, min: f ? String(toDisplay(f.kind, f.min ?? 0)) : x.min, max: f ? String(toDisplay(f.kind, f.max !== undefined ? Math.min(f.max, f.kind === "percent" ? 0.1 : f.max) : 1)) : x.max }
                            : x,
                        ),
                      );
                    }}
                  >
                    <SelectTrigger id={`${id}-field`} className="w-full bg-background">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent position="popper">
                      {candidates.map((c) => (
                        <SelectItem key={`${c.lever.uid}|${c.field.key}`} value={`${c.lever.uid}|${c.field.key}`}>
                          {c.index + 1}. {c.lever.label || LEVER_LABELS[c.lever.type]}: {c.field.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="grid grid-cols-3 gap-2">
                    {(["min", "max", "steps"] as const).map((key) => (
                      <div key={key} className="space-y-1">
                        <Label htmlFor={`${id}-${key}`} className="text-xs text-muted-foreground">
                          {key === "min" ? "From" : key === "max" ? "To" : "Steps"}
                          {key !== "steps" && suffix ? ` (${suffix})` : ""}
                        </Label>
                        <Input
                          id={`${id}-${key}`}
                          inputMode="decimal"
                          value={v[key]}
                          onChange={(e) => setVariables(liveVariables.map((x, j) => (j === i ? { ...x, [key]: e.target.value } : x)))}
                          className="bg-background"
                        />
                      </div>
                    ))}
                  </div>
                  {field ? <p className="text-xs text-muted-foreground">Allowed {rangeText(field)}.</p> : null}
                </div>
              );
            })}
            {liveVariables.length < 3 ? (
              <Button variant="outline" size="sm" onClick={() => setVariables([...liveVariables, defaultVariable()])}>
                <PlusIcon aria-hidden />
                Add variable
              </Button>
            ) : null}
          </fieldset>

          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">
              Constraints <span className="font-normal text-muted-foreground">(optional)</span>
            </legend>
            {constraints.map((c, i) => {
              const ratio = CONSTRAINT_METRICS.find((m) => m.value === c.metric)?.ratio;
              const id = `${baseId}-con-${i}`;
              return (
                <div key={i} className="grid grid-cols-2 gap-2 rounded-lg bg-muted/50 p-3">
                  <div className="col-span-2 flex items-center justify-between">
                    <span className="text-[0.8125rem] font-medium">Constraint {i + 1}</span>
                    <Button variant="ghost" size="icon-xs" onClick={() => setConstraints(constraints.filter((_, j) => j !== i))} aria-label={`Remove constraint ${i + 1}`}>
                      <Trash2Icon aria-hidden />
                    </Button>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`${id}-metric`} className="text-xs text-muted-foreground">
                      Measure
                    </Label>
                    <Select value={c.metric} onValueChange={(v) => setConstraints(constraints.map((x, j) => (j === i ? { ...x, metric: v as OptimizeConstraintMetric } : x)))}>
                      <SelectTrigger id={`${id}-metric`} className="w-full bg-background">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent position="popper">
                        {CONSTRAINT_METRICS.map((m) => (
                          <SelectItem key={m.value} value={m.value}>
                            {m.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`${id}-basis`} className="text-xs text-muted-foreground">
                      Measured as
                    </Label>
                    <Select
                      value={c.metric === "investment" ? "delta_total" : c.basis}
                      disabled={c.metric === "investment"}
                      onValueChange={(v) => setConstraints(constraints.map((x, j) => (j === i ? { ...x, basis: v as ConstraintDraft["basis"] } : x)))}
                    >
                      <SelectTrigger id={`${id}-basis`} className="w-full bg-background">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent position="popper">
                        <SelectItem value="delta_total">Change vs baseline</SelectItem>
                        <SelectItem value="scenario_total">Scenario total</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`${id}-op`} className="text-xs text-muted-foreground">
                      Rule
                    </Label>
                    <Select value={c.op} onValueChange={(v) => setConstraints(constraints.map((x, j) => (j === i ? { ...x, op: v as ConstraintDraft["op"] } : x)))}>
                      <SelectTrigger id={`${id}-op`} className="w-full bg-background">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent position="popper">
                        <SelectItem value=">=">At least</SelectItem>
                        <SelectItem value="<=">At most</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`${id}-value`} className="text-xs text-muted-foreground">
                      Value {ratio ? (c.basis === "delta_total" ? "(pp)" : "(%)") : `(${currency})`}
                    </Label>
                    <Input
                      id={`${id}-value`}
                      inputMode="decimal"
                      value={c.value}
                      onChange={(e) => setConstraints(constraints.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                      className="bg-background"
                    />
                  </div>
                </div>
              );
            })}
            {constraints.length < 6 ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConstraints([...constraints, { metric: "net_sales", basis: "delta_total", op: ">=", value: "0" }])}
              >
                <PlusIcon aria-hidden />
                Add constraint
              </Button>
            ) : null}
          </fieldset>

          <FormError message={formError ?? (error ? errorText(error) : null)} />
          <Button onClick={submit} disabled={running} className="w-full">
            {running ? <LoaderCircleIcon className="animate-spin" aria-hidden /> : <WandSparklesIcon aria-hidden />}
            {running ? "Searching the grid…" : "Find the best values"}
          </Button>
        </div>
      </Panel>

      <div className="min-w-0 space-y-6">
        {!result ? (
          <Panel>
            <EmptyState
              compact
              icon={CrosshairIcon}
              title="No search yet"
              description="Choose an objective and the ranges to search. Every evaluated combination is shown, not only the winner."
            />
          </Panel>
        ) : result.status === "infeasible" ? (
          <Notice tone="warning" title="No combination meets every constraint">
            {result.message ?? "Widen the ranges or relax a constraint."} {formatNumber(result.evaluations)} combinations were evaluated
            {result.skipped_combinations ? `, ${formatNumber(result.skipped_combinations)} skipped as invalid` : ""}.
          </Notice>
        ) : best ? (
          <Panel
            title="Best combination"
            description={`${formatNumber(result.evaluations)} combinations evaluated${result.skipped_combinations ? `, ${formatNumber(result.skipped_combinations)} skipped as invalid` : ""}`}
            actions={
              result.best_levers ? (
                <Button size="sm" onClick={() => onApply(result.best_levers ?? [])}>
                  Use in the builder
                </Button>
              ) : undefined
            }
            footer={<NoteList notes={[result.method, result.caveat].filter((n): n is string => Boolean(n))} />}
          >
            <dl className="grid gap-4 sm:grid-cols-2">
              {Object.entries(best.values).map(([key, value]) => {
                const [i, f] = key.split(".");
                const lever = levers[Number(i)];
                const field = lever ? fieldDef(lever.type, f) : undefined;
                return (
                  <div key={key}>
                    <dt className="text-xs text-muted-foreground">
                      {lever ? `${Number(i) + 1}. ${lever.label || LEVER_LABELS[lever.type]}` : key}: {field?.label ?? f}
                    </dt>
                    <dd className="text-xl font-semibold">{formatFieldValue(field, value, currency)}</dd>
                  </div>
                );
              })}
              <div>
                <dt className="text-xs text-muted-foreground">Objective</dt>
                <dd className="text-xl font-semibold">{formatDelta(best.objective, currency)}</dd>
                {isNum(best.p10_net_profit) ? <dd className="text-xs text-muted-foreground">P10 net profit change {formatDelta(best.p10_net_profit, currency)}</dd> : null}
              </div>
            </dl>
            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 border-t pt-4 text-[0.8125rem]">
              {Object.entries(best.delta).map(([k, v]) => (
                <span key={k}>
                  <span className="text-muted-foreground">{k === "net_sales" ? "Net sales" : k === "gross_profit" ? "Gross profit" : k === "ebitda" ? "EBITDA" : k === "net_profit" ? "Net profit" : "Free cash flow"}</span>{" "}
                  <span className="font-semibold tabular">{formatDelta(v, currency)}</span>
                </span>
              ))}
            </div>
            {best.constraints.length ? (
              <ul className="mt-3 flex flex-wrap gap-2">
                {best.constraints.map((c, i) => (
                  <li key={i}>
                    <StatusBadge tone={c.ok ? "good" : "danger"}>
                      {CONSTRAINT_METRICS.find((m) => m.value === c.metric)?.label ?? c.metric} {c.op === ">=" ? "≥" : "≤"}{" "}
                      {CONSTRAINT_METRICS.find((m) => m.value === c.metric)?.ratio ? formatPercent(c.limit) : formatMoney(c.limit, currency, { compact: true })}:{" "}
                      {c.ok ? "met" : "not met"}
                    </StatusBadge>
                  </li>
                ))}
              </ul>
            ) : null}
          </Panel>
        ) : null}
        {result && result.points.length ? (
          <Panel title="Objective landscape" description="The objective at every evaluated point" actions={toggle}>
            {view === "chart" ? (
              <Landscape result={result} variables={liveVariables} levers={levers} currency={currency} />
            ) : (
              <DataTable
                caption="Evaluated combinations, best first"
                dense
                maxHeight={360}
                rows={tableRows}
                rowKey={(r) => String(r.rank)}
                columns={[
                  { key: "rank", header: "Rank", align: "right", cell: (r) => r.rank },
                  {
                    key: "values",
                    header: "Values",
                    cell: (r) =>
                      Object.entries(r.values)
                        .map(([k, v]) => {
                          const [i, f] = k.split(".");
                          const lv = levers[Number(i)];
                          return `${lv ? fieldDef(lv.type, f)?.label ?? f : k} ${formatFieldValue(lv ? fieldDef(lv.type, f) : undefined, v, currency)}`;
                        })
                        .join(", "),
                  },
                  { key: "obj", header: "Objective", align: "right", cell: (r) => formatDelta(r.objective, currency) },
                  { key: "ok", header: "Constraints", cell: (r) => (r.feasible ? "Met" : "Not met") },
                ]}
              />
            )}
          </Panel>
        ) : null}
      </div>
    </div>
  );
}
