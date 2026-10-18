"use client";

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
  type UseQueryOptions,
} from "@tanstack/react-query";
import { useCallback } from "react";

import { useSession } from "@/components/app/session-provider";
import { api, ApiError, orgPath, type ApiRequestInit } from "@/lib/api";

export type QueryParams = Record<string, string | number | boolean | null | undefined | Array<string | number>>;

type OrgQueryOptions<T> = Omit<UseQueryOptions<T, ApiError, T, QueryKey>, "queryKey" | "queryFn"> & {
  query?: QueryParams;
  /** Keep the previous result on screen (dimmed) while a new filter combination loads. */
  keepPrevious?: boolean;
};

/** Query key for an org-scoped endpoint: ["org", orgId, path, params]. */
export function orgQueryKey(orgId: string | null, path: string, query?: QueryParams): QueryKey {
  return ["org", orgId, path, query ?? null];
}

/**
 * Fetch an organization-scoped endpoint (`/orgs/{activeOrg}{path}`) with TanStack Query.
 * Pass `path = null` to wait (dependent queries).
 */
export function useOrgQuery<T>(path: string | null, options: OrgQueryOptions<T> = {}) {
  const { orgId } = useSession();
  const { query, keepPrevious, enabled, ...rest } = options;
  return useQuery<T, ApiError, T, QueryKey>({
    queryKey: orgQueryKey(orgId, path ?? "", query),
    queryFn: ({ signal }) => api<T>(orgPath(orgId as string, path as string), { query, signal }),
    enabled: Boolean(orgId && path) && (enabled ?? true),
    placeholderData: keepPrevious ? keepPreviousData : undefined,
    ...rest,
  });
}

/** Fetch a non-org endpoint (platform administration). */
export function useApiQuery<T>(path: string | null, options: OrgQueryOptions<T> = {}) {
  const { query, keepPrevious, enabled, ...rest } = options;
  return useQuery<T, ApiError, T, QueryKey>({
    queryKey: ["api", path, query ?? null],
    queryFn: ({ signal }) => api<T>(path as string, { query, signal }),
    enabled: Boolean(path) && (enabled ?? true),
    placeholderData: keepPrevious ? keepPreviousData : undefined,
    ...rest,
  });
}

/**
 * Invalidate cached org queries whose path starts with one of the prefixes. A prefix ending in "$"
 * matches that exact path only (e.g. "/integrations$" refreshes the list but not detail pages).
 */
export function useInvalidateOrg() {
  const queryClient = useQueryClient();
  const { orgId } = useSession();
  return useCallback(
    (...prefixes: string[]) =>
      queryClient.invalidateQueries({
        predicate: (q) => {
          const [scope, id, path] = q.queryKey as [unknown, unknown, unknown];
          return (
            scope === "org" &&
            id === orgId &&
            typeof path === "string" &&
            prefixes.some((p) => (p.endsWith("$") ? path === p.slice(0, -1) : path.startsWith(p)))
          );
        },
      }),
    [queryClient, orgId],
  );
}

/** A mutation against an org-scoped endpoint. `request` receives the org-prefixed path builder. */
export function useOrgMutation<TVars, TResult = unknown>(
  request: (vars: TVars, call: <R>(path: string, init?: ApiRequestInit) => Promise<R>) => Promise<TResult>,
  options: { onSuccess?: (result: TResult, vars: TVars) => void; onError?: (error: ApiError, vars: TVars) => void } = {},
) {
  const { orgId } = useSession();
  return useMutation<TResult, ApiError, TVars>({
    mutationFn: (vars) => request(vars, (path, init) => api(orgPath(orgId as string, path), init)),
    onSuccess: options.onSuccess,
    onError: options.onError,
  });
}
