import "server-only";

/**
 * The tenant a public request belongs to.
 *
 * This is where the Phase 01 resolver finally gets used for what it was built
 * for. `getCurrentTenant()` reads the Host header and returns the tenant that
 * owns it - which is the only thing that decides whose website a visitor sees.
 */

import { cache } from "react";
import { getCurrentTenant } from "@/lib/tenant/context";
import type { ResolvedTenant } from "@/lib/tenant/types";
import { TENANT_ASSETS_BUCKET } from "@/lib/storage/assets";
import { logger } from "@/lib/logger";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface SiteContext {
  readonly tenant: ResolvedTenant;
  /** True when the business may show content at all. */
  readonly isServing: boolean;
}

/**
 * Resolves the site for this request, or null when no tenant owns the hostname.
 *
 * A suspended business resolves but does not serve: the caller renders a notice
 * instead of the site. That split is why this returns a flag rather than just
 * filtering suspended tenants out - a bare 404 would tell the owner nothing.
 */
export const getSiteContext = cache(async (): Promise<SiteContext | null> => {
  const tenant = await getCurrentTenant();
  if (tenant === null) return null;
  return { tenant, isServing: tenant.status === "active" };
});

/**
 * Signs the asset paths a page needs, in one round trip.
 *
 * The bucket is private (Phase 06), so `getPublicUrl` would return a URL that
 * nobody can fetch - including the legitimate visitor. Signing is the only way
 * a private object reaches a browser.
 *
 * Returned as a Map rather than a function because signing is asynchronous and
 * a renderer needs the value synchronously: the page resolves every path first,
 * then renders.
 *
 * One hour: long enough for a page view and its images, short enough that a
 * leaked URL stops working. A path that fails to sign is simply absent from the
 * map, and the renderer skips that image rather than emitting a broken one.
 */
export async function signAssetPaths(paths: readonly string[]): Promise<Map<string, string>> {
  const unique = [...new Set(paths)];
  const signed = new Map<string, string>();
  if (unique.length === 0) return signed;

  const client = await createSupabaseServerClient();
  const { data, error } = await client.storage
    .from(TENANT_ASSETS_BUCKET)
    .createSignedUrls(unique, 60 * 60);

  if (error) {
    logger.error("site.assets.sign_failed", { count: unique.length, error });
    return signed;
  }

  for (const entry of data ?? []) {
    if (entry.signedUrl !== null && entry.path !== null) {
      signed.set(entry.path, entry.signedUrl);
    }
  }
  return signed;
}
