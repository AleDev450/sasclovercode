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

/**
 * Paths that need no session at all - not even a refresh.
 *
 * A strict subset of the public ones, and the distinction is the point (Phase
 * 25, ADR-029 decision 2). `/login` is public AND must redirect somebody who is
 * already signed in, so the proxy has to ask Supabase Auth who they are.
 * `/sitio` is the tenant's public website: it uses no session, shows the same
 * page to everybody, and has no reason to consult the auth service.
 *
 * WHY THIS EXISTS. Until Phase 25 the proxy simply excluded `/sitio` from its
 * matcher, with a good reason: an auth round trip per page view would couple
 * every restaurant's menu to the availability of the login service. That was
 * right about the AUTH CALL and too broad about the proxy - because from Phase
 * 25 the proxy is also what emits the Content-Security-Policy, and `/sitio` is
 * the ONE surface that renders content written by a third party (the CMS), so
 * it is the one place a CSP has a real attack to stop.
 *
 * Splitting the question in two keeps both properties: the menu still never
 * touches Supabase Auth, and it now ships with its policy.
 */
const SESSION_FREE_PREFIXES = ["/sitio"] as const;

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

/**
 * True when the proxy may serve this path without asking who the caller is.
 *
 * Every such path must also be public: a path that needs no session but does
 * need protection would be a contradiction, and reading this the other way
 * round would be a way to skip authentication by accident.
 */
export function isSessionFreePath(pathname: string): boolean {
  return matchesPrefix(pathname, SESSION_FREE_PREFIXES) && isPublicPath(pathname);
}

/** True when reaching this path requires a verified session. */
export function requiresAuthentication(pathname: string): boolean {
  return !isPublicPath(pathname);
}

export { SIGN_IN_PATH };
