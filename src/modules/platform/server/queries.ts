import "server-only";

/**
 * Read side of the platform area. Every query is gated inside PostgreSQL, so a
 * non-operator gets zero rows rather than an error that would confirm the area.
 */

import { DatabaseError, NotFoundError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface PlatformTenant {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly status: "active" | "suspended" | "archived";
  readonly primaryDomain: string | null;
  readonly memberCount: number;
  readonly createdAt: string;
}

export async function listPlatformTenants(): Promise<PlatformTenant[]> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client.rpc("list_platform_tenants");

  if (error) {
    logger.error("platform.tenants.list_failed", { error });
    throw new DatabaseError("Tenant listing failed.", { cause: error });
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: row.status,
    primaryDomain: row.primary_domain,
    memberCount: Number(row.member_count),
    createdAt: row.created_at,
  }));
}

export async function getPlatformTenant(tenantId: string): Promise<PlatformTenant> {
  const tenants = await listPlatformTenants();
  const tenant = tenants.find((candidate) => candidate.id === tenantId);
  if (tenant === undefined) throw new NotFoundError("Empresa");
  return tenant;
}
