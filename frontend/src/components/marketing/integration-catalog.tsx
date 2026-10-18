"use client";

import { useQuery } from "@tanstack/react-query";
import { ExternalLinkIcon, RotateCwIcon } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { z } from "zod";

import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

import { CONNECTION_METHODS } from "./content";

/*
 * Public provider catalogue: GET /api/v1/public/integration-catalog.
 * Listing a provider is not a claim of a live connection; badges report availability and how far
 * the listed methods have been checked against the vendor's own documentation.
 */

const entrySchema = z.object({
  key: z.string(),
  name: z.string(),
  categories: z.array(z.string()).catch([]),
  methods: z.array(z.string()).catch([]),
  availability: z.string(),
  verification_status: z.string().nullable().catch(null),
  summary: z.string().catch(""),
  docs_url: z.string().nullable().catch(null),
});

const catalogSchema = z.object({
  generated_at: z.string().catch(""),
  entries: z.array(entrySchema),
});

type CatalogEntry = z.infer<typeof entrySchema>;

type Tone = "positive" | "caution" | "neutral" | "negative" | "muted";

const AVAILABILITY: Record<string, { label: string; tone: Tone }> = {
  available: { label: "Available", tone: "positive" },
  requires_vendor_authorization: { label: "Needs vendor authorization", tone: "caution" },
  file_import_only: { label: "File import only", tone: "neutral" },
  planned: { label: "Planned", tone: "muted" },
};

const VERIFICATION: Record<string, { label: string; tone: Tone }> = {
  verified: { label: "Verified against vendor docs", tone: "positive" },
  partially_verified: { label: "Partly verified", tone: "caution" },
  unverified: { label: "Not yet verified", tone: "muted" },
  contradicted: { label: "Contradicted by vendor docs", tone: "negative" },
};

const TONE_DOT: Record<Tone, string> = {
  positive: "bg-success",
  caution: "bg-warning",
  neutral: "bg-chart-2",
  negative: "bg-destructive",
  muted: "border-[1.5px] border-muted-foreground",
};

const WORDS: Record<string, string> = {
  api: "API",
  rest: "REST",
  oauth: "OAuth",
  oauth2: "OAuth",
  pos: "POS",
  erp: "ERP",
  hr: "HR",
  hris: "HRIS",
  crm: "CRM",
  wms: "WMS",
  csv: "CSV",
  sftp: "SFTP",
  sql: "SQL",
  ecommerce: "e-commerce",
};

const METHOD_LABELS: Record<string, string> = {
  rest_api: "REST API",
  api: "REST API",
  oauth: "OAuth",
  oauth2: "OAuth",
  webhook: "Signed webhooks",
  webhooks: "Signed webhooks",
  signed_webhooks: "Signed webhooks",
  export: "Approved export",
  approved_export: "Approved export",
  file_export: "Approved export",
  csv: "CSV import",
  excel: "Excel import",
  csv_excel: "CSV or Excel import",
  csv_excel_import: "CSV or Excel import",
  file_import: "CSV or Excel import",
  database: "Read-only database",
  read_only_database: "Read-only database",
  readonly_database: "Read-only database",
  database_read_only: "Read-only database",
};

/** Turn API keys such as "requires_vendor_authorization" or "pos" into readable labels. */
function humanize(value: string) {
  const words = value.split(/[_\-\s]+/).filter(Boolean);
  return words
    .map((word, i) => {
      const known = WORDS[word.toLowerCase()];
      if (known) return i === 0 && known === "e-commerce" ? "E-commerce" : known;
      if (word === word.toUpperCase() && word.length > 1) return word;
      return i === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word.toLowerCase();
    })
    .join(" ");
}

function methodLabel(method: string) {
  return METHOD_LABELS[method.toLowerCase()] ?? humanize(method);
}

/** Only render vendor documentation links that are plain http(s) URLs. */
function safeHttpUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function formatDate(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" }).format(date);
}

function StatusLine({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm leading-snug">
      <span aria-hidden className={cn("size-2 shrink-0 rounded-full", TONE_DOT[tone])} />
      {children}
    </span>
  );
}

function CatalogSkeleton() {
  return (
    <div aria-hidden className="mt-8 border-t">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="grid gap-4 border-b py-6 lg:grid-cols-12 lg:gap-8">
          <div className="space-y-2.5 lg:col-span-5">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="h-3.5 w-full max-w-md" />
            <Skeleton className="h-3.5 w-2/3 max-w-sm" />
          </div>
          <div className="space-y-2 lg:col-span-3">
            <Skeleton className="h-3.5 w-16" />
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="h-3.5 w-28" />
          </div>
          <div className="space-y-2.5 lg:col-span-4">
            <Skeleton className="h-3.5 w-36" />
            <Skeleton className="h-3.5 w-44" />
          </div>
        </div>
      ))}
    </div>
  );
}

function CatalogUnavailable({ onRetry, retrying }: { onRetry: () => void; retrying: boolean }) {
  return (
    <div role="status" className="mt-8 rounded-xl border bg-muted/50 p-5 sm:p-6">
      <p className="font-medium">The provider catalogue can&apos;t be loaded right now.</p>
      <p className="mt-1.5 max-w-[72ch] text-[0.9375rem] leading-relaxed text-muted-foreground">
        Every provider connects through one of the methods described above:
      </p>
      <ul className="mt-3 flex flex-wrap gap-2">
        {CONNECTION_METHODS.map((method) => (
          <li key={method.key} className="rounded-full border bg-background px-3 py-1 text-sm">
            {method.name}
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={onRetry}
        disabled={retrying}
        className="mt-5 inline-flex h-9 items-center gap-2 rounded-lg border bg-background px-3.5 text-sm font-medium transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60"
      >
        <RotateCwIcon className={cn("size-4", retrying && "animate-spin")} aria-hidden />
        {retrying ? "Trying again" : "Try again"}
      </button>
    </div>
  );
}

function CatalogRow({ entry }: { entry: CatalogEntry }) {
  const availability = AVAILABILITY[entry.availability] ?? { label: humanize(entry.availability), tone: "muted" };
  const verification = entry.verification_status
    ? (VERIFICATION[entry.verification_status] ?? { label: humanize(entry.verification_status), tone: "muted" })
    : { label: "Not assessed", tone: "muted" as Tone };
  const docsUrl = safeHttpUrl(entry.docs_url);

  return (
    <li className="grid gap-5 border-b py-6 lg:grid-cols-12 lg:gap-8">
      <div className="lg:col-span-5">
        <h3 className="font-display text-lg leading-snug font-semibold tracking-[-0.01em]">{entry.name}</h3>
        {entry.categories.length > 0 ? (
          <p className="mt-0.5 text-sm text-muted-foreground">{entry.categories.map(humanize).join(", ")}</p>
        ) : null}
        {entry.summary ? (
          <p className="mt-3 max-w-[60ch] text-[0.9375rem] leading-relaxed">{entry.summary}</p>
        ) : null}
      </div>
      <div className="lg:col-span-3">
        <p className="text-xs text-muted-foreground">Methods</p>
        {entry.methods.length > 0 ? (
          <ul className="mt-1.5 space-y-1 text-sm">
            {entry.methods.map((method) => (
              <li key={method}>{methodLabel(method)}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-1.5 text-sm text-muted-foreground">None listed yet</p>
        )}
      </div>
      <div className="flex flex-col gap-4 sm:flex-row sm:justify-between lg:col-span-4">
        <dl className="space-y-2.5">
          <div>
            <dt className="sr-only">Availability</dt>
            <dd>
              <StatusLine tone={availability.tone}>{availability.label}</StatusLine>
            </dd>
          </div>
          <div>
            <dt className="sr-only">Verification</dt>
            <dd>
              <StatusLine tone={verification.tone}>{verification.label}</StatusLine>
            </dd>
          </div>
        </dl>
        {docsUrl ? (
          <a
            href={docsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-8 items-center gap-1.5 self-start rounded-md text-sm font-medium text-primary underline decoration-primary/30 underline-offset-4 outline-none hover:decoration-primary focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            Vendor docs
            <ExternalLinkIcon className="size-3.5" aria-hidden />
            <span className="sr-only">for {entry.name} (opens in a new tab)</span>
          </a>
        ) : null}
      </div>
    </li>
  );
}

export function IntegrationCatalog() {
  const [category, setCategory] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["public", "integration-catalog"],
    queryFn: async ({ signal }) =>
      catalogSchema.parse(await api<unknown>("/public/integration-catalog", { noRefresh: true, signal })),
    retry: 1,
    staleTime: 5 * 60_000,
  });

  const entries = useMemo(() => query.data?.entries ?? [], [query.data]);

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of entries) {
      for (const c of entry.categories) counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([key, count]) => ({ key, label: humanize(key), count }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [entries]);

  if (query.isPending) {
    return (
      <div aria-busy="true">
        <p className="sr-only" role="status">
          Loading the provider catalogue
        </p>
        <div aria-hidden className="mt-8 flex flex-wrap gap-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-9 w-24 rounded-full" />
          ))}
        </div>
        <CatalogSkeleton />
      </div>
    );
  }

  if (query.isError) {
    return <CatalogUnavailable onRetry={() => void query.refetch()} retrying={query.isFetching} />;
  }

  if (entries.length === 0) {
    return (
      <p role="status" className="mt-8 rounded-xl border bg-muted/50 p-5 text-[0.9375rem]">
        No providers are listed yet. Every connection method described above is available for your own systems.
      </p>
    );
  }

  const activeCategory = category && categories.some((c) => c.key === category) ? category : null;
  const visible = activeCategory ? entries.filter((e) => e.categories.includes(activeCategory)) : entries;
  const updated = formatDate(query.data.generated_at);

  const chip = (selected: boolean) =>
    cn(
      "inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
      selected
        ? "border-foreground bg-foreground text-background"
        : "bg-background text-foreground hover:border-foreground/30 hover:bg-muted",
    );

  return (
    <div>
      <div className="mt-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div role="group" aria-label="Filter providers by category" className="flex flex-wrap gap-2">
          <button
            type="button"
            aria-pressed={activeCategory === null}
            onClick={() => setCategory(null)}
            className={chip(activeCategory === null)}
          >
            All
            <span className="tabular opacity-70">{entries.length}</span>
          </button>
          {categories.map((c) => (
            <button
              key={c.key}
              type="button"
              aria-pressed={activeCategory === c.key}
              onClick={() => setCategory(c.key)}
              className={chip(activeCategory === c.key)}
            >
              {c.label}
              <span className="tabular opacity-70">{c.count}</span>
            </button>
          ))}
        </div>
        <p className="shrink-0 text-sm text-muted-foreground" aria-live="polite">
          Showing {visible.length} of {entries.length}
          {updated ? <span>. Catalogue updated {updated}</span> : null}
        </p>
      </div>

      <ul className="mt-6 border-t">
        {visible.map((entry) => (
          <CatalogRow key={entry.key} entry={entry} />
        ))}
      </ul>
    </div>
  );
}
