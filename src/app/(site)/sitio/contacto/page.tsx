import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSiteContext } from "@/modules/cms/server/site-context";
import { ContactView } from "@/modules/storefront/components/views";

/**
 * Contacto (Phase 29 continuation).
 *
 * A static segment, so it wins over `[pageSlug]`: a CMS page that happens to be
 * called `contacto` cannot shadow the page that carries the real address and
 * the real hours.
 */
export const metadata: Metadata = {
  title: "Contacto",
  description: "Dónde estamos, cómo escribirnos y nuestro horario de atención.",
  alternates: { canonical: "/sitio/contacto" },
};

export default async function ContactPage() {
  const site = await getSiteContext();
  if (site === null || !site.isServing) notFound();

  return <ContactView tenantId={site.tenant.id} tenantName={site.tenant.name} basePath="/sitio" />;
}
