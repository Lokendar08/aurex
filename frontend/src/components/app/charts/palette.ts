/**
 * Chart colour roles, all drawn from the design tokens in globals.css.
 *
 * Categorical order (validated with the dataviz palette checker against the card surface):
 *   chart-1 brand blue, chart-4 teal, chart-6 violet, chart-5 amber, chart-2 sky
 * Light mode: worst adjacent CVD ΔE 16.6, normal-vision ΔE 27 (targets ≥ 8 / ≥ 15). Teal, amber and sky sit
 * below 3:1 against white, so every multi-series chart ships a table view and/or direct labels.
 * chart-3 (navy) fails the categorical lightness/chroma band, so it is reserved for totals and anchors.
 * Colour follows the entity: series keep their slot when filters change the number of series.
 */
export const SERIES_COLORS = ["var(--chart-1)", "var(--chart-4)", "var(--chart-6)", "var(--chart-5)", "var(--chart-2)"] as const;

/** De-emphasised context series (e.g. the comparison period). */
export const CONTEXT_COLOR = "var(--muted-foreground)";
/** Totals / anchors in bridges. */
export const ANCHOR_COLOR = "var(--chart-3)";
/** Polarity where the direction itself is good or bad news (revenue up / down). */
export const POSITIVE_COLOR = "var(--success)";
export const NEGATIVE_COLOR = "var(--destructive)";
/** "Other" bucket when a part-to-whole view folds its tail. */
export const OTHER_COLOR = "color-mix(in oklch, var(--muted-foreground) 45%, var(--card))";

export const GRID_COLOR = "var(--border)";
export const AXIS_TEXT = "var(--muted-foreground)";

export function seriesColor(index: number): string {
  return SERIES_COLORS[index] ?? OTHER_COLOR;
}
