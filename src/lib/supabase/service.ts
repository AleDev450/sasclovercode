import "server-only";

/**
 * A database client that acts as `service_role`.
 *
 * WHY IT EXISTS (ADR-034). Two things in the product cannot be done under any
 * request's identity, by design: reading a tenant's payment gateway SECRET, and
 * recording a payment a provider confirmed. Both functions are executable by
 * `service_role` alone, so no signed-in user - not a tenant owner, not a
 * platform operator, not a stolen session - can call them from a browser.
 *
 * WHAT IT MUST NEVER BECOME. A general "skip RLS" client. It is imported by
 * `modules/online-payments/server` and nothing else, and every call through it
 * is a `.rpc()` to one of those two functions - never a table read or write.
 * `src/tests/unit/security-posture.test.ts` checks the import graph.
 */

import { createClient } from "@supabase/supabase-js";
import { getServerEnv } from "@/config/env";
import { ConfigurationError } from "@/lib/errors";
import type { Database } from "@/types/database";
import type { CloverCodeSupabaseClient } from "./types";

export function isServiceRoleConfigured(): boolean {
  return getServerEnv().SUPABASE_SECRET_KEY !== undefined;
}

export function createServiceRoleClient(): CloverCodeSupabaseClient {
  const env = getServerEnv();
  if (env.SUPABASE_SECRET_KEY === undefined) {
    throw new ConfigurationError("SUPABASE_SECRET_KEY is not configured.");
  }

  return createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
