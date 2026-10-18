"use client";

import { DatabaseIcon, TriangleAlertIcon } from "lucide-react";
import Link from "next/link";
import { useLayoutEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useFilterOptions } from "@/hooks/use-filter-options";
import { useFilters } from "@/hooks/use-filters";
import { useOrgQuery } from "@/hooks/use-org-query";
import { formatDate, parseDate } from "@/lib/app/format";
import { PERMISSIONS } from "@/lib/app/nav";
import type { DataQuality } from "@/lib/app/types";
import { cn } from "@/lib/utils";

import { FreshnessList } from "../freshness";
import { useSession } from "../session-provider";
import { SkeletonBlock } from "../states";

function ageInDays(isoDate: string | null | undefined): number | null {
  const date = parseDate(isoDate);
  if (!date) return null;
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((startOfToday.getTime() - date.getTime()) / 86_400_000);
}

/** "Data through 17 Oct 2026" with the sources behind it. */
export function DataAsOf() {
  const { has } = useSession();
  const { companyId } = useFilters();
  const options = useFilterOptions(companyId);
  const [open, setOpen] = useState(false);
  const canSeeQuality = has(PERMISSIONS.dataQualityRead);
  const quality = useOrgQuery<DataQuality>("/data/quality", {
    query: companyId ? { company_id: companyId } : undefined,
    enabled: open && canSeeQuality,
    staleTime: 5 * 60_000,
  });

  useLayoutEffect(() => () => setOpen(false), []);

  const dataEnd = options.data?.data_end ?? null;
  if (!options.data) return null;
  const age = ageInDays(dataEnd);
  const stale = age !== null && age > 3;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn("h-8 gap-1.5 px-2 text-[0.8125rem] font-normal text-muted-foreground", stale && "text-foreground")}
        >
          {stale ? (
            <TriangleAlertIcon className="text-warning" aria-hidden />
          ) : (
            <DatabaseIcon className="text-muted-foreground" aria-hidden />
          )}
          {dataEnd ? (
            <span>
              <span className="hidden sm:inline">Data through </span>
              <span className="font-medium text-foreground">{formatDate(dataEnd)}</span>
            </span>
          ) : (
            <span>No data yet</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(24rem,calc(100vw-2rem))] gap-3 p-4">
        <div>
          <p className="font-medium">Data freshness</p>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            {dataEnd
              ? `Sales data runs from ${formatDate(options.data.data_start)} to ${formatDate(dataEnd)}.`
              : "No sales data has been ingested for this company yet."}
            {stale ? ` The latest sales day is ${age} days old.` : ""}
          </p>
        </div>
        {canSeeQuality ? (
          quality.isPending ? (
            <div className="space-y-2">
              <SkeletonBlock className="h-4 w-full" />
              <SkeletonBlock className="h-4 w-4/5" />
              <SkeletonBlock className="h-4 w-3/5" />
            </div>
          ) : quality.data ? (
            <FreshnessList entries={quality.data.freshness} compact />
          ) : (
            <p className="text-sm text-muted-foreground">{quality.error?.message ?? "Source details are unavailable."}</p>
          )
        ) : (
          <p className="text-sm text-muted-foreground">Source-level freshness is shown to roles with data quality access.</p>
        )}
        {canSeeQuality ? (
          <Button asChild variant="outline" size="sm" className="self-start">
            <Link href="/app/data-quality" onClick={() => setOpen(false)}>
              Open Data Quality
            </Link>
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
