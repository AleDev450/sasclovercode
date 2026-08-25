import "server-only";

/**
 * Supabase client for server-side code (Server Components, Route Handlers,
 * Server Actions).
 *
 * `import "server-only"` makes it a build error to pull this module into a
 * client bundle (CLOVERCODE_MASTER.md section 9).
 *
 * A NEW client is created per request. Supabase clients must never be hoisted
 * to module scope: a shared client would leak one visitor's session into
 * another visitor's request, which in a multi-tenant system means leaking one
 * tenant's data to another.
 */

import { createServerClient, type CookieMethodsServer } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getPublicEnv } from "@/config/env";
import type { Database } from "@/types/database";
import type { CloverCodeSupabaseClient } from "./types";

/**
 * Builds the cookie adapter over Next.js request cookies.
 *
 * `getAll` / `setAll` is the current contract; the `get` / `set` / `remove`
 * trio is deprecated by `@supabase/ssr` and misses edge cases that cause
 * random logouts.
 */
export async function createNextCookieAdapter(): Promise<CookieMethodsServer> {
  const cookieStore = await cookies();

  return {
    getAll() {
      return cookieStore.getAll().map(({ name, value }) => ({ name, value }));
    },
    setAll(cookiesToSet) {
      try {
        for (const { name, value, options } of cookiesToSet) {
          cookieStore.set(name, value, options);
        }
      } catch {
        // Server Components cannot mutate the response, so `set` throws there.
        // Swallowing is the documented behaviour: session refresh is the
        // middleware's job (Phase 02). Without that middleware, a refreshed
        // token is simply not persisted - it is never a security failure.
      }
    },
  };
}

/**
 * Returns a request-scoped Supabase client.
 *
 * @param cookieMethods Optional adapter override. Used by tests and, from
 *   Phase 02, by the middleware, which must write refreshed cookies onto its
 *   own response object.
 */
export async function createSupabaseServerClient(
  cookieMethods?: CookieMethodsServer,
): Promise<CloverCodeSupabaseClient> {
  const env = getPublicEnv();
  const cookieAdapter = cookieMethods ?? (await createNextCookieAdapter());

  return createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    { cookies: cookieAdapter },
  );
}
