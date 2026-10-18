"use client";

import { DatabaseIcon } from "lucide-react";
import { useLayoutEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatDate, formatNumber, formatRelative, humanize } from "@/lib/app/format";
import type { FreshnessEntry } from "@/lib/app/types";
import { cn } from "@/lib/utils";

const FACT_LABELS: Record<string, string> = {
  sales: "Sales",
  traffic: "Store traffic",
  inventory: "Inventory snapshots",
  inventory_movements: "Stock movements",
  purchasing: "Purchase orders",
  expenses: "Expenses",
  cash: "Cash flow",
  cash_balances: "Cash balances",
  budgets: "Budgets",
  workforce: "Workforce",
  marketing: "Marketing spend",
  customers: "Customer aggregates",
};

export function factLabel(fact: string): string {
  return FACT_LABELS[fact] ?? humanize(fact);
}

/** Latest data date per fact type and the integrations that supplied it. */
export function FreshnessList({ entries, compact }: { entries: FreshnessEntry[]; compact?: boolean }) {
  return (
    <ul className={cn("divide-y", compact ? "-mx-1 max-h-72 overflow-y-auto pr-1" : "")}>
      {entries.map((entry) => (
        <li key={entry.fact} className={cn("flex items-start justify-between gap-3", compact ? "px-1 py-2" : "py-3")}>
          <div className="min-w-0">
            <p className="text-sm font-medium">{factLabel(entry.fact)}</p>
            {entry.sources.length ? (
              <ul className="mt-0.5 space-y-0.5">
                {entry.sources.map((source) => (
                  <li key={source.integration_id} className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                    <span className="truncate">{source.name}</span>
                    {source.is_demo ? (
                      <Badge variant="outline" className="h-4 px-1.5 text-[0.6875rem] font-normal">
                        Synthetic
                      </Badge>
                    ) : null}
                    <span>
                      {formatNumber(source.records)} records
                      {source.last_successful_sync_at ? `, synced ${formatRelative(source.last_successful_sync_at)}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">No source has supplied this yet</p>
            )}
          </div>
          <div className="shrink-0 text-right">
            {entry.status === "ok" ? (
              <p className="text-sm tabular">{formatDate(entry.latest_date)}</p>
            ) : (
              <p className="text-sm text-muted-foreground">No data</p>
            )}
            {entry.multiple_sources ? <p className="text-xs text-muted-foreground">Several sources</p> : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** "Sources" button that explains where a page's numbers come from. */
export function SourcesPopover({ entries, dataEnd, label = "Sources" }: { entries: FreshnessEntry[]; dataEnd?: string | null; label?: string }) {
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => () => setOpen(false), []);
  const withData = entries.filter((e) => e.status === "ok").length;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <DatabaseIcon aria-hidden />
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(26rem,calc(100vw-2rem))] gap-2 p-4">
        <div>
          <p className="font-medium">Sources and freshness</p>
          <p className="text-sm text-muted-foreground">
            {withData} of {entries.length} data types have data{dataEnd ? `; sales through ${formatDate(dataEnd)}` : ""}. When
            several systems report the same facts, only the system of record is counted.
          </p>
        </div>
        <FreshnessList entries={entries} compact />
      </PopoverContent>
    </Popover>
  );
}
