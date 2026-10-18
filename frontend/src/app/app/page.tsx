"use client";

import { Building2Icon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { AppPage } from "@/components/app/app-page";
import { useDocumentTitle } from "@/components/app/page";
import { useSession } from "@/components/app/session-provider";
import { EmptyState, SkeletonBlock } from "@/components/app/states";
import { Button } from "@/components/ui/button";

function safeWorkspace(path: string | null | undefined): string | null {
  return path && /^\/app\/[a-z0-9/-]+$/i.test(path) ? path : null;
}

/** /app: send each member to their role's workspace (platform administrators to /app/platform). */
export default function AppIndexPage() {
  return (
    <AppPage>
      <WorkspaceRedirect />
    </AppPage>
  );
}

function WorkspaceRedirect() {
  const router = useRouter();
  const { membership, isPlatformAdmin } = useSession();
  const target = safeWorkspace(membership?.workspace_path) ?? (isPlatformAdmin ? "/app/platform" : membership ? "/app/my-work" : null);
  useDocumentTitle("Workspace");

  useEffect(() => {
    if (target) router.replace(target);
  }, [router, target]);

  if (target) {
    return (
      <div className="space-y-4" aria-busy="true">
        <SkeletonBlock className="h-8 w-64" />
        <SkeletonBlock className="h-4 w-96 max-w-full" />
        <SkeletonBlock className="h-40 w-full" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl py-12">
      <EmptyState
        icon={Building2Icon}
        title="You are not a member of an organization yet"
        description="Ask an organization owner to send you an invitation link. Once you accept it, your workspace appears here."
        action={
          <Button asChild variant="outline">
            <Link href="/">Back to the AUREX website</Link>
          </Button>
        }
      />
    </div>
  );
}
