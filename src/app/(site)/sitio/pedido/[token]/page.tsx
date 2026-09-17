import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSiteContext } from "@/modules/cms/server/site-context";
import { PROVIDER_LABELS } from "@/modules/online-payments/credentials";
import { getPublicPaymentGateway } from "@/modules/online-payments/server/queries";
import { canonicalUrl } from "@/modules/seo/metadata";
import { getPrimaryDomain, getPublicIdentity } from "@/modules/seo/server/queries";
import { OrderTracking } from "@/modules/storefront/components/order-tracking";
import { getPublicStorefront, getPublicWebOrder } from "@/modules/storefront/server/queries";

export const metadata: Metadata = {
  title: "Tu pedido",
  // The URL IS the secret. Nothing about it may reach an index, a cache or a
  // referrer header.
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export default async function OrderTrackingPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const site = await getSiteContext();
  if (site === null || !site.isServing) notFound();

  const [order, identity, storefront, domain, gateway] = await Promise.all([
    getPublicWebOrder(site.tenant.id, token),
    getPublicIdentity(site.tenant.id, site.tenant.name),
    getPublicStorefront(site.tenant.id),
    getPrimaryDomain(site.tenant.id),
    getPublicPaymentGateway(site.tenant.id),
  ]);

  if (order === null) notFound();

  return (
    <OrderTracking
      order={order}
      basePath="/sitio"
      businessName={identity.name}
      currency={identity.currency}
      whatsapp={storefront.whatsapp}
      trackingUrl={canonicalUrl(domain ?? site.tenant.domain, `/sitio/pedido/${token}`)}
      token={token}
      onlinePaymentLabel={gateway === null ? null : PROVIDER_LABELS[gateway.provider]}
    />
  );
}
