import "server-only";

/**
 * The single tenant accessor for server code.
 *
 * Master section 43: there must be one abstraction for the current tenant, not
 * hostname parsing repeated across a hundred files.
 */

import { headers } from "next/headers";
import { cache } from "react";
import { AuthorizationError } from "@/lib/errors";
import { resolveTenantByHostname } from "./resolve";
import type { ResolvedTenant } from "./types";

/**
 * Resolves the tenant for the current request, or `null`.
 *
 * Wrapped in React `cache()`, so several consumers in one render share a single
 * database round trip. The cache is per request: it cannot serve one visitor's
 * tenant to another, and a domain change takes effect on the next request.
 *
 * Reads `host` and not `x-forwarded-host`. On Vercel `host` already carries the
 * public hostname, while `x-forwarded-host` can be set by the client when the
 * app is reached directly - which would let a visitor choose their tenant.
 */
export const getCurrentTenant = cache(async (): Promise<ResolvedTenant | null> => {
  const requestHeaders = await headers();
  return resolveTenantByHostname(requestHeaders.get("host"));
});

/**
 * Same as `getCurrentTenant()` but throws when there is no tenant.
 *
 * For code paths that are meaningless without one. Uses AuthorizationError so
 * the caller receives a generic 403 instead of a hint about which hostnames are
 * registered on the platform.
 */
export async function requireCurrentTenant(): Promise<ResolvedTenant> {
  const tenant = await getCurrentTenant();
  if (tenant === null) {
    throw new AuthorizationError("No tenant is registered for this hostname.");
  }
  return tenant;
}
