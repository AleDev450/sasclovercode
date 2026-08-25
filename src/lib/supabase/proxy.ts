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

export function createSupabaseProxyClient(request: NextRequest): ProxySupabase {
  const env = getPublicEnv();

  let response = NextResponse.next({ request });

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
          response = NextResponse.next({ request });

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
