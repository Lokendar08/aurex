"use client";

import { RequireAccess } from "@/components/app/access";
import { AppPage } from "@/components/app/app-page";
import { WorkflowsView } from "@/components/app/workflows/workflows-view";
import { PERMISSIONS } from "@/lib/app/nav";

/** /app/workflows: recommendations pipeline, approvals, tasks and notifications. */
export default function WorkflowsPage() {
  return (
    <AppPage>
      <RequireAccess area="Workflows" anyOf={[PERMISSIONS.recommendationsRead, PERMISSIONS.tasksRead]}>
        <WorkflowsView />
      </RequireAccess>
    </AppPage>
  );
}
