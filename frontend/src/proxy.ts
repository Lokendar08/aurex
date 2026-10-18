import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Optimistic route guard only. It checks for the presence of the non-secret `aurex_session` hint
 * cookie so signed-out visitors are redirected before the app shell loads. Real authentication and
 * authorization are enforced by the FastAPI backend on every API call.
 */
export function proxy(request: NextRequest) {
  const hasSession = request.cookies.has("aurex_session");
  const { pathname, search } = request.nextUrl;

  if (pathname.startsWith("/app") && !hasSession) {
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/app/:path*"],
};
