"use client";

import { ArrowLeftIcon, ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { RequireAccess } from "@/components/app/access";
import { AppPage } from "@/components/app/app-page";
import { AvailabilityBadge } from "@/components/app/badges";
import { isConnectable, useCatalog, useEntities } from "@/components/app/integrations/catalog";
import { ConnectionForm } from "@/components/app/integrations/connection-form";
import { PageHeader, Panel } from "@/components/app/page";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { useOrgQuery } from "@/hooks/use-org-query";
import { categoryLabel, methodLabel } from "@/lib/app/labels";
import { PERMISSIONS } from "@/lib/app/nav";
import type { Company } from "@/lib/app/types";

export default function NewConnectionPage() {
  return (
    <AppPage>
      <RequireAccess area="creating connections" permission={PERMISSIONS.integrationsManage}>
        <NewConnection />
      </RequireAccess>
    </AppPage>
  );
}

function NewConnection() {
  const params = useSearchParams();
  const providerKey = params.get("provider");
  const catalog = useCatalog();
  const entities = useEntities();
  const companies = useOrgQuery<{ companies: Company[] }>("/companies");
  const entry = catalog.data?.entries.find((e) => e.key === providerKey && isConnectable(e));

  const back = (
    <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
      <Link href="/app/integrations?tab=catalog">
        <ArrowLeftIcon aria-hidden />
        Catalog
      </Link>
    </Button>
  );

  if (catalog.isPending || companies.isPending || entities.isPending) {
    return (
      <>
        {back}
        <PageHeader title="New connection" />
        <Panel>
          <TableSkeleton rows={6} columns={2} />
        </Panel>
      </>
    );
  }
  const error = catalog.error ?? companies.error ?? entities.error;
  if (error) {
    return (
      <>
        {back}
        <PageHeader title="New connection" />
        <Panel>
          <ErrorState error={error} onRetry={() => void Promise.all([catalog.refetch(), companies.refetch(), entities.refetch()])} />
        </Panel>
      </>
    );
  }

  if (!entry) {
    const options = (catalog.data?.entries ?? []).filter(isConnectable);
    return (
      <>
        {back}
        <PageHeader
          title="New connection"
          description={providerKey ? "That provider can’t be set up from here. Choose one of the available methods." : "Choose how the data will reach AUREX."}
        />
        {options.length === 0 ? (
          <EmptyState title="No providers are available" />
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {options.map((option) => (
              <li key={option.key}>
                <Link
                  href={`/app/integrations/new?provider=${encodeURIComponent(option.key)}`}
                  className="group flex h-full items-start gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10 transition-colors outline-none hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{option.name}</span>
                      <AvailabilityBadge availability={option.availability} />
                    </div>
                    <p className="mt-1 line-clamp-2 text-[0.8125rem] text-muted-foreground">{option.summary}</p>
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      {option.methods.map(methodLabel).join(", ")}
                      {option.categories.length ? `; ${option.categories.map(categoryLabel).join(", ")}` : ""}
                    </p>
                  </div>
                  <ChevronRightIcon className="mt-1 size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </>
    );
  }

  return (
    <>
      {back}
      <PageHeader title={`Connect ${entry.name}`} description="Fill in the settings below. Credentials are stored encrypted and never displayed again." />
      <div className="max-w-4xl">
        <ConnectionForm key={entry.key} entry={entry} companies={companies.data?.companies ?? []} entities={entities.data?.entities ?? []} />
      </div>
    </>
  );
}
