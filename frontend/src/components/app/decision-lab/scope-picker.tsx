"use client";

import { Building2Icon, ChevronsUpDownIcon, StoreIcon } from "lucide-react";
import { useId, useLayoutEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useFilterOptions } from "@/hooks/use-filter-options";
import type { FilterStore, FiltersResponse } from "@/lib/app/types";
import { cn } from "@/lib/utils";

export type Scope = { companyId?: string; storeIds: string[] };

export function storeLabel(stores: FilterStore[], ids: string[], scoped: boolean): string {
  if (!ids.length) {
    if (scoped) return stores.length === 1 ? `${stores[0].code} ${stores[0].name}` : "All my stores";
    return "All stores";
  }
  if (ids.length === 1) {
    const store = stores.find((s) => s.id === ids[0]);
    return store ? `${store.code} ${store.name}` : "1 store";
  }
  const codes = ids.map((id) => stores.find((s) => s.id === id)?.code).filter(Boolean);
  return codes.length === ids.length && ids.length <= 3 ? codes.join(", ") : `${ids.length} stores`;
}

function StoreChecklist({
  stores,
  selected,
  scoped,
  onApply,
  disabled,
  triggerId,
}: {
  stores: FilterStore[];
  selected: string[];
  scoped: boolean;
  onApply: (ids: string[]) => void;
  disabled?: boolean;
  triggerId: string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>(selected);
  const listId = useId();
  useLayoutEffect(() => () => setOpen(false), []);
  const label = storeLabel(stores, selected, scoped);
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setDraft(selected);
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <Button id={triggerId} variant="outline" className="w-full justify-between bg-background font-normal" disabled={disabled}>
          <span className="flex min-w-0 items-center gap-2">
            <StoreIcon className="text-muted-foreground" aria-hidden />
            <span className="truncate">{label}</span>
          </span>
          <ChevronsUpDownIcon className="text-muted-foreground" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(20rem,calc(100vw-2rem))] gap-0 p-0">
        <div className="border-b px-3 py-2.5">
          <p className="text-sm font-medium">Stores in scope</p>
          <p className="text-xs text-muted-foreground">
            {scoped ? "Only the stores assigned to you are listed." : "Leave all unchecked for the whole company."}
          </p>
        </div>
        <ul id={listId} className="max-h-72 overflow-y-auto p-1.5" aria-label="Stores">
          {stores.map((store) => {
            const id = `${listId}-${store.id}`;
            return (
              <li key={store.id}>
                <label htmlFor={id} className="flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
                  <Checkbox
                    id={id}
                    className="mt-0.5"
                    checked={draft.includes(store.id)}
                    onCheckedChange={(value) =>
                      setDraft((prev) => (value === true ? [...prev, store.id] : prev.filter((s) => s !== store.id)))
                    }
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
              onApply(draft.length === stores.length && !scoped ? [] : draft);
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

/** Company and store selection for a simulation or report. */
export function ScopePicker({
  scope,
  onChange,
  disabled,
  className,
  options: provided,
}: {
  scope: Scope;
  onChange: (scope: Scope) => void;
  disabled?: boolean;
  className?: string;
  /** Pass already-loaded filter options to avoid a second request. */
  options?: FiltersResponse;
}) {
  const query = useFilterOptions(scope.companyId);
  const data = provided ?? query.data;
  const companyId = useId();
  const storesId = useId();

  if (!data) {
    if (query.isPending) {
      return (
        <div className={cn("grid gap-3 sm:grid-cols-2", className)} aria-hidden>
          <Skeleton className="h-8" />
          <Skeleton className="h-8" />
        </div>
      );
    }
    return <p className={cn("text-sm text-muted-foreground", className)}>Companies and stores are unavailable right now.</p>;
  }

  const activeCompany = scope.companyId ?? data.company_id ?? undefined;
  const company = data.companies.find((c) => c.id === activeCompany);
  return (
    <div className={cn("grid gap-3 sm:grid-cols-2", className)}>
      <div className="min-w-0 space-y-1.5">
        <Label htmlFor={companyId}>Company</Label>
        {data.companies.length > 1 ? (
          <Select value={activeCompany} onValueChange={(value) => onChange({ companyId: value, storeIds: [] })} disabled={disabled}>
            <SelectTrigger id={companyId} className="w-full bg-background">
              <Building2Icon className="text-muted-foreground" aria-hidden />
              <SelectValue placeholder="Company" />
            </SelectTrigger>
            <SelectContent position="popper">
              {data.companies.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <p id={companyId} className="flex h-8 items-center gap-2 truncate text-sm font-medium">
            <Building2Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate">{company?.name ?? "Company"}</span>
          </p>
        )}
      </div>
      <div className="min-w-0 space-y-1.5">
        <Label htmlFor={storesId}>Stores</Label>
        {data.stores.length ? (
          <StoreChecklist
            key={activeCompany}
            triggerId={storesId}
            stores={data.stores}
            selected={scope.storeIds}
            scoped={data.store_scoped}
            disabled={disabled}
            onApply={(ids) => onChange({ companyId: scope.companyId, storeIds: ids })}
          />
        ) : (
          <p id={storesId} className="flex h-8 items-center text-sm text-muted-foreground">
            No stores
          </p>
        )}
      </div>
    </div>
  );
}
