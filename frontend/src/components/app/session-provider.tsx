"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  createContext,
  Suspense,
  use,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { browser } from "react-dom";

import { ApiError, authApi, type CurrentUser, type Membership, type SessionInfo } from "@/lib/api";
import type { AccessContext } from "@/lib/app/nav";

/*
 * Session model for /app.
 *
 * The workspace depends on the signed-in session, the active organization stored in this browser
 * and URL filters, so every part that needs them renders in the browser only, inside a
 * <SessionIsland> (Suspense + `use(browser())`). The shared layout itself never bails out of server
 * rendering, which keeps Next's instant-navigation validation able to render each page segment.
 *
 * Every island reads the same cached `/auth/me` query and the same active-organization store, so
 * they always agree.
 */

const ACTIVE_ORG_KEY = "aurex.activeOrg";

export type Session = AccessContext & {
  user: CurrentUser;
  memberships: Membership[];
  /** The active organization membership (null for platform admins without memberships). */
  membership: Membership | null;
  orgId: string | null;
  hasAny: (...permissions: string[]) => boolean;
  setActiveOrg: (orgId: string) => void;
  signOut: () => Promise<void>;
};

// --- Active organization: localStorage-backed store shared by all islands -------------------

const listeners = new Set<() => void>();
let memoryOrg: string | null = null;

function readActiveOrg(): string | null {
  try {
    return window.localStorage.getItem(ACTIVE_ORG_KEY) ?? memoryOrg;
  } catch {
    return memoryOrg;
  }
}

function writeActiveOrg(orgId: string) {
  memoryOrg = orgId;
  try {
    window.localStorage.setItem(ACTIVE_ORG_KEY, orgId);
  } catch {
    /* storage unavailable (private mode): keep the choice in memory for this page */
  }
  listeners.forEach((listener) => listener());
}

function subscribeActiveOrg(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === ACTIVE_ORG_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function useActiveOrgId(): string | null {
  return useSyncExternalStore(subscribeActiveOrg, readActiveOrg, () => null);
}

// --- Session query -----------------------------------------------------------------------------

export const SESSION_QUERY_KEY = ["auth", "me"] as const;

function useSessionQuery() {
  return useQuery<SessionInfo, ApiError>({
    queryKey: SESSION_QUERY_KEY,
    queryFn: () => authApi.me(),
    staleTime: 5 * 60_000,
  });
}

function signInUrl(returnHere = true) {
  const url = new URL("/sign-in", window.location.origin);
  if (returnHere) url.searchParams.set("next", `${window.location.pathname}${window.location.search}`);
  return url.href;
}

const SessionContext = createContext<Session | null>(null);

/** Build the session value from the cached `/auth/me` result (browser only). */
function SessionLoader({
  fallback,
  renderError,
  children,
}: {
  fallback: ReactNode;
  renderError?: (error: unknown, retry: () => void) => ReactNode;
  children: ReactNode;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const me = useSessionQuery();
  const storedOrg = useActiveOrgId();
  const session = me.data;
  const unauthenticated = me.error instanceof ApiError && me.error.status === 401;

  useEffect(() => {
    // The session expired and could not be refreshed: sign in again, then come back here.
    if (unauthenticated) window.location.replace(signInUrl());
  }, [unauthenticated]);

  const membership = useMemo<Membership | null>(() => {
    if (!session) return null;
    return session.memberships.find((m) => m.org_id === storedOrg) ?? session.memberships[0] ?? null;
  }, [session, storedOrg]);

  const permissions = useMemo(() => new Set(membership?.permissions ?? []), [membership]);
  const has = useCallback((permission: string) => permissions.has(permission), [permissions]);
  const hasAny = useCallback((...list: string[]) => list.some((p) => permissions.has(p)), [permissions]);

  const setActiveOrg = useCallback(
    (orgId: string) => {
      const target = session?.memberships.find((m) => m.org_id === orgId);
      if (!target) return;
      writeActiveOrg(orgId);
      // Filters (company, stores) belong to an organization, so start the new one fresh.
      router.push(target.workspace_path || "/app");
    },
    [router, session],
  );

  const signOut = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      /* the server session may already be gone; local state is cleared either way */
    }
    queryClient.clear();
    // A full page load (not router.push) discards every preserved page and all client state of
    // this account, as recommended for sign-out with Cache Components.
    window.location.assign(signInUrl(false));
  }, [queryClient]);

  const value = useMemo<Session | null>(() => {
    if (!session) return null;
    return {
      user: session.user,
      memberships: session.memberships,
      membership,
      orgId: membership?.org_id ?? null,
      hasMembership: Boolean(membership),
      isPlatformAdmin: session.user.is_platform_admin,
      has,
      hasAny,
      setActiveOrg,
      signOut,
    };
  }, [session, membership, has, hasAny, setActiveOrg, signOut]);

  if (me.isPending || unauthenticated) return <>{fallback}</>;
  if (me.error || !value) return <>{renderError ? renderError(me.error, () => void me.refetch()) : fallback}</>;
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

function BrowserOnly({ children }: { children: ReactNode }) {
  use(browser("AUREX workspace views depend on the browser session and render client-side."));
  return <>{children}</>;
}

/**
 * A part of the workspace that needs the session. Renders `fallback` on the server and while the
 * session loads; `renderError` decides what a failed session load looks like here.
 */
export function SessionIsland({
  fallback,
  renderError,
  children,
}: {
  fallback: ReactNode;
  renderError?: (error: unknown, retry: () => void) => ReactNode;
  children: ReactNode;
}) {
  return (
    <Suspense fallback={fallback}>
      <BrowserOnly>
        <SessionLoader fallback={fallback} renderError={renderError}>
          {children}
        </SessionLoader>
      </BrowserOnly>
    </Suspense>
  );
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) {
    throw new Error(
      "useSession() must run inside a <SessionIsland>. Wrap /app page content in <AppPage> (components/app/app-page.tsx).",
    );
  }
  return session;
}

/** The active organization id. Throws for users without an organization (platform-only admins). */
export function useOrgId(): string {
  const { orgId } = useSession();
  if (!orgId) throw new Error("This view needs an organization membership");
  return orgId;
}
