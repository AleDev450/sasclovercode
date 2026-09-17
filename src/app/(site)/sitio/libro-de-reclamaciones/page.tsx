import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSiteContext } from "@/modules/cms/server/site-context";
import { ComplaintBookView } from "@/modules/legal/components/views";

export const metadata: Metadata = {
  title: "Libro de Reclamaciones",
  description:
    "Registra tu reclamo o queja. Libro de Reclamaciones virtual conforme al Código de Protección y Defensa del Consumidor.",
  alternates: { canonical: "/sitio/libro-de-reclamaciones" },
};

export default async function ComplaintBookPage() {
  const site = await getSiteContext();
  if (site === null || !site.isServing) notFound();

  return (
    <ComplaintBookView tenantId={site.tenant.id} tenantName={site.tenant.name} basePath="/sitio" />
  );
}
