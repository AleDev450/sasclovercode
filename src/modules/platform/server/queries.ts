import "server-only";

/**
 * Read side of the platform area. Every query is gated inside PostgreSQL, so a
 * non-operator gets zero rows rather than an error that would confirm the area.
 */

import { DatabaseError, NotFoundError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { THEME_DEFAULTS, type ThemeValues } from "@/modules/seo/theme";

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

/**
 * The theme of one tenant, read as an operator.
 *
 * Goes through `tenant_themes_platform_select` (migration 20260915120000), not
 * through the tenant-side policy: an operator is not a member of the business
 * they are setting up, and requiring membership to see a theme would mean
 * adding operators to businesses, which is exactly what the platform policies
 * exist to avoid.
 *
 * Returns defaults rather than throwing when the row cannot be read. This feeds
 * a card on a page that is mostly about domains, plans and billing, and a theme
 * that momentarily cannot be read is not a reason to fail the screen an
 * operator opened to suspend somebody.
 */
export async function getPlatformTenantTheme(tenantId: string): Promise<ThemeValues> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .from("tenant_themes")
    .select("primary_color, accent_color, background_color, font_family, border_radius, style")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error || data === null) {
    if (error) logger.error("platform.theme.read_failed", { tenantId, error });
    return THEME_DEFAULTS;
  }

  return {
    primaryColor: data.primary_color,
    accentColor: data.accent_color,
    backgroundColor: data.background_color,
    fontFamily: data.font_family,
    borderRadius: data.border_radius,
    style: data.style,
  };
}
