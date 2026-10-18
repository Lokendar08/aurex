"use client";

import { useSession } from "@/components/app/session-provider";
import type { FiltersResponse } from "@/lib/app/types";

import { useOrgQuery } from "./use-org-query";

/**
 * Companies, permitted stores, data range and period presets for the active organization
 * (GET /orgs/{id}/dashboard/filters). Shared by the filter row, the data-as-of indicator and the
 * synthetic-data banner, so it is fetched once per company.
 */
export function useFilterOptions(companyId?: string) {
  const { hasMembership } = useSession();
  return useOrgQuery<FiltersResponse>("/dashboard/filters", {
    query: companyId ? { company_id: companyId } : undefined,
    enabled: hasMembership,
    staleTime: 5 * 60_000,
    keepPrevious: true,
  });
}
