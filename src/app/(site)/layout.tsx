import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui";
import { getPublicNavigation } from "@/modules/cms/server/public-queries";
import { getSiteContext, signAssetPaths } from "@/modules/cms/server/site-context";
import { canonicalUrl, resolveSeo } from "@/modules/seo/metadata";
import {
  getPrimaryDomain,
  getPublicIdentity,
  getPublicTheme,
  getSiteSeo,
} from "@/modules/seo/server/queries";
import { PublicLocations } from "@/modules/locations/components/public-locations";
import { listPublicLocations } from "@/modules/locations/server/queries";
import { JsonLd, localBusinessJsonLd } from "@/modules/seo/structured-data";
import { themeCssVariables } from "@/modules/seo/theme";
import { PRODUCT_NAME, VENDOR_NAME, VENDOR_SITE } from "@/config/app";

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
  // 404 - but serves no content. The navbar is not even fetched.
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

  const [navigation, theme, identity, seo, domain, locations] = await Promise.all([
    getPublicNavigation(site.tenant.id),
    getPublicTheme(site.tenant.id),
    getPublicIdentity(site.tenant.id, site.tenant.name),
    getSiteSeo(site.tenant.id),
    getPrimaryDomain(site.tenant.id),
    listPublicLocations(site.tenant.id),
  ]);

  const resolved = resolveSeo({ site: seo, business: identity, tenantIsServing: true });
  const base = domain ?? site.tenant.domain;

  return (
    /*
     * The theme travels as CSS custom properties on this element's `style`
     * attribute, never as a generated stylesheet. React escapes a style object,
     * so no stored value can end the attribute or open a rule - see the header
     * of `modules/seo/theme.ts` for why that distinction is a security one and
     * not a stylistic preference.
     *
     * Everything below reads those properties. The chrome used to be painted in
     * the DASHBOARD's tokens - `border-border`, `text-muted-foreground` - which
     * meant a business could choose any palette it liked and still get a site
     * that looked like the admin panel. Layout stays Tailwind; colour, radius
     * and typeface are the tenant's.
     */
    <div
      className="flex min-h-dvh flex-col"
      style={{
        ...themeCssVariables(theme),
        background: "var(--site-background)",
        color: "var(--site-foreground)",
        fontFamily: "var(--site-font)",
      }}
    >
      <JsonLd
        data={localBusinessJsonLd({
          name: identity.name,
          url: canonicalUrl(base, "/"),
          description: resolved.description,
          imageUrl: null,
          phone: identity.phone,
          addressLine: identity.addressLine,
          district: identity.district,
          city: identity.city,
        })}
      />

      <header
        className="sticky top-0 z-40 backdrop-blur-md"
        style={{
          borderBottom: "1px solid var(--site-border)",
          background: "color-mix(in srgb, var(--site-background) 88%, transparent)",
        }}
      >
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-6 py-4">
          <Link
            href="/sitio"
            className="text-lg font-semibold tracking-tight"
            style={{ color: "var(--site-primary)" }}
          >
            {identity.name}
          </Link>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            {navigation.length > 0 ? (
              <nav aria-label="Principal">
                <ul className="flex flex-wrap items-center gap-x-5 gap-y-1">
                  {navigation.map((item) => (
                    <li key={item.id}>
                      <Link
                        href={item.href}
                        className="text-sm font-medium transition-opacity hover:opacity-70"
                      >
                        {item.label}
                      </Link>
                      {item.children.length > 0 ? (
                        <ul className="mt-0.5 flex flex-wrap gap-3">
                          {item.children.map((child) => (
                            <li key={child.id}>
                              <Link
                                href={child.href}
                                className="text-xs transition-opacity hover:opacity-70"
                                style={{ color: "var(--site-subtle)" }}
                              >
                                {child.label}
                              </Link>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </nav>
            ) : null}

            {/*
              The phone as a button.
              
              A shop's website exists so somebody can order from it, and on a
              phone that still mostly means a call. It appears only when the
              business filled the number in - an empty button that dials nothing
              is worse than no button.
            */}
            {identity.phone !== null ? (
              <a
                href={`tel:${identity.phone.replace(/[^+0-9]/g, "")}`}
                className="inline-flex h-9 items-center px-4 text-sm font-semibold transition-opacity hover:opacity-90"
                style={{
                  background: "var(--site-primary)",
                  color: "var(--site-on-primary)",
                  borderRadius: "var(--site-radius)",
                }}
              >
                {identity.phone}
              </a>
            ) : null}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-6">{children}</main>

      <footer className="mt-20" style={{ borderTop: "1px solid var(--site-border)" }}>
        <div className="mx-auto flex max-w-5xl flex-col gap-10 px-6 py-12">
          {/* Master section 30: direccion y horarios. Rendered from the Phase
              10 rows, and omitted entirely when a business has not filled any
              of it in - an empty heading is worse than no heading. */}
          <PublicLocations locations={locations} />

          <div
            className="flex flex-col gap-2 pt-6 sm:flex-row sm:items-center sm:justify-between"
            style={{ borderTop: "1px solid var(--site-border)" }}
          >
            <p className="text-sm font-medium">
              {identity.name}
              {identity.city !== null ? ` · ${identity.city}` : null}
            </p>

            {/*
              The platform credit. Small, factual, and linking out rather than
              to `/` - which on this hostname is the tenant's own site, not
              ours. It is how a visitor who likes this site finds out who builds
              them, which is the cheapest marketing channel the product has.
            */}
            <a
              href={VENDOR_SITE}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs transition-opacity hover:opacity-100"
              style={{ color: "var(--site-subtle)" }}
            >
              Hecho con {PRODUCT_NAME} de {VENDOR_NAME}
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
