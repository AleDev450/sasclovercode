import type { MetadataRoute } from "next";
import { getSiteContext } from "@/modules/cms/server/site-context";
import { canonicalUrl } from "@/modules/seo/metadata";
import { getPrimaryDomain, getSiteSeo } from "@/modules/seo/server/queries";

/**
 * `/robots.txt`, per tenant.
 *
 * Resolved by hostname like everything else on the public side. The dashboard
 * is disallowed on every host, whoever is asking: `/dashboard` is not part of
 * any business's website and has no reason to be crawled from any domain.
 *
 * `force-dynamic` for the same reason as the sitemap: the answer depends on the
 * request, and evaluating it at build time would need credentials the build
 * does not have.
 */
export const dynamic = "force-dynamic";

/** Paths that are never a tenant's public website, on any hostname. */
const ALWAYS_DISALLOWED = ["/dashboard", "/api", "/iniciar-sesion", "/registro"];

export default async function robots(): Promise<MetadataRoute.Robots> {
  const site = await getSiteContext();

  // No tenant owns this hostname: allow nothing. Whatever is being served here
  // is not a website we are responsible for indexing.
  if (site === null) {
    return { rules: [{ userAgent: "*", disallow: "/" }] };
  }

  const [seo, domain] = await Promise.all([
    getSiteSeo(site.tenant.id),
    getPrimaryDomain(site.tenant.id),
  ]);

  const base = domain ?? site.tenant.domain;
  const indexable = site.isServing && seo.robotsIndex;

  // Disallowing everything is a REQUEST, not enforcement. A crawler that
  // ignores robots.txt still finds `noindex` in the page metadata, which is the
  // part search engines actually honour - and neither of them is access
  // control, which is what RLS is for (master section 45).
  if (!indexable) {
    return { rules: [{ userAgent: "*", disallow: "/" }] };
  }

  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ALWAYS_DISALLOWED }],
    sitemap: canonicalUrl(base, "/sitemap.xml"),
    host: base,
  };
}
