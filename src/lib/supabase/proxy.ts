import "server-only";

/**
 * Supabase client for the Next.js proxy (formerly middleware).
 *
 * Separate from `server.ts` because the cookie plumbing is genuinely different:
 * a Server Component cannot write cookies, while the proxy both can and must -
 * it is the only place a refreshed session token can be persisted.
 *
 * Two details that the official @supabase/ssr guidance is emphatic about, and
 * that are easy to get wrong:
 *
 * 1. The response object handed back must be the SAME one the cookie writer
 *    mutated. Building a fresh `NextResponse` afterwards silently discards the
 *    refreshed `Set-Cookie` headers, and the user is logged out at random.
 *
 * 2. `setAll` receives a second argument, `headers`, carrying the no-store
 *    directives that must accompany a response which sets auth cookies. Without
 *    them a CDN or reverse proxy in front of the app can cache a response that
 *    contains one user's session and serve it to somebody else.
 */

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getPublicEnv } from "@/config/env";
import type { Database } from "@/types/database";
import type { CloverCodeSupabaseClient } from "./types";

export interface ProxySupabase {
  readonly supabase: CloverCodeSupabaseClient;
  /** Reads the response as it currently stands, including any written cookies. */
  readonly getResponse: () => NextResponse;
}

/**
 * @param requestHeaders Headers to forward to the render pass. Phase 25 uses it
 *   for `x-nonce` and the CSP: `setAll` below REBUILDS the response, so a header
 *   set on the original one would be silently dropped the moment a session is
 *   refreshed - which is the one request where losing the policy would matter
 *   most, since it is the one carrying a fresh token.
 */
export function createSupabaseProxyClient(
  request: NextRequest,
  requestHeaders?: Headers,
): ProxySupabase {
  const env = getPublicEnv();

  /**
   * Built fresh each time rather than captured once.
   *
   * `request.cookies.set()` writes through to `request.headers`, so re-deriving
   * here is what makes the refreshed cookie visible downstream. Capturing a
   * merged `Headers` up front would freeze the OLD cookie header into every
   * later rebuild - a stale session handed to the render pass, which is the
   * exact bug the whole cookie dance exists to avoid.
   */
  const nextInit = (): { request: NextRequest } | { request: { headers: Headers } } => {
    if (requestHeaders === undefined) return { request };

    const merged = new Headers(request.headers);
    for (const [name, value] of requestHeaders) {
      merged.set(name, value);
    }
    return { request: { headers: merged } };
  };

  let response = NextResponse.next(nextInit());

  const supabase = createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll().map(({ name, value }) => ({ name, value }));
        },
        setAll(cookiesToSet, headers) {
          // Write onto the REQUEST first, so anything downstream in this same
          // pass (a Server Component reading cookies) sees the refreshed value
          // rather than the stale one it arrived with.
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }

          // Rebuild from the mutated request so the new cookies are part of it.
          // `nextInit()` and not `{ request }`, so the forwarded headers survive
          // the rebuild.
          response = NextResponse.next(nextInit());

          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }

          // See note 2 above: these are the caching directives supplied by
          // @supabase/ssr for responses that carry auth cookies.
          for (const [name, value] of Object.entries(headers)) {
            response.headers.set(name, value);
          }
        },
      },
    },
  );

  return { supabase, getResponse: () => response };
}
