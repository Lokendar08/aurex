"use client";

import type { ReactNode } from "react";

import { useSession } from "./session-provider";
import { ForbiddenState } from "./states";

/**
 * Show in-page actions only to members whose role allows them. This is presentation only: the
 * backend checks the same permission on every request.
 */
export function PermissionGate({
  permission,
  anyOf,
  fallback = null,
  children,
}: {
  permission?: string;
  anyOf?: string[];
  fallback?: ReactNode;
  children: ReactNode;
}) {
  const { has, hasAny } = useSession();
  const allowed = (permission ? has(permission) : true) && (anyOf ? hasAny(...anyOf) : true);
  return <>{allowed ? children : fallback}</>;
}

/** Page-level guard: renders a friendly 403 instead of the page when the role lacks access. */
export function RequireAccess({
  area,
  permission,
  allOf,
  anyOf,
  platform,
  children,
}: {
  /** Name of the area for the message, e.g. "Finance". */
  area: string;
  permission?: string;
  allOf?: string[];
  anyOf?: string[];
  /** Platform administration (no organization permission involved). */
  platform?: boolean;
  children: ReactNode;
}) {
  const session = useSession();
  const { has, hasAny, membership, hasMembership, isPlatformAdmin } = session;
  let allowed: boolean;
  if (platform) {
    allowed = isPlatformAdmin;
  } else {
    allowed =
      hasMembership &&
      (permission ? has(permission) : true) &&
      (allOf ? allOf.every((p) => has(p)) : true) &&
      (anyOf ? hasAny(...anyOf) : true);
  }
  if (!allowed) {
    const home = membership?.workspace_path ?? (isPlatformAdmin ? "/app/platform" : "/app");
    return <ForbiddenState area={area} role={membership?.role_label} homeHref={home} />;
  }
  return <>{children}</>;
}
