import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { preload } from "react-dom";

import { Providers } from "@/components/providers";

// Self-hosted fonts (public/fonts, see fonts.css): no request to a font CDN at build or run time.
import "./fonts.css";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "AUREX — Decision intelligence for retail and enterprise",
    template: "%s · AUREX",
  },
  description:
    "AUREX unifies authorized POS, ERP, inventory, accounting and workforce data, then forecasts performance and simulates management decisions with evidence-based recommendations.",
  applicationName: "AUREX",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1426" },
  ],
};

// Latin subsets are used on every page; the other subsets load only when a page needs their characters.
const PRELOADED_FONTS = [
  "/fonts/geist-latin.woff2",
  "/fonts/geist-mono-latin.woff2",
  "/fonts/schibsted-grotesk-latin.woff2",
];

// Explicit props (not the generated global LayoutProps) so `tsc` passes on a fresh checkout before `next build`.
export default function RootLayout({ children }: { children: ReactNode }) {
  for (const href of PRELOADED_FONTS) {
    preload(href, { as: "font", type: "font/woff2", crossOrigin: "anonymous" });
  }
  return (
    <html lang="en" suppressHydrationWarning className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
