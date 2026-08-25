/**
 * Turns an email link into a session.
 *
 * Supabase sends password-recovery, confirmation and invitation links here.
 * Which parameters arrive depends on the project's email template, and BOTH
 * forms are handled because both are reachable with the same configuration:
 *
 *   ?code=...                    PKCE. `createServerClient` from @supabase/ssr
 *                                hard-codes `flowType: "pkce"` after spreading
 *                                the caller's options, so it cannot be turned
 *                                off. This is what the DEFAULT template
 *                                produces, via `{{ .ConfirmationURL }}`.
 *
 *   ?token_hash=...&type=...     A template customised to use `{{ .TokenHash }}`.
 *
 * Supporting only one of them would work until somebody edited an email
 * template, and would then fail with a link that looks entirely valid.
 *
 * A Route Handler and not a page, because a page cannot set cookies, and
 * establishing the session is the whole point.
 */

import { type EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { DEFAULT_SIGNED_IN_PATH, safeRedirectPath } from "@/lib/auth/redirect";
import { logger } from "@/lib/logger";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * The link types this endpoint accepts.
 *
 * An allow list, not a cast. `type` comes from the URL, and handing an
 * unchecked value to `verifyOtp` would let a caller choose which verification
 * flow runs.
 */
const ALLOWED_OTP_TYPES = new Set<EmailOtpType>([
  "recovery",
  "email",
  "invite",
  "magiclink",
  "email_change",
]);

function isAllowedOtpType(value: string | null): value is EmailOtpType {
  return value !== null && ALLOWED_OTP_TYPES.has(value as EmailOtpType);
}

/**
 * Shown for every failure.
 *
 * Expired, already used, and forged are indistinguishable to the caller: a
 * distinct message per cause would let someone probe which links are real.
 */
const FAILURE_PATH = "/login?error=invalid_link";

export async function GET(request: NextRequest): Promise<Response> {
  const { searchParams } = request.nextUrl;

  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");

  // Attacker-controlled, so it is filtered before it can become a `Location`.
  const next = safeRedirectPath(searchParams.get("next"), DEFAULT_SIGNED_IN_PATH);

  const supabase = await createSupabaseServerClient();

  if (code !== null) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (error !== null) {
      logger.warn("auth.confirm.code_exchange_failed", { reason: error.message });
      redirect(FAILURE_PATH);
    }

    logger.info("auth.confirm.succeeded", { flow: "pkce" });
    redirect(next);
  }

  if (tokenHash !== null && isAllowedOtpType(type)) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });

    if (error !== null) {
      logger.warn("auth.confirm.verification_failed", { type, reason: error.message });
      redirect(FAILURE_PATH);
    }

    logger.info("auth.confirm.succeeded", { flow: "token_hash", type });
    redirect(next);
  }

  logger.warn("auth.confirm.malformed_link", {
    hasCode: code !== null,
    hasTokenHash: tokenHash !== null,
    type,
  });
  redirect(FAILURE_PATH);
}
