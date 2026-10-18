"use client";

import { RequireAccess } from "@/components/app/access";
import { AdvisorView } from "@/components/app/advisor/advisor-view";
import { AppPage } from "@/components/app/app-page";
import { PERMISSIONS } from "@/lib/app/nav";

/** /app/advisor: grounded Q&A over validated AUREX calculations, with traced figures and tool calls. */
export default function AdvisorPage() {
  return (
    <AppPage>
      <RequireAccess area="the AI Advisor" permission={PERMISSIONS.advisorUse}>
        <AdvisorView />
      </RequireAccess>
    </AppPage>
  );
}
