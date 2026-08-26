import "server-only";

/**
 * Metadata for one page of a tenant website.
 *
 * Shared by `/sitio` and `/sitio/[pageSlug]` so the two routes cannot drift
 * apart - the home page of a site and any other page of it must describe
 * themselves by the same rules.
 *
 * Master section 31: resolved from HOSTNAME + PATHNAME. The hostname picks the
 * business and the pathname picks the page; neither is taken from anything the
 * visitor can set beyond the URL they asked for.
 */

import type { Metadata } from "next";
import { signAssetPaths } from "@/modules/cms/server/site-context";
import { getSiteContext } from "@/modules/cms/server/site-context";
import { canonicalUrl, resolveSeo, sitePagePath } from "../metadata";
import { getPageSeo, getPrimaryDomain, getPublicIdentity, getSiteSeo } from "./queries";

/**
 * Builds the metadata for the page with `slug`.
 *
 * A slug that resolves to nothing still returns metadata: Next.js calls this
 * before the page component decides on a 404, and throwing here would turn a
 * missing page into a 500. The values are the site's own, which is the right
 * thing for a "not found" page to say anyway.
 */
export async function buildPageMetadata(slug: string): Promise<Metadata> {
  const site = await getSiteContext();
  if (site === null) return { title: "No disponible", robots: { index: false, follow: false } };

  const { tenant } = site;
  const [seo, page, identity, domain] = await Promise.all([
    getSiteSeo(tenant.id),
    getPageSeo(tenant.id, slug),
    getPublicIdentity(tenant.id, tenant.name),
    getPrimaryDomain(tenant.id),
  ]);

  const resolved = resolveSeo({
    site: seo,
    page:
      page === null
        ? null
        : {
            title: page.title,
            seoTitle: page.seoTitle,
            seoDescription: page.seoDescription,
            ogImagePath: page.ogImagePath,
          },
    business: identity,
    tenantIsServing: site.isServing,
  });

  const base = domain ?? tenant.domain;
  const path = sitePagePath(slug);
  const url = canonicalUrl(base, path);

  const signed =
    resolved.imagePath === null
      ? new Map<string, string>()
      : await signAssetPaths([resolved.imagePath]);
  const imageUrl = resolved.imagePath === null ? undefined : signed.get(resolved.imagePath);

  return {
    /*
     * `absolute` bypasses the layout's `%s · Business` template.
     *
     * Used in two cases and for the same reason: the home page, whose title is
     * already the business name and would otherwise read "Sugurolls ·
     * Sugurolls", and any page with an explicit `seo_title`, because someone
     * who wrote a title meant that title and not that title plus a suffix.
     */
    title:
      resolved.titleIsExplicit || path === "/sitio" ? { absolute: resolved.title } : resolved.title,
    description: resolved.description ?? undefined,
    // The canonical is absolute over the tenant's primary domain, so the same
    // page reached through a second hostname still declares one address.
    alternates: { canonical: url },
    robots: resolved.index
      ? { index: true, follow: true }
      : { index: false, follow: false, nocache: true },
    openGraph: {
      type: "website",
      siteName: identity.name,
      title: resolved.ogTitle,
      description: resolved.ogDescription ?? undefined,
      url,
      images: imageUrl === undefined ? undefined : [{ url: imageUrl }],
    },
    twitter: {
      card: imageUrl === undefined ? "summary" : "summary_large_image",
      title: resolved.ogTitle,
      description: resolved.ogDescription ?? undefined,
      images: imageUrl === undefined ? undefined : [imageUrl],
    },
  };
}
