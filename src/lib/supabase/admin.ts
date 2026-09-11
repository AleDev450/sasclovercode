import "server-only";

/**
 * The ONLY use of the Supabase secret key in the application.
 *
 * The secret key bypasses Row Level Security, so this module deliberately does
 * NOT export a client. It exports two operations on `auth.users` - create a
 * confirmed account, and undo that creation - and nothing else. Every caller is
 * a platform Server Action that has already run `requirePlatformAdmin()`.
 *
 * A test (security-posture, "the secret key is confined") fails if the key's
 * name appears in any other application file.
 */

import { createClient } from "@supabase/supabase-js";
import { getServerEnv } from "@/config/env";
import { ConfigurationError } from "@/lib/errors";
import { logger } from "@/lib/logger";

/** A fresh client per call, with no session storage: nothing to leak or reuse. */
function adminAuth() {
  const env = getServerEnv();
  if (env.SUPABASE_SECRET_KEY === undefined) {
    throw new ConfigurationError("SUPABASE_SECRET_KEY is not configured.");
  }

  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }).auth.admin;
}

/** Whether accounts can be created from the platform at all. */
export function isAccountCreationEnabled(): boolean {
  return getServerEnv().SUPABASE_SECRET_KEY !== undefined;
}

export type CreateUserResult =
  | { readonly ok: true; readonly userId: string }
  | { readonly ok: false; readonly reason: "exists" | "failed" };

/**
 * Creates an account that can sign in immediately, with no confirmation email.
 * The `profiles` row is created by the `on_auth_user_created` trigger.
 */
export async function createConfirmedUser(
  email: string,
  password: string,
): Promise<CreateUserResult> {
  const { data, error } = await adminAuth().createUser({
    email,
    password,
    email_confirm: true,
  });

  if (error !== null || data.user === null) {
    const exists = error?.code === "email_exists" || error?.code === "user_already_exists";
    logger.warn("platform.owner_account.create_failed", {
      email,
      code: error?.code ?? null,
      reason: error?.message ?? "no_user_returned",
    });
    return { ok: false, reason: exists ? "exists" : "failed" };
  }

  logger.info("platform.owner_account.created", { userId: data.user.id });
  return { ok: true, userId: data.user.id };
}

/**
 * Undoes `createConfirmedUser` when the step after it failed. Never throws: the
 * caller is already handling a failure and must report THAT one.
 */
export async function deleteUser(userId: string): Promise<void> {
  const { error } = await adminAuth().deleteUser(userId);
  if (error !== null) {
    logger.error("platform.owner_account.rollback_failed", { userId, reason: error.message });
  } else {
    logger.info("platform.owner_account.rolled_back", { userId });
  }
}
