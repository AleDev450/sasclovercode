import "server-only";

/**
 * Tenant resolution against the database.
 *
 * Master section 42: the tenant is determined from secure server context, never
 * from anything the client can set. The only input here is the request
 * hostname, and it is normalised and validated before it reaches SQL.
 */

import { DatabaseError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { CloverCodeSupabaseClient } from "@/lib/supabase/types";
import { toLookupDomain, type LookupOptions } from "./hostname";
import type { ResolvedTenant } from "./types";

export interface ResolveOptions extends LookupOptions {
  /** Injected by tests; production always builds a request-scoped client. */
  readonly client?: CloverCodeSupabaseClient;
}

/**
 * Resolves a hostname to its tenant, or `null`.
 *
 * `null` is an ordinary outcome: someone can point a DNS record at the platform
 * without ever registering the domain. The caller turns it into a 404. Throwing
 * would fill the logs with noise for something that is not a fault.
 */
export async function resolveTenantByHostname(
  hostname: string | null | undefined,
  options: ResolveOptions = {},
): Promise<ResolvedTenant | null> {
  const lookupDomain = toLookupDomain(hostname, options);

  // Unresolvable shapes never reach the database.
  if (lookupDomain === null) return null;

  const client = options.client ?? (await createSupabaseServerClient());

  const { data, error } = await client.rpc("resolve_tenant_by_domain", {
    p_hostname: lookupDomain,
  });

  if (error) {
    logger.error("tenant.resolution.failed", { lookupDomain, error });
    throw new DatabaseError("Tenant resolution query failed.", {
      cause: error,
      context: { lookupDomain },
    });
  }

  const row = data?.[0];
  if (row === undefined) {
    logger.debug("tenant.resolution.miss", { lookupDomain });
    return null;
  }

  return {
    id: row.tenant_id,
    slug: row.slug,
    name: row.name,
    status: row.status,
    domain: row.domain,
    domainType: row.domain_type,
    isPrimary: row.is_primary,
  };
}
