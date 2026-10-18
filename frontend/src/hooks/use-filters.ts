"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";

import type { QueryParams } from "./use-org-query";

/**
 * Company / store / period filters, kept in the URL so a view can be shared and survives reloads.
 *   ?company=<id>&stores=<id>,<id>&period=last_90d            (preset)
 *   ?period=custom&start=2026-01-01&end=2026-03-31             (custom range)
 * Components using this hook must render inside <Suspense> (useSearchParams).
 */
export const FILTER_KEYS = ["company", "stores", "period", "start", "end"] as const;
export type FilterKey = (typeof FILTER_KEYS)[number];

export type FilterPatch = Partial<{
  company: string | null;
  stores: string[] | null;
  period: string | null;
  start: string | null;
  end: string | null;
}>;

export const DEFAULT_PERIOD = "last_12m";

export function useFilters(defaultPeriod: string = DEFAULT_PERIOD) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const companyId = params.get("company") || undefined;
  const storesParam = params.get("stores") || "";
  const periodParam = params.get("period") || undefined;
  const start = params.get("start") || undefined;
  const end = params.get("end") || undefined;

  const storeIds = useMemo(() => storesParam.split(",").filter(Boolean), [storesParam]);
  const period = periodParam ?? defaultPeriod;
  const customReady = period !== "custom" || Boolean(start && end);

  /** Query parameters for analytics endpoints (company_id, store_ids, period, start, end). */
  const apiQuery = useMemo<QueryParams>(() => {
    const query: QueryParams = { company_id: companyId, period };
    if (storeIds.length) query.store_ids = storeIds;
    if (period === "custom") {
      query.start = start;
      query.end = end;
    }
    return query;
  }, [companyId, period, storeIds, start, end]);

  const setFilters = useCallback(
    (patch: FilterPatch) => {
      const next = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(patch) as [FilterKey, FilterPatch[FilterKey]][]) {
        const text = Array.isArray(value) ? value.join(",") : value;
        if (text) next.set(key, text);
        else next.delete(key);
      }
      if (patch.period && patch.period !== "custom") {
        next.delete("start");
        next.delete("end");
      }
      if (patch.company !== undefined) next.delete("stores"); // stores belong to a company
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  /** The filter part of the current query string, for carrying filters between analytic pages. */
  const filterQueryString = useMemo(() => {
    const next = new URLSearchParams();
    for (const key of FILTER_KEYS) {
      const value = params.get(key);
      if (value) next.set(key, value);
    }
    return next.toString();
  }, [params]);

  return { companyId, storeIds, period, start, end, customReady, apiQuery, setFilters, filterQueryString };
}

export type Filters = ReturnType<typeof useFilters>;
