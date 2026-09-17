import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSiteContext } from "@/modules/cms/server/site-context";
import { DeliveryZonesView } from "@/modules/storefront/components/views";

export const metadata: Metadata = {
  title: "Zonas de delivery",
  description: "Los distritos a los que llevamos tu pedido y lo que cuesta el envío.",
  alternates: { canonical: "/sitio/zonas-de-delivery" },
};

export default async function DeliveryZonesPage() {
  const site = await getSiteContext();
  if (site === null || !site.isServing) notFound();

  return (
    <DeliveryZonesView tenantId={site.tenant.id} tenantName={site.tenant.name} basePath="/sitio" />
  );
}
