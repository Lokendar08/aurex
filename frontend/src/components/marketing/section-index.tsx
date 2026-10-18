"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

export type SectionIndexGroup = {
  name: string;
  items: { id: string; label: string }[];
};

/**
 * Sticky in-page index that highlights the section currently in view. Without JavaScript it is
 * still a plain list of anchor links.
 */
export function SectionIndex({ groups, label }: { groups: SectionIndexGroup[]; label: string }) {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const ids = groups.flatMap((group) => group.items.map((item) => item.id));
    const elements = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (elements.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      // A section counts as current while it occupies the band just below the sticky header.
      { rootMargin: "-96px 0px -55% 0px", threshold: 0 },
    );
    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [groups]);

  return (
    <nav aria-label={label}>
      <ol className="space-y-5">
        {groups.map((group) => (
          <li key={group.name}>
            <p className="text-xs font-medium text-muted-foreground">{group.name}</p>
            <ol className="mt-1.5 space-y-0.5 border-l">
              {group.items.map((item) => {
                const current = active === item.id;
                return (
                  <li key={item.id}>
                    <a
                      href={`#${item.id}`}
                      aria-current={current ? "location" : undefined}
                      className={cn(
                        "-ml-px block border-l-2 py-1.5 pl-3 text-sm leading-snug transition-colors outline-none focus-visible:rounded-r-md focus-visible:ring-3 focus-visible:ring-ring/50",
                        current
                          ? "border-primary font-medium text-foreground"
                          : "border-transparent text-muted-foreground hover:border-foreground/30 hover:text-foreground",
                      )}
                    >
                      {item.label}
                    </a>
                  </li>
                );
              })}
            </ol>
          </li>
        ))}
      </ol>
    </nav>
  );
}
