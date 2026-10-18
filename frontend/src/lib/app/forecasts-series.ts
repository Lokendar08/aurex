/**
 * Chart series for a forecast: history + forecast with 80% / 95% bands, in the model's native
 * frequency or (daily models only) summed to weeks or months in the browser.
 *
 * Aggregation rules, stated in the UI next to the chart:
 * - Flows (sales, transactions, units) are summed. Only daily models offer aggregation.
 * - The bucket that straddles the last actual day combines the actual days with the forecast
 *   days ("partly actual"); its band covers only the forecast part.
 * - Incomplete buckets at either end of the window are left out.
 * - Monthly bands use the model's monthly backtest error quantiles when available (the same
 *   rule as the 12-month baseline); weekly bands sum the daily bounds, which is conservative
 *   (it assumes the daily errors move together).
 */
import { parseDate } from "./format";
import type { ErrorQuantiles, ForecastDetail } from "./forecasts-types";

export type Granularity = "native" | "week" | "month";

export type ChartPoint = {
  period: string;
  actual: number | null;
  yhat: number | null;
  band80: [number, number] | null;
  band95: [number, number] | null;
  /** Bucket combining actual days and forecast days. */
  blended?: boolean;
  /** Actual part of a blended bucket. */
  actualPart?: number;
};

const DAY = 86_400_000;

function iso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function bucketOf(dateText: string, granularity: "week" | "month"): { key: string; days: number } | null {
  const date = parseDate(dateText);
  if (!date) return null;
  if (granularity === "month") {
    const start = new Date(date.getFullYear(), date.getMonth(), 1);
    const days = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    return { key: iso(start), days };
  }
  const offset = (date.getDay() + 6) % 7; // Monday = 0
  const start = new Date(date.getTime() - offset * DAY);
  return { key: iso(new Date(start.getFullYear(), start.getMonth(), start.getDate())), days: 7 };
}

type Acc = { count: number; days: number; sum: number; l80: number; u80: number; l95: number; u95: number; bandOk: boolean };

function emptyAcc(days: number): Acc {
  return { count: 0, days, sum: 0, l80: 0, u80: 0, l95: 0, u95: 0, bandOk: true };
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export type SeriesResult = { points: ChartPoint[]; notes: string[]; forecastStart: string | null };

/** Native frequency: the last `historyPoints` actuals and the whole forecast. */
function nativeSeries(detail: ForecastDetail, historyPoints: number): SeriesResult {
  const history = detail.history.slice(-historyPoints);
  const points: ChartPoint[] = history.map((h) => ({ period: h.period_start, actual: h.actual, yhat: null, band80: null, band95: null }));
  const last = points[points.length - 1];
  if (last && isNum(last.actual) && detail.forecast.length) {
    // Anchor the forecast line and bands on the last actual so the two series join.
    last.yhat = last.actual;
    last.band80 = [last.actual, last.actual];
    last.band95 = [last.actual, last.actual];
  }
  for (const f of detail.forecast) {
    points.push({
      period: f.period_start,
      actual: null,
      yhat: f.yhat,
      band80: isNum(f.lower_80) && isNum(f.upper_80) ? [f.lower_80, f.upper_80] : null,
      band95: isNum(f.lower_95) && isNum(f.upper_95) ? [f.lower_95, f.upper_95] : null,
    });
  }
  return { points, notes: [], forecastStart: detail.forecast[0]?.period_start ?? null };
}

function aggregate(detail: ForecastDetail, granularity: "week" | "month", quantiles: ErrorQuantiles | null | undefined): SeriesResult {
  const hist = new Map<string, Acc>();
  for (const h of detail.history) {
    if (!isNum(h.actual)) continue;
    const b = bucketOf(h.period_start, granularity);
    if (!b) continue;
    const acc = hist.get(b.key) ?? emptyAcc(b.days);
    acc.count += 1;
    acc.sum += h.actual;
    hist.set(b.key, acc);
  }
  const fc = new Map<string, Acc>();
  for (const f of detail.forecast) {
    if (!isNum(f.yhat)) continue;
    const b = bucketOf(f.period_start, granularity);
    if (!b) continue;
    const acc = fc.get(b.key) ?? emptyAcc(b.days);
    acc.count += 1;
    acc.sum += f.yhat;
    if (isNum(f.lower_80) && isNum(f.upper_80) && isNum(f.lower_95) && isNum(f.upper_95)) {
      acc.l80 += f.lower_80;
      acc.u80 += f.upper_80;
      acc.l95 += f.lower_95;
      acc.u95 += f.upper_95;
    } else acc.bandOk = false;
    fc.set(b.key, acc);
  }

  const keys = Array.from(new Set([...hist.keys(), ...fc.keys()])).sort();
  const points: ChartPoint[] = [];
  let droppedStart = false;
  let droppedEnd = false;
  let blendedLabel: string | null = null;
  const useQuantiles = granularity === "month" && quantiles && isNum(quantiles.q10) && isNum(quantiles.q90);

  keys.forEach((key) => {
    const h = hist.get(key);
    const f = fc.get(key);
    if (h && !f) {
      if (h.count < h.days) {
        droppedStart = true;
        return;
      }
      points.push({ period: key, actual: h.sum, yhat: null, band80: null, band95: null });
      return;
    }
    if (!f) return;
    const actualPart = h?.sum ?? 0;
    const totalDays = (h?.count ?? 0) + f.count;
    if (totalDays < f.days) {
      droppedEnd = true;
      return;
    }
    let band80: [number, number] | null = null;
    let band95: [number, number] | null = null;
    if (useQuantiles) {
      const q = quantiles as ErrorQuantiles;
      band80 = [actualPart + f.sum * (1 + q.q10), actualPart + f.sum * (1 + q.q90)];
      band95 = isNum(q.q025) && isNum(q.q975) ? [actualPart + f.sum * (1 + q.q025), actualPart + f.sum * (1 + q.q975)] : null;
    } else if (f.bandOk) {
      band80 = [actualPart + f.l80, actualPart + f.u80];
      band95 = [actualPart + f.l95, actualPart + f.u95];
    }
    const blended = Boolean(h && h.count > 0);
    if (blended) blendedLabel = key;
    points.push({ period: key, actual: null, yhat: actualPart + f.sum, band80, band95, blended, actualPart: blended ? actualPart : undefined });
  });

  // Join the actual line to the forecast line at the last complete actual bucket.
  const lastActual = [...points].reverse().find((p) => isNum(p.actual));
  if (lastActual && isNum(lastActual.actual)) {
    lastActual.yhat = lastActual.actual;
    lastActual.band80 = [lastActual.actual, lastActual.actual];
    lastActual.band95 = [lastActual.actual, lastActual.actual];
  }

  const notes = [
    `${granularity === "month" ? "Monthly" : "Weekly"} totals are sums of the daily ${detail.target_label.toLowerCase()} values.`,
    useQuantiles
      ? "Monthly bands apply the model's monthly backtest error quantiles to the forecast part of each month."
      : "Bands are the summed daily bounds: a conservative width that assumes daily errors move together.",
  ];
  if (blendedLabel) notes.push("The first forecast period combines the actual days so far with the forecast for the rest of the period.");
  if (droppedStart || droppedEnd) notes.push("Incomplete periods (at the edges of the window or with missing days) are left out.");
  const firstForecast = points.find((p) => isNum(p.yhat) && !isNum(p.actual));
  return { points, notes, forecastStart: firstForecast?.period ?? null };
}

export function buildSeries(detail: ForecastDetail, granularity: Granularity, historyPoints: number): SeriesResult {
  if (granularity === "native" || detail.frequency !== "D") return nativeSeries(detail, historyPoints);
  return aggregate(detail, granularity, detail.metrics.monthly_relative_error_quantiles);
}

// ---------------------------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------------------------

const ALGORITHMS: Record<string, string> = {
  naive_last: "Naive (last value repeated)",
  seasonal_naive_yearly: "Seasonal naive (same period last year)",
  seasonal_naive_weekly: "Seasonal naive (same weekday last week)",
  seasonal_naive: "Seasonal naive",
  moving_average: "Moving average",
  holt_winters: "Holt-Winters exponential smoothing",
  ets: "Exponential smoothing (ETS)",
  ridge_regression: "Ridge regression",
  gradient_boosting: "Gradient boosting",
  random_forest: "Random forest",
  sarimax: "SARIMAX",
  prophet: "Prophet",
};

export function algorithmLabel(key: string | null | undefined): string {
  if (!key) return "Not available";
  return ALGORITHMS[key] ?? key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

export const FAMILY_LABELS: Record<string, string> = {
  baseline: "Baseline",
  statistical: "Statistical",
  machine_learning: "Machine learning",
};

export const FREQUENCY_LABELS: Record<string, string> = { D: "Daily", W: "Weekly", M: "Monthly" };

export const LEVEL_LABELS: Record<string, string> = { company: "Company", store: "Store", category: "Category" };
