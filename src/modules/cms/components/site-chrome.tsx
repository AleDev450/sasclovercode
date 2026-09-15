import type { ReactNode } from "react";
import Link from "next/link";
import { PublicLocations } from "@/modules/locations/components/public-locations";
import { listPublicLocations } from "@/modules/locations/server/queries";
import { canonicalUrl, resolveSeo } from "@/modules/seo/metadata";
import {
  getPrimaryDomain,
  getPublicIdentity,
  getPublicTheme,
  getSiteSeo,
} from "@/modules/seo/server/queries";
import { JsonLd, localBusinessJsonLd } from "@/modules/seo/structured-data";
import { themeCssVariables } from "@/modules/seo/theme";
import { signAssetPaths } from "@/lib/storage/sign";
import { PRODUCT_NAME, VENDOR_NAME, VENDOR_SITE } from "@/config/app";
import { getPublicNavigation } from "../server/public-queries";
import type { SiteContext } from "../server/site-context";

/**
 * The frame around a tenant's website: header, navigation, footer, theme.
 *
 * WHY IT IS A COMPONENT AND NOT JUST THE LAYOUT. It was the layout, and the
 * layout resolves its tenant from the HOSTNAME - which is the correct and only
 * way a visitor's request can be answered. It stops being enough the moment
 * somebody inside the dashboard wants to look at what they just edited, because
 * the dashboard lives on one hostname (master section 28) and that hostname
 * belongs to no tenant.
 *
 * Taking the tenant as an argument rather than reading it lets the same markup
 * serve both: `(site)` passes what the hostname resolved, and the preview route
 * passes a tenant the caller is a MEMBER of. Neither can see anything the other
 * could not - the preview still goes through the same policies, with the
 * caller's own identity.
 *
 * THE THEME TRAVELS AS CSS CUSTOM PROPERTIES on one element's `style`
 * attribute, never as a generated stylesheet. React escapes a style object, so
 * no stored value can end the attribute or open a rule - see the header of
 * `modules/seo/theme.ts` for why that is a security distinction and not a
 * stylistic one.
 */
export async function SiteChrome({
  site,
  children,
  banner,
  basePath = "/sitio",
}: {
  site: SiteContext;
  children: ReactNode;
  /** Rendered above everything. The preview route uses it to say so. */
  banner?: ReactNode;
  /**
   * Where this site's own links point.
   *
   * `/sitio` on a real visit. The preview passes `/vista/{slug}`, so following
   * the navbar keeps you inside the preview instead of landing on a path that
   * belongs to no tenant on the dashboard's hostname.
   */
  basePath?: string;
}) {
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

  /** Moves a stored `/sitio/...` link onto whichever base this render uses. */
  const localise = (href: string): string =>
    href === "/sitio" || href.startsWith("/sitio/") ? `${basePath}${href.slice(6)}` : href;

  /*
   * The logo, at last.
   *
   * `tenant_themes.logo_path` has existed since Phase 06 and nothing has ever
   * rendered it, because nothing could upload one either - so every tenant site
   * printed its name as text whatever artwork the business had. Falling back to
   * the name when there is no logo is still right; what was wrong was that
   * there was no other case.
   */
  const logoUrl =
    theme.logoPath === null
      ? null
      : ((await signAssetPaths([theme.logoPath])).get(theme.logoPath) ?? null);

  return (
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

      {banner}

      <header
        className="sticky top-0 z-40 backdrop-blur-md"
        style={{
          borderBottom: "1px solid var(--site-border)",
          background: "color-mix(in srgb, var(--site-background) 88%, transparent)",
        }}
      >
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-6 py-4">
          <Link href={basePath} className="flex items-center gap-3">
            {logoUrl !== null ? (
              /* eslint-disable-next-line @next/next/no-img-element -- a signed
                 Storage URL, whose host is not known at build time. */
              <img
                src={logoUrl}
                alt={identity.name}
                className="h-9 w-auto max-w-[180px] object-contain"
              />
            ) : (
              <span
                className="text-lg font-semibold tracking-tight"
                style={{ color: "var(--site-primary)" }}
              >
                {identity.name}
              </span>
            )}
          </Link>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            {navigation.length > 0 ? (
              <nav aria-label="Principal">
                <ul className="flex flex-wrap items-center gap-x-5 gap-y-1">
                  {navigation.map((item) => (
                    <li key={item.id}>
                      <Link
                        href={localise(item.href)}
                        className="text-sm font-medium transition-opacity hover:opacity-70"
                      >
                        {item.label}
                      </Link>
                      {item.children.length > 0 ? (
                        <ul className="mt-0.5 flex flex-wrap gap-3">
                          {item.children.map((child) => (
                            <li key={child.id}>
                              <Link
                                href={localise(child.href)}
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
