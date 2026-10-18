import { PIPELINE_STAGES } from "./content";
import { IllustrativeLabel } from "./evidence";
import { Container, SectionHeading } from "./primitives";

const ROW_GRID =
  "grid grid-cols-[2.25rem_minmax(0,1fr)] gap-x-4 sm:grid-cols-[3rem_minmax(0,1fr)] sm:gap-x-5 lg:grid-cols-[3rem_minmax(0,0.85fr)_minmax(0,1.25fr)_minmax(0,1fr)] lg:gap-x-8";

export function PipelineSection() {
  const last = PIPELINE_STAGES.length - 1;
  return (
    <section aria-labelledby="pipeline-title" className="py-20 sm:py-28">
      <Container>
        <SectionHeading
          id="pipeline-title"
          title="From authorized data to a report you can defend"
          lead="Every figure in AUREX passes through the same eight stages. Follow one sale at NovaMart, the demo retailer, as it moves through them."
        />

        <div className="mt-14 sm:mt-16">
          <div aria-hidden className={`${ROW_GRID} hidden pb-4 text-sm text-muted-foreground lg:grid`}>
            <span />
            <span>Stage</span>
            <span>What happens</span>
            <span>One NovaMart sale</span>
          </div>

          <ol className="border-t pt-8">
            {PIPELINE_STAGES.map((stage, i) => (
              <li key={stage.name} className={`${ROW_GRID} relative pb-10 last:pb-0`}>
                {i < last ? (
                  <span
                    aria-hidden
                    className="absolute top-10 bottom-1 left-[1.125rem] w-px -translate-x-1/2 bg-border sm:left-6"
                  />
                ) : null}
                <span className="relative row-span-3 grid size-9 place-items-center justify-self-center rounded-full border bg-background text-sm font-semibold text-foreground tabular lg:row-span-1">
                  {i + 1}
                </span>
                <h3 className="pt-1.5 font-display text-lg leading-snug font-semibold tracking-[-0.01em]">
                  {stage.name}
                </h3>
                <p className="mt-1.5 max-w-[56ch] text-[0.9375rem] leading-relaxed text-muted-foreground lg:mt-0 lg:pt-2">
                  {stage.text}
                </p>
                <samp className="mt-3 block font-mono text-[0.8125rem] leading-relaxed text-foreground/80 lg:mt-0 lg:pt-2.5">
                  {stage.trace}
                </samp>
              </li>
            ))}
          </ol>

          <IllustrativeLabel className="mt-10" note="Sample sale: NovaMart demo data (synthetic)" />
        </div>
      </Container>
    </section>
  );
}
