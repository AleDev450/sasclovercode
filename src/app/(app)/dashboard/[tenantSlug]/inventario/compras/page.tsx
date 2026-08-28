import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState } from "@/components/ui";
import { formatCurrency } from "@/lib/money";
import { PERMISSIONS } from "@/lib/permissions";
import { hasPermission } from "@/lib/permissions/check";
import { requireActiveTenant } from "@/lib/tenant/active";
import { RecordPurchaseForm } from "@/modules/inventory/components/purchase-form";
import { listInventoryItems, listPurchases, listSuppliers } from "@/modules/inventory/server/queries";
import { listLocations } from "@/modules/locations/server/queries";
import { getBusinessSettings } from "@/modules/settings/server/queries";

export const metadata = { title: "Compras" };

export default async function PurchasesPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { tenantSlug } = await params;
  const tenant = await requireActiveTenant(tenantSlug);

  if (!(await hasPermission(tenant.id, PERMISSIONS.PURCHASES_VIEW))) {
    notFound();
  }

  const canCreate = await hasPermission(tenant.id, PERMISSIONS.PURCHASES_CREATE);

  const raw = await searchParams;
  const pageParam = Array.isArray(raw.page) ? raw.page[0] : raw.page;
  const page = Math.max(1, Number.parseInt(pageParam ?? "1", 10) || 1);

  const [{ purchases, total, pageCount }, settings] = await Promise.all([
    listPurchases(tenant.id, page),
    getBusinessSettings(tenant.id),
  ]);

  const [suppliers, items, locations] = canCreate
    ? await Promise.all([
        listSuppliers(tenant.id, { activeOnly: true }),
        listInventoryItems(tenant.id, { activeOnly: true }),
        listLocations(tenant.id),
      ])
    : [[], [], []];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href={`/dashboard/${tenant.slug}/inventario`}
          className="text-muted-foreground text-sm hover:underline"
        >
          ← Inventario
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Compras</h1>
        <p className="text-muted-foreground text-sm">
          Lo que {tenant.name} recibio de sus proveedores. Cada compra es un registro fijo.
        </p>
      </div>

      {purchases.length === 0 ? (
        <EmptyState
          title="Aun no hay compras"
          description="Cuando registres una, aparecera aqui."
        />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[40rem] border-collapse text-sm">
            <caption className="sr-only">Compras de {tenant.name}</caption>
            <thead>
              <tr className="border-border text-muted-foreground border-b text-left text-xs">
                <th scope="col" className="px-4 py-3 font-medium">
                  Fecha
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Proveedor
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Sede
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
              {purchases.map((purchase) => (
                <tr key={purchase.id} className="border-border border-b last:border-0">
                  <td className="text-muted-foreground px-4 py-3 tabular-nums">
                    {new Date(purchase.purchasedAt).toLocaleDateString("es-PE")}
                  </td>
                  <td className="px-4 py-3 font-medium">{purchase.supplierName}</td>
                  <td className="text-muted-foreground px-4 py-3">{purchase.locationName}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatCurrency(purchase.totalCostCents, settings.currency)}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/dashboard/${tenant.slug}/inventario/compras/${purchase.id}`}
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
            Pagina {page} de {pageCount} — {total} compras
          </span>
          <span className="flex gap-4">
            {page > 1 ? (
              <Link
                href={`/dashboard/${tenant.slug}/inventario/compras?page=${page - 1}`}
                className="hover:underline"
              >
                Anterior
              </Link>
            ) : null}
            {page < pageCount ? (
              <Link
                href={`/dashboard/${tenant.slug}/inventario/compras?page=${page + 1}`}
                className="hover:underline"
              >
                Siguiente
              </Link>
            ) : null}
          </span>
        </nav>
      ) : null}

      {canCreate ? (
        <Card>
          <CardHeader>
            <CardTitle as="h2">Registrar compra</CardTitle>
            <CardDescription>
              El costo total lo suma el sistema a partir de cada insumo comprado.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RecordPurchaseForm
              tenantSlug={tenant.slug}
              suppliers={suppliers.map((s) => ({ id: s.id, name: s.name }))}
              locations={locations.filter((l) => l.isActive).map((l) => ({ id: l.id, name: l.name }))}
              items={items.map((i) => ({ id: i.id, name: i.name, unitAbbreviation: i.unitAbbreviation }))}
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
