import Link from "next/link";
import { IconClock, IconTruck } from "@/components/ui/icons";
import { formatCurrency } from "@/lib/money";
import { signAssetPaths } from "@/lib/storage/sign";
import { PROVIDER_LABELS } from "@/modules/online-payments/credentials";
import { getPublicPaymentGateway } from "@/modules/online-payments/server/queries";
import { getPublicIdentity } from "@/modules/seo/server/queries";
import {
  getPublicStorefront,
  listPublicDeliveryZones,
  listPublicMenu,
  listPublicPaymentMethods,
} from "../server/queries";
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
