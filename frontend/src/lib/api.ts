/**
 * AUREX API client.
 *
 * - All requests go to the same origin under /api/v1 (proxied to FastAPI by next.config rewrites).
 * - Auth uses HttpOnly cookies set by the backend; JavaScript never sees access/refresh tokens.
 * - Unsafe methods send the double-submit CSRF token from the readable `aurex_csrf` cookie.
 * - A 401 triggers one transparent refresh attempt (deduplicated across concurrent requests).
 */

export const API_BASE = "/api/v1";

export type ApiErrorBody = {
  error?: { code?: string; message?: string; details?: unknown };
  request_id?: string;
};

export class ApiError extends Error {
  status: number;
  code: string;
  details: unknown;
  requestId?: string;

  constructor(status: number, code: string, message: string, details?: unknown, requestId?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }
}

type Query = Record<string, string | number | boolean | null | undefined | Array<string | number>>;

export type ApiRequestInit = Omit<RequestInit, "body"> & {
  json?: unknown;
  body?: BodyInit | null;
  query?: Query;
  /** Skip the automatic refresh-and-retry on 401 (used by the auth endpoints themselves). */
  noRefresh?: boolean;
};

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function readCookie(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  const match = document.cookie.split("; ").find((row) => row.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.split("=")[1] ?? "") : undefined;
}

export function buildUrl(path: string, query?: Query): string {
  const url = path.startsWith("http") ? path : `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) value.forEach((v) => params.append(key, String(v)));
    else params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

let refreshInFlight: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = fetch(`${API_BASE}/auth/refresh`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "X-CSRF-Token": readCookie("aurex_csrf") ?? "" },
    })
      .then((res) => res.ok)
      .catch(() => false)
      .finally(() => {
        setTimeout(() => {
          refreshInFlight = null;
        }, 0);
      });
  }
  return refreshInFlight;
}

async function parseError(res: Response): Promise<ApiError> {
  let body: ApiErrorBody = {};
  try {
    body = (await res.json()) as ApiErrorBody;
  } catch {
    /* non-JSON error */
  }
  const code = body.error?.code ?? `http_${res.status}`;
  const message = body.error?.message ?? res.statusText ?? "Request failed";
  return new ApiError(res.status, code, message, body.error?.details, body.request_id);
}

export async function apiRaw(path: string, init: ApiRequestInit = {}): Promise<Response> {
  const { json, query, noRefresh, headers, ...rest } = init;
  const method = (rest.method ?? (json !== undefined ? "POST" : "GET")).toUpperCase();
  const finalHeaders = new Headers(headers);
  let body = rest.body;
  if (json !== undefined) {
    finalHeaders.set("Content-Type", "application/json");
    body = JSON.stringify(json);
  }
  if (UNSAFE.has(method)) finalHeaders.set("X-CSRF-Token", readCookie("aurex_csrf") ?? "");
  finalHeaders.set("Accept", finalHeaders.get("Accept") ?? "application/json");

  const doFetch = () =>
    fetch(buildUrl(path, query), { ...rest, method, body, headers: finalHeaders, credentials: "same-origin" });

  let res = await doFetch();
  if (res.status === 401 && !noRefresh) {
    const refreshed = await refreshSession();
    if (refreshed) {
      if (UNSAFE.has(method)) finalHeaders.set("X-CSRF-Token", readCookie("aurex_csrf") ?? "");
      res = await doFetch();
    }
  }
  return res;
}

export async function api<T>(path: string, init: ApiRequestInit = {}): Promise<T> {
  const res = await apiRaw(path, init);
  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  const type = res.headers.get("content-type") ?? "";
  if (type.includes("application/json")) return (await res.json()) as T;
  return (await res.text()) as unknown as T;
}

/**
 * Download a binary response (reports, exports) and trigger a browser save.
 * A browser-integrated download manager may take the response over (the page then sees an empty 204);
 * in that case nothing is saved here, so the user never gets an empty file. The object URL is kept
 * alive for a minute because revoking it right after click() can cancel the save.
 */
export async function apiDownload(path: string, fallbackName: string, init: ApiRequestInit = {}): Promise<void> {
  const res = await apiRaw(path, init);
  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return;
  const blob = await res.blob();
  if (blob.size === 0) return;
  const disposition = res.headers.get("content-disposition") ?? "";
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  const filename = match ? decodeURIComponent(match[1]) : fallbackName;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Prefix a path with the organization scope: orgPath(id, "/companies") -> /orgs/{id}/companies */
export function orgPath(orgId: string, path: string): string {
  return `/orgs/${orgId}${path.startsWith("/") ? path : `/${path}`}`;
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong";
}

// ---------------------------------------------------------------------------------------------
// Auth contract (mirrors backend/app/api/routes/auth.py)
// ---------------------------------------------------------------------------------------------

export type Membership = {
  org_id: string;
  org_name: string;
  org_slug: string;
  is_demo: boolean;
  role: string;
  role_label: string;
  permissions: string[];
  store_scope: string[] | null;
  workspace_path: string;
};

export type CurrentUser = {
  id: string;
  email: string;
  full_name: string;
  is_platform_admin: boolean;
};

export type SessionInfo = { user: CurrentUser; memberships: Membership[] };

export type DemoRole = {
  role: string;
  label: string;
  description: string;
  email: string;
};

export const authApi = {
  login: (email: string, password: string) =>
    api<SessionInfo>("/auth/login", { json: { email, password }, noRefresh: true }),
  register: (input: { email: string; password: string; full_name: string; organization_name?: string; invitation_token?: string }) =>
    api<SessionInfo>("/auth/register", { json: input, noRefresh: true }),
  demoRoles: () => api<{ enabled: boolean; organization: string | null; roles: DemoRole[] }>("/auth/demo/roles", { noRefresh: true }),
  demoLogin: (role: string) => api<SessionInfo>("/auth/demo/login", { json: { role }, noRefresh: true }),
  me: () => api<SessionInfo>("/auth/me"),
  logout: () => api<void>("/auth/logout", { method: "POST", noRefresh: true }),
  invitation: (token: string) =>
    api<{ email: string; organization_name: string; role: string; role_label: string; expires_at: string }>(
      `/auth/invitations/${encodeURIComponent(token)}`,
      { noRefresh: true },
    ),
};
