import { ApiError, errorMessage } from "@/lib/api";

export const SERVICE_UNAVAILABLE =
  "AUREX can't be reached right now. Check your connection and try again in a moment.";

function retryAfterSeconds(details: unknown): number | null {
  if (details && typeof details === "object" && "retry_after" in details) {
    const value = Number((details as { retry_after: unknown }).retry_after);
    return Number.isFinite(value) && value > 0 ? Math.ceil(value) : null;
  }
  return null;
}

function formatWait(seconds: number) {
  if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

/**
 * Message for a failed auth request. Backend messages are shown as written (401 invalid
 * credentials, 423 locked, 429 rate limited, 409 conflicts); transport failures and proxy errors
 * without a JSON body get a plain "can't be reached" message instead of a raw status text.
 */
export function authErrorMessage(error: unknown, fallback422 = "Check the details you entered and try again."): string {
  if (error instanceof ApiError) {
    if (error.status >= 500) {
      return error.code.startsWith("http_") ? SERVICE_UNAVAILABLE : error.message || SERVICE_UNAVAILABLE;
    }
    if (error.status === 429) {
      const wait = retryAfterSeconds(error.details);
      const message = error.message || "Too many attempts.";
      return wait && !/try again/i.test(message) ? `${message} Try again in ${formatWait(wait)}.` : message;
    }
    if (error.status === 422 && error.code === "validation_error" && error.message === "Request validation failed") {
      return fallback422;
    }
    return error.message || errorMessage(error);
  }
  if (error instanceof TypeError) return SERVICE_UNAVAILABLE;
  return errorMessage(error);
}

function sentence(text: string) {
  const trimmed = text.trim().replace(/^value error,\s*/i, "");
  if (!trimmed) return trimmed;
  const capped = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return /[.!?]$/.test(capped) ? capped : `${capped}.`;
}

/** Map FastAPI/pydantic validation details (`[{ loc, msg }]`) onto known form fields. */
export function apiFieldErrors<F extends string>(error: unknown, fields: readonly F[]): Partial<Record<F, string>> {
  const out: Partial<Record<F, string>> = {};
  if (!(error instanceof ApiError) || !Array.isArray(error.details)) return out;
  for (const detail of error.details) {
    if (!detail || typeof detail !== "object") continue;
    const { loc, msg } = detail as { loc?: unknown; msg?: unknown };
    if (!Array.isArray(loc) || typeof msg !== "string") continue;
    const field = [...loc].reverse().find((part): part is F => typeof part === "string" && fields.includes(part as F));
    if (field && !out[field]) out[field] = sentence(msg);
  }
  return out;
}
