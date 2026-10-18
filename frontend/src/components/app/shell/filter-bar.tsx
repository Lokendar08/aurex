"use client";

import { Building2Icon, CalendarIcon, ChevronsUpDownIcon, StoreIcon } from "lucide-react";
import { useId, useLayoutEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useFilterOptions } from "@/hooks/use-filter-options";
import { useFilters } from "@/hooks/use-filters";
import { formatDate } from "@/lib/app/format";
import type { FilterStore } from "@/lib/app/types";
import { cn } from "@/lib/utils";

const TRIGGER = "h-8 max-w-full gap-2 bg-background text-[0.8125rem] font-medium";

function StoresPicker({
  stores,
  selected,
  scoped,
  onChange,
}: {
  stores: FilterStore[];
  selected: string[];
  scoped: boolean;
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>(selected);
  const listId = useId();

  // A popover left open when the page is hidden (Activity) should not reappear on return.
  useLayoutEffect(() => () => setOpen(false), []);

  const allLabel = scoped ? (stores.length === 1 ? `${stores[0].code} ${stores[0].name}` : "All my stores") : "All stores";
  const label =
    selected.length === 0
      ? allLabel
      : selected.length === 1
        ? (stores.find((s) => s.id === selected[0])?.name ?? "1 store")
        : `${selected.length} stores`;

  function toggle(id: string, checked: boolean) {
    setDraft((prev) => (checked ? [...prev, id] : prev.filter((s) => s !== id)));
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setDraft(selected);
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline" size="default" className={cn(TRIGGER, "px-2.5")} aria-label={`Stores: ${label}`}>
          <StoreIcon className="text-muted-foreground" aria-hidden />
          <span className="max-w-[12rem] truncate">{label}</span>
          <ChevronsUpDownIcon className="text-muted-foreground" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 gap-0 p-0">
        <div className="border-b px-3 py-2.5">
          <p className="text-sm font-medium">Stores</p>
          <p className="text-xs text-muted-foreground">
            {scoped ? "You can see the stores assigned to you." : "Leave all unchecked to include every store."}
          </p>
        </div>
        <ul id={listId} className="max-h-72 overflow-y-auto p-1.5" aria-label="Stores">
          {stores.map((store) => {
            const id = `${listId}-${store.id}`;
            return (
              <li key={store.id}>
                <label
                  htmlFor={id}
                  className="flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                >
                  <Checkbox
                    id={id}
                    className="mt-0.5"
                    checked={draft.includes(store.id)}
                    onCheckedChange={(value) => toggle(store.id, value === true)}
                  />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">
                      <span className="text-muted-foreground">{store.code}</span> {store.name}
                    </span>
                    {store.city ? <span className="block text-xs text-muted-foreground">{store.city}</span> : null}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
        <div className="flex items-center justify-between gap-2 border-t px-3 py-2">
          <Button variant="ghost" size="sm" onClick={() => setDraft([])} disabled={draft.length === 0}>
            Clear
          </Button>
          <Button
            size="sm"
            onClick={() => {
              onChange(draft.length === stores.length && !scoped ? [] : draft);
              setOpen(false);
            }}
          >
            Apply
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function CustomRange({
  start,
  end,
  min,
  max,
  onApply,
}: {
  start?: string;
  end?: string;
  min?: string | null;
  max?: string | null;
  onApply: (start: string, end: string) => void;
}) {
  const [from, setFrom] = useState(start ?? "");
  const [to, setTo] = useState(end ?? "");
  const fromId = useId();
  const toId = useId();
  const invalid = Boolean(from && to && from > to);
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (from && to && !invalid) onApply(from, to);
      }}
    >
      <Label htmlFor={fromId} className="sr-only">
        Start date
      </Label>
      <Input
        id={fromId}
        type="date"
        value={from}
        min={min ?? undefined}
        max={max ?? undefined}
        onChange={(e) => setFrom(e.target.value)}
        className="h-8 w-[9.5rem] bg-background text-[0.8125rem]"
        aria-invalid={invalid || undefined}
      />
      <span className="text-sm text-muted-foreground" aria-hidden>
        to
      </span>
      <Label htmlFor={toId} className="sr-only">
        End date
      </Label>
      <Input
        id={toId}
        type="date"
        value={to}
        min={min ?? undefined}
        max={max ?? undefined}
        onChange={(e) => setTo(e.target.value)}
        className="h-8 w-[9.5rem] bg-background text-[0.8125rem]"
        aria-invalid={invalid || undefined}
      />
      <Button type="submit" size="sm" variant="secondary" disabled={!from || !to || invalid}>
        Apply range
      </Button>
      {invalid ? <span className="text-xs text-destructive">The start date must be before the end date.</span> : null}
    </form>
  );
}

/**
 * Company, store and period filters for every analytic page. One row above the content it scopes,
 * stored in the URL (see useFilters).
 */
export function FilterBar() {
  const filters = useFilters();
  const options = useFilterOptions(filters.companyId);
  const data = options.data;

  if (options.isPending) {
    return (
      <div className="flex flex-wrap items-center gap-2" aria-hidden>
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-8 w-36" />
        <Skeleton className="h-8 w-40" />
      </div>
    );
  }
  if (!data) {
    return <p className="text-sm text-muted-foreground">Filters are unavailable right now.</p>;
  }

  const companyId = filters.companyId ?? data.company_id ?? undefined;
  const company = data.companies.find((c) => c.id === companyId);
  const presets = data.periods.filter((p) => p.key !== "custom");
  const hasCustom = data.periods.some((p) => p.key === "custom");

  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filters">
      {data.companies.length > 1 ? (
        <Select value={companyId} onValueChange={(value) => filters.setFilters({ company: value })}>
          <SelectTrigger className={TRIGGER} aria-label="Company">
            <Building2Icon className="text-muted-foreground" aria-hidden />
            <SelectValue placeholder="Company" />
          </SelectTrigger>
          <SelectContent position="popper" align="start">
            {data.companies.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : company ? (
        <span className="inline-flex h-8 max-w-full items-center gap-2 rounded-lg px-1 text-[0.8125rem] font-medium text-foreground">
          <Building2Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="truncate">{company.name}</span>
        </span>
      ) : null}

      {data.stores.length > 0 ? (
        <StoresPicker
          key={companyId}
          stores={data.stores}
          selected={filters.storeIds}
          scoped={data.store_scoped}
          onChange={(ids) => filters.setFilters({ stores: ids })}
        />
      ) : null}

      <Select value={filters.period} onValueChange={(value) => filters.setFilters({ period: value })}>
        <SelectTrigger className={TRIGGER} aria-label="Period">
          <CalendarIcon className="text-muted-foreground" aria-hidden />
          <SelectValue placeholder="Period" />
        </SelectTrigger>
        <SelectContent position="popper" align="start">
          {presets.map((p) => (
            <SelectItem key={p.key} value={p.key}>
              {p.label}
            </SelectItem>
          ))}
          {hasCustom ? (
            <>
              <SelectSeparator />
              <SelectItem value="custom">Custom range</SelectItem>
            </>
          ) : null}
        </SelectContent>
      </Select>

      {filters.period === "custom" ? (
        <CustomRange
          key={`${filters.start}-${filters.end}`}
          start={filters.start}
          end={filters.end}
          min={data.data_start}
          max={data.data_end}
          onApply={(start, end) => filters.setFilters({ period: "custom", start, end })}
        />
      ) : null}

      {data.data_start && data.data_end ? (
        <span className="ml-auto hidden text-xs text-muted-foreground xl:inline">
          Sales data available {formatDate(data.data_start)} to {formatDate(data.data_end)}
        </span>
      ) : null}
    </div>
  );
}
