"use client";

import type { ReactNode } from "react";

import { errorMessage } from "@/lib/api";

import { SessionIsland } from "./session-provider";
import { PageSkeleton } from "./shell/shell-skeleton";
import { FullPageError } from "./states";

/**
 * Wrap the content of every /app page in <AppPage>:
 *
 *   export default function ForecastsPage() {
 *     return <AppPage><Forecasts /></AppPage>;
 *   }
 *
 * The content then renders in the browser with the signed-in session available (useSession,
 * useOrgQuery, useFilters). The server prerenders `skeleton` instead.
 */
export function AppPage({ children, skeleton }: { children: ReactNode; skeleton?: ReactNode }) {
  const fallback = skeleton ?? <PageSkeleton />;
  return (
    <SessionIsland
      fallback={fallback}
      renderError={(error, retry) => (
        <FullPageError embedded title="Your workspace couldn’t be loaded" message={errorMessage(error)} onRetry={retry} />
      )}
    >
      {children}
    </SessionIsland>
  );
}
