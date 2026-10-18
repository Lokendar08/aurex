import { cn } from "@/lib/utils";

import { DECISION_ANALYSES, DECISION_LEVERS, DECISION_PRINCIPLE } from "./content";
import { Container, TextLink } from "./primitives";

/** The Decision Lab principle, set large. */
export function DecisionPrinciple({ className }: { className?: string }) {
  return (
    <p
      className={cn(
        "text-balance font-display text-[1.75rem] leading-[1.18] font-medium tracking-[-0.02em] sm:text-[2.25rem] lg:text-[2.5rem]",
        className,
      )}
    >
      {DECISION_PRINCIPLE}
    </p>
  );
}

/**
 * Levers and analysis types. "split" sits beside each other on wide screens (home page);
 * "stacked" suits a narrower content column (product page).
 */
export function DecisionLabDetail({
  className,
  layout = "split",
}: {
  className?: string;
  layout?: "split" | "stacked";
}) {
  const split = layout === "split";
  return (
    <div className={cn("grid gap-12 border-t pt-10", split && "lg:grid-cols-12 lg:gap-8", className)}>
      <div className={cn(split && "lg:col-span-4")}>
        <h3 className="font-display text-lg font-semibold tracking-[-0.01em]">Ten levers</h3>
        <ul
          className={cn(
            "mt-4 grid gap-x-6 gap-y-2.5 text-[0.9375rem] sm:grid-cols-2",
            split ? "lg:grid-cols-1 xl:grid-cols-2" : "lg:grid-cols-3",
          )}
        >
          {DECISION_LEVERS.map((lever) => (
            <li key={lever} className="flex items-baseline gap-2.5">
              <span aria-hidden className="size-1.5 shrink-0 translate-y-[-0.1em] rounded-full bg-primary" />
              {lever}
            </li>
          ))}
        </ul>
      </div>
      <div className={cn(split && "lg:col-span-8")}>
        <h3 className="font-display text-lg font-semibold tracking-[-0.01em]">Three ways to test a scenario</h3>
        <dl className="mt-4 grid gap-6 sm:grid-cols-3 sm:gap-8">
          {DECISION_ANALYSES.map((analysis) => (
            <div key={analysis.name} className="border-t pt-4">
              <dt className="font-medium">{analysis.name}</dt>
              <dd className="mt-1.5 text-[0.9375rem] leading-relaxed text-muted-foreground">{analysis.text}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

export function DecisionLabSection() {
  return (
    <section aria-labelledby="lab-title" className="py-20 sm:py-28">
      <Container>
        <div className="grid gap-10 lg:grid-cols-12 lg:gap-8">
          <div className="lg:col-span-4">
            <h2
              id="lab-title"
              className="font-display text-[2rem] leading-[1.08] font-semibold tracking-[-0.022em] sm:text-[2.5rem] lg:text-[2.75rem]"
            >
              Decision Lab
            </h2>
            <p className="mt-5 max-w-[42ch] text-[1.0625rem] leading-relaxed text-muted-foreground">
              Change one lever or several. AUREX shows which figures move, by how much, and what supports each
              change, before anything is committed.
            </p>
            <TextLink href="/product#decision-lab" className="mt-6 inline-block">
              How Decision Lab works
            </TextLink>
          </div>
          <DecisionPrinciple className="lg:col-span-8 lg:pt-1" />
        </div>
        <DecisionLabDetail className="mt-16" />
      </Container>
    </section>
  );
}
