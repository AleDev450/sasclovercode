import type { ReactNode } from "react";
import { listPublicLocations } from "@/modules/locations/server/queries";
import { canonicalUrl, resolveSeo } from "@/modules/seo/metadata";
import {
  getPrimaryDomain,
  getPublicIdentity,
  getPublicTheme,
  getSiteSeo,
} from "@/modules/seo/server/queries";
import { JsonLd, localBusinessJsonLd } from "@/modules/seo/structured-data";
import { SITE_FONT_CLASSNAME } from "@/modules/seo/fonts";
import { themeCssVariables } from "@/modules/seo/theme";
import { CartDrawer } from "@/modules/storefront/components/cart-drawer";
import { CartProvider } from "@/modules/storefront/components/cart-provider";
import { SiteFooter, type FooterLink } from "@/modules/storefront/components/site-footer";
import { SiteHeader, type HeaderNavItem } from "@/modules/storefront/components/site-header";
import { WhatsAppButton } from "@/modules/storefront/components/whatsapp-button";
import { summarizeWeek } from "@/modules/storefront/hours";
import {
  getPublicStorefront,
  listPublicDeliveryZones,
  listPublicSocialLinks,
} from "@/modules/storefront/server/queries";
import { whatsappUrl } from "@/modules/storefront/whatsapp";
import { cn } from "@/lib/utils";
import { signAssetPaths } from "@/lib/storage/sign";
import { getPublicNavigation } from "../server/public-queries";
import type { SiteContext } from "../server/site-context";

/**
 * The frame around a tenant's website: header, navigation, footer, theme - and,
 * since Phase 29, the cart.
 *
 * WHY IT IS A COMPONENT AND NOT JUST THE LAYOUT. It was the layout, and the
 * layout resolves its tenant from the HOSTNAME - which is the correct and only
 * way a visitor's request can be answered. It stops being enough the moment
 * somebody inside the dashboard wants to look at what they just edited, because
 * the dashboard lives on one hostname (master section 28) and that hostname
 * belongs to no tenant. Taking the tenant as an argument lets the same markup
 * serve both.
 *
 * THE STRUCTURE IS A RESTAURANT'S (Phase 29). The owner asked for every theme
 * to have the structure of their Sugu Rolls site: Inicio and Nuestra carta
 * always, Zonas de delivery when they deliver, the pages they add to the menu in
 * between, "Pedir ahora" in the header, WhatsApp floating, and a footer with the
 * policies, the hours and the Libro de Reclamaciones. The three themes change
 * how that looks, never what is there.
 *
 * THE THEME TRAVELS AS CSS CUSTOM PROPERTIES on one element's `style`
 * attribute, never as a generated stylesheet. React escapes a style object, so
 * no stored value can end the attribute or open a rule - see the header of
 * `modules/seo/theme.ts`. The same element carries `SITE_FONT_CLASSNAME`, which
 * declares the `--font-*` variables the theme's stacks resolve against.
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
   * Where this site's own links point: `/sitio` on a real visit, `/vista/{slug}`
   * in the dashboard preview.
   */
  basePath?: string;
}) {
  const tenantId = site.tenant.id;

  const [navigation, theme, identity, seo, domain, locations, storefront, social, zones] =
    await Promise.all([
      getPublicNavigation(tenantId),
      getPublicTheme(tenantId),
      getPublicIdentity(tenantId, site.tenant.name),
      getSiteSeo(tenantId),
      getPrimaryDomain(tenantId),
      listPublicLocations(tenantId),
      getPublicStorefront(tenantId),
      listPublicSocialLinks(tenantId),
      listPublicDeliveryZones(tenantId),
    ]);

  const resolved = resolveSeo({ site: seo, business: identity, tenantIsServing: true });
  const base = domain ?? site.tenant.domain;

  /** Moves a stored `/sitio/...` link onto whichever base this render uses. */
  const localise = (href: string): string =>
    href === "/sitio" || href.startsWith("/sitio/") ? `${basePath}${href.slice(6)}` : href;

  const logoUrl =
    theme.logoPath === null
      ? null
      : ((await signAssetPaths([theme.logoPath])).get(theme.logoPath) ?? null);

  const hasDelivery = storefront.acceptsDelivery && zones.length > 0;

  /*
   * The menu: the fixed restaurant entries around whatever pages the owner put
   * in their own navigation. A stored entry pointing at the home page or at the
   * menu is dropped rather than drawn twice.
   */
  const fixedHrefs = new Set([
    "/sitio",
    "/sitio/inicio",
    "/sitio/carta",
    "/sitio/zonas-de-delivery",
  ]);
  const custom: HeaderNavItem[] = navigation
    .filter((item) => !fixedHrefs.has(item.href))
    .map((item) => ({
      label: item.label,
      href: localise(item.href),
      children: item.children.map((child) => ({ label: child.label, href: localise(child.href) })),
    }));

  const nav: HeaderNavItem[] = [
    { label: "Inicio", href: basePath, children: [] },
    { label: "Nuestra carta", href: `${basePath}/carta`, children: [] },
    ...custom,
    ...(hasDelivery
      ? [{ label: "Zonas de delivery", href: `${basePath}/zonas-de-delivery`, children: [] }]
      : []),
  ];

  const quickLinks: FooterLink[] = nav.map((item) => ({ label: item.label, href: item.href }));

  const helpLinks: FooterLink[] = [
    ...(hasDelivery ? [{ label: "Zonas de delivery", href: `${basePath}/zonas-de-delivery` }] : []),
    { label: "Términos y condiciones", href: `${basePath}/terminos` },
    { label: "Política de privacidad", href: `${basePath}/privacidad` },
    { label: "Política de cookies", href: `${basePath}/cookies` },
    { label: "Libro de Reclamaciones", href: `${basePath}/libro-de-reclamaciones` },
  ];

  // The hours shown are the ordering branch's: they are the hours the website
  // is open, which is what a visitor reading this footer is asking.
  const orderingBranch =
    locations.find((location) => location.id === storefront.locationId) ?? locations[0];
  const hours = summarizeWeek(orderingBranch?.shifts ?? []);

  const addressParts = [identity.addressLine, identity.district, identity.city].filter(
    (part): part is string => part !== null && part.length > 0,
  );

  const greeting =
    storefront.whatsappMessage ?? `¡Hola ${identity.name}! Quisiera hacer un pedido.`;
  const whatsappHref = whatsappUrl(storefront.whatsapp, greeting);

  const closedMessage = !storefront.orderingEnabled
    ? "Por ahora no tomamos pedidos por la web. Escríbenos por WhatsApp."
    : (storefront.closedMessage ??
      "Estamos cerrados en este momento. Puedes ver la carta y volver en nuestro horario de atención.");

  return (
    <div
      className={cn("flex min-h-dvh flex-col overflow-x-clip", SITE_FONT_CLASSNAME)}
      style={{
        ...themeCssVariables(theme),
        background: "var(--site-background)",
        color: "var(--site-foreground)",
        fontFamily: "var(--site-font)",
        letterSpacing: "var(--site-body-tracking)",
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

      <CartProvider tenantId={tenantId}>
        {banner}

        <SiteHeader
          basePath={basePath}
          name={identity.name}
          logoUrl={logoUrl}
          nav={nav}
          isOpen={storefront.isOpen}
          showStatus={storefront.orderingEnabled}
        />

        {/*
          Wide enough for three dishes across on a large screen. Full-bleed
          blocks (the slider) break out of it on purpose; `overflow-x-clip` on
          the root is what keeps that from adding a horizontal scrollbar.
        */}
        <main className="mx-auto w-full max-w-6xl flex-1 px-6 sm:px-10">{children}</main>

        <SiteFooter
          basePath={basePath}
          name={identity.name}
          logoUrl={logoUrl}
          tagline={storefront.tagline}
          social={social}
          quickLinks={quickLinks}
          helpLinks={helpLinks}
          address={addressParts.length > 0 ? addressParts.join(", ") : null}
          phone={identity.phone}
          whatsappHref={whatsappHref}
          email={storefront.publicEmail}
          hours={hours}
        />

        <CartDrawer
          basePath={basePath}
          currency={identity.currency}
          canOrder={storefront.canOrder}
          closedMessage={closedMessage}
        />

        {storefront.whatsappButton && whatsappHref !== null ? (
          <WhatsAppButton href={whatsappHref} businessName={identity.name} />
        ) : null}
      </CartProvider>
    </div>
  );
}
