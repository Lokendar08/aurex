import type { SVGProps } from "react";

import { cn } from "@/lib/utils";

/**
 * AUREX brand marks.
 *
 * The mark is an apex (the "A" without its crossbar) holding a single measured point: a decision
 * resting on evidence. Shapes are drawn in `currentColor`, so the mark follows the surrounding text
 * colour; the evidence point takes the brand accent.
 *
 * `surface` picks colours for a known background:
 * - "auto" (default): glyph inherits currentColor, accent is brand blue. Works on white and navy.
 * - "light": navy glyph, brand-blue accent, for white or light surfaces.
 * - "dark": white glyph, sky accent, for navy surfaces.
 */
export type BrandSurface = "auto" | "light" | "dark";

type BrandProps = Omit<SVGProps<SVGSVGElement>, "children"> & {
  surface?: BrandSurface;
  /** Accessible name. When omitted the graphic is decorative (aria-hidden). */
  title?: string;
};

// Apex glyph, drawn on a 32 x 32 grid (bounding box x 4.5-27.5, y 4-27).
const APEX_PATH = "M4.5 27 L16 4 L27.5 27 H23.5 L16 12 L8.5 27 Z";
const POINT = { cx: 16, cy: 22.4, r: 2.4 };

// Wordmark letters on a 20-unit cap height, stroke weight 3. Separate paths so overlapping strokes
// never cancel out under even-odd filling.
const WORDMARK_PATHS = [
  // A (apex form, echoes the mark)
  "M0 20 L7.5 0 L15 20 H11.8 L7.5 8.533 L3.2 20 Z",
  // U
  "M17.2 0 H20.2 V13 A4 4 0 0 0 28.2 13 V0 H31.2 V13 A7 7 0 0 1 17.2 13 Z",
  // R: stem and bowl (with counter), then leg
  "M34.4 0 H42 A5.7 5.7 0 0 1 42 11.4 H37.4 V20 H34.4 Z M37.4 3 V8.4 H42 A2.7 2.7 0 0 0 42 3 Z",
  "M39.7 9.6 H43 L48 20 H44.7 Z",
  // E
  "M50.6 0 H62.2 V3 H53.6 V8.5 H61.2 V11.5 H53.6 V17 H62.2 V20 H50.6 Z",
  // X
  "M64.6 0 H68.04 L79.2 20 H75.76 Z",
  "M75.76 0 H79.2 L68.04 20 H64.6 Z",
];

function surfaceClasses(surface: BrandSurface) {
  switch (surface) {
    case "light":
      return { glyph: "text-navy-950", accent: "fill-brand-600" };
    case "dark":
      return { glyph: "text-white", accent: "fill-sky-accent" };
    default:
      return { glyph: "", accent: "fill-brand-500" };
  }
}

function a11yProps(title?: string) {
  return title ? ({ role: "img", "aria-label": title } as const) : ({ "aria-hidden": true } as const);
}

/** The apex mark on its own. Size it with className (e.g. `size-7`). */
export function AurexMark({ surface = "auto", title, className, ...props }: BrandProps) {
  const tone = surfaceClasses(surface);
  return (
    <svg
      viewBox="4 3.5 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("size-7 shrink-0", tone.glyph, className)}
      focusable="false"
      {...a11yProps(title)}
      {...props}
    >
      <path d={APEX_PATH} className="fill-current" />
      <circle {...POINT} className={tone.accent} />
    </svg>
  );
}

/**
 * Mark plus wordmark. Height drives size (e.g. `h-6`); width follows the 83:24 aspect ratio.
 * Pass `title={undefined}` with `aria-hidden` usage inside a labelled link if you prefer.
 */
export function AurexLogo({ surface = "auto", title = "AUREX", className, ...props }: BrandProps) {
  const tone = surfaceClasses(surface);
  const scale = 24 / 23;
  return (
    <svg
      viewBox="0 0 83 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("h-6 w-auto shrink-0", tone.glyph, className)}
      focusable="false"
      {...a11yProps(title)}
      {...props}
    >
      <g transform={`scale(${scale}) translate(-4.5 -4)`}>
        <path d={APEX_PATH} className="fill-current" />
        <circle {...POINT} className={tone.accent} />
      </g>
      <g transform="translate(31.5 5.5) scale(0.65)" className="fill-current">
        {WORDMARK_PATHS.map((d) => (
          <path key={d} d={d} fillRule="evenodd" />
        ))}
      </g>
    </svg>
  );
}
