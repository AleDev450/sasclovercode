"use server";

/**
 * Server Actions for authentication.
 *
 * Every one of these runs on the server and is reachable directly by a client,
 * so each validates its own input rather than relying on the form having done
 * it (master section 9: never trust the frontend).
 *
 * The recurring theme below is USER ENUMERATION. An honest error message such
 * as "no account with that email" turns the sign-in and password-reset forms
 * into a tool for discovering which addresses have accounts on the platform.
 * Every response here is deliberately identical whether or not the account
 * exists.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getPublicEnv } from "@/config/env";
import { requestPasswordResetSchema, signInSchema, updatePasswordSchema } from "@/lib/auth/schemas";
import { DEFAULT_SIGNED_IN_PATH, SIGN_IN_PATH, safeRedirectPath } from "@/lib/auth/redirect";
import { logger } from "@/lib/logger";
import {
  consumeRateLimitForCaller,
  RATE_LIMITED_MESSAGE,
  RATE_LIMITS,
} from "@/lib/security/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { toFieldErrors } from "@/lib/validation";
import type { AuthFormState } from "./form-state";

/**
 * Single generic failure for sign-in.
 *
 * Used for a wrong password, an unknown address and an unconfirmed account
 * alike. The three cases must be indistinguishable from outside.
 */
const SIGN_IN_FAILED_MESSAGE = "Correo o contrasena incorrectos.";

/**
 * Single generic answer for a reset request.
 *
 * Returned when the address exists, when it does not, when Supabase failed, and
 * when the rate limit refused. One constant so the four paths cannot drift.
 */
const PASSWORD_RESET_SENT_MESSAGE =
  "Si existe una cuenta con ese correo, recibiras un enlace para restablecer tu contrasena.";

function readString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

// ---------------------------------------------------------------------------
// Sign in
// ---------------------------------------------------------------------------

export async function signInAction(
  _previousState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = signInSchema.safeParse({
    email: readString(formData, "email"),
    password: readString(formData, "password"),
  });

  if (!parsed.success) {
    return { status: "error", fieldErrors: toFieldErrors(parsed.error) };
  }

  // AFTER validation and BEFORE Supabase (Phase 25, KL-203). After, so a
  // malformed form does not spend somebody's quota; before, so a flood never
  // reaches the auth service at all.
  //
  // Counted against the CALLER's address and not the email being tried: by
  // email would be more precise and would let anybody lock out anybody else's
  // account by sending attempts with their address (ADR-029 decision 3).
  if (!(await consumeRateLimitForCaller(RATE_LIMITS.AUTH_SIGN_IN))) {
    logger.warn("auth.sign_in.throttled", {});
    return { status: "error", message: RATE_LIMITED_MESSAGE };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error !== null || data.user === null) {
    // The address is logged for rate-limit and abuse analysis. The password is
    // never touched: it is not read into a variable here and the logger redacts
    // the key anyway (master section 9).
    logger.warn("auth.sign_in.failed", {
      email: parsed.data.email,
      reason: error?.message ?? "no_user_returned",
    });
    return { status: "error", message: SIGN_IN_FAILED_MESSAGE };
  }

  logger.info("auth.sign_in.succeeded", { userId: data.user.id });

  // Cached Server Component output was rendered for an anonymous visitor.
  revalidatePath("/", "layout");

  // `next` arrives from a query string, so it is attacker-controlled and is
  // filtered before it can become a `Location` header.
  redirect(safeRedirectPath(readString(formData, "next"), DEFAULT_SIGNED_IN_PATH));
}

// ---------------------------------------------------------------------------
// Sign out
// ---------------------------------------------------------------------------

export async function signOutAction(): Promise<never> {
  const supabase = await createSupabaseServerClient();

  const { error } = await supabase.auth.signOut();
  if (error !== null) {
    // Do NOT abort. The user asked to leave; the local cookies are cleared
    // regardless, and leaving them on a page that still looks signed in is a
    // worse outcome than a stale server-side session.
    logger.warn("auth.sign_out.failed", { reason: error.message });
  } else {
    logger.info("auth.sign_out.succeeded");
  }

  revalidatePath("/", "layout");
  redirect(SIGN_IN_PATH);
}

// ---------------------------------------------------------------------------
// Password reset
// ---------------------------------------------------------------------------

export async function requestPasswordResetAction(
  _previousState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = requestPasswordResetSchema.safeParse({
    email: readString(formData, "email"),
  });

  if (!parsed.success) {
    return { status: "error", fieldErrors: toFieldErrors(parsed.error) };
  }

  // Each accepted request sends an email to somebody who did not ask for it, so
  // the limit here protects a third party rather than this application.
  //
  // The throttled answer is the SAME success message the normal path returns,
  // not an error: telling a caller "you are being throttled" only after a real
  // address would hand back the enumeration this whole action is written to
  // refuse. Somebody genuinely resetting their password sees the reassuring
  // message and the email arrives once the window rolls over.
  if (!(await consumeRateLimitForCaller(RATE_LIMITS.AUTH_PASSWORD_RESET))) {
    logger.warn("auth.password_reset.throttled", {});
    return { status: "success", message: PASSWORD_RESET_SENT_MESSAGE };
  }

  const supabase = await createSupabaseServerClient();
  const { NEXT_PUBLIC_APP_URL } = getPublicEnv();

  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    // Supabase only honours a redirect URL that is on the project's allow list,
    // so this cannot be pointed at an attacker's host even if it were somehow
    // influenced from outside.
    redirectTo: new URL("/auth/confirm?next=/reset-password", NEXT_PUBLIC_APP_URL).toString(),
  });

  if (error !== null) {
    logger.warn("auth.password_reset.request_failed", {
      email: parsed.data.email,
      reason: error.message,
    });
  } else {
    logger.info("auth.password_reset.requested", { email: parsed.data.email });
  }

  // Identical response either way, INCLUDING when Supabase reported a failure
  // and including when the rate limit refused above. Anything else reveals
  // which addresses have accounts.
  return { status: "success", message: PASSWORD_RESET_SENT_MESSAGE };
}

export async function updatePasswordAction(
  _previousState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = updatePasswordSchema.safeParse({
    password: readString(formData, "password"),
    confirmPassword: readString(formData, "confirmPassword"),
  });

  if (!parsed.success) {
    return { status: "error", fieldErrors: toFieldErrors(parsed.error) };
  }

  const supabase = await createSupabaseServerClient();

  // The recovery link already established a session by the time this runs.
  // Without one there is nothing to update, and Supabase rejects the call - so
  // an expired link cannot be used to set somebody else's password.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user === null) {
    return {
      status: "error",
      message: "El enlace ha expirado o no es valido. Solicita uno nuevo.",
    };
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });

  if (error !== null) {
    logger.warn("auth.password_update.failed", { userId: user.id, reason: error.message });
    return {
      status: "error",
      // Supabase's own message is surfaced only in the log. It can name policy
      // details that are not useful to show verbatim.
      message: "No se pudo actualizar la contrasena. Revisa los requisitos e intentalo de nuevo.",
    };
  }

  logger.info("auth.password_update.succeeded", { userId: user.id });

  revalidatePath("/", "layout");
  redirect(DEFAULT_SIGNED_IN_PATH);
}
