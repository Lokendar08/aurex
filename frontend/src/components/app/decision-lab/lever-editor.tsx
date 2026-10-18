"use client";

import {
  BoxesIcon,
  ChevronDownIcon,
  ChevronsUpDownIcon,
  CircleAlertIcon,
  HeartHandshakeIcon,
  MegaphoneIcon,
  PackageSearchIcon,
  PercentIcon,
  PlusIcon,
  ReceiptTextIcon,
  ShuffleIcon,
  StoreIcon,
  Trash2Icon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";
import { useId, useLayoutEffect, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  leverAdvice,
  LEVER_FIELDS,
  noteRequired,
  OPERATING_EXPENSE_CATEGORIES,
  rangeText,
  visibleFields,
  type FieldDef,
  type LeverDraft,
  type LeverErrors,
} from "@/lib/app/decision-lab-levers";
import type { DecisionEvidence, EvidenceCategory, LeverType } from "@/lib/app/decision-lab-types";
import { formatDate, formatMoney, formatMonth, formatNumber, formatPercent, humanize } from "@/lib/app/format";
import { cn } from "@/lib/utils";

export const LEVER_ICONS: Record<LeverType, LucideIcon> = {
  workforce: UsersIcon,
  price: PercentIcon,
  marketing: MegaphoneIcon,
  supplier_cost: PackageSearchIcon,
  inventory: BoxesIcon,
  new_store: StoreIcon,
  opex: ReceiptTextIcon,
  retention: HeartHandshakeIcon,
  product_mix: ShuffleIcon,
};

export const LEVER_LABELS: Record<LeverType, string> = {
  workforce: "Workforce",
  price: "Pricing",
  marketing: "Marketing spend",
  supplier_cost: "Supplier costs",
  inventory: "Inventory & reorder policy",
  new_store: "Open new stores",
  opex: "Operating expenses",
  retention: "Customer retention",
  product_mix: "Product mix",
};

function currencySymbol(currency: string): string {
  try {
    const part = new Intl.NumberFormat("en-IN", { style: "currency", currency, currencyDisplay: "narrowSymbol" })
      .formatToParts(0)
      .find((p) => p.type === "currency");
    return part?.value ?? currency;
  } catch {
    return currency;
  }
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="flex items-center gap-1.5 text-xs text-destructive">
      <CircleAlertIcon className="size-3.5 shrink-0" aria-hidden />
      {message}
    </p>
  );
}

function CategoryMultiSelect({
  id,
  categories,
  value,
  onChange,
  describedBy,
}: {
  id: string;
  categories: EvidenceCategory[];
  value: string[];
  onChange: (value: string[]) => void;
  describedBy?: string;
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  useLayoutEffect(() => () => setOpen(false), []);
  const label = value.length === 0 ? "All categories" : value.length <= 2 ? value.map((code) => categories.find((c) => c.code === code)?.name ?? code).join(", ") : `${value.length} categories`;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button id={id} variant="outline" className="w-full justify-between bg-background font-normal" aria-describedby={describedBy}>
          <span className="truncate">{label}</span>
          <ChevronsUpDownIcon className="text-muted-foreground" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(20rem,calc(100vw-2rem))] gap-0 p-0">
        {categories.length ? (
          <ul id={listId} className="max-h-72 overflow-y-auto p-1.5" aria-label="Categories">
            {categories.map((category) => {
              const checkId = `${listId}-${category.code}`;
              return (
                <li key={category.code}>
                  <label htmlFor={checkId} className="flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
                    <Checkbox
                      id={checkId}
                      className="mt-0.5"
                      checked={value.includes(category.code)}
                      onCheckedChange={(checked) =>
                        onChange(checked === true ? [...value, category.code] : value.filter((c) => c !== category.code))
                      }
                    />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{category.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {formatPercent(category.share, { decimals: 0 })} of sales · margin {formatPercent(category.gross_margin)}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="px-3 py-3 text-sm text-muted-foreground">Categories load with the evidence for this scope.</p>
        )}
        <div className="flex justify-between gap-2 border-t px-3 py-2">
          <Button variant="ghost" size="sm" onClick={() => onChange([])} disabled={!value.length}>
            All categories
          </Button>
          <Button size="sm" onClick={() => setOpen(false)}>
            Done
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function FieldControl({
  field,
  draft,
  error,
  currency,
  categories,
  onValue,
}: {
  field: FieldDef;
  draft: LeverDraft;
  error?: string;
  currency: string;
  categories: EvidenceCategory[];
  onValue: (key: string, value: string | string[]) => void;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const range = rangeText(field);
  const hint = field.hint ?? (range ? `Allowed ${range}.` : undefined);
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ") || undefined;
  const raw = draft.values[field.key];
  const text = typeof raw === "string" ? raw : "";
  const invalid = error ? true : undefined;

  let control: ReactNode;
  switch (field.kind) {
    case "select":
      control = (
        <Select value={text || undefined} onValueChange={(value) => onValue(field.key, value)}>
          <SelectTrigger id={id} className="w-full bg-background" aria-describedby={describedBy} aria-invalid={invalid}>
            <SelectValue placeholder="Choose" />
          </SelectTrigger>
          <SelectContent position="popper">
            {(field.options ?? []).map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
      break;
    case "category":
      control = (
        <Select value={text || undefined} onValueChange={(value) => onValue(field.key, value)}>
          <SelectTrigger id={id} className="w-full bg-background" aria-describedby={describedBy} aria-invalid={invalid}>
            <SelectValue placeholder="Choose a category" />
          </SelectTrigger>
          <SelectContent position="popper">
            {categories.map((c) => (
              <SelectItem key={c.code} value={c.code}>
                {c.name} · margin {formatPercent(c.gross_margin)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
      break;
    case "categories":
      control = (
        <CategoryMultiSelect
          id={id}
          categories={categories}
          value={Array.isArray(raw) ? raw : []}
          onChange={(value) => onValue(field.key, value)}
          describedBy={describedBy}
        />
      );
      break;
    case "percent":
    case "points":
    case "money":
    case "days": {
      const addon = field.kind === "percent" ? "%" : field.kind === "points" ? "pp" : field.kind === "days" ? "days" : currencySymbol(currency);
      control = (
        <InputGroup className="bg-background">
          {field.kind === "money" ? (
            <InputGroupAddon>
              <InputGroupText>{addon}</InputGroupText>
            </InputGroupAddon>
          ) : null}
          <InputGroupInput
            id={id}
            inputMode="decimal"
            value={text}
            placeholder={field.placeholder}
            onChange={(e) => onValue(field.key, e.target.value)}
            aria-describedby={describedBy}
            aria-invalid={invalid}
            autoComplete="off"
          />
          {field.kind !== "money" ? (
            <InputGroupAddon align="inline-end">
              <InputGroupText>{addon}</InputGroupText>
            </InputGroupAddon>
          ) : null}
        </InputGroup>
      );
      break;
    }
    default:
      control = (
        <Input
          id={id}
          inputMode={field.kind === "integer" || field.kind === "month" ? "numeric" : "decimal"}
          value={text}
          placeholder={field.placeholder}
          onChange={(e) => onValue(field.key, e.target.value)}
          aria-describedby={describedBy}
          aria-invalid={invalid}
          autoComplete="off"
          className="bg-background"
        />
      );
  }

  return (
    <div className={cn("min-w-0 space-y-1.5", field.kind === "categories" && "sm:col-span-2")}>
      <Label htmlFor={id} className="text-[0.8125rem]">
        {field.label}
        {field.required ? <span className="text-destructive"> *</span> : null}
      </Label>
      {control}
      {hint ? (
        <p id={hintId} className="text-xs leading-snug text-muted-foreground">
          {hint}
        </p>
      ) : null}
      <FieldError id={errorId} message={error} />
    </div>
  );
}

function OpexRows({
  draft,
  errors,
  onChange,
}: {
  draft: LeverDraft;
  errors: LeverErrors;
  onChange: (rows: LeverDraft["opex"]) => void;
}) {
  const baseId = useId();
  const used = new Set(draft.opex.map((r) => r.category));
  const next = OPERATING_EXPENSE_CATEGORIES.find((c) => !used.has(c));
  return (
    <fieldset className="space-y-2 sm:col-span-2">
      <legend className="text-[0.8125rem] font-medium">
        Expense changes <span className="text-destructive">*</span>
      </legend>
      <p className="text-xs text-muted-foreground">
        Percent change to each category&apos;s trailing monthly run-rate. Depreciation, finance costs and tax are not operating expenses.
      </p>
      <ul className="space-y-2">
        {draft.opex.map((row, index) => {
          const catId = `${baseId}-cat-${index}`;
          const pctId = `${baseId}-pct-${index}`;
          const catError = errors[`_opex.${index}.category`];
          const pctError = errors[`_opex.${index}.pct`];
          return (
            <li key={index} className="grid grid-cols-[minmax(0,1fr)_7.5rem_auto] items-start gap-2">
              <div className="min-w-0 space-y-1">
                <Label htmlFor={catId} className="sr-only">
                  Expense category {index + 1}
                </Label>
                <Select
                  value={row.category || undefined}
                  onValueChange={(value) => onChange(draft.opex.map((r, i) => (i === index ? { ...r, category: value } : r)))}
                >
                  <SelectTrigger id={catId} className="w-full bg-background" aria-invalid={catError ? true : undefined}>
                    <SelectValue placeholder="Category" />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    {OPERATING_EXPENSE_CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c} disabled={used.has(c) && c !== row.category}>
                        {humanize(c)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldError id={`${catId}-error`} message={catError} />
              </div>
              <div className="space-y-1">
                <Label htmlFor={pctId} className="sr-only">
                  Change for {humanize(row.category)} in percent
                </Label>
                <InputGroup className="bg-background">
                  <InputGroupInput
                    id={pctId}
                    inputMode="decimal"
                    value={row.pct}
                    placeholder="−10"
                    onChange={(e) => onChange(draft.opex.map((r, i) => (i === index ? { ...r, pct: e.target.value } : r)))}
                    aria-invalid={pctError ? true : undefined}
                    autoComplete="off"
                  />
                  <InputGroupAddon align="inline-end">
                    <InputGroupText>%</InputGroupText>
                  </InputGroupAddon>
                </InputGroup>
                <FieldError id={`${pctId}-error`} message={pctError} />
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onChange(draft.opex.filter((_, i) => i !== index))}
                aria-label={`Remove ${humanize(row.category) || "row"}`}
                disabled={draft.opex.length === 1}
              >
                <Trash2Icon aria-hidden />
              </Button>
            </li>
          );
        })}
      </ul>
      {errors._opex ? <FieldError id={`${baseId}-rows-error`} message={errors._opex} /> : null}
      {next ? (
        <Button variant="outline" size="sm" onClick={() => onChange([...draft.opex, { category: next, pct: "" }])}>
          <PlusIcon aria-hidden />
          Add category
        </Button>
      ) : null}
    </fieldset>
  );
}

/** What the data already says about this lever in the current scope. */
function EvidenceHint({ type, evidence, currency }: { type: LeverType; evidence?: DecisionEvidence; currency: string }) {
  if (!evidence) return null;
  const money = (v: number | null | undefined) => formatMoney(v ?? null, currency, { compact: (v ?? 0) >= 1e5 });
  let text: ReactNode = null;
  if (type === "workforce") {
    const w = evidence.workforce;
    if (!w?.available) text = w?.note ?? "No workforce data for this scope: staffing cost needs a cost per employee.";
    else {
      text = (
        <>
          Headcount in scope: <strong>{formatNumber(w.headcount ?? null, { decimals: 0 })}</strong>
          {w.as_of_month ? ` (${formatMonth(w.as_of_month)})` : ""}. Loaded cost per employee{" "}
          <strong>{money(w.monthly_cost_per_employee)}</strong> a month. Stores run at{" "}
          <strong>{formatPercent(w.capacity_utilization ?? null, { decimals: 0 })}</strong> of their historical peak transactions per labor hour
          {w.capacity_constrained ? ": capacity-constrained, so extra staff can raise sales." : ": not constrained, so extra staff is unlikely to raise sales."}
        </>
      );
    }
  } else if (type === "marketing") {
    const m = evidence.marketing;
    const e = m?.estimate;
    if (!e) text = "No marketing response could be estimated: revenue effect defaults to zero unless you set a response.";
    else if (e.identified)
      text = (
        <>
          Estimated response <strong>{formatNumber(e.value, { decimals: 3 })}</strong> (95% interval {formatNumber(e.ci_low, { decimals: 3 })} to{" "}
          {formatNumber(e.ci_high, { decimals: 3 })}) from {formatNumber(e.n ?? null)} weeks. Current spend {money(m?.monthly_spend)} a month.
        </>
      );
    else text = "The data does not identify a marketing response, so revenue stays unchanged unless you set one.";
  } else if (type === "new_store") {
    const n = evidence.new_store;
    if (!n?.available) text = n?.note ?? "No past openings to learn from: set area, capex and sales assumptions under More options.";
    else
      text = (
        <>
          Learned from {formatNumber(n.new_stores_observed ?? null)} past openings: mature sales {money(n.mature_sales_per_sqft_day)} per sq ft per day,
          median area {formatNumber(n.median_selling_area_sqft ?? null, { decimals: 0 })} sq ft, capex {money(n.capex_per_sqft)} per sq ft.
        </>
      );
  } else if (type === "retention") {
    const c = evidence.customers;
    if (!c?.available) text = c?.note ?? "No customer aggregates for this scope.";
    else
      text = (
        <>
          Current monthly retention <strong>{formatPercent(c.retention_rate ?? null)}</strong>, {formatNumber(c.monthly_active_customers ?? null, { decimals: 0 })}{" "}
          active customers spending {money(c.monthly_spend_per_active_customer)} a month. The change itself is your assumption.
        </>
      );
  } else if (type === "price") {
    text = "Volume reacts through price elasticities estimated per category from your sales; they are listed in the results.";
  } else if (type === "inventory") {
    text = "Holding cost and lost sales are computed per product from the last 90 days of demand and supplier lead times.";
  } else if (type === "supplier_cost" || type === "product_mix") {
    text = evidence.categories.length
      ? `Margins from the trailing 12 months to ${formatDate(evidence.window?.[1] ?? null)}.`
      : null;
  } else if (type === "opex") {
    text = "Each category changes from its trailing monthly run-rate.";
  }
  if (!text) return null;
  return <p className="rounded-md bg-muted/60 px-3 py-2 text-xs leading-relaxed text-muted-foreground [&_strong]:font-semibold [&_strong]:text-foreground">{text}</p>;
}

export function LeverCard({
  draft,
  index,
  errors,
  currency,
  evidence,
  onChange,
  onRemove,
  description,
  showErrors,
}: {
  draft: LeverDraft;
  index: number;
  errors: LeverErrors;
  currency: string;
  evidence?: DecisionEvidence;
  onChange: (draft: LeverDraft) => void;
  onRemove: () => void;
  description?: string;
  showErrors: boolean;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const titleId = useId();
  const labelId = useId();
  const noteId = useId();
  const Icon = LEVER_ICONS[draft.type];
  const fields = visibleFields(draft);
  const main = fields.filter((f) => !f.advanced && f.key !== "start_month");
  const startMonth = fields.find((f) => f.key === "start_month");
  const advanced = fields.filter((f) => f.advanced);
  const shown = showErrors ? errors : {};
  const advancedErrors = advanced.some((f) => shown[f.key]);
  const advice = leverAdvice(draft);
  const categories = evidence?.categories ?? [];
  const needsNote = noteRequired(draft);

  const setValue = (key: string, value: string | string[]) => onChange({ ...draft, values: { ...draft.values, [key]: value } });

  return (
    <section aria-labelledby={titleId} className="rounded-xl bg-card ring-1 ring-foreground/10">
      <header className="flex items-start justify-between gap-3 border-b px-4 py-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-md bg-brand-50 text-brand-700 dark:bg-brand-800/30 dark:text-brand-200">
            <Icon className="size-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <h3 id={titleId} className="font-heading text-sm font-semibold">
              <span className="text-muted-foreground tabular">{index + 1}.</span> {LEVER_LABELS[draft.type]}
            </h3>
            {description ? <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{description}</p> : null}
          </div>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onRemove} aria-label={`Remove lever ${index + 1}: ${LEVER_LABELS[draft.type]}`}>
          <Trash2Icon aria-hidden />
        </Button>
      </header>
      <div className="space-y-4 px-4 py-4">
        <div className="grid gap-x-3 gap-y-4 sm:grid-cols-2">
          {main.map((field) => (
            <FieldControl
              key={field.key}
              field={field}
              draft={draft}
              error={shown[field.key]}
              currency={currency}
              categories={categories}
              onValue={setValue}
            />
          ))}
          {draft.type === "opex" ? <OpexRows draft={draft} errors={shown} onChange={(rows) => onChange({ ...draft, opex: rows })} /> : null}
          {startMonth ? (
            <FieldControl field={startMonth} draft={draft} error={shown.start_month} currency={currency} categories={categories} onValue={setValue} />
          ) : null}
        </div>

        <EvidenceHint type={draft.type} evidence={evidence} currency={currency} />
        {advice ? <p className="text-xs text-muted-foreground">{advice}</p> : null}

        <div className="space-y-1.5">
          <Label htmlFor={noteId} className="text-[0.8125rem]">
            {needsNote ? "Assumption note" : "Note"}
            {needsNote ? <span className="text-destructive"> *</span> : <span className="font-normal text-muted-foreground"> (optional)</span>}
          </Label>
          <Textarea
            id={noteId}
            rows={2}
            value={draft.note}
            maxLength={1000}
            onChange={(e) => onChange({ ...draft, note: e.target.value })}
            placeholder={needsNote ? "Who assumes this, and on what basis?" : "Context for reviewers"}
            aria-invalid={shown.note ? true : undefined}
            aria-describedby={shown.note ? `${noteId}-error` : undefined}
            className="min-h-14 bg-background text-sm"
          />
          <FieldError id={`${noteId}-error`} message={shown.note} />
        </div>

          <div>
            <button
              type="button"
              onClick={() => setMoreOpen((v) => !v)}
              aria-expanded={moreOpen || advancedErrors}
              className="inline-flex items-center gap-1 rounded-md text-xs font-medium text-primary outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <ChevronDownIcon className={cn("size-3.5 transition-transform", (moreOpen || advancedErrors) && "rotate-180")} aria-hidden />
              {moreOpen || advancedErrors ? "Fewer options" : "More options"}
            </button>
            {moreOpen || advancedErrors ? (
              <div className="mt-3 grid gap-x-3 gap-y-4 sm:grid-cols-2">
                <div className="min-w-0 space-y-1.5 sm:col-span-2">
                  <Label htmlFor={labelId} className="text-[0.8125rem]">
                    Lever name <span className="font-normal text-muted-foreground">(optional)</span>
                  </Label>
                  <Input
                    id={labelId}
                    value={draft.label}
                    maxLength={120}
                    onChange={(e) => onChange({ ...draft, label: e.target.value })}
                    placeholder={LEVER_LABELS[draft.type]}
                    className="bg-background"
                  />
                </div>
                {advanced.map((field) => (
                  <FieldControl
                    key={field.key}
                    field={field}
                    draft={draft}
                    error={shown[field.key]}
                    currency={currency}
                    categories={categories}
                    onValue={setValue}
                  />
                ))}
              </div>
            ) : null}
          </div>
      </div>
    </section>
  );
}

export const LEVER_TYPES = Object.keys(LEVER_FIELDS) as LeverType[];
