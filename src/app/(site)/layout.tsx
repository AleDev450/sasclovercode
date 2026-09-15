import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui";
import { getSiteContext, signAssetPaths } from "@/modules/cms/server/site-context";
import { SiteChrome } from "@/modules/cms/components/site-chrome";
import { canonicalUrl, resolveSeo } from "@/modules/seo/metadata";
import {
  getPrimaryDomain,
  getPublicIdentity,
  getPublicTheme,
  getSiteSeo,
} from "@/modules/seo/server/queries";

/**
 * The public website of a tenant.
 *
 * A route group of its own: this is not the dashboard. It shares no header, no
 * session and no navigation with it - a visitor here is anonymous, and the
 * layout must not accidentally imply otherwise.
 *
 * The tenant comes from the hostname (Phase 01). If no business owns the
 * hostname there is nothing to render, so the request is a 404: the platform
 * does not have a generic homepage to fall back to.
 *
 * Phase 08 added two things to it. The metadata below makes each site an
 * independent identity for search engines and social networks (master section
 * 33), and the wrapper element carries the tenant's theme as CSS custom
 * properties, which is what finally closes KL-708.
 */

/**
 * Site-wide metadata.
 *
 * Every field here EXISTS to override the root layout, and that is the whole
 * point of the phase. The root sets the platform's title template, description,
 * application name and `robots: noindex` - correct for a dashboard, and exactly
 * wrong for a restaurant's website. Anything left unset here would leak
 * "CloverCode" onto a page that belongs to somebody else's business.
 */
export async function generateMetadata(): Promise<Metadata> {
  const site = await getSiteContext();
  if (site === null) return { title: "No disponible", robots: { index: false, follow: false } };

  const { tenant } = site;
  const [seo, identity, domain, theme] = await Promise.all([
    getSiteSeo(tenant.id),
    getPublicIdentity(tenant.id, tenant.name),
    getPrimaryDomain(tenant.id),
    getPublicTheme(tenant.id),
  ]);
  const faviconPath = theme.faviconPath;

  const resolved = resolveSeo({
    site: seo,
    business: identity,
    tenantIsServing: site.isServing,
  });

  // `metadataBase` is what makes every relative URL below absolute, and it is
  // built from the tenant's OWN domain: a canonical resolved against the
  // platform's URL would point every business at clovercodeapp.com.
  const base = domain ?? tenant.domain;
  const signed = await signAssetPaths(
    [seo.ogImagePath, seo.twitterImagePath, faviconPath].filter((path) => path !== null),
  );

  return {
    metadataBase: new URL(`https://${base}`),
    title: {
      default: resolved.title,
      // Replaces the platform template. A page of this site is titled after
      // this business, never after the platform hosting it.
      template: `%s · ${identity.name}`,
    },
    description: resolved.description ?? undefined,
    applicationName: identity.name,
    robots: resolved.index
      ? { index: true, follow: true }
      : { index: false, follow: false, nocache: true },
    icons:
      faviconPath !== null && signed.has(faviconPath)
        ? { icon: signed.get(faviconPath) }
        : undefined,
    openGraph: {
      type: "website",
      siteName: identity.name,
      title: resolved.ogTitle,
      description: resolved.ogDescription ?? undefined,
      locale: "es_PE",
      url: canonicalUrl(base, "/"),
      images:
        resolved.imagePath !== null && signed.has(resolved.imagePath)
          ? [{ url: signed.get(resolved.imagePath)! }]
          : undefined,
    },
    twitter: {
      card: resolved.imagePath === null ? "summary" : "summary_large_image",
      title: resolved.ogTitle,
      description: resolved.ogDescription ?? undefined,
    },
    verification: seo.googleVerification === null ? undefined : { google: seo.googleVerification },
  };
}

export default async function SiteLayout({ children }: { children: ReactNode }) {
  const site = await getSiteContext();
  if (site === null) notFound();

  // A suspended business resolves - so its owner sees WHY rather than a bare
  // 404 - but serves no content. The chrome is not even fetched.
  if (!site.isServing) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-xl items-center px-6 py-16">
        <Alert variant="warning">
          <AlertTitle>Sitio no disponible</AlertTitle>
          <AlertDescription>
            {site.tenant.name} no esta disponible en este momento.
          </AlertDescription>
        </Alert>
      </main>
    );
  }

  /*
   * The markup lives in `SiteChrome` so the preview route can render exactly
   * the same website from inside the dashboard, where the hostname belongs to
   * the platform and cannot name a tenant. What stays here is the one thing
   * only a real visit can answer: WHICH tenant this hostname is.
   */
  return <SiteChrome site={site}>{children}</SiteChrome>;
}
