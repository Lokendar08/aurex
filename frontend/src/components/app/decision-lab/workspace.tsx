"use client";

import { ClipboardPlusIcon, FlaskConicalIcon, LoaderCircleIcon, RefreshCwIcon } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { StatusBadge } from "@/components/app/badges";
import { NoteList, PageHeader, Panel } from "@/components/app/page";
import { useSession } from "@/components/app/session-provider";
import { EmptyState, Notice, SkeletonBlock, TableSkeleton } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useFilterOptions } from "@/hooks/use-filter-options";
import { useFilters } from "@/hooks/use-filters";
import { useInvalidateOrg, useOrgMutation, useOrgQuery } from "@/hooks/use-org-query";
import { ApiError } from "@/lib/api";
import { errorText } from "@/lib/app/decision-lab-format";
import {
  draftFromLever,
  hasErrors,
  leverPayload,
  PRESETS,
  validateLever,
  type LeverDraft,
  type LeverErrors,
  type PresetKey,
} from "@/lib/app/decision-lab-levers";
import type {
  DecisionCatalog,
  DecisionEvidence,
  OptimizeResult,
  SavedScenario,
  ScenarioComparison,
  ScenarioDetail,
  SimulateBody,
  SimulationResult,
} from "@/lib/app/decision-lab-types";
import { formatDateTime, formatRelative } from "@/lib/app/format";
import { PERMISSIONS } from "@/lib/app/nav";

import { Builder, validateAdvanced, type AdvancedSettings } from "./builder";
import { QueryError, SyntheticBadge, toastError } from "./common";
import { ComparisonResult, CompareSelector } from "./compare";
import { LEVER_LABELS } from "./lever-editor";
import { Optimizer } from "./optimizer";
import { SimulationResults } from "./results";
import {
  DeleteScenarioDialog,
  parseTags,
  RecommendationDialog,
  RunHistory,
  ScenarioDetailsDialog,
  ScenarioList,
  type ScenarioMeta,
} from "./saved";
import { storeLabel, type Scope } from "./scope-picker";

type View = "build" | "saved" | "compare" | "optimize";

const DEFAULT_ADVANCED: AdvancedSettings = { runs: "500", discount: "12", seed: "7" };

type CurrentResult = {
  result: SimulationResult;
  /** Serialized inputs the result was computed from, to flag edits made since. */
  inputsKey: string;
  scenario?: { id: string; name: string; version: number; computedAt?: string | null };
};

function bodyFrom(scope: Scope, horizon: string, levers: LeverDraft[], advanced: AdvancedSettings): SimulateBody {
  return {
    company_id: scope.companyId,
    store_ids: scope.storeIds.length ? scope.storeIds : undefined,
    horizon_months: Number(horizon),
    levers: levers.map((l) => leverPayload(l, LEVER_LABELS[l.type])),
    monte_carlo_runs: Number(advanced.runs),
    discount_rate: Number((Number(advanced.discount) / 100).toPrecision(12)),
    seed: Number(advanced.seed),
  };
}

function keyOf(body: SimulateBody): string {
  return JSON.stringify(body);
}

function savedKey(s: ScenarioDetail): string {
  return `${s.id}:${s.version}:${s.latest_run?.id ?? ""}`;
}

/** The stored body of a saved scenario (for re-saving with new details). */
function storedBody(s: SavedScenario): SimulateBody {
  return {
    company_id: s.company_id,
    store_ids: s.store_ids ?? undefined,
    horizon_months: s.horizon_months,
    levers: s.levers,
    monte_carlo_runs: s.assumptions?.monte_carlo_runs ?? 500,
    discount_rate: s.assumptions?.discount_rate ?? 0.12,
    seed: s.assumptions?.seed ?? 7,
  };
}

function scenarioMeta(s: { name: string; description: string | null; tags: string[] } | null | undefined): ScenarioMeta {
  return { name: s?.name ?? "", description: s?.description ?? "", tags: (s?.tags ?? []).join(", ") };
}

export function DecisionLabWorkspace() {
  const { has, membership } = useSession();
  const canWrite = has(PERMISSIONS.scenariosRead) && has("scenarios:write");
  const canRecommend = has("recommendations:write");
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const filters = useFilters();
  const invalidate = useInvalidateOrg();
  const resultsRef = useRef<HTMLHeadingElement>(null);

  const requestedView = params.get("view") as View | null;
  const view: View = requestedView && (canWrite || requestedView === "saved" || requestedView === "compare") ? requestedView : canWrite ? "build" : "saved";
  const scenarioParam = params.get("scenario");

  const setParams = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  // --- builder state -------------------------------------------------------------------------
  const [scope, setScope] = useState<Scope>(() => ({ companyId: filters.companyId, storeIds: filters.storeIds }));
  const [horizon, setHorizon] = useState("12");
  const [levers, setLevers] = useState<LeverDraft[]>([]);
  const [advanced, setAdvanced] = useState<AdvancedSettings>(DEFAULT_ADVANCED);
  const [showErrors, setShowErrors] = useState(false);
  const [current, setCurrent] = useState<CurrentResult | null>(null);
  const [loaded, setLoaded] = useState<ScenarioDetail | null>(null);
  const [hydratedKey, setHydratedKey] = useState<string | null>(null);

  // --- dialogs & selections ------------------------------------------------------------------
  const [saveMode, setSaveMode] = useState<"create" | "version" | null>(null);
  const [editTarget, setEditTarget] = useState<SavedScenario | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SavedScenario | null>(null);
  const [recommendTarget, setRecommendTarget] = useState<SavedScenario | null>(null);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [comparison, setComparison] = useState<ScenarioComparison | null>(null);
  const [optimizeResult, setOptimizeResult] = useState<OptimizeResult | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // --- data ----------------------------------------------------------------------------------
  const options = useFilterOptions(scope.companyId);
  const catalog = useOrgQuery<DecisionCatalog>("/decision-lab/catalog", { staleTime: 30 * 60_000 });
  const evidence = useOrgQuery<DecisionEvidence>("/decision-lab/evidence", {
    query: { company_id: scope.companyId, store_ids: scope.storeIds.length ? scope.storeIds : undefined },
    staleTime: 10 * 60_000,
    keepPrevious: true,
    enabled: canWrite,
  });
  const s04 = options.data?.stores.find((s) => s.code === "S04") ?? null;
  const s04Evidence = useOrgQuery<DecisionEvidence>("/decision-lab/evidence", {
    query: { company_id: scope.companyId, store_ids: s04 ? [s04.id] : undefined },
    enabled: Boolean(s04) && canWrite,
    staleTime: 10 * 60_000,
  });
  const scenarios = useOrgQuery<{ scenarios: SavedScenario[] }>("/scenarios", { staleTime: 30_000 });
  const detail = useOrgQuery<ScenarioDetail>(scenarioParam ? `/scenarios/${scenarioParam}` : null, { staleTime: 30_000 });

  const currency = options.data?.companies.find((c) => c.id === (scope.companyId ?? options.data?.company_id))?.currency ?? current?.result.scope.currency ?? "INR";
  const stores = options.data?.stores ?? [];
  const scoped = options.data?.store_scoped ?? false;
  const categoryNames = useMemo(
    () => Object.fromEntries((evidence.data?.categories ?? []).map((c) => [c.code, c.name])) as Record<string, string>,
    [evidence.data],
  );

  /** Put a saved scenario into the builder and show its latest result. */
  function hydrate(saved: ScenarioDetail) {
    const drafts = saved.levers.map((l) => draftFromLever(l)).filter((d): d is LeverDraft => d !== null);
    const nextScope = { companyId: saved.company_id, storeIds: saved.store_ids ?? [] };
    const nextAdvanced: AdvancedSettings = {
      runs: String(saved.assumptions?.monte_carlo_runs ?? 500),
      discount: String(Number(((saved.assumptions?.discount_rate ?? 0.12) * 100).toPrecision(12))),
      seed: String(saved.assumptions?.seed ?? 7),
    };
    setHydratedKey(savedKey(saved));
    setLoaded(saved);
    setScope(nextScope);
    setHorizon(String(saved.horizon_months));
    setLevers(drafts);
    setAdvanced(nextAdvanced);
    setShowErrors(false);
    setCurrent(
      saved.result
        ? {
            result: saved.result,
            inputsKey: keyOf(bodyFrom(nextScope, String(saved.horizon_months), drafts, nextAdvanced)),
            scenario: { id: saved.id, name: saved.name, version: saved.version, computedAt: saved.latest_run?.computed_at },
          }
        : null,
    );
  }

  // Load a saved scenario into the builder once per version and run (derived state, no effect).
  const detailData = detail.data;
  if (canWrite && detailData && savedKey(detailData) !== hydratedKey) hydrate(detailData);

  // --- validation ----------------------------------------------------------------------------
  const leverErrors = useMemo(() => Object.fromEntries(levers.map((l) => [l.uid, validateLever(l)])) as Record<string, LeverErrors>, [levers]);
  const advancedErrors = validateAdvanced(advanced);
  const invalid = levers.some((l) => hasErrors(leverErrors[l.uid])) || Object.keys(advancedErrors).length > 0;
  const body = bodyFrom(scope, horizon, levers, advanced);
  const stale = current ? current.inputsKey !== keyOf(body) : false;

  // --- mutations -----------------------------------------------------------------------------
  const simulate = useOrgMutation<SimulateBody, SimulationResult>((vars, call) => call("/decision-lab/simulate", { json: vars }));
  const createScenario = useOrgMutation<SimulateBody & { name: string; description?: string; tags: string[] }, ScenarioDetail>((vars, call) =>
    call("/scenarios", { json: vars }),
  );
  const updateScenario = useOrgMutation<{ id: string; body: SimulateBody & { name: string; description?: string; tags: string[] } }, ScenarioDetail>(
    ({ id, body: payload }, call) => call(`/scenarios/${id}`, { method: "PUT", json: payload }),
  );
  const rerun = useOrgMutation<string, ScenarioDetail>((id, call) => call(`/scenarios/${id}/run`, { method: "POST" }));
  const remove = useOrgMutation<string, void>((id, call) => call(`/scenarios/${id}`, { method: "DELETE" }));
  const recommend = useOrgMutation<{ id: string; title?: string; summary?: string }, { id: string; title: string }>(({ id, ...input }, call) =>
    call(`/scenarios/${id}/recommendation`, { json: input }),
  );
  const compare = useOrgMutation<string[], ScenarioComparison>((ids, call) => call("/scenarios/compare", { json: { scenario_ids: ids } }));
  const optimize = useOrgMutation<Record<string, unknown>, OptimizeResult>((vars, call) => call("/decision-lab/optimize", { json: vars }));

  function focusResults() {
    window.setTimeout(() => {
      resultsRef.current?.focus({ preventScroll: true });
      resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  }

  function run(runBody: SimulateBody, after?: (result: SimulationResult) => void) {
    simulate.mutate(runBody, {
      onSuccess: (result) => {
        setCurrent({ result, inputsKey: keyOf(runBody) });
        after?.(result);
        focusResults();
      },
      onError: (error) => toastError(error, "The simulation didn't run"),
    });
  }

  function onRun() {
    setShowErrors(true);
    if (!levers.length) {
      toast.error("Add at least one lever, or start from a quick-start scenario.");
      return;
    }
    if (invalid) {
      toast.error("Fix the highlighted fields first.");
      return;
    }
    run(body);
  }

  function onPreset(key: PresetKey) {
    const preset = PRESETS.find((p) => p.key === key);
    if (!preset) return;
    const context = { headcount: s04Evidence.data?.workforce?.headcount ?? null };
    const drafts = preset.levers(context);
    let nextScope = scope;
    if (preset.storeCode) {
      const store = stores.find((s) => s.code === preset.storeCode);
      if (!store) {
        toast.error(`${preset.storeCode} is not one of your stores.`);
        return;
      }
      nextScope = { companyId: scope.companyId, storeIds: [store.id] };
    }
    setScope(nextScope);
    setLevers(drafts);
    setShowErrors(false);
    setLoaded(null);
    if (scenarioParam) setParams({ scenario: null });
    run(bodyFrom(nextScope, horizon, drafts, advanced));
  }

  function adoptSaved(saved: ScenarioDetail, message: string) {
    hydrate(saved);
    setParams({ scenario: saved.id, view: "build" });
    void invalidate("/scenarios");
    toast.success(message);
    focusResults();
  }

  function onSaveSubmit(meta: ScenarioMeta) {
    const payload = { ...body, name: meta.name, description: meta.description.trim() || undefined, tags: parseTags(meta.tags) };
    if (saveMode === "version" && loaded) {
      updateScenario.mutate(
        { id: loaded.id, body: payload },
        {
          onSuccess: (saved) => {
            setSaveMode(null);
            adoptSaved(saved, `Saved “${saved.name}” as version ${saved.version}`);
          },
        },
      );
    } else {
      createScenario.mutate(payload, {
        onSuccess: (saved) => {
          setSaveMode(null);
          adoptSaved(saved, `Saved “${saved.name}”`);
        },
      });
    }
  }

  function onEditSubmit(meta: ScenarioMeta) {
    if (!editTarget) return;
    const target = editTarget;
    updateScenario.mutate(
      { id: target.id, body: { ...storedBody(target), name: meta.name, description: meta.description.trim() || undefined, tags: parseTags(meta.tags) } },
      {
        onSuccess: (saved) => {
          setEditTarget(null);
          // Also refreshes the open scenario, which then reloads into the builder as the new version.
          void invalidate("/scenarios");
          toast.success(`Saved “${saved.name}” as version ${saved.version}`);
        },
      },
    );
  }

  function onRerun(s: SavedScenario) {
    setBusyId(s.id);
    rerun.mutate(s.id, {
      onSuccess: (saved) => {
        void invalidate("/scenarios");
        if (loaded?.id === saved.id || scenarioParam === saved.id) adoptSaved(saved, `Re-ran “${saved.name}” with the latest data`);
        else toast.success(`Re-ran “${saved.name}” with the latest data`);
      },
      onError: (error) => toastError(error, "The scenario didn't re-run"),
      onSettled: () => setBusyId(null),
    });
  }

  function onDeleteConfirm() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    remove.mutate(target.id, {
      onSuccess: () => {
        setDeleteTarget(null);
        setCompareIds((ids) => ids.filter((id) => id !== target.id));
        void invalidate("/scenarios");
        if (loaded?.id === target.id || scenarioParam === target.id) {
          setLoaded(null);
          setCurrent(null);
          setParams({ scenario: null });
        }
        toast.success(`Deleted “${target.name}”`);
      },
      onError: (error) => toastError(error, "The scenario wasn't deleted"),
    });
  }

  function onRecommendSubmit(input: { title?: string; summary?: string }) {
    if (!recommendTarget) return;
    recommend.mutate(
      { id: recommendTarget.id, ...input },
      {
        onSuccess: (rec) => {
          setRecommendTarget(null);
          void invalidate("/recommendations", "/workflows");
          toast.success("Recommendation created", {
            description: rec.title,
            action: { label: "Open", onClick: () => router.push(`/app/workflows/recommendations/${rec.id}`) },
          });
        },
      },
    );
  }

  function onCompare(ids: string[]) {
    compare.mutate(ids, {
      onSuccess: (data) => setComparison(data),
      onError: (error) => toastError(error, "The comparison failed"),
    });
  }

  function openRecommend(s: SavedScenario | ScenarioDetail | null | undefined) {
    if (!s) return;
    recommend.reset();
    setRecommendTarget(s);
  }

  function openScenario(s: SavedScenario) {
    setParams({ scenario: s.id, view: canWrite ? "build" : "saved" });
    if (s.id === scenarioParam) void detail.refetch();
  }

  const scenarioList = scenarios.data?.scenarios ?? [];
  const scopeText = (ids: string[] | null | undefined) => storeLabel(stores, ids ?? [], scoped);
  const presetStores = { S04: options.data ? (s04?.id ?? null) : undefined } as Record<string, string | null>;
  const engineVersion = catalog.data?.engine_version;
  const saving = createScenario.isPending || updateScenario.isPending;

  const listProps = {
    currency,
    stores,
    scoped,
    canWrite,
    canRecommend,
    selectedIds: compareIds,
    onSelectionChange: setCompareIds,
    onOpen: openScenario,
    onRerun,
    onEdit: (s: SavedScenario) => {
      updateScenario.reset();
      setEditTarget(s);
    },
    onDelete: (s: SavedScenario) => setDeleteTarget(s),
    onRecommend: (s: SavedScenario) => openRecommend(s),
    busyId,
    activeId: loaded?.id ?? scenarioParam,
  };

  const resultHeader = current ? (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 ref={resultsRef} tabIndex={-1} className="scroll-mt-24 font-display text-lg font-semibold tracking-[-0.015em] outline-none">
          {current.scenario ? current.scenario.name : "Simulation result"}
        </h2>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          {current.scenario ? (
            <>
              <StatusBadge tone="info">Saved · v{current.scenario.version}</StatusBadge>
              {current.scenario.computedAt ? <span>Computed {formatRelative(current.scenario.computedAt)} ({formatDateTime(current.scenario.computedAt)})</span> : null}
            </>
          ) : (
            <span>Not saved yet</span>
          )}
          <span>· {current.result.levers.length} lever{current.result.levers.length === 1 ? "" : "s"}</span>
        </p>
      </div>
      {current.scenario ? (
        <div className="flex flex-wrap gap-2">
          {canWrite ? (
            <Button
              variant="outline"
              size="sm"
              disabled={busyId === current.scenario.id}
              onClick={() => {
                const s = scenarioList.find((x) => x.id === current.scenario?.id) ?? loaded;
                if (s) onRerun(s);
              }}
            >
              {busyId === current.scenario.id ? <LoaderCircleIcon className="animate-spin" aria-hidden /> : <RefreshCwIcon aria-hidden />}
              Re-run
            </Button>
          ) : null}
          {canRecommend ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => openRecommend(scenarioList.find((x) => x.id === current.scenario?.id) ?? loaded)}
            >
              <ClipboardPlusIcon aria-hidden />
              Create recommendation
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  ) : null;

  const principles = (
    <Panel
      title="How the engine works"
      description={engineVersion ? `Simulation engine ${engineVersion}` : undefined}
      footer="Every result lists its evidence, assumptions and warnings, and can be reproduced from its inputs hash."
    >
      {catalog.isPending ? (
        <div className="space-y-2">
          <SkeletonBlock className="h-4 w-full" />
          <SkeletonBlock className="h-4 w-5/6" />
          <SkeletonBlock className="h-4 w-4/6" />
        </div>
      ) : catalog.data ? (
        <NoteList notes={catalog.data.principles} className="text-sm text-foreground/85" />
      ) : (
        <QueryError compact error={catalog.error} onRetry={() => void catalog.refetch()} />
      )}
    </Panel>
  );

  return (
    <>
      <PageHeader
        title="Decision Lab"
        description="Test a decision before you make it: the engine applies known costs exactly, estimates behavioural effects from your own data, and shows the range of outcomes."
        meta={
          <>
            {engineVersion ? <span>Engine {engineVersion}</span> : null}
            {membership?.is_demo || options.data?.companies.some((c) => c.is_synthetic) ? <SyntheticBadge /> : null}
            {!canWrite ? <StatusBadge>View only</StatusBadge> : null}
          </>
        }
      />
      <p className="sr-only" aria-live="polite">
        {simulate.isPending ? "Running the simulation" : current ? `Result ready: net profit change computed for ${current.result.horizon_months} months` : ""}
      </p>

      <Tabs value={view} onValueChange={(value) => setParams({ view: value })} className="gap-5">
        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <TabsList aria-label="Decision Lab sections">
            {canWrite ? <TabsTrigger value="build">Build and simulate</TabsTrigger> : null}
            <TabsTrigger value="saved">
              Saved scenarios{scenarioList.length ? <span className="text-muted-foreground tabular">{scenarioList.length}</span> : null}
            </TabsTrigger>
            <TabsTrigger value="compare">Compare</TabsTrigger>
            {canWrite ? <TabsTrigger value="optimize">Goal optimizer</TabsTrigger> : null}
          </TabsList>
        </div>

        {canWrite ? (
          <TabsContent value="build">
            <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,25rem)_minmax(0,1fr)]">
              <div className="min-w-0">
                {evidence.error instanceof ApiError && evidence.error.code === "no_data" ? (
                  <Notice tone="warning" className="mb-4" title="No data for this scope">
                    {evidence.error.message}. Choose other stores or connect data in the Integration Hub.
                  </Notice>
                ) : null}
                <Builder
                  scope={scope}
                  onScopeChange={setScope}
                  filterOptions={options.data}
                  horizon={horizon}
                  onHorizonChange={setHorizon}
                  levers={levers}
                  onLeversChange={setLevers}
                  errors={leverErrors}
                  showErrors={showErrors}
                  advanced={advanced}
                  onAdvancedChange={setAdvanced}
                  advancedErrors={showErrors ? advancedErrors : {}}
                  catalog={catalog.data?.levers ?? []}
                  evidence={evidence.data}
                  currency={currency}
                  presetContext={{ headcount: s04Evidence.data?.workforce?.headcount ?? null }}
                  presetStores={presetStores}
                  onPreset={onPreset}
                  onRun={onRun}
                  onSave={() => {
                    setShowErrors(true);
                    if (invalid) {
                      toast.error("Fix the highlighted fields first.");
                      return;
                    }
                    createScenario.reset();
                    updateScenario.reset();
                    setSaveMode(loaded ? "version" : "create");
                  }}
                  onReset={() => {
                    setLevers([]);
                    setCurrent(null);
                    setLoaded(null);
                    setShowErrors(false);
                    setAdvanced(DEFAULT_ADVANCED);
                    setHorizon("12");
                    setScope({ companyId: filters.companyId, storeIds: filters.storeIds });
                    if (scenarioParam) setParams({ scenario: null });
                  }}
                  running={simulate.isPending}
                  runError={simulate.error ? errorText(simulate.error) : null}
                  editingName={loaded?.name ?? null}
                  canRun={canWrite}
                />
              </div>
              <div className="min-w-0 space-y-4">
                {scenarioParam && detail.isPending && !current ? (
                  <div className="space-y-4" aria-busy="true">
                    <SkeletonBlock className="h-56 w-full rounded-2xl" />
                    <TableSkeleton rows={4} columns={3} />
                  </div>
                ) : scenarioParam && detail.error && !current ? (
                  <Panel>
                    <QueryError error={detail.error} onRetry={() => void detail.refetch()} />
                  </Panel>
                ) : current ? (
                  <>
                    {stale ? (
                      <Notice tone="warning" title="The inputs changed since this result">
                        Run the simulation again to update it{current.scenario ? ", or save a new version" : ""}.
                      </Notice>
                    ) : null}
                    <div className={simulate.isPending ? "opacity-55 transition-opacity" : "transition-opacity"}>
                      <SimulationResults
                        result={current.result}
                        scopeLabel={scopeText(current.result.scope.store_ids)}
                        categories={categoryNames}
                        engineVersion={engineVersion}
                        title={resultHeader}
                      />
                    </div>
                    {loaded && current.scenario?.id === loaded.id ? (
                      <Panel title="Version history" description="Every run of this scenario, newest first">
                        <RunHistory detail={loaded} currency={currency} />
                      </Panel>
                    ) : null}
                    {principles}
                  </>
                ) : simulate.isPending ? (
                  <div className="space-y-4" aria-busy="true">
                    <SkeletonBlock className="h-56 w-full rounded-2xl" />
                    <div className="grid gap-4 xl:grid-cols-2">
                      <SkeletonBlock className="h-64" />
                      <SkeletonBlock className="h-64" />
                    </div>
                  </div>
                ) : (
                  <>
                    <Panel>
                      <EmptyState
                        icon={FlaskConicalIcon}
                        title="Run a simulation to see the outcome"
                        description="Pick a quick-start scenario or add levers, then run. Results show the change against the forecast baseline with its P10–P90 range, cash and payback, what drives the uncertainty, and every assumption."
                      />
                    </Panel>
                    {principles}
                  </>
                )}
              </div>
            </div>
          </TabsContent>
        ) : null}

        <TabsContent value="saved" className="space-y-6">
          <Panel
            title="Saved scenarios"
            description={canWrite ? "Open one to see its latest result or edit it as a new version. Select two to six to compare." : "Read-only: open a scenario to see its latest result. Select two to six to compare."}
            actions={
              compareIds.length >= 2 ? (
                <Button
                  size="sm"
                  onClick={() => {
                    setParams({ view: "compare" });
                    onCompare(compareIds);
                  }}
                >
                  Compare {compareIds.length} selected
                </Button>
              ) : undefined
            }
            contentClassName="px-0 pb-0 sm:px-0"
          >
            {scenarios.isPending ? (
              <div className="px-4 pb-5 sm:px-5">
                <TableSkeleton rows={4} columns={3} />
              </div>
            ) : scenarios.error ? (
              <div className="px-4 pb-5 sm:px-5">
                <QueryError error={scenarios.error} onRetry={() => void scenarios.refetch()} />
              </div>
            ) : (
              <div className="border-t">
                <ScenarioList scenarios={scenarioList} {...listProps} />
              </div>
            )}
          </Panel>
          {!canWrite && scenarioParam ? (
            detail.isPending ? (
              <SkeletonBlock className="h-56 w-full rounded-2xl" />
            ) : detail.error ? (
              <Panel>
                <QueryError error={detail.error} onRetry={() => void detail.refetch()} />
              </Panel>
            ) : detail.data?.result ? (
              <div className="space-y-6">
                <SimulationResults
                  result={detail.data.result}
                  scopeLabel={scopeText(detail.data.result.scope.store_ids)}
                  categories={categoryNames}
                  engineVersion={engineVersion}
                  title={
                    <div>
                      <h2 ref={resultsRef} tabIndex={-1} className="scroll-mt-24 font-display text-lg font-semibold tracking-[-0.015em] outline-none">
                        {detail.data.name}
                      </h2>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        Version {detail.data.version}
                        {detail.data.latest_run ? ` · computed ${formatDateTime(detail.data.latest_run.computed_at)}` : ""}
                      </p>
                    </div>
                  }
                />
                <Panel title="Version history">
                  <RunHistory detail={detail.data} currency={currency} />
                </Panel>
              </div>
            ) : (
              <Panel>
                <EmptyState compact title="This scenario has not been computed yet" />
              </Panel>
            )
          ) : null}
        </TabsContent>

        <TabsContent value="compare" className="space-y-6">
          {scenarios.isPending ? (
            <TableSkeleton rows={3} columns={3} />
          ) : scenarios.error ? (
            <Panel>
              <QueryError error={scenarios.error} onRetry={() => void scenarios.refetch()} />
            </Panel>
          ) : (
            <CompareSelector
              scenarios={scenarioList}
              selectedIds={compareIds}
              onSelectionChange={setCompareIds}
              onCompare={() => onCompare(compareIds)}
              comparing={compare.isPending}
            />
          )}
          {compare.isPending ? (
            <SkeletonBlock className="h-48 w-full rounded-xl" />
          ) : compare.error ? (
            <Panel>
              <QueryError error={compare.error} onRetry={() => onCompare(compareIds)} />
            </Panel>
          ) : comparison ? (
            <ComparisonResult data={comparison} currency={currency} />
          ) : null}
        </TabsContent>

        {canWrite ? (
          <TabsContent value="optimize">
            <Optimizer
              levers={levers}
              currency={currency}
              running={optimize.isPending}
              error={optimize.error}
              result={optimizeResult}
              onRun={(input) =>
                optimize.mutate(
                  {
                    company_id: scope.companyId,
                    store_ids: scope.storeIds.length ? scope.storeIds : undefined,
                    horizon_months: Number(horizon),
                    ...input,
                  },
                  { onSuccess: (data) => setOptimizeResult(data) },
                )
              }
              onApply={(best) => {
                const drafts = best
                  .map((l, i) => {
                    const draft = draftFromLever(l);
                    return draft ? { ...draft, uid: levers[i]?.uid ?? draft.uid } : null;
                  })
                  .filter((d): d is LeverDraft => d !== null);
                setLevers(drafts);
                setParams({ view: "build" });
                run(bodyFrom(scope, horizon, drafts, advanced));
              }}
            />
            <div className="mt-6">
              <Notice title="About the optimizer">
                The optimizer searches the ranges you choose exhaustively, so the best value is the best on that grid, within the model and its
                assumptions. Check the chosen scenario&apos;s evidence and warnings before acting on it.
              </Notice>
            </div>
          </TabsContent>
        ) : null}
      </Tabs>

      <ScenarioDetailsDialog
        open={saveMode !== null}
        onOpenChange={(open) => {
          if (!open) setSaveMode(null);
        }}
        mode={saveMode ?? "create"}
        initial={saveMode === "version" ? scenarioMeta(loaded) : { name: levers.length === 1 ? levers[0].label || LEVER_LABELS[levers[0].type] : "", description: "", tags: "" }}
        version={loaded?.version}
        submitting={saving}
        error={saveMode ? (createScenario.error ?? updateScenario.error) : null}
        onSubmit={onSaveSubmit}
      />
      <ScenarioDetailsDialog
        open={editTarget !== null}
        onOpenChange={(open) => {
          if (!open) setEditTarget(null);
        }}
        mode="edit"
        initial={scenarioMeta(editTarget)}
        version={editTarget?.version}
        submitting={updateScenario.isPending}
        error={editTarget ? updateScenario.error : null}
        onSubmit={onEditSubmit}
      />
      <DeleteScenarioDialog scenario={deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)} onConfirm={onDeleteConfirm} submitting={remove.isPending} />
      <RecommendationDialog
        scenario={recommendTarget}
        onOpenChange={(open) => !open && setRecommendTarget(null)}
        onSubmit={onRecommendSubmit}
        submitting={recommend.isPending}
        error={recommendTarget ? recommend.error : null}
      />
    </>
  );
}
