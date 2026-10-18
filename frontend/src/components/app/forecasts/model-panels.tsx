"use client";

import { CircleCheckIcon, CrownIcon, FlagIcon, TriangleAlertIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { StatusBadge } from "@/components/app/badges";
import { BarList } from "@/components/app/charts/bar-list";
import { useChartView } from "@/components/app/charts/chart-parts";
import { CONTEXT_COLOR, SERIES_COLORS } from "@/components/app/charts/palette";
import { TrendChart } from "@/components/app/charts/trend-chart";
import { DataTable, type Column } from "@/components/app/data-table";
import { JsonPreview } from "@/components/app/json-preview";
import { DefinitionButton } from "@/components/app/kpi";
import { DetailList, NoteList, Panel } from "@/components/app/page";
import { HashValue, ReliabilityBadge } from "@/components/app/decision-lab/common";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDate, formatDateTime, formatDuration, formatNumber, formatPercent, MISSING } from "@/lib/app/format";
import { algorithmLabel, FAMILY_LABELS, FREQUENCY_LABELS } from "@/lib/app/forecasts-series";
import type { ForecastDetail, ForecastModel, Methodology, ModelCandidate } from "@/lib/app/forecasts-types";
import { cn } from "@/lib/utils";

import { unitFormatter } from "./forecast-chart";

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** "19.9% lower error than the naive (last value repeated) baseline" from skill = 1 − WAPE ÷ baseline WAPE. */
export function skillSentence(model: Pick<ForecastModel, "skill_vs_baseline" | "baseline_algorithm" | "algorithm">): string {
  const skill = model.skill_vs_baseline;
  const baseline = algorithmLabel(model.baseline_algorithm).replace(/^./, (c) => c.toLowerCase());
  if (!isNum(skill)) return "No comparison with a baseline is available.";
  if (model.algorithm === model.baseline_algorithm || Math.abs(skill) < 0.0005) {
    return `No improvement over the ${baseline} baseline: the baseline itself was the most accurate model.`;
  }
  if (skill > 0) return `${formatPercent(skill)} lower error (WAPE) than the ${baseline} baseline.`;
  return `${formatPercent(Math.abs(skill))} higher error (WAPE) than the ${baseline} baseline.`;
}

function MetricTile({
  label,
  value,
  hint,
  formula,
  description,
  emphasis,
}: {
  label: string;
  value: string;
  hint?: string;
  formula?: string;
  description?: string;
  emphasis?: boolean;
}) {
  return (
    <div className="min-w-0 border-t border-l border-border bg-card px-4 py-3.5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[0.8125rem] font-medium text-muted-foreground">{label}</p>
        <DefinitionButton label={label} formula={formula} description={description} />
      </div>
      <p className={cn("mt-1 leading-tight font-semibold tracking-[-0.01em]", emphasis ? "text-[1.5rem]" : "text-lg")}>{value}</p>
      {hint ? <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function ModelCard({ model, methodology, currency }: { model: ForecastModel; methodology?: Methodology; currency: string }) {
  const m = model.metrics;
  const unitFormat = unitFormatter(model.unit, currency);
  const coverageOk = isNum(m.coverage_80) && m.coverage_80 >= 0.7 && m.coverage_80 <= 0.95;
  const chosen = model.candidates.find((c) => c.algorithm === model.algorithm);
  return (
    <Panel
      title="Model card"
      description={`${model.target_label} · ${model.level_label} · ${FREQUENCY_LABELS[model.frequency] ?? model.frequency} · version ${model.version}`}
      actions={<ReliabilityBadge reliability={model.reliability} />}
    >
      <div className="space-y-5">
        <div>
          <p className="text-xs text-muted-foreground">Selected model</p>
          <p className="mt-0.5 font-heading text-lg font-semibold">{algorithmLabel(model.algorithm)}</p>
          {chosen?.description ? <p className="mt-0.5 text-sm text-muted-foreground">{chosen.description}</p> : null}
          <p className="mt-2 flex items-start gap-2 text-sm">
            <CircleCheckIcon className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
            <span>{skillSentence(model)}</span>
          </p>
        </div>

        <div className="@container overflow-hidden rounded-xl ring-1 ring-foreground/10">
          <div className="-mt-px -ml-px grid grid-cols-1 @xs:grid-cols-2 @xl:grid-cols-3">
            <MetricTile
              emphasis
              label="WAPE"
              value={formatPercent(m.wape)}
              hint={isNum(model.baseline_metrics?.wape) ? `Baseline ${formatPercent(model.baseline_metrics?.wape)}` : undefined}
              formula="Σ|actual − forecast| ÷ Σ|actual|"
              description="Weighted absolute percentage error across the backtest folds. Lower is better."
            />
            <MetricTile
              label="80% interval coverage"
              value={formatPercent(m.coverage_80)}
              hint={isNum(m.coverage_80) ? (coverageOk ? "Within the 70–95% target" : "Outside the 70–95% target") : "Not measured"}
              description="Share of backtest actuals that fell inside the 80% interval."
            />
            <MetricTile
              label="Bias"
              value={isNum(m.bias) ? formatPercent(m.bias, { signed: true }) : MISSING}
              hint={isNum(m.bias) ? (m.bias > 0 ? "Forecasts run above actuals" : m.bias < 0 ? "Forecasts run below actuals" : "No bias") : undefined}
              formula="mean(forecast − actual) ÷ mean(actual)"
              description="Positive means over-forecasting."
            />
            <MetricTile label="MAE" value={isNum(m.mae) ? unitFormat(m.mae) : MISSING} hint="Mean absolute error per period" formula="mean |actual − forecast|" />
            <MetricTile label="RMSE" value={isNum(m.rmse) ? unitFormat(m.rmse) : MISSING} hint="Penalises large misses" formula="√ mean (actual − forecast)²" />
            <MetricTile
              label="MAPE"
              value={formatPercent(m.mape)}
              hint="Zero actuals excluded"
              formula="mean |actual − forecast| ÷ |actual|"
            />
          </div>
        </div>

        <div className="rounded-lg bg-muted/60 px-3.5 py-3 text-[0.8125rem] leading-relaxed">
          <p className="flex flex-wrap items-center gap-2 font-medium">
            Reliability verdict <ReliabilityBadge reliability={model.reliability} />
          </p>
          {methodology?.reliability ? <p className="mt-1 text-muted-foreground">{methodology.reliability}</p> : null}
          <p className="mt-1 text-muted-foreground">
            Measured on {formatNumber(m.folds ?? null)} time-ordered folds, each scored up to {formatNumber(m.eval_horizon ?? null)}{" "}
            {model.frequency === "D" ? "days" : model.frequency === "W" ? "weeks" : "months"} ahead.
          </p>
        </div>

        <DetailList
          items={[
            { label: "Training window", value: `${formatDate(model.training_start)} to ${formatDate(model.training_end)}` },
            { label: "Observations", value: formatNumber(model.n_observations ?? null) },
            { label: "Data fingerprint", value: <HashValue value={model.data_fingerprint} /> },
            { label: "Code version · random seed", value: `${model.code_version ?? MISSING} · ${model.random_seed ?? MISSING}` },
            { label: "Trained", value: formatDateTime(model.created_at) },
            {
              label: "Hyperparameters",
              value: model.hyperparameters && Object.keys(model.hyperparameters).length ? (
                <JsonPreview label="View" title="Hyperparameters" value={model.hyperparameters} />
              ) : (
                "None (rule-based model)"
              ),
            },
          ]}
        />

        {model.limitations.length ? (
          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
              <TriangleAlertIcon className="size-3.5 text-warning" aria-hidden />
              Limitations
            </p>
            <NoteList notes={model.limitations} />
          </div>
        ) : null}
      </div>
    </Panel>
  );
}

type CandidateRow = ModelCandidate & { chosen: boolean; baseline: boolean };

export function CandidatesPanel({ model, currency }: { model: ForecastModel; currency: string }) {
  const [view, toggle] = useChartView("Candidate models");
  const unitFormat = unitFormatter(model.unit, currency);
  const rows: CandidateRow[] = useMemo(
    () =>
      [...model.candidates]
        .map((c) => ({ ...c, chosen: c.algorithm === model.algorithm, baseline: c.algorithm === model.baseline_algorithm }))
        .sort((a, b) => (a.failed ? 1 : 0) - (b.failed ? 1 : 0) || (a.wape ?? Infinity) - (b.wape ?? Infinity)),
    [model],
  );
  const columns: Column<CandidateRow>[] = [
    {
      key: "algorithm",
      header: "Model",
      cell: (r) => (
        <div className="min-w-[12rem]">
          <p className="flex flex-wrap items-center gap-1.5 font-medium">
            {algorithmLabel(r.algorithm)}
            {r.chosen ? (
              <StatusBadge tone="good" icon={CrownIcon}>
                Selected
              </StatusBadge>
            ) : null}
            {r.baseline ? (
              <StatusBadge tone="neutral" icon={FlagIcon}>
                Best baseline
              </StatusBadge>
            ) : null}
            {r.failed ? <StatusBadge tone="danger">Failed</StatusBadge> : null}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">{r.failed ? r.failed : r.description}</p>
        </div>
      ),
    },
    { key: "family", header: "Family", cell: (r) => FAMILY_LABELS[r.family] ?? r.family },
    { key: "wape", header: "WAPE", align: "right", cell: (r) => formatPercent(r.wape), sortValue: (r) => r.wape },
    { key: "mae", header: "MAE", align: "right", cell: (r) => (isNum(r.mae) ? unitFormat(r.mae) : MISSING), sortValue: (r) => r.mae },
    { key: "rmse", header: "RMSE", align: "right", cell: (r) => (isNum(r.rmse) ? unitFormat(r.rmse) : MISSING), sortValue: (r) => r.rmse },
    { key: "mape", header: "MAPE", align: "right", cell: (r) => formatPercent(r.mape), sortValue: (r) => r.mape },
    { key: "bias", header: "Bias", align: "right", cell: (r) => (isNum(r.bias) ? formatPercent(r.bias, { signed: true }) : MISSING), sortValue: (r) => r.bias },
    { key: "folds", header: "Folds", align: "right", cell: (r) => formatNumber(r.folds ?? null) },
    { key: "fit", header: "Fit time", align: "right", cell: (r) => formatDuration(r.fit_seconds ?? null), sortValue: (r) => r.fit_seconds },
  ];
  const valid = rows.filter((r) => isNum(r.wape));
  return (
    <Panel
      title="Candidate models"
      description="Every model scored on the same rolling-origin backtests; the lowest mean WAPE wins, ties go to the simpler model"
      actions={toggle}
    >
      {view === "chart" ? (
        <BarList
          label="Backtest WAPE by candidate model (lower is better)"
          color={SERIES_COLORS[0]}
          items={valid.map((r) => ({
            key: r.algorithm,
            label: algorithmLabel(r.algorithm),
            sublabel: `${FAMILY_LABELS[r.family] ?? r.family}${r.chosen ? " · selected" : r.baseline ? " · best baseline" : ""}`,
            value: r.wape,
            display: formatPercent(r.wape),
            highlight: r.chosen,
          }))}
        />
      ) : (
        <DataTable caption="Candidate models and their backtest errors" columns={columns} rows={rows} rowKey={(r) => r.algorithm} dense />
      )}
      {rows.some((r) => r.failed) ? <p className="mt-3 text-xs text-muted-foreground">Failed candidates are listed with the reason and excluded from selection.</p> : null}
    </Panel>
  );
}

export function BacktestsPanel({ detail, currency }: { detail: ForecastDetail; currency: string }) {
  const algorithms = Array.from(new Set(detail.backtests.map((b) => b.algorithm)));
  const [compareWith, setCompareWith] = useState<string>(detail.baseline_algorithm && algorithms.includes(detail.baseline_algorithm) ? detail.baseline_algorithm : (algorithms.find((a) => a !== detail.algorithm) ?? detail.algorithm));
  const [view, toggle] = useChartView("Backtest folds");
  const unitFormat = unitFormatter(detail.unit, currency);
  const folds = Array.from(new Set(detail.backtests.map((b) => b.fold))).sort((a, b) => a - b);
  const data = folds.map((fold) => {
    const chosen = detail.backtests.find((b) => b.fold === fold && b.algorithm === detail.algorithm);
    const other = detail.backtests.find((b) => b.fold === fold && b.algorithm === compareWith);
    return { fold: `Fold ${fold}`, cutoff: chosen?.cutoff ?? other?.cutoff ?? "", chosen: chosen?.wape ?? null, other: other?.wape ?? null };
  });
  const tableRows = detail.backtests.filter((b) => b.algorithm === detail.algorithm || b.algorithm === compareWith);
  const selectId = "fc-backtest-compare";
  if (!detail.backtests.length) {
    return (
      <Panel title="Backtest folds">
        <p className="text-sm text-muted-foreground">No backtest folds are stored for this model.</p>
      </Panel>
    );
  }
  return (
    <Panel
      title="Backtest folds"
      description="WAPE on each time-ordered fold: trained only on data before the cutoff, scored on the periods after it"
      actions={
        <>
          <Label htmlFor={selectId} className="sr-only">
            Compare with
          </Label>
          <Select value={compareWith} onValueChange={setCompareWith}>
            <SelectTrigger id={selectId} size="sm" className="h-7 w-[13rem] bg-background text-[0.8125rem]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" align="end">
              {algorithms
                .filter((a) => a !== detail.algorithm)
                .map((a) => (
                  <SelectItem key={a} value={a}>
                    vs {algorithmLabel(a)}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          {toggle}
        </>
      }
    >
      {view === "chart" ? (
        <TrendChart
          ariaLabel={`Backtest WAPE by fold: ${algorithmLabel(detail.algorithm)} against ${algorithmLabel(compareWith)}`}
          data={data}
          xKey="fold"
          tooltipTitle={(v) => {
            const row = data.find((d) => d.fold === v);
            return row?.cutoff ? `${v} · cutoff ${formatDate(row.cutoff)}` : v;
          }}
          yFormat={(v) => formatPercent(v, { decimals: 0 })}
          series={[
            { key: "chosen", label: algorithmLabel(detail.algorithm), color: SERIES_COLORS[0], kind: "bar", format: (v) => formatPercent(v) },
            { key: "other", label: algorithmLabel(compareWith), color: CONTEXT_COLOR, kind: "bar", format: (v) => formatPercent(v) },
          ]}
          height={220}
        />
      ) : (
        <DataTable
          caption="Backtest folds"
          dense
          rows={tableRows}
          rowKey={(r) => `${r.algorithm}-${r.fold}`}
          defaultSort={{ key: "fold", dir: "asc" }}
          columns={[
            { key: "fold", header: "Fold", align: "right", cell: (r) => r.fold, sortValue: (r) => r.fold },
            { key: "algorithm", header: "Model", cell: (r) => algorithmLabel(r.algorithm) },
            { key: "cutoff", header: "Cutoff", cell: (r) => formatDate(r.cutoff), sortValue: (r) => r.cutoff },
            { key: "h", header: "Horizon", align: "right", cell: (r) => formatNumber(r.horizon) },
            { key: "wape", header: "WAPE", align: "right", cell: (r) => formatPercent(r.wape), sortValue: (r) => r.wape },
            { key: "mae", header: "MAE", align: "right", cell: (r) => (isNum(r.mae) ? unitFormat(r.mae) : MISSING), sortValue: (r) => r.mae },
            { key: "bias", header: "Bias", align: "right", cell: (r) => (isNum(r.bias) ? formatPercent(r.bias, { signed: true }) : MISSING) },
          ]}
        />
      )}
    </Panel>
  );
}

export function VersionsPanel({ detail, onSelect, selectedId }: { detail: ForecastDetail; onSelect: (id: string | null) => void; selectedId: string | null }) {
  return (
    <Panel title="Versions" description="Each training run is kept; the active version serves forecasts and the Decision Lab baseline">
      <DataTable
        caption="Model versions"
        dense
        rows={detail.versions}
        rowKey={(r) => r.id}
        columns={[
          { key: "v", header: "Version", align: "right", cell: (r) => `v${r.version}`, sortValue: (r) => r.version },
          { key: "a", header: "Model", cell: (r) => algorithmLabel(r.algorithm) },
          { key: "w", header: "WAPE", align: "right", cell: (r) => formatPercent(r.wape), sortValue: (r) => r.wape },
          { key: "r", header: "Reliability", cell: (r) => <ReliabilityBadge reliability={r.reliability} /> },
          { key: "t", header: "Trained through", cell: (r) => formatDate(r.training_end), sortValue: (r) => r.training_end },
          { key: "f", header: "Fingerprint", cell: (r) => <code className="font-mono text-xs">{r.data_fingerprint}</code> },
          {
            key: "s",
            header: "Status",
            cell: (r) =>
              r.is_active ? (
                <StatusBadge tone="good">Active</StatusBadge>
              ) : r.id === detail.id ? (
                <StatusBadge tone="info">Viewing</StatusBadge>
              ) : (
                <Button variant="ghost" size="xs" className="text-primary" onClick={() => onSelect(r.id)}>
                  View
                </Button>
              ),
          },
        ]}
      />
      {selectedId ? (
        <Button variant="outline" size="sm" className="mt-3" onClick={() => onSelect(null)}>
          Back to the active version
        </Button>
      ) : null}
    </Panel>
  );
}

export function MethodologyPanel({ methodology }: { methodology: Methodology }) {
  const items = [
    { label: "Validation", value: methodology.validation },
    { label: "Error metrics", value: methodology.metrics },
    { label: "Model selection", value: methodology.selection },
    { label: "Prediction intervals", value: methodology.intervals },
    { label: "Reliability", value: methodology.reliability },
  ];
  return (
    <Panel title="Methodology" description="How every model on this page is validated and chosen. No future data is used to score a forecast.">
      <dl className="space-y-3">
        {items.map((item) => (
          <div key={item.label}>
            <dt className="text-xs font-semibold text-muted-foreground">{item.label}</dt>
            <dd className="mt-0.5 text-[0.8125rem] leading-relaxed">{item.value}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}
