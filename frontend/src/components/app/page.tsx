"use client";

import { useEffect, useId, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Set the browser tab title for a client-rendered page. Next re-renders the static segment title
 * ("Workspace") into <head> after client navigations, so the title is re-applied whenever <head>
 * changes while this page is visible. Hidden (preserved) pages disconnect their observer.
 */
export function useDocumentTitle(title: string) {
  useEffect(() => {
    const desired = `${title} · AUREX`;
    const apply = () => {
      if (document.title !== desired) document.title = desired;
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [title]);
}

/** Page title block: display-face title, one-line purpose, optional meta row and actions. */
export function PageHeader({
  title,
  description,
  actions,
  meta,
  className,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  meta?: ReactNode;
  className?: string;
}) {
  useDocumentTitle(title);
  return (
    <div className={cn("mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between", className)}>
      <div className="min-w-0">
        <h1 className="font-display text-[1.625rem] leading-tight font-semibold tracking-[-0.022em] text-balance sm:text-[1.875rem]">
          {title}
        </h1>
        {description ? (
          <p className="mt-1.5 max-w-[72ch] text-[0.9375rem] leading-relaxed text-pretty text-muted-foreground">{description}</p>
        ) : null}
        {meta ? <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted-foreground">{meta}</div> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** A titled surface for one chart, table or group of figures. */
export function Panel({
  title,
  description,
  actions,
  footer,
  children,
  className,
  contentClassName,
  dimmed,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  /** Previous data stays on screen, dimmed, while new filters load. */
  dimmed?: boolean;
}) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={title ? headingId : undefined}
      aria-busy={dimmed || undefined}
      className={cn("flex min-w-0 flex-col rounded-xl bg-card text-card-foreground ring-1 ring-foreground/10", className)}
    >
      {title || actions ? (
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 pt-4 sm:px-5">
          <div className="min-w-0">
            {title ? (
              <h2 id={headingId} className="font-heading text-[0.9375rem] leading-snug font-semibold tracking-[-0.005em]">
                {title}
              </h2>
            ) : null}
            {description ? <div className="mt-0.5 text-[0.8125rem] leading-relaxed text-muted-foreground">{description}</div> : null}
          </div>
          {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      <div
        className={cn(
          "min-w-0 flex-1 px-4 pt-4 pb-5 transition-opacity duration-200 sm:px-5",
          dimmed && "opacity-55",
          contentClassName,
        )}
      >
        {children}
      </div>
      {footer ? (
        <div className="border-t px-4 py-3 text-xs leading-relaxed text-muted-foreground sm:px-5">{footer}</div>
      ) : null}
    </section>
  );
}

/** Section heading between groups of panels. */
export function SectionHeading({ title, description, actions, id }: { title: string; description?: ReactNode; actions?: ReactNode; id?: string }) {
  return (
    <div className="mt-10 mb-4 flex flex-wrap items-end justify-between gap-3 first:mt-0">
      <div>
        <h2 id={id} className="font-display text-lg font-semibold tracking-[-0.015em]">
          {title}
        </h2>
        {description ? <p className="mt-0.5 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions}
    </div>
  );
}

/** Label / value pairs (status details, configuration). */
export function DetailList({ items, className }: { items: { label: ReactNode; value: ReactNode }[]; className?: string }) {
  return (
    <dl className={cn("grid gap-x-6 gap-y-3 sm:grid-cols-2", className)}>
      {items.map((item, index) => (
        <div key={index} className="min-w-0">
          <dt className="text-xs text-muted-foreground">{item.label}</dt>
          <dd className="mt-0.5 text-sm break-words">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A plain figure with label (secondary stats that are not backend KPI objects). */
export function Stat({
  label,
  value,
  hint,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <p className="text-[0.8125rem] text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl leading-tight font-semibold tracking-[-0.01em] text-foreground">{value}</p>
      {hint ? <p className="mt-1 text-xs leading-snug text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** Bulleted method / limitation notes in small print. */
export function NoteList({ notes, className }: { notes: ReactNode[]; className?: string }) {
  if (!notes.length) return null;
  return (
    <ul className={cn("space-y-1.5 text-[0.8125rem] leading-relaxed text-muted-foreground", className)}>
      {notes.map((note, i) => (
        <li key={i} className="flex gap-2">
          <span aria-hidden className="mt-[0.55rem] size-1 shrink-0 rounded-full bg-muted-foreground/60" />
          <span>{note}</span>
        </li>
      ))}
    </ul>
  );
}
