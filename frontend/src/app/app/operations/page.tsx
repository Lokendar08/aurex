"use client";

import { TriangleAlertIcon } from "lucide-react";

import { RequireAccess } from "@/components/app/access";
import { AppPage } from "@/components/app/app-page";
import { StatusBadge } from "@/components/app/badges";
import { DataTable, type Column } from "@/components/app/data-table";
import { ChangeIndicator } from "@/components/app/kpi";
import { NoteList, PageHeader, Panel, SectionHeading } from "@/components/app/page";
import { MethodNotes, StockoutRiskTable } from "@/components/app/sections/inventory";
import { StoresPanel } from "@/components/app/sections/stores";
import { useSession } from "@/components/app/session-provider";
import { EmptyState, QueryView, TableSkeleton } from "@/components/app/states";
import { useFilters } from "@/hooks/use-filters";
import { useOrgQuery } from "@/hooks/use-org-query";
import { formatDays, formatMoney, formatNumber, formatPercent } from "@/lib/app/format";
import { PERMISSIONS } from "@/lib/app/nav";
import type { InventoryReport, StoresReport, SupplierReport, SupplierRow, WorkforceReport, WorkforceStore } from "@/lib/app/types";

export default function OperationsPage() {
  return (
    <AppPage>
      <RequireAccess area="Operations" allOf={[PERMISSIONS.salesRead, PERMISSIONS.inventoryRead]}>
        <Operations />
      </RequireAccess>
    </AppPage>
  );
}

function Operations() {
  const { membership, has } = useSession();
  const filters = useFilters();
  const scoped = Boolean(membership?.store_scope?.length);
  const enabled = filters.customReady;
  const stores = useOrgQuery<StoresReport>("/analytics/stores", { query: filters.apiQuery, enabled, keepPrevious: true });

  return (
    <>
      <PageHeader
        title="Operations"
        description={
          scoped
            ? "Performance, stock risk, supplier delays and staffing for the stores assigned to you."
            : "Store performance, stock risk, supplier delays and staffing across the stores you select."
        }
        meta={stores.data ? <span>{stores.data.period.label}</span> : null}
      />
      {!enabled ? (
        <EmptyState title="Choose a date range" description="Pick a start and end date in the filter row." />
      ) : (
        <div className="space-y-6">
          <QueryView query={stores} loading={<Panel><TableSkeleton /></Panel>}>
            {(data) => (
              <StoresPanel
                title="Store productivity"
                stores={data.stores}
                currency={data.currency}
                finance={has(PERMISSIONS.financeRead)}
                notes={data.notes}
                dimmed={stores.isPlaceholderData}
                initialView="table"
              />
            )}
          </QueryView>

          <SectionHeading title="Stock at risk" description="Positions that may run out before the next delivery arrives" />
          <StockRisks />

          {has(PERMISSIONS.suppliersRead) ? (
            <>
              <SectionHeading title="Supplier alerts" description="Suppliers whose recent lead times are well above their earlier average" />
              <SupplierAlerts />
            </>
          ) : null}

          {has(PERMISSIONS.workforceRead) ? (
            <>
              <SectionHeading title="Staffing" description="Hours, labor cost and productivity per store for the period" />
              <Staffing />
            </>
          ) : null}
        </div>
      )}
    </>
  );
}

function StockRisks() {
  const filters = useFilters();
  const query = useOrgQuery<InventoryReport>("/analytics/inventory", { query: filters.apiQuery, keepPrevious: true });
  return (
    <QueryView query={query} loading={<Panel><TableSkeleton /></Panel>}>
      {(data) => (
        <Panel
          title="Stockout risk"
          description={
            data.risks.risk_counts
              ? `${(data.risks.risk_counts.stocked_out ?? 0) + (data.risks.risk_counts.high ?? 0) + (data.risks.risk_counts.medium ?? 0)} of ${data.risks.positions ?? 0} positions need attention`
              : undefined
          }
          footer={<MethodNotes method={data.risks.method} limitations={data.risks.limitations} />}
          dimmed={query.isPlaceholderData}
        >
          {data.risks.status === "ok" ? (
            <StockoutRiskTable rows={data.risks.stockout_risks} currency={data.currency} pageSize={8} />
          ) : (
            <EmptyState compact title="No recent inventory positions" description={data.risks.note} />
          )}
        </Panel>
      )}
    </QueryView>
  );
}

function SupplierAlerts() {
  const filters = useFilters();
  const query = useOrgQuery<SupplierReport>("/analytics/suppliers", { query: filters.apiQuery, keepPrevious: true });
  return (
    <QueryView query={query} loading={<Panel><TableSkeleton rows={3} /></Panel>}>
      {(data) => {
        const alerts = data.suppliers.filter((s) => s.alert);
        const columns: Column<SupplierRow>[] = [
          {
            key: "supplier",
            header: "Supplier",
            cell: (r) => (
              <span className="inline-flex items-center gap-2 font-medium">
                <StatusBadge tone="danger" icon={TriangleAlertIcon}>
                  Slowing
                </StatusBadge>
                {r.supplier}
              </span>
            ),
            sortValue: (r) => r.supplier,
          },
          { key: "contracted", header: "Contracted", align: "right", cell: (r) => formatDays(r.contracted_lead_days), sortValue: (r) => r.contracted_lead_days },
          { key: "avg", header: "Average", align: "right", cell: (r) => formatDays(r.avg_lead_days), sortValue: (r) => r.avg_lead_days },
          { key: "recent", header: "Last 60 days", align: "right", cell: (r) => formatDays(r.recent_avg_lead_days), sortValue: (r) => r.recent_avg_lead_days },
          {
            key: "change",
            header: "Change",
            align: "right",
            cell: (r) => (
              <ChangeIndicator change={r.lead_time_change_recent_vs_prior} direction="down">
                {formatPercent(r.lead_time_change_recent_vs_prior, { signed: true })}
              </ChangeIndicator>
            ),
            sortValue: (r) => r.lead_time_change_recent_vs_prior,
          },
          { key: "open", header: "Open orders", align: "right", cell: (r) => formatNumber(r.open_orders), sortValue: (r) => r.open_orders },
          { key: "ontime", header: "On time", align: "right", cell: (r) => formatPercent(r.on_time_rate), sortValue: (r) => r.on_time_rate },
        ];
        return (
          <Panel
            title="Suppliers needing follow-up"
            description={`${alerts.length} of ${data.suppliers.length} suppliers flagged`}
            footer={data.method ? <NoteList notes={[data.method]} /> : undefined}
            dimmed={query.isPlaceholderData}
          >
            <DataTable
              caption="Supplier alerts"
              columns={columns}
              rows={alerts}
              rowKey={(r) => r.supplier_code}
              dense
              empty={
                <EmptyState
                  compact
                  title="No supplier is slowing down"
                  description="No supplier's last 60 days of lead times are more than 40% above its earlier average."
                />
              }
            />
          </Panel>
        );
      }}
    </QueryView>
  );
}

function Staffing() {
  const filters = useFilters();
  const query = useOrgQuery<WorkforceReport>("/analytics/workforce", { query: filters.apiQuery, keepPrevious: true });
  return (
    <QueryView query={query} loading={<Panel><TableSkeleton /></Panel>}>
      {(data) => {
        const columns: Column<WorkforceStore>[] = [
          { key: "store", header: "Store", cell: (r) => <span className="font-medium">{r.store_code}</span>, sortValue: (r) => r.store_code },
          { key: "headcount", header: "Headcount (latest month)", align: "right", cell: (r) => formatNumber(r.headcount), sortValue: (r) => r.headcount },
          { key: "hours", header: "Hours worked", align: "right", cell: (r) => formatNumber(r.hours, { currency: data.currency }), sortValue: (r) => r.hours },
          { key: "cost", header: "Labor cost", align: "right", cell: (r) => formatMoney(r.labor_cost, data.currency, { compact: true }), sortValue: (r) => r.labor_cost },
          { key: "ratio", header: "Labor % of sales", align: "right", cell: (r) => formatPercent(r.labor_cost_ratio), sortValue: (r) => r.labor_cost_ratio },
          { key: "splh", header: "Sales / labor hour", align: "right", cell: (r) => formatMoney(r.sales_per_labor_hour, data.currency), sortValue: (r) => r.sales_per_labor_hour },
          {
            key: "tplh",
            header: "Transactions / labor hour",
            align: "right",
            cell: (r) => formatNumber(r.transactions_per_labor_hour, { decimals: 2 }),
            sortValue: (r) => r.transactions_per_labor_hour,
          },
        ];
        return (
          <Panel title="Staffing by store" description={data.note} dimmed={query.isPlaceholderData}>
            {data.status === "ok" ? (
              <DataTable caption="Staffing by store" columns={columns} rows={data.stores} rowKey={(r) => r.store_code} dense defaultSort={{ key: "store", dir: "asc" }} />
            ) : (
              <EmptyState compact title="No workforce data" description="Workforce aggregates arrive from the HRIS or payroll feed." />
            )}
          </Panel>
        );
      }}
    </QueryView>
  );
}
