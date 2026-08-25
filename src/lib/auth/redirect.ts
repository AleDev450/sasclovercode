/**
 * Safe post-authentication redirects.
 *
 * Pure functions, no I/O. The `next` parameter travels through a query string,
 * so it is attacker-controlled: `/login?next=https://evil.example` turns a
 * trusted login page into an open redirect, which is how phishing links borrow
 * a real domain's credibility.
 *
 * The rule enforced here is narrow on purpose: a redirect target must be a path
 * on THIS origin. Not a URL, not a protocol-relative reference, not a path that
 * a browser will re-read as an authority.
 */

/** Where a signed-in user lands when no explicit target was requested. */
export const DEFAULT_SIGNED_IN_PATH = "/dashboard";

/** Where an unauthenticated visitor is sent. */
export const SIGN_IN_PATH = "/login";

/**
 * Returns `candidate` when it is a safe same-origin path, otherwise `fallback`.
 *
 * Rejected, with the reason each one matters:
 *
 *   `https://evil.com`   absolute URL - different origin
 *   `//evil.com`         protocol-relative - the browser reads it as a host
 *   `/\evil.com`         backslash - normalised to `//` by several browsers
 *   `javascript:...`     scheme that executes rather than navigates
 *   `dashboard`          relative path - resolves against the current URL
 */
export function safeRedirectPath(
  candidate: string | null | undefined,
  fallback: string = DEFAULT_SIGNED_IN_PATH,
): string {
  if (typeof candidate !== "string") return fallback;

  const value = candidate.trim();

  // Must be an absolute path on this origin.
  if (!value.startsWith("/")) return fallback;

  // `//host` and `/\host` are both read as an authority, not as a path.
  if (value.startsWith("//") || value.startsWith("/\\")) return fallback;

  // A control character can truncate the value inside a Location header.
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 0x1f || code === 0x7f) return fallback;
  }

  // Percent-encoding can hide any of the above from the checks up to here
  // (`/%2f%2fevil.com`). Decode once and re-apply the structural rules.
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    // Malformed encoding: not something to guess the intent of.
    return fallback;
  }

  if (!decoded.startsWith("/") || decoded.startsWith("//") || decoded.startsWith("/\\")) {
    return fallback;
  }

  return value;
}

/** Builds the sign-in URL that returns the visitor to where they were going. */
export function signInPathWithReturnTo(pathname: string, search = ""): string {
  const target = `${pathname}${search}`;
  // No `next` for the sign-in page itself: it would bounce the user back to a
  // page they are already on.
  if (pathname === SIGN_IN_PATH) return SIGN_IN_PATH;
  return `${SIGN_IN_PATH}?next=${encodeURIComponent(target)}`;
}
