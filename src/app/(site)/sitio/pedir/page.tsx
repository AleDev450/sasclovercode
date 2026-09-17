import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSiteContext } from "@/modules/cms/server/site-context";
import { CheckoutView } from "@/modules/storefront/components/views";

export const metadata: Metadata = {
  title: "Completa tu pedido",
  // A checkout has nothing to offer a search engine, and an indexed one is a
  // result that opens on an empty cart.
  robots: { index: false, follow: false },
};

export default async function CheckoutPage() {
  const site = await getSiteContext();
  if (site === null || !site.isServing) notFound();

  return <CheckoutView tenantId={site.tenant.id} tenantName={site.tenant.name} basePath="/sitio" />;
}
