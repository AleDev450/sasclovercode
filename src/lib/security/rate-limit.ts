import "server-only";

/**
 * Application rate limiting.
 *
 * CLOVERCODE_MASTER.md section 33 (Phase 25) lists "rate limits" among the areas
 * to review. Phase 02 reviewed it and found none, recording KL-203 - "a limiter
 * needs shared state" - with this phase as its owner.
 *
 * The state lives in PostgreSQL, not in this process. The deployment target is
 * serverless: an in-memory counter is per instance, so it allows N x limit
 * attempts with N instances and does not know it (ADR-029 decision 3).
 *
 * NOTHING HERE THROWS, and nothing here denies on failure. See `fail open`
 * below - it is the deliberate and uncomfortable decision of this module.
 */

import { logger } from "@/lib/logger";
import { getRequestContext } from "@/lib/observability/request-context";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * The buckets, with their limits.
 *
 * Named constants rather than numbers at the call site: a limit that lives in
 * the call is a limit nobody can review in one place, which is the whole reason
 * master asks for these to be auditable.
 *
 * Every one of them counts the CALLER, not the account being addressed.
 * Counting by email would be more precise against an attacker and would let
 * anybody lock out anybody else's account by sending attempts with their
 * address - a limiter that becomes a denial-of-service tool against one named
 * user is worse than none (ADR-029 decision 3).
 */
export const RATE_LIMITS = {
  /** Sign-in. Generous enough for somebody who genuinely forgot which password. */
  AUTH_SIGN_IN: { bucket: "auth.sign_in", limit: 10, windowSeconds: 300 },
  /** Password reset. Each one sends an email to somebody who did not ask. */
  AUTH_PASSWORD_RESET: { bucket: "auth.password_reset", limit: 5, windowSeconds: 900 },
} as const satisfies Record<string, RateLimitRule>;

/*
 * There is no `auth.sign_up` bucket, deliberately: this application has no
 * sign-up action. An account is created by a platform operator (Phase 04), so a
 * limit for a surface that does not exist would be exactly the future
 * functionality master section 51 forbids building ahead of its phase. Adding
 * one when self-service registration arrives is a single line here, because
 * `consumeRateLimit` is already generic.
 */

export interface RateLimitRule {
  readonly bucket: string;
  readonly limit: number;
  readonly windowSeconds: number;
}

/**
 * What a caller is identified by when it has no session.
 *
 * A request with no address at all - an internal call, a test - gets a shared
 * fallback rather than being waved through: "we could not tell who this is" is
 * not a reason to stop counting.
 */
const UNKNOWN_SUBJECT = "unknown-origin";

/**
 * Consumes one attempt. `true` means go ahead.
 *
 * FAIL OPEN. If the check itself fails - the table is unreachable, the function
 * is missing, the network blinked - this returns `true` and the request
 * proceeds.
 *
 * This is the uncomfortable decision, so here is the reasoning in full. This is
 * a SECOND line: Supabase Auth ships its own limiter (`[auth.rate_limit]` in
 * `supabase/config.toml`) and it does not disappear when this one fails. A
 * limiter that failed CLOSED would turn any problem with its own auxiliary
 * table into "nobody can sign in" - strictly worse than the state this project
 * lived in for twenty-four phases. Failing open returns us to that state.
 *
 * It is the opposite posture to `has_module()` (ADR-025), which fails closed,
 * and the difference is the one that matters: there, failing open gives away
 * paid functionality; here, failing closed locks out everybody.
 */
export async function consumeRateLimit(rule: RateLimitRule, subject: string): Promise<boolean> {
  try {
    const client = await createSupabaseServerClient();

    const { data, error } = await client.rpc("consume_rate_limit", {
      p_bucket: rule.bucket,
      p_subject: subject,
      p_limit: rule.limit,
      p_window_seconds: rule.windowSeconds,
    });

    if (error) {
      logger.error("security.rate_limit_unavailable", { bucket: rule.bucket, error });
      return true;
    }

    const allowed = data !== false;

    if (!allowed) {
      // The bucket, never the subject. Logging the identifier would rebuild in
      // the log the address the database went out of its way not to store.
      logger.warn("security.rate_limited", { bucket: rule.bucket, limit: rule.limit });
    }

    return allowed;
  } catch (error) {
    logger.error("security.rate_limit_unavailable", { bucket: rule.bucket, error });
    return true;
  }
}

/**
 * Consumes one attempt against the caller's own address.
 *
 * What every unauthenticated action uses. The address comes from the same
 * forwarded-header path Phase 24 built for the audit triggers, so there is one
 * definition of "who is calling" rather than two that can disagree.
 */
export async function consumeRateLimitForCaller(rule: RateLimitRule): Promise<boolean> {
  const { ip } = await getRequestContext();
  return consumeRateLimit(rule, ip ?? UNKNOWN_SUBJECT);
}

/**
 * What a throttled caller is told.
 *
 * The SAME message whether the account exists or not - the same reason the
 * sign-in form already gives one error for both. A distinct message here would
 * hand back the enumeration that the rest of the auth surface refuses to give.
 */
export const RATE_LIMITED_MESSAGE = "Demasiados intentos. Espera un momento y vuelve a probar.";
