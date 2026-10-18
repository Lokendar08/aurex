"use client";

import { useRouter, useSearchParams } from "next/navigation";
import {
  createContext,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";

import type { SessionInfo } from "@/lib/api";

const APP_PATH = /^\/app(?:[/?#]|$)/;

/**
 * Accept `next` only when it is a same-origin relative path into the app (`/app`, `/app/...`).
 * Rejects absolute and protocol-relative URLs, backslashes, control characters and paths that
 * normalize outside /app (such as `/app/../admin`).
 */
export function safeAppPath(candidate: string | null | undefined): string | null {
  if (!candidate || !APP_PATH.test(candidate) || candidate.includes("\\")) return null;
  for (const char of candidate) {
    const code = char.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) return null;
  }
  if (typeof window === "undefined") return null;
  try {
    const url = new URL(candidate, window.location.origin);
    if (url.origin !== window.location.origin) return null;
    const path = `${url.pathname}${url.search}${url.hash}`;
    return APP_PATH.test(path) ? path : null;
  } catch {
    return null;
  }
}

/** Where to go after a successful sign-in, demo sign-in or registration. */
export function destinationFor(session: SessionInfo, next: string | null): string {
  const requested = safeAppPath(next);
  if (requested) return requested;
  const workspace = safeAppPath(session.memberships[0]?.workspace_path);
  if (workspace) return workspace;
  if (session.memberships.length === 0 && session.user.is_platform_admin) return "/app/platform";
  return "/app";
}

const NextParamContext = createContext<RefObject<string | null> | null>(null);

/** Reads `?next=` in its own Suspense boundary so the forms around it stay in the static shell. */
function NextParamReader({ nextRef }: { nextRef: RefObject<string | null> }) {
  const params = useSearchParams();
  const next = params.get("next");
  useEffect(() => {
    nextRef.current = next;
  }, [next, nextRef]);
  return null;
}

export function AuthRedirectProvider({ children }: { children: ReactNode }) {
  const nextRef = useRef<string | null>(null);
  return (
    <NextParamContext.Provider value={nextRef}>
      <Suspense fallback={null}>
        <NextParamReader nextRef={nextRef} />
      </Suspense>
      {children}
    </NextParamContext.Provider>
  );
}

/** Returns a function that navigates to the right workspace for a new session. */
export function useAuthNavigation() {
  const router = useRouter();
  const nextRef = useContext(NextParamContext);
  return useCallback(
    (session: SessionInfo) => {
      router.replace(destinationFor(session, nextRef?.current ?? null));
    },
    [router, nextRef],
  );
}
