import Link from "next/link";
import { IconClock, IconTruck } from "@/components/ui/icons";
import { formatCurrency } from "@/lib/money";
import { signAssetPaths } from "@/lib/storage/sign";
import { PROVIDER_LABELS } from "@/modules/online-payments/credentials";
import { getPublicPaymentGateway } from "@/modules/online-payments/server/queries";
import { listPublicLocations } from "@/modules/locations/server/queries";
import { getPublicIdentity } from "@/modules/seo/server/queries";
import {
  getPublicStorefront,
  listPublicDeliveryZones,
  listPublicMenu,
  listPublicPaymentMethods,
} from "../server/queries";
import { summarizeWeek } from "../hours";
import { whatsappUrl } from "../whatsapp";
import { CheckoutForm } from "./checkout-form";
import { MenuBrowser, type MenuProductView } from "./menu-browser";
import { PageHeading } from "./page-heading";
import {
  buttonClass,
  displayStyle,
  mutedStyle,
  primaryButtonStyle,
  subtleStyle,
} from "./site-styles";

/**
 * The fixed pages of a restaurant site, as views that take their tenant.
 *
 * Like `SiteChrome`, they receive the tenant instead of reading the hostname, so
 * the public routes under `/sitio` and the dashboard preview under `/vista`
 * render the same page. The routes are one line each.
 */

interface ViewProps {
  readonly tenantId: string;
  readonly tenantName: string;
  readonly basePath: string;
}

/* -------------------------------------------------------------------------- */
/*  Nuestra carta                                                              */
/* -------------------------------------------------------------------------- */

export async function MenuView({ tenantId, tenantName }: ViewProps) {
  const [menu, identity] = await Promise.all([
    listPublicMenu(tenantId),
    getPublicIdentity(tenantId, tenantName),
  ]);

  const imagePaths = menu.products
    .map((product) => product.imagePath)
    .filter((path): path is string => path !== null);
  const urls = await signAssetPaths(imagePaths);

  const products: MenuProductView[] = menu.products.map((product) => ({
    ...product,
    imageUrl: product.imagePath === null ? null : (urls.get(product.imagePath) ?? null),
  }));

  return (
    <div className="pb-8">
      <PageHeading
        eyebrow="Carta"
        title="Nuestra carta"
        description="Todo se prepara al momento. Elige tus favoritos y arma tu pedido."
      />
      <MenuBrowser categories={menu.categories} products={products} currency={identity.currency} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Zonas de delivery                                                          */
/* -------------------------------------------------------------------------- */

export async function DeliveryZonesView({ tenantId, tenantName, basePath }: ViewProps) {
  const [zones, storefront, identity] = await Promise.all([
    listPublicDeliveryZones(tenantId),
    getPublicStorefront(tenantId),
    getPublicIdentity(tenantId, tenantName),
  ]);

  return (
    <div className="pb-8">
      <PageHeading
        eyebrow="Delivery"
        title="Zonas de delivery"
        description={
          storefront.acceptsDelivery && zones.length > 0
            ? "Estos son los distritos a los que llevamos tu pedido y lo que cuesta el envío."
            : "Por ahora no hacemos delivery desde la web."
        }
      />

      {storefront.acceptsDelivery && zones.length > 0 ? (
        <ul className="mx-auto grid max-w-4xl gap-4 sm:grid-cols-2">
          {zones.map((zone) => (
            <li
              key={zone.id}
              className="flex flex-col gap-3 p-6"
              style={{
                border: "1px solid var(--site-border)",
                borderRadius: "var(--site-radius)",
                background: "var(--site-surface)",
              }}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-xl" style={displayStyle}>
                    {zone.name}
                  </h2>
                  {zone.district !== null && zone.district !== zone.name ? (
                    <p className="text-sm" style={subtleStyle}>
                      {zone.district}
                    </p>
                  ) : null}
                </div>
                <span
                  className="shrink-0 text-lg font-semibold tabular-nums"
                  style={{ color: "var(--site-primary)" }}
                >
                  {zone.feeCents === 0
                    ? "Gratis"
                    : formatCurrency(zone.feeCents, identity.currency)}
                </span>
              </div>

              <ul className="flex flex-col gap-1.5 text-sm" style={mutedStyle}>
                {zone.minOrderFreeCents !== null && zone.feeCents > 0 ? (
                  <li className="flex items-center gap-2">
                    <IconTruck className="size-4 shrink-0" />
                    Gratis desde {formatCurrency(zone.minOrderFreeCents, identity.currency)}
                  </li>
                ) : null}
                {zone.estimatedMinutes !== null ? (
                  <li className="flex items-center gap-2">
                    <IconClock className="size-4 shrink-0" />
                    Llega en unos {zone.estimatedMinutes} minutos
                  </li>
                ) : null}
                {zone.notes !== null ? <li>{zone.notes}</li> : null}
              </ul>
            </li>
          ))}
        </ul>
      ) : null}

      {storefront.acceptsPickup ? (
        <p className="mx-auto mt-10 max-w-prose text-center text-sm" style={mutedStyle}>
          ¿Tu zona no está en la lista? También puedes pedir y recoger en nuestro local.
        </p>
      ) : null}

      <div className="mt-8 flex justify-center">
        <Link href={`${basePath}/carta`} className={buttonClass} style={primaryButtonStyle}>
          Ver la carta
        </Link>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Contacto                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The contact page, which stores nothing of its own.
 *
 * WHY IT IS A ROUTE AND NOT A SECTION TYPE. Everything on it - the address, the
 * phone, the WhatsApp, the email, the week's hours - is already a field of the
 * business, typed once in Configuracion and printed in the footer of every
 * page. A `contact` section would have meant a restaurant that moves has two
 * places to change its address and no way of knowing it missed one. It is the
 * same reasoning that made "Zonas de delivery" a route: a fixed page of a
 * restaurant site, assembled from what the business already told us.
 *
 * THE MAP IS A LINK, NOT AN EMBED. An iframe would mean widening `frame-src` in
 * the CSP for a third party on every tenant page, and handing that third party
 * the IP of every visitor, to save one tap.
 */
export async function ContactView({ tenantId, tenantName, basePath }: ViewProps) {
  const [identity, storefront, locations] = await Promise.all([
    getPublicIdentity(tenantId, tenantName),
    getPublicStorefront(tenantId),
    listPublicLocations(tenantId),
  ]);

  const branch =
    locations.find((location) => location.id === storefront.locationId) ?? locations[0];
  const hours = summarizeWeek(branch?.shifts ?? []);

  const addressParts = [identity.addressLine, identity.district, identity.city].filter(
    (part): part is string => part !== null && part.length > 0,
  );
  const address = addressParts.length > 0 ? addressParts.join(", ") : null;

  const greeting =
    storefront.whatsappMessage ?? `¡Hola ${identity.name}! Quisiera hacer un pedido.`;
  const whatsappHref = whatsappUrl(storefront.whatsapp, greeting);

  const mapHref =
    address === null
      ? null
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;

  const rows: { label: string; value: string; href: string | null }[] = [
    ...(address !== null ? [{ label: "Direccion", value: address, href: mapHref }] : []),
    ...(identity.phone !== null
      ? [
          {
            label: "Telefono",
            value: identity.phone,
            href: `tel:${identity.phone.replace(/[^0-9+]/g, "")}`,
          },
        ]
      : []),
    ...(whatsappHref !== null
      ? [{ label: "WhatsApp", value: storefront.whatsapp ?? "", href: whatsappHref }]
      : []),
    ...(storefront.publicEmail !== null
      ? [
          {
            label: "Correo",
            value: storefront.publicEmail,
            href: `mailto:${storefront.publicEmail}`,
          },
        ]
      : []),
  ].filter((row) => row.value.length > 0);

  return (
    <div className="pb-8">
      <PageHeading
        eyebrow="Contacto"
        title="Hablemos"
        description="Escríbenos, llámanos o pasa por el local. Respondemos por WhatsApp en minutos."
      />

      <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-2">
        <section
          className="flex flex-col gap-6 p-8"
          style={{
            border: "var(--site-card-border)",
            background: "var(--site-card-background)",
            borderRadius: "var(--site-panel-radius)",
          }}
        >
          <h2 className="text-2xl" style={displayStyle}>
            Dónde estamos
          </h2>
          <dl className="flex flex-col gap-5">
            {rows.map((row) => (
              <div key={row.label} className="flex flex-col gap-1">
                <dt
                  className="text-xs font-semibold"
                  style={{
                    color: "var(--site-accent)",
                    letterSpacing: "var(--site-eyebrow-tracking)",
                    textTransform: "var(--site-eyebrow-transform)" as "uppercase",
                  }}
                >
                  {row.label}
                </dt>
                <dd className="text-base" style={{ color: "var(--site-foreground)" }}>
                  {row.href === null ? (
                    row.value
                  ) : (
                    <a
                      href={row.href}
                      {...(row.href.startsWith("https://")
                        ? { target: "_blank", rel: "noreferrer noopener" }
                        : {})}
                      className="underline-offset-4 transition-opacity hover:underline hover:opacity-80"
                    >
                      {row.value}
                    </a>
                  )}
                </dd>
              </div>
            ))}
          </dl>

          {mapHref !== null ? (
            <a
              href={mapHref}
              target="_blank"
              rel="noreferrer noopener"
              className={buttonClass}
              style={primaryButtonStyle}
            >
              Cómo llegar
            </a>
          ) : null}
        </section>

        <section
          className="flex flex-col gap-6 p-8"
          style={{
            border: "var(--site-card-border)",
            background: "var(--site-card-background)",
            borderRadius: "var(--site-panel-radius)",
          }}
        >
          <h2 className="text-2xl" style={displayStyle}>
            Horario de atención
          </h2>
          {hours.length > 0 ? (
            <dl className="flex flex-col gap-3">
              {hours.map((row) => (
                <div key={row.days} className="flex items-baseline justify-between gap-4">
                  <dt style={mutedStyle}>{row.days}</dt>
                  <span
                    aria-hidden
                    className="min-w-4 flex-1"
                    style={{ borderBottom: "1px solid var(--site-border)" }}
                  />
                  <dd className="tabular-nums" style={{ color: "var(--site-foreground)" }}>
                    {row.hours}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p style={mutedStyle}>Consúltanos el horario por WhatsApp.</p>
          )}

          <div className="mt-auto flex flex-wrap gap-3">
            <Link href={`${basePath}/carta`} className={buttonClass} style={primaryButtonStyle}>
              Ver la carta
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Checkout                                                                   */
/* -------------------------------------------------------------------------- */

export async function CheckoutView({
  tenantId,
  tenantName,
  basePath,
  preview = false,
}: ViewProps & { preview?: boolean }) {
  const [storefront, zones, methods, menu, identity, gateway] = await Promise.all([
    getPublicStorefront(tenantId),
    listPublicDeliveryZones(tenantId),
    listPublicPaymentMethods(tenantId),
    listPublicMenu(tenantId),
    getPublicIdentity(tenantId, tenantName),
    getPublicPaymentGateway(tenantId),
  ]);

  return (
    <div className="pb-8">
      <PageHeading eyebrow="Pedir ahora" title="Completa tu pedido" />
      <CheckoutForm
        basePath={basePath}
        businessName={identity.name}
        currency={identity.currency}
        preview={preview}
        onlinePaymentLabel={gateway === null ? null : PROVIDER_LABELS[gateway.provider]}
        storefront={{
          canOrder: storefront.canOrder,
          orderingEnabled: storefront.orderingEnabled,
          closedMessage: storefront.closedMessage,
          acceptsDelivery: storefront.acceptsDelivery && zones.length > 0,
          acceptsPickup: storefront.acceptsPickup,
          minOrderCents: storefront.minOrderCents,
          whatsapp: storefront.whatsapp,
        }}
        zones={zones}
        paymentMethods={methods}
        pickupAddress={
          [identity.addressLine, identity.district].filter((part) => part !== null).join(", ") ||
          null
        }
        menu={menu.products.map((product) => ({
          id: product.id,
          name: product.name,
          basePriceCents: product.basePriceCents,
          isAvailable: product.isAvailable,
          variants: product.variants,
          options: product.options,
        }))}
      />
    </div>
  );
}
