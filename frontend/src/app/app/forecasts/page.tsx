"use client";

import { RequireAccess } from "@/components/app/access";
import { AppPage } from "@/components/app/app-page";
import { ForecastsView } from "@/components/app/forecasts/forecasts-view";
import { PERMISSIONS } from "@/lib/app/nav";

/** /app/forecasts: validated forecasts, model cards, backtests, versions and the baseline P&L. */
export default function ForecastsPage() {
  return (
    <AppPage>
      <RequireAccess area="Forecasts" permission={PERMISSIONS.forecastsRead}>
        <ForecastsView />
      </RequireAccess>
    </AppPage>
  );
}
