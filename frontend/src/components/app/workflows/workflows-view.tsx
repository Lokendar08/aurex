"use client";

import { ClipboardListIcon, LoaderCircleIcon, PlusIcon, SparklesIcon, StampIcon, ThumbsDownIcon, ThumbsUpIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { NoteList, PageHeader, Panel } from "@/components/app/page";
import { useSession } from "@/components/app/session-provider";
import { EmptyState, Notice, TableSkeleton } from "@/components/app/states";
import { QueryError, toastError } from "@/components/app/decision-lab/common";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useFilterOptions } from "@/hooks/use-filter-options";
import { useInvalidateOrg, useOrgMutation, useOrgQuery } from "@/hooks/use-org-query";
import { formatNumber, humanize } from "@/lib/app/format";
import { PERMISSIONS } from "@/lib/app/nav";
import {
  STATUS_FLOW,
  STATUS_LABELS,
  type MyWork,
  type NotificationsResponse,
  type Recommendation,
  type RecommendationsResponse,
} from "@/lib/app/workflows-types";
import { cn } from "@/lib/utils";

import { CreateRecommendationDialog, NoteDialog, type NewRecommendation } from "./dialogs";
import { impactSummary, RecommendationRow, RecStatusBadge, useMembers } from "./shared";
import { NotificationsPanel, TasksPanel } from "./tasks";

type Tab = "recommendations" | "approvals" | "tasks" | "notifications";

function PipelineSummary({ counts, active, onSelect }: { counts: Record<string, number>; active: string | null; onSelect: (status: string | null) => void }) {
  const side = ["rejected", "dismissed"];
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const chip = (status: string | null, label: string, count: number) => (
    <button
      key={status ?? "all"}
      type="button"
      onClick={() => onSelect(status)}
      aria-pressed={active === status}
      className={cn(
        "flex min-w-0 flex-col items-start rounded-lg px-3 py-2 text-left ring-1 transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        active === status ? "bg-navy-950 text-white ring-navy-950" : "bg-card ring-foreground/10 hover:bg-muted/60",
      )}
    >
      <span className={cn("text-xs", active === status ? "text-navy-200" : "text-muted-foreground")}>{label}</span>
      <span className="text-lg leading-tight font-semibold tabular">{formatNumber(count)}</span>
    </button>
  );
  return (
    <div className="space-y-2" role="group" aria-label="Filter by lifecycle stage">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-2">
        {chip(null, "All", total)}
        {STATUS_FLOW.map((s) => chip(s, STATUS_LABELS[s], counts[s] ?? 0))}
        {side.map((s) => chip(s, STATUS_LABELS[s], counts[s] ?? 0))}
      </div>
      <p className="text-xs text-muted-foreground">Proposed → pending approval → approved or rejected → in progress → implemented → measured. Proposals can be dismissed before a decision.</p>
    </div>
  );
}

function ApprovalsPanel({ items, currency }: { items: MyWork["approvals_pending"]; currency: string }) {
  const invalidate = useInvalidateOrg();
  const [target, setTarget] = useState<{ rec: Recommendation; approve: boolean } | null>(null);
  const decide = useOrgMutation<{ id: string; approve: boolean; note?: string }, Recommendation>(({ id, ...body }, call) =>
    call(`/recommendations/${id}/decision`, { json: body }),
  );
  if (!items.length) {
    return (
      <Panel>
        <EmptyState compact icon={StampIcon} title="Nothing waiting for your approval" description="Recommendations submitted by colleagues appear here. You never approve your own." />
      </Panel>
    );
  }
  return (
    <Panel title="Waiting for your decision" description="Submitted by colleagues; approving or rejecting is recorded with your note">
      <ul className="divide-y">
        {items.map(({ approval_id, recommendation: rec }) => (
          <li key={approval_id} className="flex flex-col gap-3 py-3.5 first:pt-0 last:pb-0 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap gap-1.5">
                <RecStatusBadge status={rec.status} />
              </div>
              <Link href={`/app/workflows/recommendations/${rec.id}`} className="mt-1 block font-medium underline-offset-3 hover:underline">
                {rec.title}
              </Link>
              <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{rec.summary}</p>
              {impactSummary(rec, currency) ? <p className="mt-1 text-xs font-medium text-foreground/80">{impactSummary(rec, currency)}</p> : null}
            </div>
            <div className="flex shrink-0 gap-2">
              <Button size="sm" onClick={() => setTarget({ rec, approve: true })}>
                <ThumbsUpIcon aria-hidden />
                Approve
              </Button>
              <Button size="sm" variant="outline" onClick={() => setTarget({ rec, approve: false })}>
                <ThumbsDownIcon aria-hidden />
                Reject
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <NoteDialog
        open={Boolean(target)}
        onOpenChange={(open) => {
          if (!open) setTarget(null);
          else decide.reset();
        }}
        title={target?.approve ? "Approve this recommendation?" : "Reject this recommendation?"}
        description={target ? `“${target.rec.title}”. The requester is notified of your decision.` : ""}
        confirmLabel={target?.approve ? "Approve" : "Reject"}
        destructive={target ? !target.approve : false}
        submitting={decide.isPending}
        error={decide.error}
        onConfirm={(note) => {
          if (!target) return;
          decide.mutate(
            { id: target.rec.id, approve: target.approve, note },
            {
              onSuccess: (rec) => {
                setTarget(null);
                void invalidate("/recommendations", "/workflows", "/notifications");
                toast.success(`${target.approve ? "Approved" : "Rejected"}: ${rec.title}`);
              },
            },
          );
        }}
      />
    </Panel>
  );
}

export function WorkflowsView() {
  const { has, membership } = useSession();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const invalidate = useInvalidateOrg();
  const canReadRecs = has(PERMISSIONS.recommendationsRead);
  const canWrite = has("recommendations:write");
  const canApprove = has("recommendations:approve");
  const storeScoped = Boolean(membership?.store_scope && membership.store_scope.length);
  const legacyRec = params.get("recommendation");
  const status = params.get("status");
  const category = params.get("category");
  const requested = params.get("tab") as Tab | null;
  const tab: Tab = requested && (requested !== "approvals" || canApprove) && (requested !== "recommendations" || canReadRecs) ? requested : canReadRecs ? "recommendations" : "tasks";
  const [createOpen, setCreateOpen] = useState(false);

  // Notification links use /app/workflows?recommendation=<id>: open the recommendation itself.
  useEffect(() => {
    if (legacyRec && /^[0-9a-f-]{36}$/i.test(legacyRec)) router.replace(`/app/workflows/recommendations/${legacyRec}`);
  }, [legacyRec, router]);

  const setParams = useCallback(
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

  const options = useFilterOptions();
  const currency = options.data?.companies.find((c) => c.id === options.data?.company_id)?.currency ?? "INR";
  const recs = useOrgQuery<RecommendationsResponse>("/recommendations", {
    query: { status: status ?? undefined, category: category ?? undefined },
    enabled: canReadRecs,
    keepPrevious: true,
    staleTime: 30_000,
  });
  const allRecs = useOrgQuery<RecommendationsResponse>("/recommendations", { enabled: canReadRecs, staleTime: 30_000 });
  const myWork = useOrgQuery<MyWork>("/workflows/my-work", { staleTime: 30_000 });
  const unread = useOrgQuery<NotificationsResponse>("/notifications", { query: { limit: 1 }, staleTime: 30_000 });
  const { nameOf } = useMembers();

  const generate = useOrgMutation<void, { created: number; skipped_duplicates?: number; note?: string }>((_, call) => call("/recommendations/generate", { method: "POST" }));
  const create = useOrgMutation<NewRecommendation, Recommendation>((body, call) => call("/recommendations", { json: body }));

  const categories = Array.from(new Set((allRecs.data?.recommendations ?? []).map((r) => r.category))).sort();
  // The API's counts cover the whole organization; store-scoped members count what they can see.
  const pipelineCounts = storeScoped
    ? (allRecs.data?.recommendations ?? []).reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {})
    : (allRecs.data?.counts ?? recs.data?.counts ?? {});
  const pending = myWork.data?.approvals_pending ?? [];
  const recList = recs.data?.recommendations ?? [];

  return (
    <>
      <PageHeader
        title="Workflows"
        description="Turn analysis into decisions: recommendations go through approval with separation of duties, become tasks, and are measured against what was predicted."
        actions={
          canWrite ? (
            <>
              {!storeScoped ? (
                <Button
                  variant="outline"
                  disabled={generate.isPending}
                  onClick={() =>
                    generate.mutate(undefined, {
                      onSuccess: (res) => {
                        void invalidate("/recommendations", "/workflows");
                        toast.success(
                          res.created ? `Created ${res.created} recommendation${res.created === 1 ? "" : "s"}` : "No new recommendations",
                          {
                            description: res.note
                              ? res.note
                              : `${res.skipped_duplicates ?? 0} already open ${res.skipped_duplicates === 1 ? "recommendation was" : "recommendations were"} not duplicated.`,
                          },
                        );
                        setParams({ tab: "recommendations", status: null });
                      },
                      onError: (error) => toastError(error, "The rules didn't run"),
                    })
                  }
                >
                  {generate.isPending ? <LoaderCircleIcon className="animate-spin" aria-hidden /> : <SparklesIcon aria-hidden />}
                  Generate from rules
                </Button>
              ) : null}
              <Button
                onClick={() => {
                  create.reset();
                  setCreateOpen(true);
                }}
              >
                <PlusIcon aria-hidden />
                New recommendation
              </Button>
            </>
          ) : null
        }
      />

      <Tabs value={tab} onValueChange={(value) => setParams({ tab: value })} className="gap-5">
        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <TabsList aria-label="Workflow sections">
            {canReadRecs ? <TabsTrigger value="recommendations">Recommendations</TabsTrigger> : null}
            {canApprove ? (
              <TabsTrigger value="approvals">
                Approvals{pending.length ? <span className="rounded-full bg-warning/25 px-1.5 text-xs tabular">{pending.length}</span> : null}
              </TabsTrigger>
            ) : null}
            <TabsTrigger value="tasks">Tasks</TabsTrigger>
            <TabsTrigger value="notifications">
              Notifications{unread.data?.unread ? <span className="rounded-full bg-primary/15 px-1.5 text-xs text-primary tabular">{unread.data.unread}</span> : null}
            </TabsTrigger>
          </TabsList>
        </div>

        {canReadRecs ? (
          <TabsContent value="recommendations" className="space-y-5">
            <PipelineSummary counts={pipelineCounts} active={status} onSelect={(s) => setParams({ status: s })} />
            <Panel
              title={status ? STATUS_LABELS[status] ?? humanize(status) : "All recommendations"}
              description="From the rule engine, Decision Lab scenarios and your team"
              actions={
                <>
                  <Label htmlFor="rec-category" className="sr-only">
                    Category
                  </Label>
                  <Select value={category ?? "all"} onValueChange={(v) => setParams({ category: v === "all" ? null : v })}>
                    <SelectTrigger id="rec-category" size="sm" className="h-7 w-[10rem] bg-background text-[0.8125rem]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent position="popper" align="end">
                      <SelectItem value="all">All categories</SelectItem>
                      <SelectSeparator />
                      {categories.map((c) => (
                        <SelectItem key={c} value={c}>
                          {humanize(c)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </>
              }
              contentClassName="px-0 pb-1 sm:px-0"
            >
              {recs.isPending ? (
                <div className="px-4 pb-4 sm:px-5">
                  <TableSkeleton rows={4} columns={2} />
                </div>
              ) : recs.error ? (
                <div className="px-4 pb-4 sm:px-5">
                  <QueryError error={recs.error} onRetry={() => void recs.refetch()} />
                </div>
              ) : recList.length === 0 ? (
                <EmptyState
                  compact
                  icon={ClipboardListIcon}
                  title={status || category ? "No recommendations match" : "No recommendations yet"}
                  description={canWrite ? "Generate them from the rules, create one, or turn a Decision Lab scenario into one." : "Recommendations created by your team appear here."}
                />
              ) : (
                <ul className={cn("divide-y border-t", recs.isPlaceholderData && "opacity-55")}>
                  {recList.map((rec) => (
                    <RecommendationRow key={rec.id} rec={rec} currency={currency} nameOf={nameOf} />
                  ))}
                </ul>
              )}
            </Panel>
            {storeScoped ? <Notice>You see recommendations for your stores only.</Notice> : null}
          </TabsContent>
        ) : null}

        {canApprove ? (
          <TabsContent value="approvals" className="space-y-5">
            {myWork.isPending ? (
              <TableSkeleton rows={3} columns={2} />
            ) : myWork.error ? (
              <Panel>
                <QueryError error={myWork.error} onRetry={() => void myWork.refetch()} />
              </Panel>
            ) : (
              <ApprovalsPanel items={pending} currency={currency} />
            )}
            <NoteList
              notes={[
                "Separation of duties: the member who created a recommendation cannot approve or reject it.",
                "Every approval request goes to all members with approval rights; the first decision closes the others.",
              ]}
            />
          </TabsContent>
        ) : null}

        <TabsContent value="tasks">
          <TasksPanel recommendations={allRecs.data?.recommendations ?? []} />
        </TabsContent>

        <TabsContent value="notifications">
          <NotificationsPanel />
        </TabsContent>
      </Tabs>

      <CreateRecommendationDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        stores={options.data?.stores ?? []}
        storeRequired={storeScoped}
        submitting={create.isPending}
        error={create.error}
        currency={currency}
        onSubmit={(input) =>
          create.mutate(input, {
            onSuccess: (rec) => {
              setCreateOpen(false);
              void invalidate("/recommendations", "/workflows");
              toast.success("Recommendation created", { description: "Submit it for approval when it is ready." });
              router.push(`/app/workflows/recommendations/${rec.id}`);
            },
          })
        }
      />
    </>
  );
}
