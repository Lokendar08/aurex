"use client";

import { CheckIcon } from "lucide-react";

import { useSession } from "@/components/app/session-provider";
import { QueryView, TableSkeleton } from "@/components/app/states";
import { cn } from "@/lib/utils";

import { useRoles } from "./members";

const PERMISSION_LABELS: Record<string, string> = {
  "org:read": "View organization",
  "org:manage": "Manage organization, companies and stores",
  "members:read": "View members",
  "members:manage": "Manage members and invitations",
  "integrations:read": "View integrations",
  "integrations:manage": "Manage integrations",
  "data:import": "Import data files",
  "data_quality:read": "View data quality",
  "dashboard:read": "Executive dashboard",
  "sales:read": "Sales",
  "finance:read": "Finance and profit",
  "inventory:read": "Inventory",
  "suppliers:read": "Suppliers",
  "workforce:read": "Workforce",
  "forecasts:read": "View forecasts",
  "forecasts:run": "Train and run forecasts",
  "scenarios:read": "View scenarios",
  "scenarios:write": "Create scenarios",
  "advisor:use": "Use the AI advisor",
  "intelligence:read": "Company intelligence and news",
  "intelligence:manage": "Manage intelligence sources",
  "reports:read": "View reports",
  "reports:generate": "Generate reports",
  "recommendations:read": "View recommendations",
  "recommendations:write": "Create recommendations",
  "recommendations:approve": "Approve recommendations",
  "tasks:read": "View tasks",
  "tasks:manage": "Manage tasks",
  "audit:read": "Audit trail",
};

/** Roles × permissions, exactly as the backend enforces them (GET /roles). */
export function RolesMatrix() {
  const { membership } = useSession();
  const roles = useRoles();
  return (
    <QueryView query={roles} loading={<TableSkeleton rows={10} columns={6} />}>
      {(data) => (
        <div className="space-y-5">
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {data.roles.map((r) => (
              <li key={r.role} className={cn("rounded-lg p-3 ring-1 ring-foreground/10", r.role === membership?.role && "bg-brand-50/60 ring-brand-200 dark:bg-brand-800/20")}>
                <p className="text-sm font-medium">
                  {r.label}
                  {r.role === membership?.role ? <span className="ml-1.5 text-xs font-normal text-muted-foreground">(your role)</span> : null}
                </p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{r.description}</p>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {r.permissions.length} permissions{r.store_scoped_by_default ? ", usually limited to specific stores" : ""}
                </p>
              </li>
            ))}
          </ul>
          <div className="relative overflow-x-auto rounded-lg ring-1 ring-foreground/8" role="region" aria-label="Permissions by role" tabIndex={0}>
            <table className="w-full border-collapse text-[0.8125rem]">
              <caption className="sr-only">Permissions granted to each role</caption>
              <thead className="bg-muted/60">
                <tr className="border-b">
                  <th scope="col" className="sticky left-0 z-[1] min-w-[15rem] bg-muted px-3 py-2 text-left font-medium text-muted-foreground">
                    Permission
                  </th>
                  {data.roles.map((r) => (
                    <th key={r.role} scope="col" className="min-w-[6.5rem] px-2 py-2 text-center align-bottom text-xs leading-tight font-medium text-muted-foreground">
                      {r.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.all_permissions.map((permission) => (
                  <tr key={permission} className="border-b last:border-b-0 hover:bg-muted/30">
                    <th scope="row" className="sticky left-0 z-[1] bg-card px-3 py-1.5 text-left font-normal">
                      {PERMISSION_LABELS[permission] ?? permission}
                      <span className="block font-mono text-[0.6875rem] text-muted-foreground">{permission}</span>
                    </th>
                    {data.roles.map((r) => {
                      const granted = r.permissions.includes(permission);
                      return (
                        <td key={r.role} className="px-2 py-1.5 text-center">
                          {granted ? (
                            <>
                              <CheckIcon className="mx-auto size-4 text-primary" aria-hidden />
                              <span className="sr-only">Granted</span>
                            </>
                          ) : (
                            <>
                              <span className="text-muted-foreground/50" aria-hidden>
                                –
                              </span>
                              <span className="sr-only">Not granted</span>
                            </>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </QueryView>
  );
}
