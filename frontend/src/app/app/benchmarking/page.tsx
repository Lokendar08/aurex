"use client";

import { RequireAccess } from "@/components/app/access";
import { AppPage } from "@/components/app/app-page";
import { BenchmarkingView } from "@/components/app/benchmarking/benchmarking-view";
import { PERMISSIONS } from "@/lib/app/nav";

/** /app/benchmarking: own company against listed peers on comparable ratios, with comparability notes. */
export default function BenchmarkingPage() {
  return (
    <AppPage>
      <RequireAccess area="Benchmarking" permission={PERMISSIONS.intelligenceRead}>
        <BenchmarkingView />
      </RequireAccess>
    </AppPage>
  );
}
