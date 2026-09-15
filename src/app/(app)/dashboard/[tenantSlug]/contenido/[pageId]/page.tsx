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
  PageHeader,
  buttonVariants,
} from "@/components/ui";
import { IconArrowRight, IconGlobe, IconLayout } from "@/components/ui/icons";
import { PERMISSIONS } from "@/lib/permissions";
import { hasPermission } from "@/lib/permissions/check";
import { MODULES } from "@/lib/features";
import { hasFeature } from "@/lib/features/check";
import { requireActiveTenant } from "@/lib/tenant/active";
import {
  AddSectionPanel,
  SectionCard,
  type CategoryChoice,
} from "@/modules/cms/components/section-editor";
import { getPageWithSections } from "@/modules/cms/server/admin-queries";
import { listCategories } from "@/modules/catalog/server/queries";
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

  /*
   * The categories the `products` section may point at.
   *
   * Read here and passed down so the editor offers a LIST instead of asking
   * somebody to type a slug they have to go and look up - and so a section can
   * never point at a category that does not exist. Skipped entirely when the
   * business has no catalogue module: there would be nothing to offer.
   */
  const categories: CategoryChoice[] = (await hasFeature(tenant.id, MODULES.CATALOG))
    ? (await listCategories(tenant.id))
        .filter((category) => category.isActive)
        .map((category) => ({ slug: category.slug, name: category.name }))
    : [];

  const contentHref = `/dashboard/${tenant.slug}/contenido`;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow={
          <Link
            href={contentHref}
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm"
          >
            <IconLayout className="size-3.5" />
            Paginas
          </Link>
        }
        title={page.title}
        description={`Ruta publica: /sitio/${page.slug}`}
        actions={
          <>
            <Badge variant={page.status === "published" ? "success" : "neutral"} dot>
              {page.status === "published" ? "Publicada" : "Borrador"}
            </Badge>
            <Link
              href={`/vista/${tenant.slug}/${page.slug}`}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <IconGlobe />
              Ver como cliente
              <IconArrowRight />
            </Link>
          </>
        }
      />

      {/* ------------------------------------------------------- the sections */}
      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold tracking-tight">Secciones</h2>
          <p className="text-muted-foreground text-sm">
            Se muestran en este orden. Usa las flechas para moverlas y el ojo para esconder una sin
            borrarla.
          </p>
        </div>

        {sections.length === 0 ? (
          <EmptyState
            title="Esta pagina esta vacia"
            description="Anade una portada para empezar, y despues tus productos. Puedes cambiar el orden cuando quieras."
            icon={<IconLayout className="size-8" />}
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {sections.map((section, index) => (
              <li key={section.id}>
                <SectionCard
                  tenantSlug={tenant.slug}
                  pageId={page.id}
                  section={section}
                  categories={categories}
                  index={index}
                  total={sections.length}
                />
              </li>
            ))}
          </ul>
        )}

        <div>
          <AddSectionPanel
            tenantSlug={tenant.slug}
            pageId={page.id}
            categories={categories}
            nextPosition={sections.length}
          />
        </div>
      </section>

      {/* ------------------------------------------------------------ the SEO */}
      <Card>
        <CardHeader>
          <CardTitle as="h2">SEO de esta pagina</CardTitle>
          <CardDescription>
            Como aparece en Google y al compartirla por WhatsApp. Lo que dejes vacio se hereda del
            SEO del sitio.
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
    </div>
  );
}
