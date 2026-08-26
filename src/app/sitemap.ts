import type { MetadataRoute } from "next";
import { getSiteContext } from "@/modules/cms/server/site-context";
import { canonicalUrl, sitePagePath } from "@/modules/seo/metadata";
import { getPrimaryDomain, getSiteSeo, listPublishedPages } from "@/modules/seo/server/queries";
import { logger } from "@/lib/logger";

/**
 * `/sitemap.xml`, per tenant.
 *
 * One route, many sitemaps: which one a request gets is decided by the hostname
 * it arrived on, exactly like the pages themselves. Every URL inside is built
 * from the tenant's primary domain, so the document a crawler receives on
 * `sugurolls.com` lists `sugurolls.com` URLs and nothing else. A sitemap that
 * mixed businesses would tell Google they are one site.
 *
 * `force-dynamic` for a reason that has bitten this project before (Phase 00,
 * EC-02): a statically generated sitemap would be evaluated during `next
 * build`, on a machine that legitimately has no database credentials, and the
 * build would fail. There is nothing to prerender anyway - the answer depends
 * on the request's hostname.
 */
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const site = await getSiteContext();

  // An unregistered hostname gets an empty document rather than an error. A
  // crawler asking a question we have no answer to is not a fault, and a 500
  // here would be retried forever.
  if (site === null) return [];

  // A suspended business publishes nothing, so it lists nothing. Suspension
  // that still fed a sitemap would keep the business in the index for weeks
  // after it stopped serving.
  if (!site.isServing) return [];

  const [seo, domain] = await Promise.all([
    getSiteSeo(site.tenant.id),
    getPrimaryDomain(site.tenant.id),
  ]);

  // A site that asked not to be indexed does not hand out a map of itself.
  if (!seo.robotsIndex) return [];

  const base = domain ?? site.tenant.domain;
  const pages = await listPublishedPages(site.tenant.id);

  logger.debug("seo.sitemap.served", { tenantId: site.tenant.id, pages: pages.length });

  return pages.map((page) => {
    const path = sitePagePath(page.slug);
    return {
      url: canonicalUrl(base, path),
      lastModified: new Date(page.updatedAt),
      // The home page is the entry point; everything else sits below it.
      priority: path === "/sitio" ? 1 : 0.7,
      changeFrequency: "weekly" as const,
    };
  });
}
