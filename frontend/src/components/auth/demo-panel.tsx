"use client";

import { useQuery } from "@tanstack/react-query";
import { LoaderCircleIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { authApi, type DemoRole } from "@/lib/api";
import { cn } from "@/lib/utils";

import { authErrorMessage } from "./errors";
import { useAuthNavigation } from "./redirect";

/**
 * "Explore the live demo": one-click sign-in to NovaMart, the synthetic demo company. Hidden
 * entirely when demo mode is disabled or the roles can't be loaded.
 */
export function DemoPanel() {
  const navigateAfterAuth = useAuthNavigation();
  const [pendingRole, setPendingRole] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLElement>(null);

  const query = useQuery({
    queryKey: ["auth", "demo-roles"],
    queryFn: () => authApi.demoRoles(),
    retry: false,
    staleTime: 5 * 60_000,
  });

  const roles: DemoRole[] = query.data?.enabled ? query.data.roles : [];
  const visible = roles.length > 0;
  const organization = query.data?.organization || "NovaMart";

  // Links to /sign-in#demo arrive before this panel exists; scroll to it once it renders.
  useEffect(() => {
    if (visible && window.location.hash === "#demo") {
      panelRef.current?.scrollIntoView({ block: "start" });
    }
  }, [visible]);

  // Reset the in-flight state when the page is hidden after navigating into the app.
  useLayoutEffect(() => {
    return () => setPendingRole(null);
  }, []);

  if (!visible) return null;

  async function signInAs(role: string) {
    if (pendingRole) return;
    setError(null);
    setPendingRole(role);
    try {
      const session = await authApi.demoLogin(role);
      navigateAfterAuth(session);
    } catch (err) {
      setPendingRole(null);
      setError(authErrorMessage(err));
    }
  }

  return (
    <section
      id="demo"
      ref={panelRef}
      aria-labelledby="demo-title"
      className="mt-10 scroll-mt-24 overflow-hidden rounded-2xl bg-navy-900 text-white ring-1 ring-navy-900"
    >
      <div className="px-5 pt-6 pb-5 sm:px-6">
        <h2 id="demo-title" className="font-display text-xl font-semibold tracking-[-0.01em]">
          Explore the live demo
        </h2>
        <p className="mt-2 text-[0.9375rem] leading-relaxed text-navy-200">
          Sign in as any role at {organization}, a fictional retailer. Every figure in the demo is synthetic, so
          you can explore freely.
        </p>
      </div>

      {error ? (
        <p role="alert" className="mx-5 mb-4 rounded-lg bg-white/8 px-3.5 py-3 text-sm leading-relaxed sm:mx-6">
          {error}
        </p>
      ) : null}

      <ul className="border-t border-white/10" aria-busy={pendingRole ? true : undefined}>
        {roles.map((role) => {
          const isPending = pendingRole === role.role;
          return (
            <li key={role.role} className="border-b border-white/10 last:border-b-0">
              <button
                type="button"
                onClick={() => void signInAs(role.role)}
                disabled={pendingRole !== null}
                className={cn(
                  "group flex w-full items-start justify-between gap-4 px-5 py-4 text-left transition-colors outline-none sm:px-6",
                  "hover:bg-white/5 focus-visible:bg-white/5 focus-visible:ring-2 focus-visible:ring-sky-accent focus-visible:ring-inset",
                  "disabled:cursor-wait",
                  pendingRole !== null && !isPending && "opacity-50",
                )}
              >
                <span className="min-w-0">
                  <span className="block font-medium text-white">{role.label}</span>
                  {role.description ? (
                    <span className="mt-0.5 block text-sm leading-relaxed text-navy-300">{role.description}</span>
                  ) : null}
                </span>
                <span className="mt-0.5 shrink-0 text-sm font-medium text-sky-accent">
                  {isPending ? (
                    <span className="inline-flex items-center gap-1.5">
                      <LoaderCircleIcon className="size-4 animate-spin" aria-hidden />
                      Opening
                    </span>
                  ) : (
                    <span className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                      Sign in
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
