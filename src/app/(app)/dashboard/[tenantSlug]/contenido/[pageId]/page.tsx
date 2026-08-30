import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
} from "@/components/ui";
import { PERMISSIONS } from "@/lib/permissions";
import { hasPermission } from "@/lib/permissions/check";
import { MODULES } from "@/lib/features";
import { hasFeature } from "@/lib/features/check";
import { requireActiveTenant } from "@/lib/tenant/active";
import { DeleteSectionForm, SectionEditor } from "@/modules/cms/components/section-editor";
import { getPageWithSections } from "@/modules/cms/server/admin-queries";
import { SECTION_LABELS } from "@/modules/cms/sections";
import { PageSeoForm } from "@/modules/seo/components/page-seo-form";

export const metadata = { title: "Editor de pagina" };

export default async function PageEditorPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; pageId: string }>;
}) {
  const { tenantSlug, pageId } = await params;
  const tenant = await requireActiveTenant(tenantSlug);

  // Phase 21: the plan decides before the person does. 404, not 403 - the
  // same posture every permission guard here takes toward a section that is
  // not yours to know about.
  if (!(await hasFeature(tenant.id, MODULES.WEBSITE))) {
    notFound();
  }

  if (!(await hasPermission(tenant.id, PERMISSIONS.CONTENT_MANAGE))) {
    notFound();
  }

  const result = await getPageWithSections(tenant.id, pageId);
  if (result === null) notFound();

  const { page, sections } = result;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{page.title}</h1>
          <p className="text-muted-foreground font-mono text-sm">/{page.slug}</p>
        </div>
        <Badge variant={page.status === "published" ? "success" : "neutral"}>
          {page.status === "published" ? "Publicada" : "Borrador"}
        </Badge>
      </div>

      {sections.length === 0 ? (
        <EmptyState
          title="Esta pagina no tiene secciones"
          description="Anade la primera con el formulario de abajo."
        />
      ) : (
        <ul className="flex flex-col gap-4">
          {sections.map((section) => (
            <li key={section.id} className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-4">
                <h2 className="text-sm font-medium">
                  {SECTION_LABELS[section.type]}{" "}
                  <span className="text-muted-foreground font-normal">
                    (orden {section.position})
                  </span>
                </h2>
                <DeleteSectionForm
                  tenantSlug={tenant.slug}
                  pageId={page.id}
                  sectionId={section.id}
                />
              </div>
              <SectionEditor tenantSlug={tenant.slug} pageId={page.id} section={section} />
            </li>
          ))}
        </ul>
      )}

      <Card>
        <CardHeader>
          <CardTitle as="h2">SEO de esta pagina</CardTitle>
          <CardDescription>
            Opcional. Lo que dejes vacio se hereda del SEO del sitio.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PageSeoForm
            tenantSlug={tenant.slug}
            page={{
              id: page.id,
              seoTitle: page.seoTitle,
              seoDescription: page.seoDescription,
              ogImagePath: page.ogImagePath,
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2">Anadir seccion</CardTitle>
          <CardDescription>
            El contenido es texto estructurado. No se admite HTML en ningun campo.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SectionEditor tenantSlug={tenant.slug} pageId={page.id} />
        </CardContent>
      </Card>

      <Link
        href={`/dashboard/${tenant.slug}/contenido`}
        className="text-muted-foreground text-sm hover:underline"
      >
        Volver a contenido
      </Link>
    </div>
  );
}
