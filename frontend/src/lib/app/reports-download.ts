/**
 * Report download with integrity check.
 *
 * Uses apiRaw (CSRF / refresh handled), keeps the object URL alive until the browser has taken
 * the file (revoking it right after click() can leave an empty download), and compares the
 * file's SHA-256, computed in the browser, with the X-Content-SHA256 header from the API.
 *
 * Download managers that integrate with the browser can take the response over: the page then
 * receives an empty 204 while the manager saves the file itself. That case is reported as
 * "handed over" and no second download is started, so the file is never saved empty or twice.
 */
import { ApiError, apiRaw } from "@/lib/api";

export type DownloadResult = {
  filename: string;
  bytes: number;
  sha256: string | null;
  verified: boolean | null;
  /** A browser download manager took the file over; nothing was saved by the page. */
  handedOver?: boolean;
};

async function sha256Hex(buffer: ArrayBuffer): Promise<string | null> {
  try {
    if (!globalThis.crypto?.subtle) return null;
    const digest = await crypto.subtle.digest("SHA-256", buffer);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return null;
  }
}

function filenameFrom(disposition: string, fallback: string): string {
  const star = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(disposition);
  if (star) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ""));
    } catch {
      /* fall through */
    }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(disposition);
  return plain ? plain[1].trim() : fallback;
}

export async function downloadReport(path: string, fallbackName: string): Promise<DownloadResult> {
  const res = await apiRaw(path);
  if (res.status === 204) return { filename: fallbackName, bytes: 0, sha256: null, verified: null, handedOver: true };
  if (!res.ok) {
    let message = res.statusText || "Download failed";
    let code = `http_${res.status}`;
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } };
      message = body.error?.message ?? message;
      code = body.error?.code ?? code;
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, code, message);
  }
  const buffer = await res.arrayBuffer();
  const filename = filenameFrom(res.headers.get("content-disposition") ?? "", fallbackName);
  if (buffer.byteLength === 0) return { filename, bytes: 0, sha256: null, verified: null, handedOver: true };
  const expected = (res.headers.get("x-content-sha256") ?? "").trim().toLowerCase() || null;
  const actual = await sha256Hex(buffer);
  const blob = new Blob([buffer], { type: res.headers.get("content-type") ?? "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return {
    filename,
    bytes: buffer.byteLength,
    sha256: actual,
    verified: expected && actual ? expected === actual : null,
  };
}
