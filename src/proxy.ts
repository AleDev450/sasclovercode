/**
 * Next.js proxy — session refresh and route protection.
 *
 * Named `proxy.ts`, not `middleware.ts`: Next.js 16 renamed the convention and
 * the exported function must be called `proxy`. Verified against the installed
 * Next.js 16.3.2, whose build output reports `ƒ Proxy (Middleware)` when this
 * file is present. The proxy always runs on the Node.js runtime; a route
 * segment config here is a build error.
 *
 * Two jobs, in this order:
 *
 * 1. Refresh the Supabase session. Access tokens are short-lived, and a Server
 *    Component cannot write the refreshed cookie back. If this does not happen
 *    here it does not happen at all, and users are signed out mid-session.
 *
 * 2. Decide whether the request may proceed. This is defence in depth, not the
 *    only check: Server Actions and Route Handlers are reachable without ever
 *    matching a page path, so each of those verifies the session itself through
 *    `requireUser()`.
 */

import { NextResponse, type NextRequest } from "next/server";
import { isAnonymousOnlyPath, requiresAuthentication } from "@/lib/auth/route-access";
import {
  DEFAULT_SIGNED_IN_PATH,
  safeRedirectPath,
  signInPathWithReturnTo,
} from "@/lib/auth/redirect";
import { logger } from "@/lib/logger";
import { createSupabaseProxyClient } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { supabase, getResponse } = createSupabaseProxyClient(request);
  const { pathname, search, searchParams } = request.nextUrl;

  // IMPORTANT: nothing may run between creating the client and this call.
  // `getUser()` is what triggers the refresh, and any earlier response would
  // be committed without the refreshed cookies.
  //
  // `getUser()` and not `getSession()`: the latter reads the cookie without
  // verifying it, and the cookie comes from the client.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isAuthenticated = user !== null;

  if (!isAuthenticated && requiresAuthentication(pathname)) {
    logger.debug("auth.proxy.redirect_to_sign_in", { pathname });

    const url = request.nextUrl.clone();
    const target = new URL(signInPathWithReturnTo(pathname, search), request.url);
    url.pathname = target.pathname;
    url.search = target.search;

    // `redirect` does not inherit the refreshed cookies automatically; copying
    // them over keeps the refresh that just happened from being thrown away.
    const redirectResponse = NextResponse.redirect(url);
    for (const cookie of getResponse().cookies.getAll()) {
      redirectResponse.cookies.set(cookie);
    }
    return redirectResponse;
  }

  if (isAuthenticated && isAnonymousOnlyPath(pathname)) {
    const url = request.nextUrl.clone();
    // Honour `?next=` so a link that led here still lands where it intended,
    // but only after `safeRedirectPath` has confirmed it is a local path.
    url.pathname = safeRedirectPath(searchParams.get("next"), DEFAULT_SIGNED_IN_PATH);
    url.search = "";

    const redirectResponse = NextResponse.redirect(url);
    for (const cookie of getResponse().cookies.getAll()) {
      redirectResponse.cookies.set(cookie);
    }
    return redirectResponse;
  }

  // IMPORTANT: return the response the cookie writer mutated, unmodified.
  // Constructing a new one here would drop the refreshed session.
  return getResponse();
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and the liveness probe.
     *
     * Excluding static assets is not only about cost: a request that ran this
     * proxy would perform a `getUser()` round trip per file, and any refreshed
     * cookie it wrote could be cached by the CDN alongside the asset.
     *
     * `/api/health` is excluded for a different and more important reason. It
     * is a LIVENESS probe: it reports that this process is up, and it
     * deliberately checks no dependency. Running it through this proxy would
     * make every probe call Supabase Auth, so an auth outage would report the
     * application as down when it is serving perfectly well. Dependency health
     * is a separate signal, and it belongs to Phase 24.
     */
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|api/health|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|avif|woff|woff2|ttf)$).*)",
  ],
};
