"use client";

import { RequireAccess } from "@/components/app/access";
import { AppPage } from "@/components/app/app-page";
import { ReportsView } from "@/components/app/reports/reports-view";
import { PERMISSIONS } from "@/lib/app/nav";

/** /app/reports: generate PDF / CSV / Excel reports and download them with their checksum. */
export default function ReportsPage() {
  return (
    <AppPage>
      <RequireAccess area="Reports" permission={PERMISSIONS.reportsRead}>
        <ReportsView />
      </RequireAccess>
    </AppPage>
  );
}
