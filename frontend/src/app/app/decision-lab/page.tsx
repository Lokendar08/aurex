"use client";

import { RequireAccess } from "@/components/app/access";
import { AppPage } from "@/components/app/app-page";
import { DecisionLabWorkspace } from "@/components/app/decision-lab/workspace";
import { PERMISSIONS } from "@/lib/app/nav";

/** /app/decision-lab: scenario builder, results, saved scenarios, comparison and goal optimizer. */
export default function DecisionLabPage() {
  return (
    <AppPage>
      <RequireAccess area="the Decision Lab" permission={PERMISSIONS.scenariosRead}>
        <DecisionLabWorkspace />
      </RequireAccess>
    </AppPage>
  );
}
