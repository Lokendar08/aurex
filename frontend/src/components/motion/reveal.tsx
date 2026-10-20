"use client";

import { Fragment, useEffect, useRef, useState, type CSSProperties, type ElementType, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/*
 * Scroll-reveal primitives for the public website.
 *
 * Content is always present in the HTML. The hidden "pre-reveal" state is applied by CSS only when
 * scripting is enabled and the visitor has not asked for reduced motion (see globals.css), and a timer
 * releases anything the observer never reached, so a reveal can delay content but never withhold it.
 */

type RevealState = "idle" | "in";

const RELEASE_AFTER_MS = 5000;

function useRevealState<T extends HTMLElement>(rootMargin = "0px 0px -12% 0px") {
  const ref = useRef<T | null>(null);
  const [state, setState] = useState<RevealState>("idle");

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const release = window.setTimeout(() => setState("in"), RELEASE_AFTER_MS);
    if (typeof IntersectionObserver === "undefined") {
      window.clearTimeout(release);
      const immediate = window.setTimeout(() => setState("in"), 0);
      return () => window.clearTimeout(immediate);
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setState("in");
          window.clearTimeout(release);
          observer.disconnect();
        }
      },
      { rootMargin, threshold: 0.12 },
    );
    observer.observe(element);
    return () => {
      window.clearTimeout(release);
      observer.disconnect();
    };
  }, [rootMargin]);

  return [ref, state] as const;
}

/** Fades and lifts its children into place once, when they scroll into view. */
export function Reveal({
  as: Tag = "div",
  delay = 0,
  className,
  children,
}: {
  as?: ElementType;
  /** Milliseconds. */
  delay?: number;
  className?: string;
  children: ReactNode;
}) {
  const [ref, state] = useRevealState<HTMLElement>();
  return (
    <Tag ref={ref} data-reveal={state} style={{ "--d": delay } as CSSProperties} className={className}>
      {children}
    </Tag>
  );
}

/**
 * A headline whose words rise into focus one after another. The full text stays available to
 * assistive technology; the animated words are decorative duplicates.
 */
export function WordReveal({
  text,
  as: Tag = "h2",
  id,
  className,
  accent = [],
  delay = 0,
}: {
  text: string;
  as?: ElementType;
  id?: string;
  className?: string;
  /** Zero-based indexes of words that take the gold accent. */
  accent?: number[];
  /** Milliseconds before the first word. */
  delay?: number;
}) {
  const [ref, state] = useRevealState<HTMLElement>("0px 0px -8% 0px");
  const words = text.split(" ");
  return (
    <Tag
      ref={ref}
      id={id}
      data-reveal={state}
      style={{ "--d": delay } as CSSProperties}
      className={cn("wr", className)}
    >
      <span className="sr-only">{text}</span>
      <span aria-hidden>
        {words.map((word, i) => (
          <Fragment key={`${word}-${i}`}>
            <span className={cn("wr-w", accent.includes(i) && "mk-gold-text")} style={{ "--i": i } as CSSProperties}>
              {word}
            </span>
            {i < words.length - 1 ? " " : null}
          </Fragment>
        ))}
      </span>
    </Tag>
  );
}
