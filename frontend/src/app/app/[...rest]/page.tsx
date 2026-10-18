"use client";

import { CompassIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { AppPage } from "@/components/app/app-page";
import { useDocumentTitle } from "@/components/app/page";
import { useSession } from "@/components/app/session-provider";
import { EmptyState } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { navItemFor } from "@/lib/app/nav";

/**
 * Unknown /app/... address, rendered inside the workspace shell. Specific routes always take
 * precedence over this catch-all, so new pages replace it automatically.
 */
export default function AppNotFoundPage() {
  return (
    <AppPage>
      <NotFound />
    </AppPage>
  );
}

function NotFound() {
  const pathname = usePathname();
  const { membership, isPlatformAdmin } = useSession();
  const item = navItemFor(pathname);
  const home = membership?.workspace_path ?? (isPlatformAdmin ? "/app/platform" : "/app");
  useDocumentTitle(item ? item.label : "Page not found");

  return (
    <div className="mx-auto max-w-xl py-12">
      <EmptyState
        icon={CompassIcon}
        title={item ? `${item.label} isn’t available in this build yet` : "This page doesn’t exist"}
        description={
          item
            ? "This workspace area is being prepared. Everything else in your navigation is ready to use."
            : "Check the address, or go back to your workspace."
        }
        action={
          <Button asChild>
            <Link href={home}>Go to your workspace</Link>
          </Button>
        }
      />
    </div>
  );
}
