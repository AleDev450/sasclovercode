import { PageHeading } from "@/modules/storefront/components/page-heading";
import type { LegalDocumentKind } from "@/types/database";
import { getPublicLegalDocument, getPublicLegalIdentity } from "../server/queries";
import { LEGAL_TITLES } from "../templates";
import { ComplaintForm } from "./complaint-form";
import { LegalText } from "./legal-text";

/**
 * The legal pages of a restaurant site, as views that take their tenant - the
 * same shape as the storefront views, so `/sitio/...` and the `/vista` preview
 * render the same page.
 */

interface ViewProps {
  readonly tenantId: string;
  readonly tenantName: string;
  readonly basePath: string;
}

export async function LegalDocumentView({
  tenantId,
  tenantName,
  kind,
}: ViewProps & { kind: LegalDocumentKind }) {
  const identity = await getPublicLegalIdentity(tenantId, tenantName);
  const document = await getPublicLegalDocument(tenantId, kind, identity);

  const updated =
    document.updatedAt === null
      ? null
      : new Intl.DateTimeFormat("es-PE", { dateStyle: "long", timeZone: "America/Lima" }).format(
          new Date(document.updatedAt),
        );

  return (
    <article className="mx-auto max-w-3xl pb-8">
      <PageHeading
        eyebrow={identity.name}
        title={LEGAL_TITLES[kind]}
        description={updated !== null ? `Última actualización: ${updated}` : undefined}
      />
      <LegalText source={document.body} />
    </article>
  );
}

export async function ComplaintBookView({
  tenantId,
  tenantName,
  preview = false,
}: ViewProps & { preview?: boolean }) {
  const identity = await getPublicLegalIdentity(tenantId, tenantName);

  return (
    <div className="mx-auto max-w-3xl pb-8">
      <PageHeading
        eyebrow="Código de Protección y Defensa del Consumidor"
        title="Libro de Reclamaciones"
        description="Conforme a la ley, cuentas con este Libro de Reclamaciones virtual. Te responderemos en un plazo máximo de 15 días hábiles."
      />
      <ComplaintForm
        provider={{
          name: identity.legalName ?? identity.name,
          taxId: identity.taxId,
          address: identity.address,
        }}
        preview={preview}
      />
    </div>
  );
}
