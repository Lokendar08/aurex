import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AppFrame } from "@/components/app/shell/app-shell";

export const metadata: Metadata = {
  title: "Workspace",
  robots: { index: false, follow: false },
};

/**
 * Authenticated app (/app/**).
 *
 * The frame (sidebar, top bar) renders on the server as a skeleton and fills in from the browser
 * session. Pages wrap their content in <AppPage> (components/app/app-page.tsx) so their data views
 * also render in the browser, where the session, active organization and URL filters are known.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return <AppFrame>{children}</AppFrame>;
}
