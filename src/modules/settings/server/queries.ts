import "server-only";

/**
 * Read side of business settings.
 *
 * Every tenant has exactly one settings row and one theme row - the Phase 06
 * trigger makes that an invariant of the table - so these return a value, not a
 * maybe. A caller never has to write a fallback.
 */

import { DatabaseError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { SocialPlatform } from "@/types/database";

export interface BusinessSettings {
  readonly legalName: string | null;
  readonly tradeName: string | null;
  readonly taxId: string | null;
  readonly contactEmail: string | null;
  readonly phone: string | null;
  readonly whatsapp: string | null;
  readonly addressLine: string | null;
  readonly district: string | null;
  readonly city: string | null;
  readonly currency: string;
  readonly timezone: string;
}

export interface TenantTheme {
  readonly primaryColor: string;
  readonly accentColor: string;
  readonly backgroundColor: string;
  readonly fontFamily: string;
  readonly borderRadius: string;
  readonly logoPath: string | null;
  readonly faviconPath: string | null;
}

export interface SocialLink {
  readonly id: string;
  readonly platform: SocialPlatform;
  readonly url: string;
  readonly position: number;
}

export async function getBusinessSettings(tenantId: string): Promise<BusinessSettings> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .from("tenant_settings")
    .select("*")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) {
    logger.error("settings.read_failed", { tenantId, error });
    throw new DatabaseError("Settings lookup failed.", { cause: error });
  }
  // Reaching here with no row means the invariant broke.
  //
  // The caller's membership was already verified by `requireActiveTenant`, so
  // RLS is not hiding it, and the row cannot have been deleted: Phase 06 gives
  // these tables UPDATE-only policies precisely so it cannot. A missing row
  // therefore means the trigger failed - a fault, not a 404. Saying 500 keeps
  // that distinguishable from "wrong URL" in the logs and in monitoring.
  if (data === null) {
    logger.error("settings.row_missing", { tenantId });
    throw new DatabaseError("Tenant settings row is missing.", { context: { tenantId } });
  }

  return {
    legalName: data.legal_name,
    tradeName: data.trade_name,
    taxId: data.tax_id,
    contactEmail: data.contact_email,
    phone: data.phone,
    whatsapp: data.whatsapp,
    addressLine: data.address_line,
    district: data.district,
    city: data.city,
    currency: data.currency,
    timezone: data.timezone,
  };
}

export async function getTenantTheme(tenantId: string): Promise<TenantTheme> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .from("tenant_themes")
    .select("*")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) {
    logger.error("theme.read_failed", { tenantId, error });
    throw new DatabaseError("Theme lookup failed.", { cause: error });
  }
  if (data === null) {
    logger.error("theme.row_missing", { tenantId });
    throw new DatabaseError("Tenant theme row is missing.", { context: { tenantId } });
  }

  return {
    primaryColor: data.primary_color,
    accentColor: data.accent_color,
    backgroundColor: data.background_color,
    fontFamily: data.font_family,
    borderRadius: data.border_radius,
    logoPath: data.logo_path,
    faviconPath: data.favicon_path,
  };
}

export async function listSocialLinks(tenantId: string): Promise<SocialLink[]> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .from("tenant_social_links")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("position");

  if (error) {
    logger.error("settings.social_links_failed", { tenantId, error });
    throw new DatabaseError("Social link lookup failed.", { cause: error });
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    platform: row.platform,
    url: row.url,
    position: row.position,
  }));
}
