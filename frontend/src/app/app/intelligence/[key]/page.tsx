"use client";

import { useParams } from "next/navigation";

import { RequireAccess } from "@/components/app/access";
import { AppPage } from "@/components/app/app-page";
import { CompanyDetailView } from "@/components/app/intelligence/company-detail";
import { PERMISSIONS } from "@/lib/app/nav";

/** /app/intelligence/[key]: one company's reported financials, derived metrics, market data and news. */
export default function CompanyPage() {
  return (
    <AppPage>
      <RequireAccess area="Company Intelligence" permission={PERMISSIONS.intelligenceRead}>
        <CompanyRoute />
      </RequireAccess>
    </AppPage>
  );
}

function CompanyRoute() {
  const params = useParams<{ key: string }>();
  const key = typeof params.key === "string" ? decodeURIComponent(params.key) : "";
  return <CompanyDetailView key={key} companyKey={key} />;
}
