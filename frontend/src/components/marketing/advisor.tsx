import { IllustrativeLabel } from "./evidence";
import { Container } from "./primitives";

const ADVISOR_POINTS = [
  {
    name: "Runs validated calculations",
    text: "Figures come from the same tested calculations as your dashboards and reports, not from the language model's own arithmetic.",
  },
  {
    name: "Cites its sources",
    text: "Each answer links to the data, period and calculation it used, so anyone can check it.",
  },
  {
    name: "States its uncertainty",
    text: "When data is thin or a range is wide, the answer says so, and says what would narrow it.",
  },
] as const;

const SOURCES = [
  "Gross margin by store, September 2026 (sales ledger)",
  "Product-mix variance, August to September 2026",
  "Supplier price file, imported 8 September 2026",
] as const;

function Cite({ n }: { n: number }) {
  return (
    <sup className="ml-0.5">
      <a
        href={`#advisor-source-${n}`}
        aria-label={`Source ${n}`}
        className="rounded-sm px-0.5 text-[0.7rem] font-semibold text-sky-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-sky-accent"
      >
        [{n}]
      </a>
    </sup>
  );
}

/** Illustrative advisor answer laid out as a working paper: question, answer, uncertainty, evidence. */
export function AdvisorSample() {
  return (
    <figure
      aria-labelledby="advisor-sample-title"
      className="overflow-hidden rounded-2xl bg-navy-950 text-white ring-1 ring-white/10"
    >
      <div className="flex flex-col gap-3 border-b border-white/10 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
        <p id="advisor-sample-title" className="font-display text-lg font-semibold tracking-tight">
          AI Business Advisor
        </p>
        <IllustrativeLabel surface="dark" />
      </div>

      <div className="space-y-7 px-5 py-6 sm:px-7 sm:py-7">
        <div>
          <p className="text-sm text-navy-300">Question from a Finance Manager</p>
          <p className="mt-1.5 text-[1.0625rem] leading-snug text-white">
            Why did gross margin fall at store NM‑012 in September?
          </p>
        </div>

        <div className="border-l-2 border-sky-accent/70 pl-4 sm:pl-5">
          <p className="text-sm text-navy-300">Answer</p>
          <p className="mt-1.5 text-[0.9375rem] leading-relaxed text-navy-50">
            Gross margin at NM‑012 fell from 32.6% in August to 30.1% in September.
            <Cite n={1} /> About 1.7 points of the 2.5-point drop comes from a shift in sales toward lower-margin
            household lines.
            <Cite n={2} /> The remaining 0.8 points come from higher supplier prices on 41 products.
            <Cite n={3} />
          </p>
          <div className="mt-5 rounded-lg bg-white/[0.04] px-4 py-3.5">
            <p className="text-sm font-medium text-white">Uncertainty</p>
            <ul className="mt-1.5 space-y-1 text-sm leading-relaxed text-navy-200">
              <li>Mix effect: well supported by 18 months of sales.</li>
              <li>Supplier effect: provisional. It rests on only three weeks of new prices.</li>
            </ul>
          </div>
        </div>

        <div className="grid gap-6 border-t border-white/10 pt-6 sm:grid-cols-2">
          <div>
            <p className="text-sm text-navy-300">Calculations run</p>
            <ul className="mt-2 space-y-1.5 font-mono text-[0.8125rem] leading-relaxed break-words text-navy-100">
              <li>margin_bridge(NM-012, 2026-09)</li>
              <li>mix_variance(NM-012, 2026-08, 2026-09)</li>
            </ul>
          </div>
          <div>
            <p className="text-sm text-navy-300">Sources</p>
            <ol className="mt-2 space-y-1.5 text-[0.8125rem] leading-relaxed text-navy-100">
              {SOURCES.map((source, i) => (
                <li key={source} id={`advisor-source-${i + 1}`} className="flex gap-2 scroll-mt-28">
                  <span className="tabular shrink-0 text-navy-300">[{i + 1}]</span>
                  <span>{source}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </figure>
  );
}

export function AdvisorSection() {
  return (
    <section aria-labelledby="advisor-title" className="bg-navy-900 py-20 text-white sm:py-28">
      <Container className="grid gap-12 lg:grid-cols-12 lg:gap-8">
        <div className="lg:col-span-5 lg:pr-6">
          <h2
            id="advisor-title"
            className="text-balance font-display text-[2rem] leading-[1.08] font-semibold tracking-[-0.022em] sm:text-[2.5rem] lg:text-[2.75rem]"
          >
            An advisor that shows its working
          </h2>
          <p className="mt-5 max-w-[48ch] text-[1.0625rem] leading-relaxed text-navy-200">
            The AI Business Advisor answers questions about your business by running AUREX&apos;s validated
            calculations. It doesn&apos;t do arithmetic in prose, and it doesn&apos;t fill gaps with guesses.
          </p>
          <dl className="mt-10 space-y-6 border-t border-white/10 pt-8">
            {ADVISOR_POINTS.map((point) => (
              <div key={point.name}>
                <dt className="font-medium text-white">{point.name}</dt>
                <dd className="mt-1 text-[0.9375rem] leading-relaxed text-navy-300">{point.text}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="lg:col-span-7">
          <AdvisorSample />
        </div>
      </Container>
    </section>
  );
}
