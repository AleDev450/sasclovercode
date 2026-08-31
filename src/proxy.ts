/**
 * Next.js proxy — security headers, session refresh and route protection.
 *
 * Named `proxy.ts`, not `middleware.ts`: Next.js 16 renamed the convention and
 * the exported function must be called `proxy`. Verified against the installed
 * Next.js 16.3.2, whose build output reports `ƒ Proxy (Middleware)` when this
 * file is present. The proxy always runs on the Node.js runtime; a route
 * segment config here is a build error.
 *
 * Three jobs, in this order:
 *
 * 0. Emit the Content-Security-Policy with a fresh nonce (Phase 25). This runs
 *    for EVERY matched request, including the ones that need no session, and it
 *    is the reason the matcher changed - see the note on `/sitio` below.
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
import {
  isAnonymousOnlyPath,
  isSessionFreePath,
  requiresAuthentication,
} from "@/lib/auth/route-access";
import {
  DEFAULT_SIGNED_IN_PATH,
  safeRedirectPath,
  signInPathWithReturnTo,
} from "@/lib/auth/redirect";
import { logger } from "@/lib/logger";
import { buildContentSecurityPolicy, generateNonce, NONCE_HEADER } from "@/lib/security/csp";
import { createSupabaseProxyClient } from "@/lib/supabase/proxy";

/**
 * Puts the policy on a response.
 *
 * Applied to every response this function can return, redirects included: a
 * redirect that lost its CSP would be a hole exactly where an attacker would
 * look for one.
 */
function withCsp(response: NextResponse, policy: string): NextResponse {
  response.headers.set("Content-Security-Policy", policy);
  return response;
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname, search, searchParams } = request.nextUrl;

  // A fresh, unguessable value per request. Next.js reads it back out of the
  // CSP header during rendering and attaches it to every script it emits, so
  // nothing below has to thread it through by hand.
  const nonce = generateNonce();
  const policy = buildContentSecurityPolicy(nonce, process.env.NODE_ENV === "development");

  // Forwarded on the REQUEST too, so a Server Component that ever needs to mark
  // a script of its own can read it (`headers().get("x-nonce")`).
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(NONCE_HEADER, nonce);
  requestHeaders.set("Content-Security-Policy", policy);

  /*
   * The tenant public website: headers, and nothing else.
   *
   * Until Phase 25 this path was excluded from the matcher entirely, with a
   * good reason - an auth round trip per page view would couple every
   * restaurant's menu to the availability of the login service.
   *
   * That reasoning was right about the AUTH CALL and too broad about the proxy.
   * From this phase the proxy is also what emits the CSP, and `/sitio` is the
   * ONE surface in the product that renders content written by a third party
   * (the CMS of Phase 07) - which makes it the one place a CSP has a real
   * attack to stop. Leaving it out meant protecting the admin panel and not the
   * shop.
   *
   * So the question is split in two: does this path need a SESSION (no), and
   * does it need HEADERS (always). Returning here keeps the original property
   * completely intact - the menu still never touches Supabase Auth - while the
   * policy now reaches it (ADR-029 decision 2).
   */
  if (isSessionFreePath(pathname)) {
    return withCsp(NextResponse.next({ request: { headers: requestHeaders } }), policy);
  }

  const { supabase, getResponse } = createSupabaseProxyClient(request, requestHeaders);

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
    return withCsp(redirectResponse, policy);
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
    return withCsp(redirectResponse, policy);
  }

  // IMPORTANT: return the response the cookie writer mutated, unmodified.
  // Constructing a new one here would drop the refreshed session.
  return withCsp(getResponse(), policy);
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and the liveness probe.
     *
     * Excluding static assets is not only about cost: a request that ran this
     * proxy would perform a `getUser()` round trip per file, and any refreshed
     * cookie it wrote could be cached by the CDN alongside the asset. They also
     * need no CSP: a CSP governs what a DOCUMENT may load, and none of these is
     * a document.
     *
     * `/api/health` is excluded, and Phase 25 deliberately left it excluded
     * rather than folding it in with `/sitio`. It is a LIVENESS probe returning
     * JSON, so there is nothing for a CSP to protect - and keeping the probe on
     * a path that shares no code with anything else is itself a property worth
     * having. Phase 24's dependency checks live inside the route, not here.
     *
     * `/sitio` USED to be excluded and no longer is. Its exclusion existed to
     * keep a Supabase Auth round trip off the highest-traffic surface of the
     * product; that is now handled inside the function, which returns before
     * touching Auth for it. The exclusion additionally cost `/sitio` its
     * security headers, and it is the one surface that renders third-party
     * content - see the note above the early return (ADR-029 decision 2).
     */
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|api/health|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|avif|woff|woff2|ttf)$).*)",
  ],
};
