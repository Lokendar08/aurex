"use client";

import {
  BadgeCheckIcon,
  CopyIcon,
  LoaderCircleIcon,
  MegaphoneIcon,
  NewspaperIcon,
  PlusIcon,
  RefreshCwIcon,
  RssIcon,
  SearchIcon,
  SparklesIcon,
  XIcon,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useId, useState } from "react";
import { toast } from "sonner";

import { PermissionGate } from "@/components/app/access";
import { StatusBadge } from "@/components/app/badges";
import { fieldErrors, FormError, TextAreaField, TextField } from "@/components/app/form";
import { PageHeader, Panel } from "@/components/app/page";
import { Pagination } from "@/components/app/pagination";
import { useSession } from "@/components/app/session-provider";
import { EmptyState, SkeletonBlock } from "@/components/app/states";
import { ExternalLink, hostOf, QueryError, toastError } from "@/components/app/decision-lab/common";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useInvalidateOrg, useOrgMutation, useOrgQuery } from "@/hooks/use-org-query";
import { ApiError } from "@/lib/api";
import { errorText } from "@/lib/app/decision-lab-format";
import { formatDate, formatDateTime, formatNumber, formatRelative, humanize } from "@/lib/app/format";
import type { CompaniesResponse } from "@/lib/app/intelligence-types";
import type { NewsArticle, NewsResponse, NewsSourcesResponse } from "@/lib/app/news-types";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 20;

const SOURCE_TYPES: Record<string, string> = {
  official_ir: "Investor relations page",
  exchange_announcements: "Exchange announcements",
  rss: "RSS feed",
  press_release: "Press releases",
  news_site: "News site",
};

function sourceType(type: string): string {
  return SOURCE_TYPES[type] ?? humanize(type);
}

function useNewsParams() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const set = useCallback(
    (patch: Record<string, string | null>, resetPage = true) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v) next.set(k, v);
        else next.delete(k);
      }
      if (resetPage) next.delete("page");
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );
  return {
    q: params.get("q") ?? "",
    company: params.get("company") ?? "",
    start: params.get("start") ?? "",
    end: params.get("end") ?? "",
    official: params.get("official") === "1",
    duplicates: params.get("duplicates") === "1",
    page: Math.max(0, Number(params.get("page") ?? "0") || 0),
    set,
  };
}

function ArticleCard({
  article,
  companies,
  canManage,
}: {
  article: NewsArticle;
  companies: Record<string, string>;
  canManage: boolean;
}) {
  const invalidate = useInvalidateOrg();
  const [interpretError, setInterpretError] = useState<string | null>(null);
  const interpret = useOrgMutation<string, NewsArticle>((id, call) => call(`/news/${id}/interpret`, { method: "POST" }));
  const facts = article.reported_facts;
  const ai = article.ai_interpretation;
  const host = hostOf(article.url);
  return (
    <article className="rounded-xl bg-card ring-1 ring-foreground/10" aria-labelledby={`news-${article.id}`}>
      <div className="space-y-3 px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-center gap-1.5">
          {article.is_official_announcement ? (
            <StatusBadge tone="info" icon={MegaphoneIcon}>
              Official announcement
            </StatusBadge>
          ) : null}
          {article.verified ? (
            <StatusBadge tone="good" icon={BadgeCheckIcon}>
              Verified at source
            </StatusBadge>
          ) : (
            <StatusBadge tone="neutral">Not verified</StatusBadge>
          )}
          {article.duplicate_of ? <StatusBadge tone="neutral">Similar report of an earlier article</StatusBadge> : null}
          {(article.entity_keys ?? []).map((key) => (
            <StatusBadge key={key}>{companies[key] ?? humanize(key)}</StatusBadge>
          ))}
        </div>
        <div>
          <h2 id={`news-${article.id}`} className="font-heading text-[0.9375rem] leading-snug font-semibold">
            <ExternalLink href={article.url} className="text-[0.9375rem] text-foreground">
              {article.title}
            </ExternalLink>
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {article.source_name ?? host ?? "Unknown source"}
            {host && article.source_name ? ` · ${host}` : ""} · {article.published_at ? formatDate(article.published_at) : "Undated"}
            {article.duplicate_count > 0 ? (
              <>
                {" "}
                ·{" "}
                <span className="inline-flex items-center gap-1 font-medium text-foreground">
                  <CopyIcon className="size-3" aria-hidden />+{formatNumber(article.duplicate_count)} similar report{article.duplicate_count === 1 ? "" : "s"}
                </span>
              </>
            ) : null}
          </p>
        </div>

        <section aria-label="Reported facts" className="rounded-lg bg-muted/55 px-3.5 py-3">
          <p className="text-xs font-semibold text-muted-foreground">Reported facts (from the source)</p>
          {facts?.text ? (
            <>
              <p className="mt-1 text-[0.8125rem] leading-relaxed">{facts.text}</p>
              {facts.label ? <p className="mt-1 text-xs text-muted-foreground">{facts.label}</p> : null}
            </>
          ) : (
            <p className="mt-1 text-[0.8125rem] text-muted-foreground">No summary of reported facts is stored. Read the original article.</p>
          )}
        </section>

        {ai ? (
          <section aria-label="AI-generated interpretation" className="rounded-lg px-3.5 py-3 ring-1 ring-warning/35 ring-inset">
            <p className="flex flex-wrap items-center gap-2 text-xs font-semibold">
              <SparklesIcon className="size-3.5 text-warning" aria-hidden />
              AI-generated interpretation — not verified
            </p>
            <p className="mt-1 text-[0.8125rem] leading-relaxed whitespace-pre-line text-foreground/90">{ai.text}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {ai.label}
              {ai.model ? ` · ${ai.model}` : ""}
              {ai.generated_at ? ` · ${formatDateTime(ai.generated_at)}` : ""}
            </p>
          </section>
        ) : canManage ? (
          <div className="space-y-1.5">
            <Button
              variant="ghost"
              size="sm"
              className="-ml-2 text-primary"
              disabled={interpret.isPending}
              onClick={() => {
                setInterpretError(null);
                interpret.mutate(article.id, {
                  onSuccess: () => {
                    void invalidate("/news", "/intelligence");
                    toast.success("Interpretation added", { description: "It is labelled as AI-generated and not verified." });
                  },
                  onError: (error) => {
                    if (error instanceof ApiError && error.code === "llm_not_configured") {
                      setInterpretError(
                        "No language model is configured on this deployment, so no AI interpretation was generated. The reported facts above are unaffected.",
                      );
                    } else setInterpretError(errorText(error));
                  },
                });
              }}
            >
              {interpret.isPending ? <LoaderCircleIcon className="animate-spin" aria-hidden /> : <SparklesIcon aria-hidden />}
              Generate AI interpretation
            </Button>
            {interpretError ? <p className="text-xs text-muted-foreground">{interpretError}</p> : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function SourcesPanel() {
  const query = useOrgQuery<NewsSourcesResponse>("/news/sources", { staleTime: 10 * 60_000 });
  return (
    <Panel title="Sources" description="Feeds and pages the news desk monitors">
      {query.isPending ? (
        <div className="space-y-2">
          <SkeletonBlock className="h-12" />
          <SkeletonBlock className="h-12" />
          <SkeletonBlock className="h-12" />
        </div>
      ) : query.error || !query.data ? (
        <QueryError compact error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            {query.data.fetch_enabled
              ? "Automatic fetching is on: sources are checked on a schedule."
              : "Automatic fetching is off on this deployment: articles are curated and added by hand."}
          </p>
          <ul className="max-h-[32rem] divide-y overflow-y-auto pr-1">
            {query.data.sources.map((s) => (
              <li key={s.id} className="space-y-1 py-2.5 first:pt-0">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <ExternalLink href={s.url} className="text-[0.8125rem]">
                    {s.name}
                  </ExternalLink>
                  <div className="flex flex-wrap gap-1">
                    {s.verified_working ? <StatusBadge tone="good">Checked working</StatusBadge> : s.verified_working === false ? <StatusBadge tone="danger">Not working</StatusBadge> : null}
                    {!s.active ? <StatusBadge>Paused</StatusBadge> : null}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  {sourceType(s.type)} · {s.last_fetched_at ? `last fetched ${formatRelative(s.last_fetched_at)}${s.last_status ? ` (${s.last_status})` : ""}` : "never fetched"}
                </p>
                {s.notes ? <p className="text-xs leading-snug text-muted-foreground">{s.notes}</p> : null}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

function AddArticleDialog({ companies }: { companies: { key: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ url: "", title: "", source_name: "", published_at: "", facts_summary: "", is_official_announcement: false, companies: [] as string[] });
  const [local, setLocal] = useState<Record<string, string>>({});
  const invalidate = useInvalidateOrg();
  const create = useOrgMutation<Record<string, unknown>, { status: string; id?: string }>((body, call) => call("/news", { json: body }));
  const errors = { ...fieldErrors(create.error), ...local };
  const baseId = useId();

  function submit() {
    const problems: Record<string, string> = {};
    if (!/^https?:\/\/\S+$/i.test(form.url.trim())) problems.url = "A link to the original article is required";
    if (form.title.trim().length < 5) problems.title = "At least 5 characters";
    if (form.source_name.trim().length < 2) problems.source_name = "Who published it";
    if (form.published_at && form.published_at > new Date().toISOString().slice(0, 10)) problems.published_at = "Cannot be in the future";
    setLocal(problems);
    if (Object.keys(problems).length) return;
    create.mutate(
      {
        url: form.url.trim(),
        title: form.title.trim(),
        source_name: form.source_name.trim(),
        published_at: form.published_at || undefined,
        companies: form.companies,
        facts_summary: form.facts_summary.trim() || undefined,
        is_official_announcement: form.is_official_announcement,
      },
      {
        onSuccess: (res) => {
          void invalidate("/news", "/intelligence");
          toast.success(res.status === "duplicate" ? "Added as a similar report of an existing article" : "Article added", {
            description: "It is listed as not verified until checked at the source.",
          });
          setOpen(false);
          setForm({ url: "", title: "", source_name: "", published_at: "", facts_summary: "", is_official_announcement: false, companies: [] });
        },
      },
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          create.reset();
          setLocal({});
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <PlusIcon aria-hidden />
          Add article
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>Add an article</DialogTitle>
            <DialogDescription>Link to the original. Summarise only what the source reports; interpretation belongs in the AI section, which is always labelled.</DialogDescription>
          </DialogHeader>
          <TextField label="Article link" required value={form.url} onChange={(url) => setForm({ ...form, url })} error={errors.url} placeholder="https://" />
          <TextField label="Headline" required value={form.title} onChange={(title) => setForm({ ...form, title })} error={errors.title} maxLength={1000} />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Publisher" required value={form.source_name} onChange={(source_name) => setForm({ ...form, source_name })} error={errors.source_name} maxLength={200} />
            <TextField label="Published on" type="date" value={form.published_at} onChange={(published_at) => setForm({ ...form, published_at })} error={errors.published_at} />
          </div>
          <TextAreaField
            label="Reported facts"
            value={form.facts_summary}
            onChange={(facts_summary) => setForm({ ...form, facts_summary })}
            rows={3}
            maxLength={1200}
            hint="What the article states, in its own terms (optional, up to 1,200 characters)."
          />
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Companies mentioned</legend>
            <div className="grid gap-1 sm:grid-cols-2">
              {companies.map((c) => {
                const id = `${baseId}-${c.key}`;
                return (
                  <label key={c.key} htmlFor={id} className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-muted">
                    <Checkbox
                      id={id}
                      checked={form.companies.includes(c.key)}
                      onCheckedChange={(v) =>
                        setForm({ ...form, companies: v === true ? [...form.companies, c.key].slice(0, 10) : form.companies.filter((k) => k !== c.key) })
                      }
                    />
                    {c.name}
                  </label>
                );
              })}
            </div>
          </fieldset>
          <label htmlFor={`${baseId}-official`} className="flex items-center justify-between gap-3 rounded-lg bg-muted/50 px-3 py-2.5 text-sm">
            <span>
              <span className="font-medium">Official announcement</span>
              <span className="block text-xs text-muted-foreground">Issued by the company or filed with an exchange</span>
            </span>
            <Switch id={`${baseId}-official`} checked={form.is_official_announcement} onCheckedChange={(v) => setForm({ ...form, is_official_announcement: v })} />
          </label>
          <FormError message={create.error ? errorText(create.error) : null} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={create.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? <LoaderCircleIcon className="animate-spin" aria-hidden /> : null}
              Add article
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function NewsView() {
  const { has } = useSession();
  const canManage = has("intelligence:manage");
  const filters = useNewsParams();
  const [search, setSearch] = useState(filters.q);
  const searchId = useId();
  const companyId = useId();
  const startId = useId();
  const endId = useId();
  const officialId = useId();
  const dupId = useId();

  // Debounce typing into the URL.
  useEffect(() => {
    if (search === filters.q) return;
    const t = window.setTimeout(() => filters.set({ q: search.trim() || null }), 350);
    return () => window.clearTimeout(t);
  }, [search, filters]);

  const companies = useOrgQuery<CompaniesResponse>("/intelligence/companies", { staleTime: 10 * 60_000 });
  const companyNames = Object.fromEntries((companies.data?.companies ?? []).map((c) => [c.key, c.display_name])) as Record<string, string>;
  const companyList = (companies.data?.companies ?? []).map((c) => ({ key: c.key, name: c.display_name }));
  const rangeInvalid = Boolean(filters.start && filters.end && filters.start > filters.end);
  const news = useOrgQuery<NewsResponse>("/news", {
    query: {
      q: filters.q || undefined,
      company: filters.company || undefined,
      start: filters.start || undefined,
      end: filters.end || undefined,
      official_only: filters.official || undefined,
      include_duplicates: filters.duplicates || undefined,
      limit: PAGE_SIZE,
      offset: filters.page * PAGE_SIZE,
    },
    enabled: !rangeInvalid,
    keepPrevious: true,
    staleTime: 60_000,
  });
  const invalidate = useInvalidateOrg();
  const refresh = useOrgMutation<void, { job_id: string }>((_, call) => call("/news/refresh", { method: "POST" }));
  const hasFilters = Boolean(filters.q || filters.company || filters.start || filters.end || filters.official || filters.duplicates);

  return (
    <>
      <PageHeader
        title="Market News"
        description="Verified news and official announcements about the companies you follow. Reported facts and AI interpretation are always kept apart."
        actions={
          <PermissionGate permission="intelligence:manage">
            <Button
              variant="outline"
              disabled={refresh.isPending}
              onClick={() =>
                refresh.mutate(undefined, {
                  onSuccess: () => {
                    toast.success("Refresh started", { description: "New articles appear when the sources have been read." });
                    window.setTimeout(() => void invalidate("/news"), 4000);
                  },
                  onError: (error) => {
                    if (error instanceof ApiError && error.code === "news_fetch_disabled") {
                      toast.message("Automatic fetching is off", { description: `${error.message}. Add articles by hand instead.` });
                    } else toastError(error, "The refresh didn't start");
                  },
                })
              }
            >
              {refresh.isPending ? <LoaderCircleIcon className="animate-spin" aria-hidden /> : <RefreshCwIcon aria-hidden />}
              Refresh feeds
            </Button>
            <AddArticleDialog companies={companyList} />
          </PermissionGate>
        }
      />

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-end gap-3 rounded-xl bg-muted/40 p-3 ring-1 ring-foreground/8" role="search" aria-label="Filter news">
            <div className="min-w-[14rem] flex-1 space-y-1">
              <Label htmlFor={searchId} className="text-xs text-muted-foreground">
                Search
              </Label>
              <InputGroup className="bg-background">
                <InputGroupAddon>
                  <SearchIcon aria-hidden />
                </InputGroupAddon>
                <InputGroupInput id={searchId} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Headline or facts" maxLength={120} />
              </InputGroup>
            </div>
            <div className="space-y-1">
              <Label htmlFor={companyId} className="text-xs text-muted-foreground">
                Company
              </Label>
              <Select value={filters.company || "all"} onValueChange={(v) => filters.set({ company: v === "all" ? null : v })}>
                <SelectTrigger id={companyId} className="w-44 bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  <SelectItem value="all">All companies</SelectItem>
                  <SelectSeparator />
                  {companyList.map((c) => (
                    <SelectItem key={c.key} value={c.key}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor={startId} className="text-xs text-muted-foreground">
                From
              </Label>
              <Input id={startId} type="date" value={filters.start} onChange={(e) => filters.set({ start: e.target.value || null })} className="w-[9.5rem] bg-background" aria-invalid={rangeInvalid || undefined} />
            </div>
            <div className="space-y-1">
              <Label htmlFor={endId} className="text-xs text-muted-foreground">
                To
              </Label>
              <Input id={endId} type="date" value={filters.end} onChange={(e) => filters.set({ end: e.target.value || null })} className="w-[9.5rem] bg-background" aria-invalid={rangeInvalid || undefined} />
            </div>
            <div className="flex flex-wrap gap-4 pb-1.5">
              <label htmlFor={officialId} className="flex items-center gap-2 text-sm">
                <Switch id={officialId} checked={filters.official} onCheckedChange={(v) => filters.set({ official: v ? "1" : null })} />
                Official only
              </label>
              <label htmlFor={dupId} className="flex items-center gap-2 text-sm">
                <Switch id={dupId} checked={filters.duplicates} onCheckedChange={(v) => filters.set({ duplicates: v ? "1" : null })} />
                Show similar reports
              </label>
            </div>
            {hasFilters ? (
              <Button
                variant="ghost"
                size="sm"
                className="mb-1"
                onClick={() => {
                  setSearch("");
                  filters.set({ q: null, company: null, start: null, end: null, official: null, duplicates: null });
                }}
              >
                <XIcon aria-hidden />
                Clear
              </Button>
            ) : null}
          </div>
          {rangeInvalid ? <p className="text-sm text-destructive">The start date must be before the end date.</p> : null}

          {news.isPending ? (
            <div className="space-y-3" aria-busy="true">
              {Array.from({ length: 4 }, (_, i) => (
                <SkeletonBlock key={i} className="h-44" />
              ))}
            </div>
          ) : news.error || !news.data ? (
            <Panel>
              <QueryError error={news.error} onRetry={() => void news.refetch()} />
            </Panel>
          ) : news.data.articles.length === 0 ? (
            <Panel>
              <EmptyState
                icon={NewspaperIcon}
                title={hasFilters ? "No articles match these filters" : "No articles yet"}
                description={hasFilters ? "Try a broader search or another date range." : "Articles appear here once they are added or fetched from the sources. Nothing is invented to fill the page."}
              />
            </Panel>
          ) : (
            <div className={cn("space-y-3 transition-opacity", news.isPlaceholderData && "opacity-55")}>
              <p className="text-sm text-muted-foreground" aria-live="polite">
                {formatNumber(news.data.total)} article{news.data.total === 1 ? "" : "s"}
                {filters.duplicates ? " including similar reports" : ", similar reports grouped"}
              </p>
              {news.data.articles.map((a) => (
                <ArticleCard key={a.id} article={a} companies={companyNames} canManage={canManage} />
              ))}
              {news.data.total > PAGE_SIZE ? (
                <Pagination page={filters.page} pageSize={PAGE_SIZE} total={news.data.total} onPageChange={(p) => filters.set({ page: p ? String(p) : null }, false)} disabled={news.isFetching} />
              ) : null}
            </div>
          )}
        </div>
        <aside className="min-w-0 space-y-4" aria-label="News sources">
          <SourcesPanel />
          <div className="flex items-start gap-2 rounded-lg bg-muted/55 px-3.5 py-3 text-xs leading-relaxed text-muted-foreground">
            <RssIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>
              Reported facts come from the publisher. An AI interpretation, when present, is generated from those facts only, labelled every time, and never
              treated as verified.
            </p>
          </div>
        </aside>
      </div>
    </>
  );
}
