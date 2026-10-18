import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Evidence vocabulary shared by every sample on the site. Each basis has a shape as well as a
 * colour, so the distinction never relies on colour alone, and the label always spells it out.
 *
 * - known: arithmetic on known inputs (payroll rate x headcount). Filled square.
 * - history: estimated from the organization's own historical data. Filled circle, blue.
 * - assumption: a documented, attributed assumption. Diamond, amber.
 * - calculated: derived from other lines. Outlined square.
 * - none: not modeled because nothing supports it. Outlined circle.
 */
export type EvidenceBasis = "known" | "history" | "assumption" | "calculated" | "none";

export const EVIDENCE_LABELS: Record<EvidenceBasis, string> = {
  known: "Known cost",
  history: "Sales history",
  assumption: "Documented assumption",
  calculated: "Calculated",
  none: "Not modeled",
};

type Surface = "light" | "dark";

export function EvidenceMarker({
  basis,
  surface = "light",
  className,
}: {
  basis: EvidenceBasis;
  surface?: Surface;
  className?: string;
}) {
  const shape = {
    known: "rounded-[1px] bg-current",
    history: cn("rounded-full", surface === "dark" ? "bg-sky-accent" : "bg-brand-500"),
    assumption: "rotate-45 rounded-[1px] bg-warning scale-90",
    calculated: "rounded-[1px] border-[1.5px] border-current",
    none: "rounded-full border-[1.5px] border-current opacity-70",
  }[basis];
  return <span aria-hidden className={cn("inline-block size-2 shrink-0", shape, className)} />;
}

export function EvidenceTag({
  basis,
  surface = "light",
  children,
  className,
}: {
  basis: EvidenceBasis;
  surface?: Surface;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 text-[0.8125rem] leading-none font-medium whitespace-nowrap",
        surface === "dark" ? "text-navy-100" : "text-foreground",
        className,
      )}
    >
      <EvidenceMarker basis={basis} surface={surface} />
      {children ?? EVIDENCE_LABELS[basis]}
    </span>
  );
}

/** "Illustrative" badge plus the synthetic-data notice. Required next to every sample figure. */
export function IllustrativeLabel({
  surface = "light",
  note = "NovaMart demo data (synthetic)",
  className,
}: {
  surface?: Surface;
  note?: string;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "flex flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-none",
        surface === "dark" ? "text-navy-300" : "text-muted-foreground",
        className,
      )}
    >
      <span
        className={cn(
          "rounded-md border px-1.5 py-1 font-medium",
          surface === "dark" ? "border-white/20 text-navy-100" : "border-border text-foreground",
        )}
      >
        Illustrative
      </span>
      <span>{note}</span>
    </p>
  );
}
