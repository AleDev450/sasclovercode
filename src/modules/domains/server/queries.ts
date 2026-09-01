import "server-only";

/**
 * Read side of domain management.
 *
 * The tenant filter is applied here AND the `domains.view` policy is applied in
 * PostgreSQL. Neither is redundant: the policy decides whether the caller may
 * see any of it, and the filter decides which business's screen this is.
 */

import { DatabaseError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  DomainProviderStatus,
  DomainVerificationStatus,
  TenantDomainType,
} from "@/types/database";
import { LIST_CAP } from "@/config/app";

export interface TenantDomain {
  readonly id: string;
  readonly domain: string;
  readonly type: TenantDomainType;
  readonly isPrimary: boolean;
  readonly status: DomainVerificationStatus;
  readonly verifiedAt: string | null;
  readonly verificationToken: string | null;
  readonly checkedAt: string | null;
  readonly lastError: string | null;
  readonly providerStatus: DomainProviderStatus;
  readonly providerSyncedAt: string | null;
  readonly createdAt: string;
}

const COLUMNS =
  "id, domain, type, is_primary, verification_status, verified_at, verification_token, verification_checked_at, last_error, provider_status, provider_synced_at, created_at";

function toDomain(row: {
  id: string;
  domain: string;
  type: TenantDomainType;
  is_primary: boolean;
  verification_status: DomainVerificationStatus;
  verified_at: string | null;
  verification_token: string | null;
  verification_checked_at: string | null;
  last_error: string | null;
  provider_status: DomainProviderStatus;
  provider_synced_at: string | null;
  created_at: string;
}): TenantDomain {
  return {
    id: row.id,
    domain: row.domain,
    type: row.type,
    isPrimary: row.is_primary,
    status: row.verification_status,
    verifiedAt: row.verified_at,
    verificationToken: row.verification_token,
    checkedAt: row.verification_checked_at,
    lastError: row.last_error,
    providerStatus: row.provider_status,
    providerSyncedAt: row.provider_synced_at,
    createdAt: row.created_at,
  };
}

/**
 * Every domain of one tenant.
 *
 * Ordered so the screen reads the way the business thinks: the address people
 * type first, then the rest alphabetically. The system subdomain sinks to the
 * bottom - it always works and nobody needs to look at it.
 */
export async function listTenantDomains(tenantId: string): Promise<TenantDomain[]> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .from("tenant_domains")
    .select(COLUMNS)
    .eq("tenant_id", tenantId)
    .order("is_primary", { ascending: false })
    .order("type", { ascending: true })
    .order("domain", { ascending: true })
    .limit(LIST_CAP);

  if (error) {
    logger.error("domains.list_failed", { tenantId, error });
    throw new DatabaseError("Domain listing failed.", { cause: error });
  }

  return (data ?? []).map(toDomain);
}

/** One domain of THIS tenant, or null. The tenant filter is not optional. */
export async function getTenantDomain(
  tenantId: string,
  domainId: string,
): Promise<TenantDomain | null> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .from("tenant_domains")
    .select(COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("id", domainId)
    .maybeSingle();

  if (error) {
    logger.error("domains.get_failed", { tenantId, domainId, error });
    throw new DatabaseError("Domain lookup failed.", { cause: error });
  }
  return data === null ? null : toDomain(data);
}
