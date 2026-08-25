"use client";

/**
 * Supabase client for the browser.
 *
 * Only `NEXT_PUBLIC_*` values are used here. Those are safe to ship to the
 * browser by design: in Supabase, access control comes from Row Level Security,
 * not from key secrecy. The `service_role` / secret key must NEVER appear in
 * this file or in anything it imports (CLOVERCODE_MASTER.md section 9).
 */

import { createBrowserClient } from "@supabase/ssr";
import { getPublicEnv } from "@/config/env";
import type { Database } from "@/types/database";
import type { CloverCodeSupabaseClient } from "./types";

/**
 * Returns the browser Supabase client.
 *
 * `createBrowserClient` is a singleton per set of arguments, so calling this
 * from several components does not open several clients.
 */
export function createSupabaseBrowserClient(): CloverCodeSupabaseClient {
  const env = getPublicEnv();

  return createBrowserClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}
