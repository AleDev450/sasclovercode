import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { normalizeHostname } from "@/lib/tenant";
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

/**
 * Everything on the marketing host that is not the marketing site.
 *
 * `/sitio` is on the list because a tenant's website reached through the
 * PLATFORM hostname is a duplicate of the same content served from that
 * business's own domain, and duplicates are what canonical hosts exist to
 * avoid.
 */
const PLATFORM_DISALLOWED = ["/dashboard", "/super-admin", "/api", "/login", "/sitio", "/auth"];

/**
 * True when this request arrived on CloverCode's own hostname.
 *
 * `NEXT_PUBLIC_APP_URL` is read directly rather than through `getPublicEnv()`,
 * for the reason the root layout gives: this route may be evaluated on a
 * machine with no validated environment, and a missing variable must degrade
 * rather than throw. An unset variable simply means no host matches, which
 * falls through to the closed default below.
 */
async function isPlatformHost(): Promise<boolean> {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (configured === undefined || configured === "") return false;

  let expected: string | null;
  try {
    expected = normalizeHostname(new URL(configured).host);
  } catch {
    return false;
  }
  if (expected === null) return false;

  const requestHeaders = await headers();
  return normalizeHostname(requestHeaders.get("host")) === expected;
}

export default async function robots(): Promise<MetadataRoute.Robots> {
  const site = await getSiteContext();

  if (site === null) {
    /*
     * No tenant owns this hostname, which has exactly two explanations.
     *
     * It is CloverCode's OWN marketing host - the landing page for `Tu
     * Tiendita` - and that page exists to be found. It is the one surface in
     * this application that wants a crawler, and the `(marketing)` layout says
     * so in its metadata too; a `robots.txt` that disallowed it would quietly
     * override that and nobody would notice until the traffic did not arrive.
     *
     * Or it is a hostname pointed here by somebody whose domain we have never
     * heard of, and allowing nothing is the only safe answer.
     */
    if (await isPlatformHost()) {
      return { rules: [{ userAgent: "*", allow: "/", disallow: PLATFORM_DISALLOWED }] };
    }

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
