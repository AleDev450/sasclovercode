/**
 * Hostname handling for tenant resolution.
 *
 * Pure functions, no I/O: the `Host` header is untrusted input (master section
 * 9) and everything that decides *which tenant a request belongs to* must be
 * assertable in isolation.
 *
 * The key design decision: every supported host shape is mapped to the SAME
 * canonical lookup domain, so production and local development go through one
 * query and one code path. Local development exercises exactly what production
 * runs.
 */

import { SYSTEM_DOMAIN } from "@/config/app";

/** Hard DNS limit for a full name. */
const MAX_HOSTNAME_LENGTH = 253;

/** A single DNS label: alphanumeric, inner hyphens allowed. */
const LABEL_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/** Two or more labels. Mirrors `tenant_domains_domain_format` in SQL. */
const DOMAIN_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/** Control characters, space and DEL: never legal inside a hostname. */
function hasIllegalCharacters(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * Hosts that only mean anything on a developer machine.
 *
 * No IPv6 literal here on purpose: `normalizeHostname()` rejects every IPv6
 * form (bracketed or bare) before this set is consulted, so an entry for `::1`
 * would be unreachable.
 */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0"]);

const LOCAL_SUFFIX = ".localhost";

/**
 * Normalises a raw `Host` header into a bare hostname.
 *
 * Lowercases, trims, drops the port and the FQDN trailing dot, and rejects
 * anything that cannot be a hostname. Returns `null` rather than throwing:
 * receiving a malformed Host from the internet is normal, not exceptional.
 */
export function normalizeHostname(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;

  let host = raw.trim().toLowerCase();
  if (host.length === 0) return null;

  // Defensive: some proxies forward a full URL rather than an authority.
  host = host.replace(/^https?:\/\//, "");

  // Anything from the first path/query/fragment character onwards is not host.
  const pathIndex = host.search(/[/?#]/);
  if (pathIndex !== -1) host = host.slice(0, pathIndex);

  // Control characters or embedded whitespace: reject outright. Checked after
  // the trim so that a merely padded value still works.
  if (hasIllegalCharacters(host)) return null;

  // Bracketed IPv6 (`[::1]:3000`). Never a tenant host.
  if (host.startsWith("[")) return null;

  // Bare IPv6 (`::1`, `fe80::1`). A hostname carries at most one colon, and
  // that one separates the port. Without this guard the port logic below would
  // treat the last group as a port and return a fragment such as `":"` or
  // `"fe80:"` - a value that is not a hostname, breaking the contract this
  // function promises to every later caller.
  if (host.indexOf(":") !== host.lastIndexOf(":")) return null;

  // Drop the port, but only when what follows really is a port.
  const colonIndex = host.lastIndexOf(":");
  if (colonIndex !== -1) {
    const port = host.slice(colonIndex + 1);
    if (!/^\d{1,5}$/.test(port)) return null;
    host = host.slice(0, colonIndex);
  }

  // A single colon that was not a port separator (`::1` is caught above, but
  // `host:` is not) must not survive as part of the returned name.
  if (host.includes(":")) return null;

  // A trailing dot is a legal FQDN, but it is not how the domain is stored.
  if (host.endsWith(".")) host = host.slice(0, -1);

  if (host.length === 0 || host.length > MAX_HOSTNAME_LENGTH) return null;

  return host;
}

export interface LookupOptions {
  /** Platform domain that issues system subdomains. */
  readonly systemDomain?: string;
  /** Overrides the environment check. Tests use it to simulate production. */
  readonly isProduction?: boolean;
  /** Slug used when a developer browses plain `localhost`. */
  readonly devTenantSlug?: string | undefined;
}

function isIpLike(host: string): boolean {
  // A real TLD always contains a letter; `127.0.0.1` does not.
  const lastLabel = host.slice(host.lastIndexOf(".") + 1);
  return !/[a-z]/.test(lastLabel);
}

/**
 * Maps a request hostname to the domain to look up in `tenant_domains`.
 *
 * ```text
 * sugurolls.clovercodeapp.com  -> sugurolls.clovercodeapp.com          (as-is)
 * sugurolls.com                -> sugurolls.com                        (as-is)
 * sugurolls.localhost:3000     -> sugurolls.clovercodeapp.com          (dev only)
 * localhost:3000               -> {DEV_TENANT_SLUG}.clovercodeapp.com  (dev only)
 * clovercodeapp.com            -> null   (platform host, no tenant)
 * a.b.clovercodeapp.com        -> null   (nested subdomain)
 * 127.0.0.1:3000               -> {DEV_TENANT_SLUG}.clovercodeapp.com  (dev only)
 * 127.0.0.1                    -> null   (in production; a loopback host is
 *                                         never a tenant once deployed)
 * 8.8.8.8                      -> null   (any non-loopback IP, always)
 * ```
 *
 * Returns `null` when the host cannot belong to a tenant, so the caller can
 * skip the database entirely.
 */
export function toLookupDomain(
  rawHostname: string | null | undefined,
  options: LookupOptions = {},
): string | null {
  const host = normalizeHostname(rawHostname);
  if (host === null) return null;

  const systemDomain = options.systemDomain ?? SYSTEM_DOMAIN;
  const isProduction = options.isProduction ?? process.env.NODE_ENV === "production";

  // --- Platform system subdomain -------------------------------------------
  const systemSuffix = `.${systemDomain}`;
  if (host.endsWith(systemSuffix)) {
    const label = host.slice(0, -systemSuffix.length);
    // A nested subdomain (`a.b.clovercodeapp.com`) fails LABEL_PATTERN because
    // of the dot, which is exactly what we want.
    return LABEL_PATTERN.test(label) ? host : null;
  }

  // The bare platform domain belongs to CloverCode, not to any tenant.
  if (host === systemDomain) return null;

  // --- Local development ----------------------------------------------------
  const isLoopback = LOOPBACK_HOSTS.has(host);
  const isLocalSuffix = host.endsWith(LOCAL_SUFFIX);

  if (isLoopback || isLocalSuffix) {
    // In production a local host is never a tenant, whatever is configured.
    if (isProduction) return null;

    if (isLocalSuffix) {
      const label = host.slice(0, -LOCAL_SUFFIX.length);
      return LABEL_PATTERN.test(label) ? `${label}.${systemDomain}` : null;
    }

    const configured = (options.devTenantSlug ?? process.env.DEV_TENANT_SLUG)?.trim().toLowerCase();
    if (configured === undefined || configured.length === 0) return null;
    return LABEL_PATTERN.test(configured) ? `${configured}.${systemDomain}` : null;
  }

  // --- Custom domain --------------------------------------------------------
  if (!DOMAIN_PATTERN.test(host)) return null;
  if (isIpLike(host)) return null;

  return host;
}
