import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui";
import { PERMISSIONS } from "@/lib/permissions";
import { hasPermission } from "@/lib/permissions/check";
import { MODULES } from "@/lib/features";
import { hasFeature } from "@/lib/features/check";
import { requireActiveTenant } from "@/lib/tenant/active";
import { SiteSeoForm } from "@/modules/seo/components/site-seo-form";
import { getSiteSeo } from "@/modules/seo/server/queries";

export const metadata = { title: "SEO del sitio" };

export default async function SiteSeoPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
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

  const seo = await getSiteSeo(tenant.id);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">SEO del sitio</h1>
          <p className="text-muted-foreground text-sm">
            Como se presenta {tenant.name} en Google y al compartir su enlace.
          </p>
        </div>
        <Link
          href={`/dashboard/${tenant.slug}/contenido`}
          className="text-muted-foreground hover:text-foreground text-sm"
        >
          Volver a contenido
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle as="h2">Identidad en buscadores</CardTitle>
          <CardDescription>
            Cada pagina puede tener su propio titulo. Lo que definas aqui es lo que usaran las
            paginas que no lo hagan.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SiteSeoForm tenantSlug={tenant.slug} seo={seo} />
        </CardContent>
      </Card>
    </div>
  );
}
