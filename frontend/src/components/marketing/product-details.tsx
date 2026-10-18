import { cn } from "@/lib/utils";

import { IllustrativeLabel } from "./evidence";

const FORECAST_CONCEPTS = [
  {
    name: "Baselines and advanced models",
    text: "Seasonal-naive and moving-average baselines set the bar. Advanced models are shown next to them, so you can see whether the extra complexity earns its place.",
  },
  {
    name: "Time-based validation",
    text: "Models are trained on earlier periods and scored on later ones they haven't seen, the way they will be used. Data is never shuffled across time.",
  },
  {
    name: "Prediction intervals",
    text: "Every forecast comes with a range, so plans can allow for the plausible low and high, not just the middle.",
  },
] as const;

const METRICS = [
  { name: "MAE", full: "Mean absolute error", text: "The typical size of a miss, in the forecast's own units." },
  { name: "RMSE", full: "Root mean squared error", text: "Like MAE, but large misses count for more." },
  {
    name: "WAPE",
    full: "Weighted absolute percentage error",
    text: "Total error as a share of total actuals, comparable across stores of different sizes.",
  },
] as const;

// NovaMart demo data (synthetic): weekly sales per store, 26-week holdout, mean actual about 82,700.
const MODEL_SCORES = [
  { model: "Seasonal naive", kind: "Baseline", mae: "7,940", rmse: "10,300", wape: "9.6%" },
  { model: "Moving average", kind: "Baseline", mae: "9,350", rmse: "12,200", wape: "11.3%" },
  { model: "Advanced model", kind: "Candidate", mae: "5,950", rmse: "7,900", wape: "7.2%" },
] as const;

export function ForecastingDetail() {
  return (
    <div className="mt-10 space-y-10">
      <dl className="grid gap-6 sm:grid-cols-3 sm:gap-8">
        {FORECAST_CONCEPTS.map((concept) => (
          <div key={concept.name} className="border-t pt-4">
            <dt className="font-medium">{concept.name}</dt>
            <dd className="mt-1.5 text-[0.9375rem] leading-relaxed text-muted-foreground">{concept.text}</dd>
          </div>
        ))}
      </dl>

      <div className="grid gap-8 lg:grid-cols-12 lg:gap-10">
        <div className="lg:col-span-5">
          <h3 className="font-display text-lg font-semibold tracking-[-0.01em]">How accuracy is reported</h3>
          <dl className="mt-4 space-y-4">
            {METRICS.map((metric) => (
              <div key={metric.name}>
                <dt className="text-[0.9375rem]">
                  <span className="font-semibold">{metric.name}</span>
                  <span className="text-muted-foreground">, {metric.full.toLowerCase()}</span>
                </dt>
                <dd className="mt-0.5 text-[0.9375rem] leading-relaxed text-muted-foreground">{metric.text}</dd>
              </div>
            ))}
          </dl>
        </div>

        <figure className="rounded-xl border bg-card lg:col-span-7">
          <figcaption className="space-y-2.5 border-b px-5 py-4">
            <span className="block text-sm font-medium">Weekly sales per store, 26-week holdout</span>
            <IllustrativeLabel />
          </figcaption>
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-5 pt-3 pb-2 font-medium">
                  Model
                </th>
                <th scope="col" className="px-3 pt-3 pb-2 text-right font-medium">
                  MAE
                </th>
                <th scope="col" className="px-3 pt-3 pb-2 text-right font-medium">
                  RMSE
                </th>
                <th scope="col" className="px-5 pt-3 pb-2 text-right font-medium">
                  WAPE
                </th>
              </tr>
            </thead>
            <tbody>
              {MODEL_SCORES.map((row) => (
                <tr key={row.model} className="border-t">
                  <th scope="row" className="px-5 py-3 font-normal">
                    <span className="block font-medium">{row.model}</span>
                    <span className="block text-xs text-muted-foreground">{row.kind}</span>
                  </th>
                  <td className="tabular px-3 py-3 text-right">{row.mae}</td>
                  <td className="tabular px-3 py-3 text-right">{row.rmse}</td>
                  <td className="tabular px-5 py-3 text-right font-medium">{row.wape}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t px-5 py-3 text-xs leading-relaxed text-muted-foreground">
            Lower is better on all three. Here the advanced model beats both baselines on weeks it never saw, so
            it earns its place.
          </p>
        </figure>
      </div>
    </div>
  );
}

export function OutcomeTrackingSample({ className }: { className?: string }) {
  const items = [
    { term: "Decision", detail: "R-118: hire 6 associates at stores NM‑012 and NM‑017. Approved 2 June 2026." },
    { term: "Predicted", detail: "Operating profit −4,200 to +5,800 a month (80% interval)." },
    { term: "Measured after 12 weeks", detail: "+1,900 a month, inside the predicted range." },
  ];
  return (
    <figure className={cn("rounded-xl border bg-card", className)}>
      <figcaption className="flex flex-col gap-2.5 border-b px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-sm font-medium">Predicted versus actual</span>
        <IllustrativeLabel />
      </figcaption>
      <dl className="grid gap-5 px-5 py-5 sm:grid-cols-3 sm:gap-6">
        {items.map((item) => (
          <div key={item.term}>
            <dt className="text-xs text-muted-foreground">{item.term}</dt>
            <dd className="tabular mt-1 text-[0.9375rem] leading-relaxed">{item.detail}</dd>
          </div>
        ))}
      </dl>
    </figure>
  );
}
