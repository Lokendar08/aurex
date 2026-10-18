"use client";

import { ExternalLinkIcon, FileSearchIcon, PlugIcon } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { AvailabilityBadge, StatusBadge, SyntheticFeedBadge, VerificationBadge } from "@/components/app/badges";
import { PermissionGate } from "@/components/app/access";
import { NoteList } from "@/components/app/page";
import { EmptyState } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useOrgQuery } from "@/hooks/use-org-query";
import { formatDate, humanize } from "@/lib/app/format";
import { categoryLabel, methodLabel } from "@/lib/app/labels";
import { PERMISSIONS } from "@/lib/app/nav";
import type { CatalogEntry, EntitySpec, ResearchEvidence, VendorResearch } from "@/lib/app/types";

export function useCatalog() {
  return useOrgQuery<{ entries: CatalogEntry[] }>("/integrations/catalog", { staleTime: 10 * 60_000 });
}

export function useEntities() {
  return useOrgQuery<{ entities: EntitySpec[]; authority_fact_types: string[] }>("/integrations/entities", { staleTime: 10 * 60_000 });
}

/** Providers a member can set up: implemented, not planned, and not the built-in synthetic feed. */
export function isConnectable(entry: CatalogEntry): boolean {
  return entry.implemented && entry.availability !== "planned" && entry.key !== "novamart_synthetic";
}

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      {children}
      <ExternalLinkIcon className="size-3.5" aria-hidden />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

function EvidenceList({ evidence }: { evidence?: ResearchEvidence[] }) {
  if (!evidence?.length) return null;
  return (
    <ul className="space-y-2">
      {evidence.map((e) => (
        <li key={e.url} className="text-[0.8125rem] leading-relaxed">
          <ExternalLink href={e.url}>{e.title || e.url}</ExternalLink>
          <span className="block text-xs text-muted-foreground">
            {[e.publisher, e.accessed ? `accessed ${formatDate(e.accessed)}` : null].filter(Boolean).join(", ")}
          </span>
          {e.supports ? <span className="block text-xs text-muted-foreground">Supports: {e.supports}</span> : null}
        </li>
      ))}
    </ul>
  );
}

/** Vendor research: capabilities, reported association and the public evidence behind them. */
export function ResearchDetails({ research }: { research: VendorResearch }) {
  const caps = research.integration_capabilities;
  return (
    <div className="space-y-5 text-[0.8125rem] leading-relaxed">
      {research.description ? <p className="text-muted-foreground">{research.description}</p> : null}
      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {research.legal_name ? (
          <div>
            <dt className="text-xs text-muted-foreground">Legal name</dt>
            <dd>{research.legal_name}</dd>
          </div>
        ) : null}
        {research.website ? (
          <div>
            <dt className="text-xs text-muted-foreground">Website</dt>
            <dd>
              <ExternalLink href={research.website}>{research.website.replace(/^https?:\/\//, "")}</ExternalLink>
            </dd>
          </div>
        ) : null}
        {caps?.public_api ? (
          <div>
            <dt className="text-xs text-muted-foreground">Public API</dt>
            <dd>{caps.public_api.available === true ? "Available" : caps.public_api.available === false ? "Not available" : "Unknown"}</dd>
          </div>
        ) : null}
        {caps?.auth_methods?.length ? (
          <div>
            <dt className="text-xs text-muted-foreground">Authentication</dt>
            <dd>{caps.auth_methods.map(humanize).join(", ")}</dd>
          </div>
        ) : null}
        {caps?.webhooks ? (
          <div>
            <dt className="text-xs text-muted-foreground">Webhooks</dt>
            <dd>{caps.webhooks.available === true ? "Available" : caps.webhooks.available === false ? "Not available" : "Unknown"}</dd>
          </div>
        ) : null}
        {caps?.export_formats?.length ? (
          <div>
            <dt className="text-xs text-muted-foreground">Export formats</dt>
            <dd>{caps.export_formats.join(", ")}</dd>
          </div>
        ) : null}
      </dl>
      {caps?.public_api?.notes || caps?.webhooks?.notes ? (
        <NoteList notes={[caps?.public_api?.notes, caps?.webhooks?.notes].filter((n): n is string => Boolean(n))} />
      ) : null}
      {research.reported_association ? (
        <section className="space-y-2 rounded-lg bg-muted/60 p-3">
          <h3 className="flex flex-wrap items-center gap-2 text-sm font-semibold">
            Reported association
            <VerificationBadge status={research.reported_association.verification_status} />
          </h3>
          {research.reported_association.claim ? <p>{research.reported_association.claim}</p> : null}
          {research.reported_association.finding ? <p className="text-muted-foreground">{research.reported_association.finding}</p> : null}
          <EvidenceList evidence={research.reported_association.evidence} />
        </section>
      ) : null}
      {caps?.evidence?.length ? (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Evidence for integration capabilities</h3>
          <EvidenceList evidence={caps.evidence} />
        </section>
      ) : null}
      {research.notes ? <p className="text-xs text-muted-foreground">{research.notes}</p> : null}
    </div>
  );
}

export function ResearchDialog({ name, research }: { name: string; research: VendorResearch }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <FileSearchIcon aria-hidden />
          Research
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{name}</DialogTitle>
          <DialogDescription>Vendor research with the public sources it is based on. Claims are only as strong as the evidence listed.</DialogDescription>
        </DialogHeader>
        <ResearchDetails research={research} />
      </DialogContent>
    </Dialog>
  );
}

function CatalogCard({ entry }: { entry: CatalogEntry }) {
  const connectable = isConnectable(entry);
  return (
    <li className="flex min-w-0 flex-col gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-heading text-[0.9375rem] leading-snug font-semibold">{entry.name}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{entry.categories.map(categoryLabel).join(", ")}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {entry.key === "novamart_synthetic" ? <SyntheticFeedBadge /> : <AvailabilityBadge availability={entry.availability} />}
        <VerificationBadge status={entry.verification_status} />
        {!entry.implemented ? <StatusBadge tone="neutral">Connector not built yet</StatusBadge> : null}
      </div>
      <p className="line-clamp-4 text-[0.8125rem] leading-relaxed text-muted-foreground">{entry.summary}</p>
      {entry.methods.length ? (
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Methods: </span>
          {entry.methods.map(methodLabel).join(", ")}
        </p>
      ) : null}
      {entry.activation_requirements.length ? (
        <details className="group text-[0.8125rem]">
          <summary className="cursor-pointer font-medium outline-none hover:underline focus-visible:underline">
            Activation requirements ({entry.activation_requirements.length})
          </summary>
          <NoteList className="mt-2" notes={entry.activation_requirements} />
        </details>
      ) : null}
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
        {connectable ? (
          <PermissionGate permission={PERMISSIONS.integrationsManage}>
            <Button asChild size="sm">
              <Link href={`/app/integrations/new?provider=${encodeURIComponent(entry.key)}`}>
                <PlugIcon aria-hidden />
                {entry.availability === "requires_vendor_authorization" ? "Set up import" : "Connect"}
              </Link>
            </Button>
          </PermissionGate>
        ) : null}
        {entry.research ? <ResearchDialog name={entry.name} research={entry.research} /> : null}
        {entry.docs_url ? (
          <span className="text-[0.8125rem]">
            <ExternalLink href={entry.docs_url}>Documentation</ExternalLink>
          </span>
        ) : null}
      </div>
    </li>
  );
}

const CATEGORIES = ["pos", "erp", "inventory", "accounting", "workforce", "crm"];

/** Searchable, filterable list of every connector and researched vendor profile. */
export function CatalogBrowser({ entries }: { entries: CatalogEntry[] }) {
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return entries.filter(
      (e) =>
        (category === "all" || e.categories.includes(category)) &&
        (!term || e.name.toLowerCase().includes(term) || e.summary.toLowerCase().includes(term) || e.key.includes(term)),
    );
  }, [entries, category, search]);
  const available = filtered.filter((e) => isConnectable(e) || e.key === "novamart_synthetic");
  const researched = filtered.filter((e) => !(isConnectable(e) || e.key === "novamart_synthetic"));

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <ToggleGroup
          type="single"
          size="sm"
          variant="outline"
          value={category}
          onValueChange={(value) => setCategory(value || "all")}
          aria-label="Filter by category"
          className="flex-wrap"
        >
          <ToggleGroupItem value="all">All</ToggleGroupItem>
          {CATEGORIES.map((c) => (
            <ToggleGroupItem key={c} value={c}>
              {categoryLabel(c)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <div className="space-y-1">
          <Label htmlFor="catalog-search" className="sr-only">
            Search the catalog
          </Label>
          <Input
            id="catalog-search"
            type="search"
            placeholder="Search by name or capability"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-background lg:w-72"
          />
        </div>
      </div>
      {filtered.length === 0 ? (
        <EmptyState title="No matching integrations" description="Try another category or search term." />
      ) : (
        <>
          {available.length ? (
            <section aria-labelledby="catalog-available">
              <h2 id="catalog-available" className="mb-3 font-heading text-base font-semibold">
                Ready to connect
              </h2>
              <ul className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
                {available.map((entry) => (
                  <CatalogCard key={entry.key} entry={entry} />
                ))}
              </ul>
            </section>
          ) : null}
          {researched.length ? (
            <section aria-labelledby="catalog-researched">
              <h2 id="catalog-researched" className="font-heading text-base font-semibold">
                Researched vendors
              </h2>
              <p className="mt-0.5 mb-3 text-sm text-muted-foreground">
                Profiles with public evidence. Connectors for these are planned; until then, approved exports can be imported as files.
              </p>
              <ul className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
                {researched.map((entry) => (
                  <CatalogCard key={entry.key} entry={entry} />
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
