"use client";

import { RequireAccess } from "@/components/app/access";
import { AppPage } from "@/components/app/app-page";
import { NewsView } from "@/components/app/news/news-view";
import { PERMISSIONS } from "@/lib/app/nav";

/** /app/news: curated and fetched market news, with reported facts kept apart from AI interpretation. */
export default function NewsPage() {
  return (
    <AppPage>
      <RequireAccess area="Market News" permission={PERMISSIONS.intelligenceRead}>
        <NewsView />
      </RequireAccess>
    </AppPage>
  );
}
