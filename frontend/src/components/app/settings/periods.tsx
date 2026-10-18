"use client";

import { useState } from "react";

import { StatusBadge } from "@/components/app/badges";
import { DataTable, type Column } from "@/components/app/data-table";
import { MONTHS, SelectField } from "@/components/app/form";
import { Panel } from "@/components/app/page";
import { EmptyState, QueryView, TableSkeleton } from "@/components/app/states";
import { useOrgQuery } from "@/hooks/use-org-query";
import { formatDate, humanize } from "@/lib/app/format";
import type { FiscalPeriod } from "@/lib/app/types";

import { useCompanies } from "./structure";

/** Fiscal calendar of a company: months grouped into fiscal quarters and years. */
export function PeriodsSettings() {
  const companies = useCompanies();
  const [companyId, setCompanyId] = useState<string>("");
  const [year, setYear] = useState<string>("");
  const company = companies.data?.companies.find((c) => c.id === companyId) ?? companies.data?.companies[0];
  const periods = useOrgQuery<{ fiscal_year_start_month: number; periods: FiscalPeriod[] }>(company ? `/companies/${company.id}/periods` : null);
  const years = Array.from(new Set((periods.data?.periods ?? []).map((p) => p.fiscal_year))).sort((a, b) => b - a);
  const today = new Date().toISOString().slice(0, 10);
  const currentYear = periods.data?.periods.find((p) => p.period_start <= today && p.period_end >= today)?.fiscal_year;
  const selectedYear = year ? Number(year) : (currentYear ?? years[0]);
  const rows = (periods.data?.periods ?? []).filter((p) => p.fiscal_year === selectedYear);
  const columns: Column<FiscalPeriod>[] = [
    { key: "label", header: "Month", cell: (p) => <span className="font-medium">{p.label}</span> },
    { key: "fm", header: "Fiscal month", align: "right", cell: (p) => p.fiscal_month },
    { key: "fq", header: "Quarter", cell: (p) => `Q${p.fiscal_quarter}` },
    { key: "start", header: "Starts", cell: (p) => formatDate(p.period_start) },
    { key: "end", header: "Ends", cell: (p) => formatDate(p.period_end) },
    {
      key: "status",
      header: "Status",
      cell: (p) => <StatusBadge tone={p.status === "open" ? "info" : "neutral"}>{humanize(p.status)}</StatusBadge>,
    },
  ];
  return (
    <Panel
      title="Fiscal periods"
      description={
        periods.data
          ? `The fiscal year starts in ${MONTHS[periods.data.fiscal_year_start_month - 1]}. FY${selectedYear ?? ""} is named after the calendar year it ends in.`
          : "The fiscal calendar used for year-to-date and fiscal-year periods"
      }
    >
      <div className="mb-4 flex flex-wrap gap-4">
        {(companies.data?.companies.length ?? 0) > 1 ? (
          <SelectField
            label="Company"
            value={company?.id ?? ""}
            onChange={(v) => {
              setCompanyId(v);
              setYear("");
            }}
            options={(companies.data?.companies ?? []).map((c) => ({ value: c.id, label: c.name }))}
            className="w-64"
          />
        ) : null}
        {years.length ? (
          <SelectField
            label="Fiscal year"
            value={String(selectedYear)}
            onChange={setYear}
            options={years.map((y) => ({ value: String(y), label: `FY${y}${y === currentYear ? " (current)" : ""}` }))}
            className="w-48"
          />
        ) : null}
      </div>
      <QueryView query={periods} loading={<TableSkeleton rows={12} columns={5} />}>
        {() => (
          <DataTable caption={`Fiscal periods FY${selectedYear}`} columns={columns} rows={rows} rowKey={(p) => p.id} dense empty={<EmptyState compact title="No fiscal periods defined" />} />
        )}
      </QueryView>
    </Panel>
  );
}
