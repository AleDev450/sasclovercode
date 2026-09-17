import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui";
import { IconArrowRight } from "@/components/ui/icons";
import { MODULES } from "@/lib/features";
import { hasFeature } from "@/lib/features/check";
import { PERMISSIONS } from "@/lib/permissions";
import { hasPermission } from "@/lib/permissions/check";
import { requireActiveTenant } from "@/lib/tenant/active";
import { listPageSlugs } from "@/modules/cms/server/admin-queries";
import { listLocations } from "@/modules/locations/server/queries";
import { PROVIDER_LABELS } from "@/modules/online-payments/credentials";
import { getGatewaySummary } from "@/modules/online-payments/server/queries";
import {
  ApplyTemplateForm,
  StorefrontSettingsForm,
} from "@/modules/storefront/components/storefront-settings-form";
import {
  getPublicStorefront,
  getStorefrontSettings,
  listPublicPaymentMethods,
} from "@/modules/storefront/server/queries";

export const metadata = { title: "Tienda online" };

/**
 * Mi web -> Tienda online (Phase 29).
 *
 * The one screen an owner needs to answer "can people order from my website
 * right now, and how": the live state as a visitor would see it, the settings,
 * and a way to every other screen that feeds the site - the home page, the
 * zones, the payment methods, the hours.
 */
export default async function StorefrontPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const tenant = await requireActiveTenant(tenantSlug);

  if (!(await hasFeature(tenant.id, MODULES.WEBSITE))) notFound();
  if (!(await hasPermission(tenant.id, PERMISSIONS.SETTINGS_MANAGE))) notFound();

  const [settings, live, locations, pages, methods, hasDelivery, hasOrders, gateway, hasOnline] =
    await Promise.all([
      getStorefrontSettings(tenant.id),
      getPublicStorefront(tenant.id),
      listLocations(tenant.id),
      listPageSlugs(tenant.id),
      listPublicPaymentMethods(tenant.id),
      hasFeature(tenant.id, MODULES.DELIVERY),
      hasFeature(tenant.id, MODULES.ORDERS),
      getGatewaySummary(tenant.id),
      hasFeature(tenant.id, MODULES.ONLINE_PAYMENTS),
    ]);

  const home = pages.find((page) => page.slug === "inicio");
  const base = `/dashboard/${tenant.slug}`;

  const shortcuts = [
    {
      label: "Portada y slider",
      href: `${base}/contenido`,
      detail: "Fotos, accesos y los mas pedidos",
    },
    {
      label: "Carta",
      href: `${base}/catalogo`,
      detail: "Productos, fotos, presentaciones y extras",
    },
    ...(hasDelivery
      ? [
          {
            label: "Zonas de delivery",
            href: `${base}/configuracion/delivery`,
            detail: "Distritos y tarifas",
          },
        ]
      : []),
    ...(hasOrders
      ? [
          {
            label: "Metodos de pago",
            href: `${base}/configuracion/pagos`,
            detail: `${methods.length} visibles en la web`,
          },
        ]
      : []),
    { label: "Horario", href: `${base}/sedes`, detail: "Turnos de cada sede" },
    {
      label: "Redes sociales y WhatsApp",
      href: `${base}/configuracion`,
      detail: "Datos del negocio",
    },
    {
      label: "Textos legales",
      href: `${base}/tienda/legales`,
      detail: "Privacidad, cookies y terminos",
    },
    {
      label: "Libro de reclamaciones",
      href: `${base}/reclamos`,
      detail: "Hojas recibidas y respuestas",
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Tienda online</h1>
          <p className="text-muted-foreground text-sm">
            Como vende la web de {tenant.name}: pedidos, horario, entrega y contacto.
          </p>
        </div>
        <Link
          href={`/vista/${tenant.slug}`}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm"
        >
          Ver mi web
          <IconArrowRight className="size-4" />
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle as="h2">Ahora mismo</CardTitle>
          <CardDescription>
            Lo que ve un cliente que entra a tu web en este momento.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {!hasOrders ? (
            <Badge variant="warning">Tu plan no incluye pedidos</Badge>
          ) : !live.orderingEnabled ? (
            <Badge variant="neutral">Pedidos web apagados</Badge>
          ) : live.canOrder ? (
            <Badge variant="success" dot>
              Abierta: recibiendo pedidos
            </Badge>
          ) : (
            <Badge variant="warning" dot>
              Cerrada
            </Badge>
          )}
          <Badge variant="neutral">
            {live.acceptsDelivery && live.acceptsPickup
              ? "Delivery y recojo"
              : live.acceptsDelivery
                ? "Solo delivery"
                : "Solo recojo"}
          </Badge>
          {methods.length === 0 && hasOrders ? (
            <Badge variant="warning">Sin metodos de pago en la web</Badge>
          ) : null}
          {live.whatsapp === null ? <Badge variant="warning">Sin numero de WhatsApp</Badge> : null}
          {/*
            Phase 31. Configured by CloverCode, not here: the owner sees the
            state and knows who to ask.
          */}
          {hasOnline && gateway !== null && gateway.isEnabled ? (
            <Badge variant="success">
              Pago online: {PROVIDER_LABELS[gateway.provider]}
              {gateway.mode === "test" ? " (pruebas)" : ""}
            </Badge>
          ) : hasOnline ? (
            <Badge variant="neutral">
              Tu plan incluye pago online: pide a CloverCode activarlo
            </Badge>
          ) : null}
        </CardContent>
      </Card>

      {home === undefined || home.status !== "published" ? (
        <Card>
          <CardHeader>
            <CardTitle as="h2">Tu portada</CardTitle>
            <CardDescription>
              {home === undefined
                ? "Tu web todavia no tiene portada. Crea la de restaurante: slider de fotos, accesos a la carta y al delivery, y tus platos mas pedidos."
                : "Tu portada esta en borrador, asi que los clientes no la ven."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ApplyTemplateForm tenantSlug={tenant.slug} />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle as="h2">Configuracion</CardTitle>
        </CardHeader>
        <CardContent>
          <StorefrontSettingsForm
            tenantSlug={tenant.slug}
            settings={settings}
            locations={locations
              .filter((location) => location.isActive)
              .map((location) => ({ id: location.id, name: location.name }))}
            hasDeliveryModule={hasDelivery}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2">Todo lo que sale en tu web</CardTitle>
          <CardDescription>Cada parte se edita en su propia pantalla.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-2 sm:grid-cols-2">
            {shortcuts.map((shortcut) => (
              <li key={shortcut.href}>
                <Link
                  href={shortcut.href}
                  className="border-border hover:bg-accent/40 flex items-center justify-between gap-3 rounded-lg border p-3 transition-colors"
                >
                  <span className="flex flex-col">
                    <span className="text-sm font-medium">{shortcut.label}</span>
                    <span className="text-muted-foreground text-xs">{shortcut.detail}</span>
                  </span>
                  <IconArrowRight className="text-muted-foreground size-4" />
                </Link>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
