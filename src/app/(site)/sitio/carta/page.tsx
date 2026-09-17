import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSiteContext } from "@/modules/cms/server/site-context";
import { MenuView } from "@/modules/storefront/components/views";

/**
 * Nuestra carta (Phase 29).
 *
 * A static segment, so it wins over `[pageSlug]`: a CMS page that happens to be
 * called `carta` cannot shadow the menu of a restaurant.
 */
export const metadata: Metadata = {
  title: "Nuestra carta",
  description: "Todos nuestros platos, preparados al momento. Arma tu pedido online.",
  alternates: { canonical: "/sitio/carta" },
};

export default async function MenuPage() {
  const site = await getSiteContext();
  if (site === null || !site.isServing) notFound();

  return <MenuView tenantId={site.tenant.id} tenantName={site.tenant.name} basePath="/sitio" />;
}
