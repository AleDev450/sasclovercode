/**
 * Which paths require a session, and which are reserved for anonymous callers.
 *
 * Pure and side-effect free so the rules can be asserted directly, without a
 * request, a database or a running Next.js. The proxy is the one place that
 * enforces them.
 *
 * The default is CLOSED: a path is public only if it appears below. A new route
 * added by a later phase is therefore protected until somebody deliberately
 * opens it, which is the only default that fails safe.
 */

import { SIGN_IN_PATH } from "./redirect";

/**
 * Paths reachable without a session.
 *
 * A prefix match: `/login` also covers `/login/anything`. Every entry must be a
 * path that genuinely has to work before sign-in.
 */
const PUBLIC_PREFIXES = [
  "/login",
  "/forgot-password",
  // The reset form is opened from an email link, by definition before signing
  // in. The link's token is what authorises the change, not a session.
  "/reset-password",
  // Verifies the token in an email link and then redirects.
  "/auth",
  // Liveness probe. Returns no tenant or user data.
  "/api/health",
  // The tenant public website. Anonymous by definition: this is the site a
  // customer visits, and requiring a session would defeat its purpose.
  "/sitio",
] as const;

/**
 * Paths an ALREADY signed-in user should not sit on.
 *
 * Showing a sign-in form to somebody who is signed in is a dead end that
 * invites them to authenticate twice. `/reset-password` is deliberately absent:
 * changing your password while signed in is legitimate.
 */
const ANONYMOUS_ONLY_PREFIXES = ["/login", "/forgot-password"] as const;

/** The public landing page. Exact match only, so `/anything` stays protected. */
const PUBLIC_EXACT_PATHS = new Set<string>(["/"]);

function matchesPrefix(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/** True when the path may be served without a session. */
export function isPublicPath(pathname: string): boolean {
  if (PUBLIC_EXACT_PATHS.has(pathname)) return true;
  return matchesPrefix(pathname, PUBLIC_PREFIXES);
}

/** True when a signed-in user should be moved off this path. */
export function isAnonymousOnlyPath(pathname: string): boolean {
  return matchesPrefix(pathname, ANONYMOUS_ONLY_PREFIXES);
}

/** True when reaching this path requires a verified session. */
export function requiresAuthentication(pathname: string): boolean {
  return !isPublicPath(pathname);
}

export { SIGN_IN_PATH };
