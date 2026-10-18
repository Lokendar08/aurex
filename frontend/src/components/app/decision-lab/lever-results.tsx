"use client";

import { CircleAlertIcon, LightbulbIcon, TriangleAlertIcon } from "lucide-react";
import type { ReactNode } from "react";

import { StatusBadge } from "@/components/app/badges";
import { formatEvidenceValue, isNum } from "@/lib/app/decision-lab-format";
import type { LeverAssumption, LeverEvidenceItem, LeverResult, LeverType } from "@/lib/app/decision-lab-types";
import { formatDate, formatNumber, humanize } from "@/lib/app/format";
import { cn } from "@/lib/utils";

import { SourceBadge } from "./common";
import { LEVER_ICONS, LEVER_LABELS } from "./lever-editor";

const EVIDENCE_META = new Set([
  "name",
  "value",
  "std_error",
  "ci_low",
  "ci_high",
  "p_value",
  "n",
  "identified",
  "method",
  "notes",
  "interpretation",
  "as_of",
]);

/** "price_elasticity:STAPLES" → "Price elasticity · Staples". */
export function evidenceName(name: string, categories: Record<string, string>): string {
  const [head, code] = name.split(":");
  if (code) return `${humanize(head)} · ${categories[code] ?? code}`;
  return name.includes("_") && !name.includes(" ") ? humanize(name) : name;
}

function EvidenceItem({ item, currency, categories }: { item: LeverEvidenceItem; currency: string; categories: Record<string, string> }) {
  const name = evidenceName(String(item.name), categories);
  const hasValue = "value" in item;
  const ci = isNum(item.ci_low) && isNum(item.ci_high);
  const identified = typeof item.identified === "boolean" ? item.identified : null;
  const extras = Object.entries(item).filter(([key, value]) => !EVIDENCE_META.has(key) && value !== null && value !== undefined && !key.endsWith("_se"));
  const notes = Array.isArray(item.notes) ? (item.notes as string[]) : [];
  return (
    <li className="space-y-1 py-2.5 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-[0.8125rem] font-medium">{name}</p>
        <div className="flex flex-wrap items-center gap-2">
          {hasValue ? <span className="text-[0.8125rem] font-semibold tabular">{formatEvidenceValue(String(item.name), item.value, currency)}</span> : null}
          {identified === false ? <StatusBadge tone="warning">Not identified</StatusBadge> : null}
          {identified === true ? <StatusBadge tone="good">Identified</StatusBadge> : null}
        </div>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground tabular">
        {ci ? (
          <span>
            95% interval {formatEvidenceValue(String(item.name), item.ci_low, currency)} to {formatEvidenceValue(String(item.name), item.ci_high, currency)}
          </span>
        ) : null}
        {isNum(item.std_error) ? <span>Std. error {formatNumber(item.std_error as number, { decimals: 3 })}</span> : null}
        {isNum(item.p_value) ? <span>p {(item.p_value as number) < 0.001 ? "< 0.001" : formatNumber(item.p_value as number, { decimals: 3 })}</span> : null}
        {isNum(item.n) ? <span>n = {formatNumber(item.n as number)}</span> : null}
        {typeof item.as_of === "string" ? <span>As of {formatDate(item.as_of)}</span> : null}
        {typeof item.interpretation === "string" ? <span>{item.interpretation}</span> : null}
        {extras.map(([key, value]) => (
          <span key={key}>
            {humanize(key)}: {formatEvidenceValue(`${String(item.name)} ${key.replace(/_/g, " ")}`, value, currency)}
          </span>
        ))}
      </div>
      {typeof item.method === "string" ? <p className="text-xs leading-relaxed text-muted-foreground">Method: {item.method}</p> : null}
      {notes.map((note, i) => (
        <p key={i} className="text-xs leading-relaxed text-muted-foreground">
          {note}
        </p>
      ))}
    </li>
  );
}

export function AssumptionRows({
  assumptions,
  currency,
  showLever,
}: {
  assumptions: (LeverAssumption & { lever?: string })[];
  currency: string;
  showLever?: boolean;
}) {
  if (!assumptions.length) return <p className="text-sm text-muted-foreground">No assumptions recorded.</p>;
  return (
    <div className="relative w-full overflow-x-auto rounded-lg ring-1 ring-foreground/8" tabIndex={0} role="region" aria-label="Assumptions">
      <table className="w-full border-collapse text-[0.8125rem]">
        <caption className="sr-only">Assumptions and where each value comes from</caption>
        <thead className="bg-muted/60">
          <tr className="border-b">
            {showLever ? <th scope="col" className="px-3 py-2 text-left font-medium text-muted-foreground">Lever</th> : null}
            <th scope="col" className="px-3 py-2 text-left font-medium text-muted-foreground">Assumption</th>
            <th scope="col" className="px-3 py-2 text-right font-medium text-muted-foreground">Value</th>
            <th scope="col" className="px-3 py-2 text-left font-medium text-muted-foreground">Source</th>
          </tr>
        </thead>
        <tbody>
          {assumptions.map((a, i) => {
            // Long descriptions (cost structure, methods) read better under the name than in a narrow value column.
            const long = typeof a.value === "string" && a.value.length > 48;
            return (
              <tr key={`${a.lever ?? ""}-${a.name}-${i}`} className="border-b align-top last:border-b-0">
                {showLever ? <td className="px-3 py-2 text-muted-foreground">{a.lever === "baseline" ? "Baseline" : a.lever}</td> : null}
                <td className="px-3 py-2">
                  {a.name}
                  {long ? <span className="mt-0.5 block max-w-[48ch] text-xs leading-relaxed text-muted-foreground">{String(a.value)}</span> : null}
                  {a.note ? <span className="mt-0.5 block text-xs text-muted-foreground">Note: {a.note}</span> : null}
                </td>
                <td className={cn("px-3 py-2 text-right", typeof a.value === "number" && "tabular whitespace-nowrap")}>
                  {long ? <span className="text-xs text-muted-foreground">Described</span> : formatEvidenceValue(a.name, a.value, currency)}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <SourceBadge source={a.source} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DetailBlock({ title, values, currency }: { title: string; values: Record<string, unknown>; currency: string }) {
  const entries = Object.entries(values).filter(([, v]) => v !== null && v !== undefined);
  if (!entries.length) return null;
  return (
    <div className="rounded-lg bg-muted/50 px-3.5 py-3">
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      <dl className="mt-2 grid gap-x-5 gap-y-2 sm:grid-cols-2">
        {entries.map(([key, value]) => (
          <div key={key} className="min-w-0">
            <dt className="text-xs text-muted-foreground">{humanize(key)}</dt>
            <dd className="text-[0.8125rem] font-semibold tabular">{formatEvidenceValue(key.replace(/_/g, " "), value, currency)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

const DETAIL_TITLES: Record<string, string> = {
  capacity: "Staffing capacity",
  inventory: "Inventory policy effect",
  new_store: "New store economics",
};

const KNOWN_KEYS = new Set([
  "index",
  "type",
  "label",
  "summary",
  "evidence",
  "assumptions",
  "warnings",
  "revenue_effect_note",
  "insights",
]);

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <h4 className="text-xs font-semibold tracking-[0.01em] text-muted-foreground">{title}</h4>
      {children}
    </div>
  );
}

/** One lever's outcome: what changed, the revenue rule applied, evidence, assumptions and warnings. */
export function LeverResultPanel({
  lever,
  currency,
  categories,
}: {
  lever: LeverResult;
  currency: string;
  categories: Record<string, string>;
}) {
  const Icon = LEVER_ICONS[lever.type as LeverType] ?? CircleAlertIcon;
  const details = Object.entries(lever).filter(
    ([key, value]) => !KNOWN_KEYS.has(key) && value && typeof value === "object" && !Array.isArray(value),
  ) as [string, Record<string, unknown>][];
  const label = lever.label && lever.label !== lever.type ? lever.label : LEVER_LABELS[lever.type as LeverType] ?? humanize(lever.type);
  return (
    <article className="rounded-xl bg-card ring-1 ring-foreground/10" aria-label={`Lever ${lever.index + 1}: ${label}`}>
      <header className="flex items-start gap-2.5 border-b px-4 py-3 sm:px-5">
        <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-md bg-brand-50 text-brand-700 dark:bg-brand-800/30 dark:text-brand-200">
          <Icon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <h3 className="font-heading text-sm font-semibold">
            <span className="text-muted-foreground tabular">{lever.index + 1}.</span> {label}
          </h3>
          <p className="mt-0.5 text-[0.8125rem] text-foreground/85">{lever.summary}</p>
        </div>
      </header>
      <div className="space-y-4 px-4 py-4 sm:px-5">
        {lever.revenue_effect_note ? (
          <div className="flex items-start gap-2.5 rounded-lg bg-brand-50 px-3.5 py-3 text-[0.8125rem] leading-relaxed text-navy-800 ring-1 ring-brand-200/80 dark:bg-brand-800/25 dark:text-navy-100 dark:ring-brand-700/40">
            <CircleAlertIcon className="mt-0.5 size-4 shrink-0 text-brand-600 dark:text-sky-accent" aria-hidden />
            <p>
              <strong className="font-semibold">Revenue effect.</strong> {lever.revenue_effect_note}
            </p>
          </div>
        ) : null}
        {lever.insights?.length ? (
          <ul className="space-y-1.5">
            {lever.insights.map((insight, i) => (
              <li key={i} className="flex items-start gap-2 text-[0.8125rem] leading-relaxed">
                <LightbulbIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span>{insight}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {lever.warnings?.length ? (
          <ul className="space-y-1.5">
            {lever.warnings.map((warning, i) => (
              <li key={i} className="flex items-start gap-2 rounded-lg bg-warning/12 px-3 py-2 text-[0.8125rem] leading-relaxed ring-1 ring-warning/30">
                <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                <span>{warning}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {details.map(([key, values]) => (
          <DetailBlock key={key} title={DETAIL_TITLES[key] ?? humanize(key)} values={values} currency={currency} />
        ))}
        {lever.evidence?.length ? (
          <Section title="Evidence from your data">
            <ul className="divide-y">
              {lever.evidence.map((item, i) => (
                <EvidenceItem key={`${item.name}-${i}`} item={item} currency={currency} categories={categories} />
              ))}
            </ul>
          </Section>
        ) : null}
        <Section title="Assumptions">
          <AssumptionRows assumptions={lever.assumptions ?? []} currency={currency} />
        </Section>
      </div>
    </article>
  );
}
