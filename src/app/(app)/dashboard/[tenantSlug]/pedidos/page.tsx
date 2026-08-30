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
import { formatCurrency } from "@/lib/money";
import { PERMISSIONS } from "@/lib/permissions";
import { hasPermission } from "@/lib/permissions/check";
import { MODULES } from "@/lib/features";
import { hasFeature } from "@/lib/features/check";
import { requireActiveTenant } from "@/lib/tenant/active";
import { listCustomers } from "@/modules/customers/server/queries";
import { listLocations } from "@/modules/locations/server/queries";
import { NewOrderForm } from "@/modules/orders/components/new-order-form";
import { ORDER_STATUSES, ORDER_STATUS_LABELS } from "@/modules/orders/lifecycle";
import { orderFiltersSchema } from "@/modules/orders/schemas";
import { listOrders } from "@/modules/orders/server/queries";
import { listProducts } from "@/modules/catalog/server/queries";
import { getBusinessSettings } from "@/modules/settings/server/queries";
import type { OrderStatus } from "@/types/database";

export const metadata = { title: "Pedidos" };

/** Which badge colour a status wears. Cancelled is not an error, it is a fact. */
const STATUS_VARIANT: Record<OrderStatus, "success" | "warning" | "neutral"> = {
  pending: "warning",
  confirmed: "neutral",
  preparing: "neutral",
  ready: "success",
  completed: "success",
  cancelled: "neutral",
};

export default async function OrdersPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { tenantSlug } = await params;
  const tenant = await requireActiveTenant(tenantSlug);

  // Phase 21: the plan decides before the person does. 404, not 403 - the
  // same posture every permission guard here takes toward a section that is
  // not yours to know about.
  if (!(await hasFeature(tenant.id, MODULES.ORDERS))) {
    notFound();
  }

  // The nav hides this without the permission, but hiding is cosmetic (§45).
  if (!(await hasPermission(tenant.id, PERMISSIONS.ORDERS_VIEW))) {
    notFound();
  }

  const canCreate = await hasPermission(tenant.id, PERMISSIONS.ORDERS_CREATE);

  const raw = await searchParams;
  const readParam = (key: string): string | undefined => {
    const value = raw[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const filters = orderFiltersSchema.parse({
    status: readParam("estado"),
    locationId: readParam("sede"),
    page: readParam("page"),
  });

  const [{ orders, total, page, pageCount }, settings, locations] = await Promise.all([
    listOrders(tenant.id, filters),
    getBusinessSettings(tenant.id),
    listLocations(tenant.id),
  ]);

  const hrefWith = (overrides: Record<string, string | null>): string => {
    const query = new URLSearchParams();
    if (filters.status !== null) query.set("estado", filters.status);
    if (filters.locationId !== null) query.set("sede", filters.locationId);
    if (page > 1) query.set("page", String(page));
    for (const [key, value] of Object.entries(overrides)) {
      if (value === null) query.delete(key);
      else query.set(key, value);
    }
    const suffix = query.toString();
    return `/dashboard/${tenant.slug}/pedidos${suffix.length > 0 ? `?${suffix}` : ""}`;
  };

  // Only fetched when the form will actually be drawn.
  const [products, customerPage] = canCreate
    ? await Promise.all([
        listProducts(tenant.id),
        listCustomers(tenant.id, { search: null, includeInactive: false, page: 1 }),
      ])
    : [[], null];

  const activeLocations = locations.filter((location) => location.isActive);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Pedidos</h1>
        <p className="text-muted-foreground text-sm">
          Lo que vende {tenant.name}. Los importes quedan congelados al momento de la venta.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <form method="get" className="flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-2">
              <label htmlFor="estado" className="text-sm font-medium">
                Estado
              </label>
              <select
                id="estado"
                name="estado"
                defaultValue={filters.status ?? ""}
                className="border-input bg-background h-10 rounded-md border px-3 text-sm"
              >
                <option value="">Todos</option>
                {ORDER_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {ORDER_STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="sede" className="text-sm font-medium">
                Sede
              </label>
              <select
                id="sede"
                name="sede"
                defaultValue={filters.locationId ?? ""}
                className="border-input bg-background h-10 rounded-md border px-3 text-sm"
              >
                <option value="">Todas</option>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="submit"
              className="bg-secondary text-secondary-foreground h-10 rounded-md px-4 text-sm"
            >
              Filtrar
            </button>
          </form>
        </CardContent>
      </Card>

      {orders.length === 0 ? (
        <EmptyState
          title={filters.status !== null ? "Sin pedidos con ese filtro" : "Aun no hay pedidos"}
          description={
            filters.status !== null
              ? "Prueba con otro estado o quita el filtro."
              : "Cuando registres una venta aparecera aqui."
          }
          action={
            filters.status !== null || filters.locationId !== null ? (
              <Link
                href={hrefWith({ estado: null, sede: null, page: null })}
                className="text-sm hover:underline"
              >
                Quitar los filtros
              </Link>
            ) : undefined
          }
        />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[44rem] border-collapse text-sm">
            <caption className="sr-only">Pedidos de {tenant.name}</caption>
            <thead>
              <tr className="border-border text-muted-foreground border-b text-left text-xs">
                <th scope="col" className="px-4 py-3 font-medium">
                  Pedido
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Sede
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Cliente
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Estado
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  Total
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Accion
                </th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id} className="border-border border-b last:border-0">
                  <td className="px-4 py-3 font-medium">#{order.number}</td>
                  <td className="text-muted-foreground px-4 py-3">{order.locationName ?? "—"}</td>
                  <td className="text-muted-foreground px-4 py-3">
                    {order.customerName ?? "Sin cliente"}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={STATUS_VARIANT[order.status]}>
                      {ORDER_STATUS_LABELS[order.status]}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatCurrency(order.totalCents, settings.currency)}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/dashboard/${tenant.slug}/pedidos/${order.id}`}
                      className="text-sm hover:underline"
                    >
                      Ver
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {pageCount > 1 ? (
        <nav className="flex items-center justify-between text-sm" aria-label="Paginacion">
          <span className="text-muted-foreground">
            Pagina {page} de {pageCount} — {total} pedidos
          </span>
          <span className="flex gap-4">
            {page > 1 ? (
              <Link href={hrefWith({ page: String(page - 1) })} className="hover:underline">
                Anterior
              </Link>
            ) : null}
            {page < pageCount ? (
              <Link href={hrefWith({ page: String(page + 1) })} className="hover:underline">
                Siguiente
              </Link>
            ) : null}
          </span>
        </nav>
      ) : null}

      {canCreate && activeLocations.length > 0 && products.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle as="h2">Nuevo pedido</CardTitle>
            <CardDescription>
              El pedido nace en pendiente. Los precios se copian del catalogo al guardarlo.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <NewOrderForm
              tenantSlug={tenant.slug}
              locations={activeLocations.map((l) => ({ id: l.id, name: l.name }))}
              customers={(customerPage?.customers ?? []).map((c) => ({ id: c.id, name: c.name }))}
              products={products.map((p) => ({
                id: p.id,
                name: p.name,
                basePriceCents: p.basePriceCents,
              }))}
              currency={settings.currency}
            />
          </CardContent>
        </Card>
      ) : canCreate ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground text-sm">
              {products.length === 0
                ? "Necesitas al menos un producto en el catalogo para registrar un pedido."
                : "Necesitas al menos una sede activa para registrar un pedido."}
            </p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
