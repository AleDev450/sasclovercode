import Link from "next/link";
import type { ComponentType } from "react";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardTitle,
  PageHeader,
  buttonVariants,
} from "@/components/ui";
import type { IconProps } from "@/components/ui/icons";
import { IconArrowRight, IconGlobe, IconPalette } from "@/components/ui/icons";
import { SYSTEM_DOMAIN } from "@/config/app";
import { getMyModules } from "@/lib/features/check";
import { getMyPermissions } from "@/lib/permissions/check";
import { requireActiveTenant } from "@/lib/tenant/active";
import { cn } from "@/lib/utils";
import { visibleNavGroups, navItemHref } from "@/modules/dashboard/navigation";
import { NAV_GLYPHS } from "@/modules/dashboard/components/nav-glyphs";

export async function generateMetadata({ params }: { params: Promise<{ tenantSlug: string }> }) {
  const { tenantSlug } = await params;
  const tenant = await requireActiveTenant(tenantSlug);
  return { title: tenant.name };
}

const ROLE_LABEL: Record<string, string> = {
  owner: "Propietario",
  admin: "Administrador",
  manager: "Encargado",
  cashier: "Cajero",
  waiter: "Mesero",
  kitchen: "Cocina",
  delivery: "Repartidor",
  accountant: "Contador",
};

/**
 * The tenant home.
 *
 * WHAT IT SAID BEFORE. Three cards: the system domain, a count of permissions
 * ("49 permisos concedidos"), and a notice that "catalogo, pedidos, punto de
 * venta e inventario llegan en las fases 10 en adelante" - which had been
 * untrue for fifteen phases. So the first screen of the product told a business
 * two things it cannot act on and one thing that was wrong.
 *
 * WHAT IT SAYS NOW. Where to go. The menu already knows which sections this
 * person may open in this business, so the shortcuts are built from exactly
 * that list rather than from a second, hand-kept copy that would drift the way
 * the notice did. Nothing here is a permission decision: `visibleNavGroups` is
 * the same call the sidebar makes, and every page it points at checks again.
 */
export default async function TenantHomePage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  // Repeated on purpose: the layout is not the only way into this page.
  const tenant = await requireActiveTenant(tenantSlug);

  const [permissions, modules] = await Promise.all([
    getMyPermissions(tenant.id),
    getMyModules(tenant.id),
  ]);

  const groups = visibleNavGroups(permissions, modules);
  const canSeeWebsite = groups.some((group) => group.key === "web");

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={tenant.name}
        description={`Entraste como ${ROLE_LABEL[tenant.role] ?? tenant.role}. Aqui tienes todo lo que puedes hacer en esta empresa.`}
        eyebrow={
          tenant.status === "suspended" ? (
            <Badge variant="warning" dot>
              Suspendida
            </Badge>
          ) : (
            <Badge variant="success" dot>
              Activa
            </Badge>
          )
        }
      />

      {/* ---------------------------------------------------------- the site */}
      {canSeeWebsite ? (
        <Card variant="brand">
          <CardContent className="flex flex-wrap items-center justify-between gap-6 p-6">
            <div className="flex min-w-0 flex-col gap-1.5">
              <CardTitle as="h2">Tu web</CardTitle>
              <CardDescription>
                La direccion publica de {tenant.name}. Funciona en cuanto el dominio apunte a
                CloverCode.
              </CardDescription>
              <p className="mt-1 font-mono text-sm">
                {tenant.slug}.{SYSTEM_DOMAIN}
              </p>
            </div>

            <div className="flex shrink-0 flex-wrap gap-2">
              <Link
                href={`/vista/${tenant.slug}`}
                className={buttonVariants({ variant: "default", size: "md" })}
              >
                <IconGlobe />
                Ver mi web
                <IconArrowRight />
              </Link>
              <Link
                href={`/dashboard/${tenant.slug}/configuracion/tema`}
                className={buttonVariants({ variant: "outline", size: "md" })}
              >
                <IconPalette />
                Diseno
              </Link>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* ------------------------------------------------------- the sections */}
      {groups
        .filter((group) => group.key !== "principal")
        .map((group) => (
          <section key={group.key} className="flex flex-col gap-3">
            <h2 className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
              {group.label}
            </h2>

            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {group.items.map((item) => {
                const Glyph: ComponentType<IconProps> | undefined = NAV_GLYPHS[item.icon];

                return (
                  <li key={item.key}>
                    <Link
                      href={navItemHref(tenant.slug, item)}
                      className={cn(
                        "group border-border bg-card shadow-e1 flex items-center gap-3 rounded-xl border p-4",
                        "hover:border-primary/30 hover:shadow-e2 transition-[border-color,box-shadow,transform] hover:-translate-y-0.5",
                        "focus-visible:outline-ring focus-visible:outline-2 focus-visible:outline-offset-2",
                      )}
                    >
                      <span className="bg-accent text-accent-foreground flex size-10 shrink-0 items-center justify-center rounded-lg">
                        {Glyph !== undefined ? <Glyph className="size-5" /> : null}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        {item.label}
                      </span>
                      <IconArrowRight className="text-muted-foreground/40 group-hover:text-primary size-4 transition-colors" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
    </div>
  );
}
