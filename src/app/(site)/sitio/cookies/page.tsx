import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSiteContext } from "@/modules/cms/server/site-context";
import { LegalDocumentView } from "@/modules/legal/components/views";

export const metadata: Metadata = {
  title: "Política de cookies",
  alternates: { canonical: "/sitio/cookies" },
};

export default async function LegalPage() {
  const site = await getSiteContext();
  if (site === null || !site.isServing) notFound();

  return (
    <LegalDocumentView
      tenantId={site.tenant.id}
      tenantName={site.tenant.name}
      basePath="/sitio"
      kind="cookies"
    />
  );
}
