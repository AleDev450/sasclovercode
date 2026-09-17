import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui";
import { MODULES } from "@/lib/features";
import { hasFeature } from "@/lib/features/check";
import { PERMISSIONS } from "@/lib/permissions";
import { hasPermission } from "@/lib/permissions/check";
import { requireActiveTenant } from "@/lib/tenant/active";
import { LegalDocumentForm } from "@/modules/legal/components/admin-forms";
import { resetLegalDocumentAction } from "@/modules/legal/server/actions";
import { getPublicLegalIdentity, listLegalDocuments } from "@/modules/legal/server/queries";
import { LEGAL_TITLES, legalTemplate } from "@/modules/legal/templates";
import type { LegalDocumentKind } from "@/types/database";

export const metadata = { title: "Textos legales" };

/** The dashboard writes without accents, like every other screen of it. */
const ADMIN_TITLES: Record<LegalDocumentKind, string> = {
  terms: "Terminos y condiciones",
  privacy: "Politica de privacidad",
  cookies: "Politica de cookies",
};

const ROUTES: Record<LegalDocumentKind, string> = {
  terms: "terminos",
  privacy: "privacidad",
  cookies: "cookies",
};

/**
 * Mi web -> Tienda online -> Textos legales (Phase 30).
 *
 * Each document starts as the platform template filled with the business's own
 * razon social, RUC and contact, and becomes the business's own text the first
 * time it is saved. "Volver a la plantilla" deletes that text.
 */
export default async function LegalDocumentsPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const tenant = await requireActiveTenant(tenantSlug);

  if (!(await hasFeature(tenant.id, MODULES.WEBSITE))) notFound();
  if (!(await hasPermission(tenant.id, PERMISSIONS.CONTENT_MANAGE))) notFound();

  const [stored, identity] = await Promise.all([
    listLegalDocuments(tenant.id),
    getPublicLegalIdentity(tenant.id, tenant.name),
  ]);

  const kinds: LegalDocumentKind[] = ["terms", "privacy", "cookies"];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link
          href={`/dashboard/${tenant.slug}/tienda`}
          className="text-muted-foreground text-sm hover:underline"
        >
          ← Tienda online
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Textos legales</h1>
        <p className="text-muted-foreground text-sm">
          Terminos y condiciones, politica de privacidad y politica de cookies de tu web.
        </p>
      </div>

      <Alert variant="warning">
        <AlertDescription>
          Las plantillas estan pensadas para como funciona tu web (pedidos sin cuenta, carrito en el
          navegador, pagos por WhatsApp) y usan tu razon social y RUC de Datos del negocio. No son
          asesoria legal: revisalas con un abogado para tu caso.
        </AlertDescription>
      </Alert>

      {identity.legalName === null || identity.taxId === null ? (
        <Alert variant="warning">
          <AlertDescription>
            Falta tu razon social o tu RUC. Completalos en{" "}
            <Link href={`/dashboard/${tenant.slug}/configuracion`} className="underline">
              Datos del negocio
            </Link>
            : aparecen en estos textos y en el Libro de Reclamaciones.
          </AlertDescription>
        </Alert>
      ) : null}

      {kinds.map((kind) => {
        const own = stored[kind];
        return (
          <Card key={kind}>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <CardTitle as="h2">{ADMIN_TITLES[kind]}</CardTitle>
                <div className="flex items-center gap-3">
                  <Badge variant={own === undefined ? "neutral" : "success"}>
                    {own === undefined ? "Plantilla" : "Texto propio"}
                  </Badge>
                  <Link
                    href={`/vista/${tenant.slug}/${ROUTES[kind]}`}
                    className="text-muted-foreground text-sm hover:underline"
                  >
                    Ver en la web
                  </Link>
                </div>
              </div>
              <CardDescription>
                {own === undefined
                  ? "Tu web muestra esta plantilla. Al guardar, pasa a ser tu propio texto."
                  : "Tu web muestra este texto."}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <LegalDocumentForm
                tenantSlug={tenant.slug}
                kind={kind}
                title={LEGAL_TITLES[kind]}
                body={own?.body ?? legalTemplate(kind, identity)}
              />
              {own !== undefined ? (
                <form action={resetLegalDocumentAction} className="flex items-center gap-2">
                  <input type="hidden" name="tenantSlug" value={tenant.slug} />
                  <input type="hidden" name="kind" value={kind} />
                  <label className="flex items-center gap-2 text-xs">
                    <input type="checkbox" required className="size-4" />
                    Confirmar
                  </label>
                  <Button type="submit" size="sm" variant="outline">
                    Volver a la plantilla
                  </Button>
                </form>
              ) : null}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
