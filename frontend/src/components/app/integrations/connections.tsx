"use client";

import { CableIcon, ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

import { PermissionGate } from "@/components/app/access";
import { IntegrationStatusBadge, SyntheticFeedBadge } from "@/components/app/badges";
import { DataTable, type Column } from "@/components/app/data-table";
import { useSession } from "@/components/app/session-provider";
import { EmptyState, QueryView, TableSkeleton } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useInvalidateOrg, useOrgMutation, useOrgQuery } from "@/hooks/use-org-query";
import { formatDateTime, formatNumber, formatRelative } from "@/lib/app/format";
import { methodLabel } from "@/lib/app/labels";
import { PERMISSIONS } from "@/lib/app/nav";
import type { AuthorityRules, Company, Integration } from "@/lib/app/types";

import { factLabel } from "../freshness";

/** Every connection with an honest status: only a passing live test reads as connected. */
export function ConnectionList({ integrations }: { integrations: Integration[] }) {
  if (!integrations.length) {
    return (
      <EmptyState
        icon={CableIcon}
        title="No connections yet"
        description="Connect a POS, ERP, accounting or workforce system, or import approved exports as files."
        action={
          <PermissionGate permission={PERMISSIONS.integrationsManage}>
            <Button asChild>
              <Link href="/app/integrations/new">New connection</Link>
            </Button>
          </PermissionGate>
        }
      />
    );
  }
  return (
    <ul className="divide-y overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
      {integrations.map((i) => (
        <li key={i.id}>
          <Link
            href={`/app/integrations/${i.id}`}
            className="group flex items-start gap-4 px-4 py-4 transition-colors outline-none hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset sm:px-5"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-foreground">{i.display_name}</span>
                <IntegrationStatusBadge status={i.status} />
                {i.is_demo ? <SyntheticFeedBadge /> : null}
              </div>
              <p className="mt-1 text-[0.8125rem] text-muted-foreground">
                {i.provider_name}
                {i.methods.length ? ` (${i.methods.map(methodLabel).join(", ")})` : ""}
              </p>
              {i.status_detail ? <p className="mt-1 line-clamp-2 text-[0.8125rem] text-muted-foreground">{i.status_detail}</p> : null}
            </div>
            <div className="hidden shrink-0 text-right text-[0.8125rem] sm:block">
              <p className="text-muted-foreground">Last successful sync</p>
              <p className="font-medium" title={formatDateTime(i.last_successful_sync_at)}>
                {i.last_successful_sync_at ? formatRelative(i.last_successful_sync_at) : "Never"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{formatNumber(i.sync_job_count ?? 0)} sync jobs</p>
            </div>
            <ChevronRightIcon className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
          </Link>
        </li>
      ))}
    </ul>
  );
}

const FACT_ENTITIES: Record<string, string[]> = {
  sales: ["sales"],
  traffic: ["traffic"],
  inventory: ["inventory_snapshot", "inventory_movement"],
  purchasing: ["purchase_order", "purchase_order_line"],
  expenses: ["expense"],
  cash: ["cash_flow", "cash_balance"],
  budgets: ["budget"],
  workforce: ["workforce"],
  marketing: ["marketing_spend"],
  customers: ["customer_metric"],
};

/** Which integration is the system of record for each type of fact (prevents double counting). */
export function AuthorityRulesPanel() {
  const { has } = useSession();
  const canManage = has(PERMISSIONS.integrationsManage);
  const invalidate = useInvalidateOrg();
  const rules = useOrgQuery<AuthorityRules>("/integrations-authorities");
  const integrations = useOrgQuery<{ integrations: Integration[] }>("/integrations");
  const companies = useOrgQuery<{ companies: Company[] }>("/companies");
  const save = useOrgMutation<{ company_id: string; fact_type: string; integration_id: string }>(
    (body, call) => call("/integrations-authorities", { method: "PUT", json: body }),
    {
      onSuccess: () => {
        toast.success("System of record updated");
        void invalidate("/integrations-authorities", "/dashboard", "/analytics", "/data");
      },
      onError: (error) => toast.error(error.message),
    },
  );

  return (
    <QueryView query={rules} loading={<TableSkeleton rows={8} columns={3} />}>
      {(data) => {
        const company = companies.data?.companies[0];
        const all = integrations.data?.integrations ?? [];
        type Row = { fact: string; rule: AuthorityRules["rules"][number] | undefined };
        const rows: Row[] = data.fact_types.map((fact) => ({
          fact,
          rule: data.rules.find((r) => r.fact_type === fact && r.store_id === null && (!company || r.company_id === company.id)),
        }));
        const columns: Column<Row>[] = [
          { key: "fact", header: "Data type", cell: (r) => <span className="font-medium">{factLabel(r.fact)}</span> },
          {
            key: "source",
            header: "System of record",
            cell: (r) => {
              const candidates = all.filter(
                (i) => (!company || i.company_id === company.id) && (FACT_ENTITIES[r.fact] ?? []).some((e) => i.supported_entities.includes(e)),
              );
              const current = all.find((i) => i.id === r.rule?.integration_id);
              if (!canManage || !company) {
                return current ? current.display_name : <span className="text-muted-foreground">Default rule</span>;
              }
              return (
                <Select
                  value={r.rule?.integration_id ?? "__default"}
                  disabled={save.isPending}
                  onValueChange={(value) => {
                    if (value === "__default") return;
                    save.mutate({ company_id: company.id, fact_type: r.fact, integration_id: value });
                  }}
                >
                  <SelectTrigger size="sm" className="w-full max-w-[22rem] bg-background" aria-label={`System of record for ${factLabel(r.fact)}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    <SelectItem value="__default" disabled={Boolean(r.rule)}>
                      Default: earliest integration that supplied it
                    </SelectItem>
                    <SelectSeparator />
                    {candidates.map((i) => (
                      <SelectItem key={i.id} value={i.id}>
                        {i.display_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              );
            },
          },
          {
            key: "status",
            header: "Rule",
            cell: (r) => (r.rule ? "Explicit rule" : <span className="text-muted-foreground">Default</span>),
          },
        ];
        return (
          <div className="space-y-3">
            <p className="text-sm leading-relaxed text-muted-foreground">
              When two systems report the same facts (for example a POS and an ERP both sending sales), only the system of record is
              counted. {data.default_rule}
            </p>
            <DataTable caption="System-of-record rules" columns={columns} rows={rows} rowKey={(r) => r.fact} dense />
          </div>
        );
      }}
    </QueryView>
  );
}
