"use client";

import { TrendingUpIcon } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";

import { useChartView } from "@/components/app/charts/chart-parts";
import { DataTable } from "@/components/app/data-table";
import { NoteList, PageHeader, Panel, SectionHeading } from "@/components/app/page";
import { useSession } from "@/components/app/session-provider";
import { ChartSkeleton, EmptyState, SkeletonBlock, TableSkeleton } from "@/components/app/states";
import { QueryError, ReliabilityBadge, SyntheticBadge } from "@/components/app/decision-lab/common";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useFilterOptions } from "@/hooks/use-filter-options";
import { useOrgQuery } from "@/hooks/use-org-query";
import { ApiError } from "@/lib/api";
import { formatDate, formatNumber, formatPercent, MISSING } from "@/lib/app/format";
import { algorithmLabel, buildSeries, FREQUENCY_LABELS, LEVEL_LABELS, type Granularity } from "@/lib/app/forecasts-series";
import type { ForecastDetail, ForecastModel, ForecastsResponse, ForecastTarget } from "@/lib/app/forecasts-types";
import { PERMISSIONS } from "@/lib/app/nav";

import { BaselinePanel } from "./baseline-panel";
import { ForecastChart, periodLabel, periodOf, unitFormatter } from "./forecast-chart";
import { BacktestsPanel, CandidatesPanel, MethodologyPanel, ModelCard, VersionsPanel } from "./model-panels";
import { TrainButton, TrainingStatus, useTraining } from "./training";

const HISTORY_PERIODS: Record<string, number> = { D: 730, W: 156, M: 36 };
const NATIVE_WINDOW: Record<string, number> = { D: 120, W: 104, M: 36 };

function useParamsState() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const set = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v) next.set(k, v);
        else next.delete(k);
      }
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );
  return { params, set };
}

type KeyOption = { value: string; label: string; trained: boolean };

function keyOptions(target: ForecastTarget, level: string, models: ForecastModel[], stores: { id: string; code: string; name: string }[]): KeyOption[] {
  const trained = models.filter((m) => m.target === target.key && m.level === level);
  if (level === "company") return [{ value: "all", label: "Whole company", trained: trained.some((m) => m.level_key === "all") }];
  const options = new Map<string, KeyOption>();
  if (level === "store") {
    for (const s of stores) options.set(s.id, { value: s.id, label: `${s.code} · ${s.name}`, trained: false });
  } else {
    for (const m of models.filter((x) => x.level === "category")) options.set(m.level_key, { value: m.level_key, label: m.level_label, trained: false });
  }
  for (const m of trained) options.set(m.level_key, { value: m.level_key, label: m.level_label, trained: true });
  return Array.from(options.values()).sort((a, b) => a.label.localeCompare(b.label));
}

function ForecastPanel({ detail, currency, granularity, onGranularity }: { detail: ForecastDetail; currency: string; granularity: Granularity; onGranularity: (g: Granularity) => void }) {
  const [view, toggle] = useChartView("Forecast");
  const effective: Granularity = detail.frequency === "D" ? granularity : "native";
  const series = useMemo(() => buildSeries(detail, effective, NATIVE_WINDOW[detail.frequency] ?? 120), [detail, effective]);
  const period = periodOf(detail.frequency, effective);
  const format = unitFormatter(detail.unit, currency);
  const formatFull = unitFormatter(detail.unit, currency, false);
  const lastActual = detail.history[detail.history.length - 1]?.period_start;
  const horizonEnd = detail.forecast[detail.forecast.length - 1]?.period_start;
  return (
    <Panel
      title={`${detail.target_label}: ${detail.level_label}`}
      description={`Actuals to ${formatDate(lastActual)} and forecast to ${formatDate(horizonEnd)}, with 80% and 95% intervals`}
      actions={
        <>
          {detail.frequency === "D" ? (
            <ToggleGroup
              type="single"
              size="sm"
              variant="outline"
              spacing={0}
              value={effective}
              onValueChange={(value) => value && onGranularity(value as Granularity)}
              aria-label="Aggregate the daily series"
            >
              <ToggleGroupItem value="native">Daily</ToggleGroupItem>
              <ToggleGroupItem value="week">Weekly</ToggleGroupItem>
              <ToggleGroupItem value="month">Monthly</ToggleGroupItem>
            </ToggleGroup>
          ) : null}
          {toggle}
        </>
      }
      footer={
        <NoteList
          notes={[
            effective === "native" && detail.frequency === "D"
              ? `Showing the last ${NATIVE_WINDOW.D} days of actuals; switch to weekly or monthly for the longer history.`
              : null,
            ...series.notes,
          ].filter((n): n is string => Boolean(n))}
        />
      }
    >
      {view === "chart" ? (
        <ForecastChart
          ariaLabel={`${detail.target_label} for ${detail.level_label}: actuals and forecast`}
          points={series.points}
          unit={detail.unit}
          currency={currency}
          period={period}
          forecastStart={series.forecastStart}
        />
      ) : (
        <DataTable
          caption={`${detail.target_label} for ${detail.level_label}`}
          dense
          maxHeight={380}
          rows={series.points}
          rowKey={(r) => r.period}
          defaultSort={{ key: "period", dir: "desc" }}
          columns={[
            { key: "period", header: "Period", cell: (r) => periodLabel(r.period, period), sortValue: (r) => r.period },
            {
              key: "actual",
              header: "Actual",
              align: "right",
              cell: (r) => (r.actual !== null ? formatFull(r.actual) : r.blended && typeof r.actualPart === "number" ? `${format(r.actualPart)} so far` : MISSING),
            },
            { key: "yhat", header: "Forecast", align: "right", cell: (r) => (r.actual === null && r.yhat !== null ? formatFull(r.yhat) : MISSING) },
            { key: "b80", header: "80% interval", align: "right", cell: (r) => (r.actual === null && r.band80 ? `${format(r.band80[0])} – ${format(r.band80[1])}` : MISSING) },
            { key: "b95", header: "95% interval", align: "right", cell: (r) => (r.actual === null && r.band95 ? `${format(r.band95[0])} – ${format(r.band95[1])}` : MISSING) },
          ]}
        />
      )}
    </Panel>
  );
}

function ModelsOverview({ models, onSelect, activeId }: { models: ForecastModel[]; onSelect: (m: ForecastModel) => void; activeId?: string }) {
  return (
    <Panel title="All forecast models" description="Active version of every trained series you can see">
      <DataTable
        caption="Active forecast models"
        dense
        pageSize={12}
        rows={models}
        rowKey={(r) => r.id}
        defaultSort={{ key: "target", dir: "asc" }}
        rowClassName={(r) => (r.id === activeId ? "bg-brand-50/60 dark:bg-brand-800/15" : undefined)}
        columns={[
          { key: "target", header: "Target", cell: (r) => r.target_label, sortValue: (r) => r.target_label },
          { key: "series", header: "Series", cell: (r) => r.level_label, sortValue: (r) => r.level_label },
          { key: "freq", header: "Frequency", cell: (r) => FREQUENCY_LABELS[r.frequency] ?? r.frequency },
          { key: "algo", header: "Model", cell: (r) => algorithmLabel(r.algorithm) },
          { key: "wape", header: "WAPE", align: "right", cell: (r) => formatPercent(r.metrics.wape), sortValue: (r) => r.metrics.wape },
          { key: "skill", header: "vs baseline", align: "right", cell: (r) => (r.skill_vs_baseline === null ? MISSING : formatPercent(r.skill_vs_baseline, { signed: true })), sortValue: (r) => r.skill_vs_baseline },
          { key: "rel", header: "Reliability", cell: (r) => <ReliabilityBadge reliability={r.reliability} /> },
          {
            key: "open",
            header: <span className="sr-only">Open</span>,
            label: "Open",
            cell: (r) =>
              r.id === activeId ? (
                <span className="text-xs text-muted-foreground">Showing</span>
              ) : (
                <Button variant="ghost" size="xs" className="text-primary" onClick={() => onSelect(r)}>
                  Open
                </Button>
              ),
          },
        ]}
      />
    </Panel>
  );
}

export function ForecastsView() {
  const { has } = useSession();
  const { params, set } = useParamsState();
  const list = useOrgQuery<ForecastsResponse>("/forecasts", { staleTime: 5 * 60_000 });
  const options = useFilterOptions();
  const data = list.data;
  const training = useTraining(data?.company_id, data?.recent_jobs);
  const currency = options.data?.companies.find((c) => c.id === (data?.company_id ?? options.data?.company_id))?.currency ?? "INR";

  const models = useMemo(() => data?.models ?? [], [data]);
  const targets = useMemo(() => data?.targets ?? [], [data]);
  const preferred = models.find((m) => m.target === "net_sales" && m.level === "company") ?? models[0];
  const targetKey = params.get("target") ?? preferred?.target ?? targets[0]?.key ?? "net_sales";
  const target = targets.find((t) => t.key === targetKey) ?? targets[0];
  const levelParam = params.get("level");
  const firstTrainedLevel = target ? target.levels.find((l) => models.some((m) => m.target === target.key && m.level === l)) : undefined;
  const level = levelParam && target?.levels.includes(levelParam) ? levelParam : (firstTrainedLevel ?? target?.levels[0] ?? "company");
  const keys = target ? keyOptions(target, level, models, options.data?.stores ?? []) : [];
  const keyParam = params.get("key");
  const key = keyParam && keys.some((k) => k.value === keyParam) ? keyParam : (keys.find((k) => k.trained)?.value ?? keys[0]?.value ?? "all");
  const modelId = params.get("model");
  const granularity = (params.get("gran") as Granularity | null) ?? "native";

  const detail = useOrgQuery<ForecastDetail>(target ? (modelId ? `/forecasts/models/${modelId}` : "/forecasts/active") : null, {
    query: modelId
      ? { history_periods: HISTORY_PERIODS[target?.frequency ?? "D"] }
      : { target: target?.key, level, key, company_id: data?.company_id, history_periods: HISTORY_PERIODS[target?.frequency ?? "D"] },
    enabled: Boolean(data && target),
    keepPrevious: true,
    retry: false,
    staleTime: 5 * 60_000,
  });
  const notTrained = detail.error instanceof ApiError && (detail.error.code === "not_trained" || detail.error.status === 404);
  const shown = detail.data;

  const header = (
    <PageHeader
      title="Forecasts"
      description="Validated forecasts for sales, transactions, demand, operating expenses and inventory, each with its error on time-ordered backtests and an honest reliability verdict."
      actions={<TrainButton training={training} />}
      meta={
        <>
          {data?.is_synthetic ? <SyntheticBadge /> : null}
          {data ? <span>{formatNumber(models.length)} active models</span> : null}
          <TrainingStatus training={training} recent={data?.recent_jobs} />
        </>
      }
    />
  );

  if (list.isPending) {
    return (
      <>
        {header}
        <div className="space-y-6" aria-busy="true">
          <SkeletonBlock className="h-10 w-full max-w-2xl" />
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <Panel>
              <ChartSkeleton height={300} />
            </Panel>
            <Panel>
              <TableSkeleton rows={6} columns={2} />
            </Panel>
          </div>
        </div>
      </>
    );
  }
  if (list.error || !data) {
    return (
      <>
        {header}
        <Panel>
          <QueryError error={list.error} onRetry={() => void list.refetch()} />
        </Panel>
      </>
    );
  }
  if (!models.length) {
    return (
      <>
        {header}
        <Panel>
          <EmptyState
            icon={TrendingUpIcon}
            title="No forecast models are trained yet"
            description={
              training.allowed
                ? "Training validates several models per series on rolling-origin backtests and keeps the most accurate one."
                : (training.reason ?? "Ask an analyst or finance manager to train the forecast models.")
            }
            action={<TrainButton training={training} label="Train forecast models" />}
          />
        </Panel>
      </>
    );
  }

  const selectClass = "w-full bg-background sm:w-auto sm:min-w-[12rem]";
  return (
    <>
      {header}
      <div className="space-y-6">
        <div className="flex flex-wrap items-end gap-3" role="group" aria-label="Choose a forecast">
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="fc-target">Target</Label>
            <Select value={target?.key} onValueChange={(value) => set({ target: value, level: null, key: null, model: null })}>
              <SelectTrigger id="fc-target" className={selectClass}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                {targets.map((t) => (
                  <SelectItem key={t.key} value={t.key}>
                    {t.label} · {FREQUENCY_LABELS[t.frequency] ?? t.frequency}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="fc-level">Level</Label>
            <Select value={level} onValueChange={(value) => set({ level: value, key: null, model: null })}>
              <SelectTrigger id="fc-level" className={selectClass}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                {(target?.levels ?? []).map((l) => (
                  <SelectItem key={l} value={l}>
                    {LEVEL_LABELS[l] ?? l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="fc-key">Series</Label>
            <Select value={key} onValueChange={(value) => set({ key: value, model: null })} disabled={keys.length <= 1}>
              <SelectTrigger id="fc-key" className={selectClass}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                {keys.map((k) => (
                  <SelectItem key={k.value} value={k.value}>
                    {k.label}
                    {k.trained ? "" : " (not trained)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {target ? (
            <p className="pb-1.5 text-xs text-muted-foreground">
              Horizon {formatNumber(target.horizon)} {target.frequency === "D" ? "days" : target.frequency === "W" ? "weeks" : "months"} · scored on{" "}
              {formatNumber(target.folds)} folds of {formatNumber(target.evaluation_horizon)}
            </p>
          ) : null}
        </div>

        {modelId && detail.data && !detail.data.is_active ? (
          <p className="rounded-lg bg-warning/12 px-3.5 py-2.5 text-sm ring-1 ring-warning/30">
            You are viewing version {detail.data.version}, which is not the active version.{" "}
            <button type="button" className="font-medium text-primary underline-offset-3 hover:underline" onClick={() => set({ model: null })}>
              Back to the active version
            </button>
          </p>
        ) : null}

        {detail.isPending && !detail.data ? (
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]" aria-busy="true">
            <Panel>
              <ChartSkeleton height={300} />
            </Panel>
            <Panel>
              <TableSkeleton rows={6} columns={2} />
            </Panel>
          </div>
        ) : notTrained ? (
          <Panel>
            <EmptyState
              icon={TrendingUpIcon}
              title={`No trained forecast for ${keys.find((k) => k.value === key)?.label ?? "this series"} yet`}
              description={
                training.allowed
                  ? "This series has no validated model. Training builds and backtests one; until then no forecast is shown."
                  : `This series has no validated model, so no forecast is shown. ${training.reason ?? ""}`
              }
              action={<TrainButton training={training} label="Train forecast models" targets={target ? [target.key] : undefined} />}
            />
          </Panel>
        ) : detail.error || !shown ? (
          <Panel>
            <QueryError error={detail.error} onRetry={() => void detail.refetch()} />
          </Panel>
        ) : (
          <div className={detail.isPlaceholderData ? "space-y-6 opacity-55 transition-opacity" : "space-y-6 transition-opacity"}>
            <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
              <div className="min-w-0 space-y-6">
                <ForecastPanel detail={shown} currency={currency} granularity={granularity} onGranularity={(g) => set({ gran: g === "native" ? null : g })} />
                <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                  <CandidatesPanel model={shown} currency={currency} />
                  <BacktestsPanel detail={shown} currency={currency} />
                </div>
              </div>
              <div className="min-w-0 space-y-6">
                <ModelCard model={shown} methodology={data.methodology} currency={currency} />
              </div>
            </div>
            <div className="grid gap-6 xl:grid-cols-2">
              <VersionsPanel detail={shown} selectedId={modelId} onSelect={(id) => set({ model: id })} />
              <MethodologyPanel methodology={data.methodology} />
            </div>
          </div>
        )}

        <SectionHeading title="Baseline outlook" description="The forecast turned into a monthly P&L, used as the Decision Lab baseline" />
        <BaselinePanel companyId={data.company_id} canSee={has(PERMISSIONS.financeRead)} />

        <ModelsOverview
          models={models}
          activeId={shown?.id}
          onSelect={(m) => set({ target: m.target, level: m.level, key: m.level_key, model: null })}
        />
      </div>
    </>
  );
}
