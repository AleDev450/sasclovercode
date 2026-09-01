import "server-only";

/**
 * Read side of SEO.
 *
 * Everything here is read on the public site, by a visitor with no session, so
 * every path goes through a policy or a function that `anon` may use. Nothing
 * in this file may become a member-only read without breaking the crawler.
 */

import { cache } from "react";
import { DatabaseError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { BusinessIdentity, SiteSeo } from "../metadata";
import { THEME_DEFAULTS, type ThemeValues } from "../theme";
import { LIST_CAP } from "@/config/app";

/**
 * The SEO row of a tenant.
 *
 * Wrapped in `cache()`: `generateMetadata` and the page body both need it in
 * one render, and Next.js calls them separately. Without this the site would
 * make two identical queries per page view.
 *
 * Returns defaults rather than null when the row is unreadable. This read
 * happens on the public site, where a failure must degrade to a plain page
 * rather than a 500 - a business whose SEO row is momentarily unreadable should
 * still be able to sell lunch.
 */
export const getSiteSeo = cache(async (tenantId: string): Promise<SiteSeo> => {
  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .from("tenant_seo")
    .select("*")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) {
    logger.error("seo.read_failed", { tenantId, error });
    return EMPTY_SEO;
  }
  if (data === null) {
    // The trigger guarantees the row, so this means a suspended tenant read by
    // a stranger (the policy hides it) or a genuinely missing row. Neither is
    // worth failing a page render over.
    logger.debug("seo.row_absent", { tenantId });
    return EMPTY_SEO;
  }

  return {
    siteTitle: data.site_title,
    siteDescription: data.site_description,
    ogTitle: data.og_title,
    ogDescription: data.og_description,
    ogImagePath: data.og_image_path,
    twitterImagePath: data.twitter_image_path,
    robotsIndex: data.robots_index,
    googleVerification: data.google_verification,
  };
});

/**
 * What a site with no SEO row looks like.
 *
 * `robotsIndex: true` matches the column default. Defaulting to false would be
 * the "safer" reflex and the wrong call: a transient read failure would then
 * silently deindex a business that had done nothing wrong, and recovery from
 * deindexing takes weeks.
 */
const EMPTY_SEO: SiteSeo = {
  siteTitle: null,
  siteDescription: null,
  ogTitle: null,
  ogDescription: null,
  ogImagePath: null,
  twitterImagePath: null,
  robotsIndex: true,
  googleVerification: null,
};

/** What the site falls back to when the identity cannot be read. */
const FALLBACK_IDENTITY = (name: string): BusinessIdentity => ({
  name,
  addressLine: null,
  district: null,
  city: null,
  phone: null,
  currency: "PEN",
});

/**
 * The public identity of the business, through the narrow function.
 *
 * `tenant_settings` has no public policy - it holds the RUC and the contact
 * email - so this goes through `get_public_business_identity`, which returns
 * only what a website displays. `fallbackName` is the tenant name, used when
 * the function returns nothing (a suspended business).
 */
export const getPublicIdentity = cache(
  async (tenantId: string, fallbackName: string): Promise<BusinessIdentity> => {
    const client = await createSupabaseServerClient();
    const { data, error } = await client.rpc("get_public_business_identity", {
      p_tenant_id: tenantId,
    });

    if (error) {
      logger.error("seo.identity_failed", { tenantId, error });
      return FALLBACK_IDENTITY(fallbackName);
    }

    const row = data?.[0];
    if (row === undefined) {
      return FALLBACK_IDENTITY(fallbackName);
    }

    return {
      name: row.trade_name ?? fallbackName,
      addressLine: row.address_line,
      district: row.district,
      city: row.city,
      phone: row.phone,
      // Defaulted rather than left empty: a page that shows prices with no
      // currency is worse than one that shows them in the platform's default
      // market. The function defaults it too, so this is the second layer.
      currency: row.currency ?? "PEN",
    };
  },
);

/**
 * The domain a tenant canonicalises to, or null.
 *
 * Null is ordinary: a tenant may exist before any domain is verified. The
 * caller then falls back to the platform URL rather than emitting a canonical
 * pointing nowhere.
 */
export const getPrimaryDomain = cache(async (tenantId: string): Promise<string | null> => {
  const client = await createSupabaseServerClient();
  const { data, error } = await client.rpc("get_tenant_primary_domain", {
    p_tenant_id: tenantId,
  });

  if (error) {
    logger.error("seo.primary_domain_failed", { tenantId, error });
    return null;
  }
  return data ?? null;
});

/** A theme plus the branding paths that hang off it. */
export interface PublicTheme extends ThemeValues {
  readonly faviconPath: string | null;
  readonly logoPath: string | null;
}

/**
 * The theme of a tenant, for the public site. Defaults when unreadable.
 *
 * One query for the colours AND the favicon, memoised for the request: the
 * layout needs the first and `generateMetadata` needs the second, and Next.js
 * calls them separately, so splitting this in two would double the round trips
 * on the busiest page of the product.
 */
export const getPublicTheme = cache(async (tenantId: string): Promise<PublicTheme> => {
  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .from("tenant_themes")
    .select(
      "primary_color, accent_color, background_color, font_family, border_radius, favicon_path, logo_path",
    )
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error || data === null) {
    if (error) logger.error("seo.theme_read_failed", { tenantId, error });
    return { ...THEME_DEFAULTS, faviconPath: null, logoPath: null };
  }

  return {
    primaryColor: data.primary_color,
    accentColor: data.accent_color,
    backgroundColor: data.background_color,
    fontFamily: data.font_family,
    borderRadius: data.border_radius,
    faviconPath: data.favicon_path,
    logoPath: data.logo_path,
  };
});

export interface SeoPageRow {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly seoTitle: string | null;
  readonly seoDescription: string | null;
  readonly ogImagePath: string | null;
  readonly updatedAt: string;
}

/**
 * The SEO fields of one published page of THIS tenant, or null.
 *
 * Separate from `getPublicPage` on purpose: `generateMetadata` runs before the
 * page body and needs only these columns, and pulling every section's JSONB to
 * decide on a title would be wasteful on the hottest path of the product.
 */
export const getPageSeo = cache(
  async (tenantId: string, slug: string): Promise<SeoPageRow | null> => {
    const client = await createSupabaseServerClient();
    const { data, error } = await client
      .from("pages")
      .select("id, slug, title, seo_title, seo_description, og_image_path, updated_at")
      .eq("tenant_id", tenantId)
      .eq("slug", slug)
      .eq("status", "published")
      .maybeSingle();

    if (error) {
      logger.error("seo.page_read_failed", { tenantId, slug, error });
      return null;
    }
    if (data === null) return null;

    return {
      id: data.id,
      slug: data.slug,
      title: data.title,
      seoTitle: data.seo_title,
      seoDescription: data.seo_description,
      ogImagePath: data.og_image_path,
      updatedAt: data.updated_at,
    };
  },
);

/** Every published page of a tenant, for the sitemap. */
export async function listPublishedPages(tenantId: string): Promise<SeoPageRow[]> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .from("pages")
    .select("id, slug, title, seo_title, seo_description, og_image_path, updated_at")
    .eq("tenant_id", tenantId)
    .eq("status", "published")
    .order("slug")
    .limit(LIST_CAP);

  if (error) {
    logger.error("seo.sitemap_query_failed", { tenantId, error });
    throw new DatabaseError("Sitemap query failed.", { cause: error });
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    seoTitle: row.seo_title,
    seoDescription: row.seo_description,
    ogImagePath: row.og_image_path,
    updatedAt: row.updated_at,
  }));
}
