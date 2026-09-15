import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
  buttonVariants,
} from "@/components/ui";
import { IconArrowRight, IconGlobe, IconLayout, IconPalette } from "@/components/ui/icons";
import { PERMISSIONS } from "@/lib/permissions";
import { hasPermission } from "@/lib/permissions/check";
import { MODULES } from "@/lib/features";
import { hasFeature } from "@/lib/features/check";
import { requireActiveTenant } from "@/lib/tenant/active";
import { CreatePageForm, PageCard } from "@/modules/cms/components/page-list";
import { listPages } from "@/modules/cms/server/admin-queries";

export const metadata = { title: "Contenido" };

export default async function ContentPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
  const { tenantSlug } = await params;
  const tenant = await requireActiveTenant(tenantSlug);

  // Phase 21: the plan decides before the person does. 404, not 403 - the
  // same posture every permission guard here takes toward a section that is
  // not yours to know about.
  if (!(await hasFeature(tenant.id, MODULES.WEBSITE))) {
    notFound();
  }

  // The nav hides this entry without the permission, but hiding is cosmetic
  // (master section 45): a typed URL lands here, so the page checks too.
  if (!(await hasPermission(tenant.id, PERMISSIONS.CONTENT_MANAGE))) {
    notFound();
  }

  const pages = await listPages(tenant.id);
  const hasHome = pages.some((page) => page.slug === "inicio");

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Paginas"
        description={`El sitio publico de ${tenant.name}. Cada pagina se compone de secciones que puedes ordenar y esconder.`}
        actions={
          <>
            <Link
              href={`/dashboard/${tenant.slug}/configuracion/tema`}
              className={buttonVariants({ variant: "ghost", size: "sm" })}
            >
              <IconPalette />
              Diseno y marca
            </Link>
            <Link
              href={`/vista/${tenant.slug}`}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <IconGlobe />
              Ver mi web
              <IconArrowRight />
            </Link>
          </>
        }
      />

      {/*
        The one piece of structure a site cannot do without.

        `/sitio` renders the page whose slug is `inicio`, so a business with
        pages but no `inicio` has a website whose front door is an empty state -
        and nothing anywhere said so. Saying it here is cheaper than letting
        them discover it from a customer.
      */}
      {pages.length > 0 && !hasHome ? (
        <Card variant="brand">
          <CardHeader>
            <CardTitle as="h2">Te falta la portada</CardTitle>
            <CardDescription>
              La portada es la pagina con el enlace <code className="font-mono">inicio</code>. Sin
              ella, quien entre a tu web no vera nada. Creala abajo.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {pages.length === 0 ? (
        <EmptyState
          title="Aun no hay paginas"
          description="Empieza por la portada: crea una pagina con el enlace inicio y anade tu carta."
          icon={<IconLayout className="size-8" />}
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {pages.map((page) => (
            <li key={page.id}>
              <PageCard tenantSlug={tenant.slug} page={page} />
            </li>
          ))}
        </ul>
      )}

      <Card>
        <CardHeader>
          <CardTitle as="h2">Nueva pagina</CardTitle>
          <CardDescription>Se crea en borrador: nadie la vera hasta publicarla.</CardDescription>
        </CardHeader>
        <CardContent>
          <CreatePageForm tenantSlug={tenant.slug} />
        </CardContent>
      </Card>
    </div>
  );
}
