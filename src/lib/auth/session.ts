import "server-only";

/**
 * The single session accessor for server code.
 *
 * Master section 43 asks for one abstraction per cross-cutting concern; this is
 * the one for "who is making this request".
 *
 * The critical rule of this file, from the Supabase SSR guidance: server code
 * uses `getUser()`, never `getSession()`. `getSession()` returns whatever the
 * cookie says without contacting the auth server, and a cookie is supplied by
 * the client. Trusting it would let anyone hand us a forged session. `getUser()`
 * revalidates the token with Supabase Auth on every call.
 */

import { cache } from "react";
import { AuthenticationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { CloverCodeSupabaseClient } from "@/lib/supabase/types";
import type { AuthenticatedUser } from "./types";

export interface SessionOptions {
  /** Injected by tests; production always builds a request-scoped client. */
  readonly client?: CloverCodeSupabaseClient;
}

/**
 * Returns the signed-in user, or `null`.
 *
 * `null` is an ordinary outcome - most public traffic is anonymous - so it is
 * not an error and is not logged as one.
 *
 * Wrapped in React `cache()`: several components in one render share a single
 * verification round trip. The cache is per request, so it can never serve one
 * visitor's identity to another.
 */
export const getCurrentUser = cache(async (): Promise<AuthenticatedUser | null> => {
  return loadCurrentUser();
});

/** Uncached form. `getCurrentUser()` is what application code should call. */
export async function loadCurrentUser(
  options: SessionOptions = {},
): Promise<AuthenticatedUser | null> {
  const client = options.client ?? (await createSupabaseServerClient());

  const {
    data: { user },
    error,
  } = await client.auth.getUser();

  if (error !== null) {
    // An expired or absent session reports an error here. That is the normal
    // anonymous case, not a fault, so it stays at debug level: logging it as an
    // error would bury real failures under anonymous traffic.
    logger.debug("auth.session.absent", { reason: error.message });
    return null;
  }

  if (user === null) return null;

  // The profile carries the business-facing fields. `user_metadata` is not used
  // for anything that matters: master section 9 forbids trusting it, because a
  // signed-in user can write to it themselves.
  const { data: profile, error: profileError } = await client
    .from("profiles")
    .select("email, full_name, avatar_url")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError !== null) {
    logger.error("auth.profile.read_failed", { userId: user.id, error: profileError });
  }

  return {
    id: user.id,
    // `user.email` is the authoritative address; the profile mirrors it. Fall
    // back to the mirror only if Auth omitted it.
    email: user.email ?? profile?.email ?? "",
    fullName: profile?.full_name ?? null,
    avatarUrl: profile?.avatar_url ?? null,
  };
}

/**
 * Same as `getCurrentUser()` but throws when nobody is signed in.
 *
 * For server code that is meaningless without a user. Route protection happens
 * earlier, in `src/proxy.ts`; this is the second line of defence for anything
 * the proxy's matcher does not cover, and for Server Actions, which a client
 * can invoke directly.
 */
export async function requireUser(): Promise<AuthenticatedUser> {
  const user = await getCurrentUser();
  if (user === null) {
    throw new AuthenticationError("No authenticated user for this request.");
  }
  return user;
}
