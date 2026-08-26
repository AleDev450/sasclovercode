import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
} from "@/components/ui";
import { PERMISSIONS } from "@/lib/permissions";
import { hasPermission } from "@/lib/permissions/check";
import { requireActiveTenant } from "@/lib/tenant/active";
import { CreatePageForm, PageRow } from "@/modules/cms/components/page-list";
import { listPages } from "@/modules/cms/server/admin-queries";

export const metadata = { title: "Contenido" };

export default async function ContentPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
  const { tenantSlug } = await params;
  const tenant = await requireActiveTenant(tenantSlug);

  // The nav hides this entry without the permission, but hiding is cosmetic
  // (master section 45): a typed URL lands here, so the page checks too.
  if (!(await hasPermission(tenant.id, PERMISSIONS.CONTENT_MANAGE))) {
    notFound();
  }

  const pages = await listPages(tenant.id);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Contenido</h1>
          <p className="text-muted-foreground text-sm">
            Paginas del sitio publico de {tenant.name}.
          </p>
        </div>
        {/* Static segment, so it never collides with `/contenido/[pageId]`:
            page ids are uuids and Next.js matches a literal segment first. */}
        <Link
          href={`/dashboard/${tenant.slug}/contenido/seo`}
          className="text-muted-foreground hover:text-foreground text-sm"
        >
          SEO del sitio
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle as="h2">Nueva pagina</CardTitle>
          <CardDescription>Se crea en borrador: nadie la vera hasta publicarla.</CardDescription>
        </CardHeader>
        <CardContent>
          <CreatePageForm tenantSlug={tenant.slug} />
        </CardContent>
      </Card>

      {pages.length === 0 ? (
        <EmptyState
          title="Aun no hay paginas"
          description="Crea la primera para empezar a construir el sitio."
        />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[36rem] border-collapse text-sm">
            <caption className="sr-only">Paginas de {tenant.name}</caption>
            <thead>
              <tr className="border-border text-muted-foreground border-b text-left text-xs">
                <th scope="col" className="px-4 py-3 font-medium">
                  Pagina
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Estado
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Secciones
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Accion
                </th>
              </tr>
            </thead>
            <tbody>
              {pages.map((page) => (
                <PageRow key={page.id} tenantSlug={tenant.slug} page={page} />
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
