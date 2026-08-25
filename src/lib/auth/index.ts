/**
 * Public surface of the auth layer.
 *
 * `session.ts` and `membership.ts` are server-only and are NOT re-exported: a
 * barrel that pulled them in would drag `server-only` into every client bundle
 * that just wanted a schema. Import them explicitly:
 *
 *   import { getCurrentUser, requireUser } from "@/lib/auth/session";
 *   import { requireMembership } from "@/lib/auth/membership";
 */
export {
  emailSchema,
  newPasswordSchema,
  requestPasswordResetSchema,
  signInSchema,
  updatePasswordSchema,
} from "./schemas";
export type { RequestPasswordResetInput, SignInInput, UpdatePasswordInput } from "./schemas";
export {
  DEFAULT_SIGNED_IN_PATH,
  SIGN_IN_PATH,
  safeRedirectPath,
  signInPathWithReturnTo,
} from "./redirect";
export { isActiveMembership } from "./types";
export type { AuthenticatedUser, Membership, MembershipStatus, TenantRole } from "./types";
