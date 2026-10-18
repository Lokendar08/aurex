import Link from "next/link";

import { MODULE_GROUPS, MODULES } from "./content";
import { Container, SectionHeading } from "./primitives";

export function ModuleIndexSection() {
  return (
    <section aria-labelledby="modules-title" className="border-y bg-muted/60 py-20 sm:py-28">
      <Container>
        <SectionHeading
          id="modules-title"
          title="Eleven modules on one shared data model"
          lead="A figure means the same thing on the dashboard, in a forecast, in Decision Lab and in the advisor's answer, because every module reads the same validated model."
        />
        <div className="mt-14 border-t border-foreground/10">
          {MODULE_GROUPS.map((group) => {
            const modules = MODULES.filter((m) => m.group === group.name);
            return (
              <div
                key={group.name}
                className="grid gap-6 border-b border-foreground/10 py-8 lg:grid-cols-12 lg:gap-8 lg:py-10"
              >
                <div className="lg:col-span-3">
                  <h3 className="font-display text-xl font-semibold tracking-[-0.01em]">{group.name}</h3>
                  <p className="mt-1.5 max-w-[32ch] text-sm leading-relaxed text-muted-foreground">{group.text}</p>
                </div>
                <ul className="grid gap-x-8 gap-y-7 sm:grid-cols-2 lg:col-span-9 lg:grid-cols-3">
                  {modules.map((module) => (
                    <li key={module.id}>
                      <Link
                        href={`/product#${module.id}`}
                        className="group -m-2 block rounded-lg p-2 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                      >
                        <span className="font-medium text-foreground decoration-primary/50 underline-offset-4 group-hover:text-primary group-hover:underline">
                          {module.name}
                        </span>
                        <span className="mt-1 block text-[0.9375rem] leading-relaxed text-muted-foreground">
                          {module.summary}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </Container>
    </section>
  );
}
