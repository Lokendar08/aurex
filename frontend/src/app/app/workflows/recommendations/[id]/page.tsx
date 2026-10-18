"use client";

import { useParams } from "next/navigation";

import { RequireAccess } from "@/components/app/access";
import { AppPage } from "@/components/app/app-page";
import { RecommendationDetailView } from "@/components/app/workflows/recommendation-detail";
import { PERMISSIONS } from "@/lib/app/nav";

/** /app/workflows/recommendations/[id]: one recommendation's evidence, approvals, tasks and outcome. */
export default function RecommendationPage() {
  return (
    <AppPage>
      <RequireAccess area="Recommendations" permission={PERMISSIONS.recommendationsRead}>
        <RecommendationRoute />
      </RequireAccess>
    </AppPage>
  );
}

function RecommendationRoute() {
  const params = useParams<{ id: string }>();
  const id = typeof params.id === "string" ? params.id : "";
  return <RecommendationDetailView key={id} id={id} />;
}
