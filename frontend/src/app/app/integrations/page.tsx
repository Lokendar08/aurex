"use client";

import { PlusIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { PermissionGate, RequireAccess } from "@/components/app/access";
import { AppPage } from "@/components/app/app-page";
import { CatalogBrowser, useCatalog } from "@/components/app/integrations/catalog";
import { AuthorityRulesPanel, ConnectionList } from "@/components/app/integrations/connections";
import { ACTIVE_JOB, JobsTable } from "@/components/app/integrations/jobs";
import { PageHeader, Panel } from "@/components/app/page";
import { QueryView, TableSkeleton } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useOrgQuery } from "@/hooks/use-org-query";
import { PERMISSIONS } from "@/lib/app/nav";
import type { Integration, SyncJob } from "@/lib/app/types";

export default function IntegrationsPage() {
  return (
    <AppPage>
      <RequireAccess area="the Integration Hub" permission={PERMISSIONS.integrationsRead}>
        <IntegrationHub />
      </RequireAccess>
    </AppPage>
  );
}

const TABS = ["connections", "catalog", "history", "rules"] as const;
type Tab = (typeof TABS)[number];

function IntegrationHub() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const requested = params.get("tab") as Tab | null;
  const tab: Tab = requested && TABS.includes(requested) ? requested : "connections";
  const integrations = useOrgQuery<{ integrations: Integration[] }>("/integrations");
  const counts = integrations.data?.integrations.reduce(
    (acc, i) => {
      if (i.status === "connected") acc.live += 1;
      else if (i.status === "awaiting_credentials" || i.status === "error") acc.attention += 1;
      return acc;
    },
    { live: 0, attention: 0 },
  );

  function setTab(next: string) {
    const query = new URLSearchParams(params.toString());
    if (next === "connections") query.delete("tab");
    else query.set("tab", next);
    const qs = query.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  return (
    <>
      <PageHeader
        title="Integration Hub"
        description="Connections to the systems that supply your data, the catalog of supported and researched vendors, sync history and system-of-record rules."
        meta={
          counts ? (
            <>
              <span>{integrations.data?.integrations.length ?? 0} connections</span>
              <span>{counts.live} connected</span>
              {counts.attention ? <span>{counts.attention} need attention</span> : null}
            </>
          ) : null
        }
        actions={
          <PermissionGate permission={PERMISSIONS.integrationsManage}>
            <Button asChild>
              <Link href="/app/integrations/new">
                <PlusIcon aria-hidden />
                New connection
              </Link>
            </Button>
          </PermissionGate>
        }
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4 max-w-full flex-wrap justify-start group-data-horizontal/tabs:h-auto">
          <TabsTrigger value="connections">Connections</TabsTrigger>
          <TabsTrigger value="catalog">Catalog</TabsTrigger>
          <TabsTrigger value="history">Sync history</TabsTrigger>
          <TabsTrigger value="rules">System of record</TabsTrigger>
        </TabsList>
        <TabsContent value="connections">
          <QueryView query={integrations} loading={<Panel><TableSkeleton rows={6} columns={3} /></Panel>}>
            {(data) => <ConnectionList integrations={data.integrations} />}
          </QueryView>
        </TabsContent>
        <TabsContent value="catalog">
          <CatalogTab />
        </TabsContent>
        <TabsContent value="history">
          <HistoryTab />
        </TabsContent>
        <TabsContent value="rules">
          <Panel title="System-of-record rules" description="Which integration counts for each type of data">
            <AuthorityRulesPanel />
          </Panel>
        </TabsContent>
      </Tabs>
    </>
  );
}

function CatalogTab() {
  const catalog = useCatalog();
  return (
    <QueryView query={catalog} loading={<Panel><TableSkeleton rows={6} columns={3} /></Panel>}>
      {(data) => <CatalogBrowser entries={data.entries} />}
    </QueryView>
  );
}

function HistoryTab() {
  const jobs = useOrgQuery<{ jobs: SyncJob[] }>("/sync-jobs", {
    query: { limit: 50 },
    refetchInterval: (query) => (query.state.data?.jobs.some((j) => ACTIVE_JOB.has(j.status)) ? 2500 : false),
  });
  return (
    <Panel title="Sync history" description="The 50 most recent tests, syncs and uploads across all connections. Open a job for its error log.">
      <QueryView query={jobs} loading={<TableSkeleton rows={8} columns={8} />}>
        {(data) => <JobsTable jobs={data.jobs} showIntegration />}
      </QueryView>
    </Panel>
  );
}
