"use client";

import { RequireAccess } from "@/components/app/access";
import { AppPage } from "@/components/app/app-page";
import { IntelligenceList } from "@/components/app/intelligence/list-view";
import { PERMISSIONS } from "@/lib/app/nav";

/** /app/intelligence: public company profiles with cited figures, listings and dated share-price snapshots. */
export default function IntelligencePage() {
  return (
    <AppPage>
      <RequireAccess area="Company Intelligence" permission={PERMISSIONS.intelligenceRead}>
        <IntelligenceList />
      </RequireAccess>
    </AppPage>
  );
}
