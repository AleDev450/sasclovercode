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
import { NavItemActions, NavItemForm } from "@/modules/cms/components/nav-editor";
import { listNavItems, listPages } from "@/modules/cms/server/admin-queries";

export const metadata = { title: "Navegacion" };

export default async function NavigationPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
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

  const [items, pages] = await Promise.all([listNavItems(tenant.id), listPages(tenant.id)]);

  const tops = items.filter((item) => item.parentId === null);
  const childrenOf = (id: string) => items.filter((item) => item.parentId === id);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Navegacion</h1>
        <p className="text-muted-foreground text-sm">Menu del sitio publico. Admite dos niveles.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle as="h2">Anadir elemento</CardTitle>
          <CardDescription>
            Un elemento que apunta a una pagina en borrador no se muestra al publico.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <NavItemForm
            tenantSlug={tenant.slug}
            pages={pages.map((page) => ({ id: page.id, title: page.title, slug: page.slug }))}
            parents={tops}
          />
        </CardContent>
      </Card>

      {items.length === 0 ? (
        <EmptyState
          title="El menu esta vacio"
          description="Anade el primer elemento para que aparezca en el sitio."
        />
      ) : (
        <Card>
          <CardContent className="pt-6">
            <ul className="flex flex-col gap-4">
              {tops.map((item) => (
                <li key={item.id} className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="flex items-center gap-2 text-sm font-medium">
                      {item.label}
                      <Badge variant={item.isActive ? "success" : "neutral"}>
                        {item.isActive ? "Activo" : "Oculto"}
                      </Badge>
                      <span className="text-muted-foreground font-mono text-xs font-normal">
                        {item.target}
                      </span>
                    </span>
                    <NavItemActions tenantSlug={tenant.slug} item={item} />
                  </div>

                  {childrenOf(item.id).length > 0 ? (
                    <ul className="border-border ml-4 flex flex-col gap-2 border-l pl-4">
                      {childrenOf(item.id).map((child) => (
                        <li
                          key={child.id}
                          className="flex flex-wrap items-center justify-between gap-3"
                        >
                          <span className="flex items-center gap-2 text-sm">
                            {child.label}
                            <Badge variant={child.isActive ? "success" : "neutral"}>
                              {child.isActive ? "Activo" : "Oculto"}
                            </Badge>
                          </span>
                          <NavItemActions tenantSlug={tenant.slug} item={child} />
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
