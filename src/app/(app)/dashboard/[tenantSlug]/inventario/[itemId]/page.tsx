import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui";
import { PERMISSIONS } from "@/lib/permissions";
import { hasPermission } from "@/lib/permissions/check";
import { requireActiveTenant } from "@/lib/tenant/active";
import { UpdateInventoryItemForm } from "@/modules/inventory/components/inventory-item-forms";
import { STOCK_MOVEMENT_TYPE_LABELS } from "@/modules/inventory/constants";
import { getInventoryItemDetail, listUnits } from "@/modules/inventory/server/queries";

export const metadata = { title: "Insumo" };

export default async function InventoryItemDetailPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; itemId: string }>;
}) {
  const { tenantSlug, itemId } = await params;
  const tenant = await requireActiveTenant(tenantSlug);

  if (!(await hasPermission(tenant.id, PERMISSIONS.INVENTORY_VIEW))) {
    notFound();
  }

  const item = await getInventoryItemDetail(tenant.id, itemId);
  if (item === null) notFound();

  const canManage = await hasPermission(tenant.id, PERMISSIONS.INVENTORY_MANAGE);
  const units = canManage ? await listUnits(tenant.id, { activeOnly: true }) : [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link
          href={`/dashboard/${tenant.slug}/inventario`}
          className="text-muted-foreground text-sm hover:underline"
        >
          ← Inventario
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{item.name}</h1>
          <Badge variant={item.isActive ? "success" : "neutral"}>
            {item.isActive ? "Activo" : "Inactivo"}
          </Badge>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle as="h2">Stock actual por sede</CardTitle>
          <CardDescription>Suma en vivo de los movimientos de este insumo, nunca un numero guardado.</CardDescription>
        </CardHeader>
        <CardContent>
          {item.stockByLocation.length === 0 ? (
            <p className="text-muted-foreground text-sm">Sin movimientos todavia.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {item.stockByLocation.map((stock) => (
                <li key={stock.locationId} className="flex items-center justify-between text-sm">
                  <span>{stock.locationName}</span>
                  <span className="font-mono tabular-nums">
                    {stock.quantityOnHand} {item.unitAbbreviation}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle as="h2">Datos</CardTitle>
          </CardHeader>
          <CardContent>
            <UpdateInventoryItemForm tenantSlug={tenant.slug} units={units} item={item} />
          </CardContent>
        </Card>
      ) : null}

      <Card className="overflow-x-auto">
        <CardHeader>
          <CardTitle as="h2">Movimientos recientes</CardTitle>
        </CardHeader>
        <CardContent>
          {item.recentMovements.length === 0 ? (
            <p className="text-muted-foreground text-sm">Sin movimientos todavia.</p>
          ) : (
            <table className="w-full min-w-[36rem] border-collapse text-sm">
              <caption className="sr-only">Movimientos de {item.name}</caption>
              <thead>
                <tr className="border-border text-muted-foreground border-b text-left text-xs">
                  <th scope="col" className="px-2 py-2 font-medium">
                    Fecha
                  </th>
                  <th scope="col" className="px-2 py-2 font-medium">
                    Tipo
                  </th>
                  <th scope="col" className="px-2 py-2 font-medium">
                    Sede
                  </th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">
                    Cantidad
                  </th>
                  <th scope="col" className="px-2 py-2 font-medium">
                    Motivo
                  </th>
                </tr>
              </thead>
              <tbody>
                {item.recentMovements.map((movement) => (
                  <tr key={movement.id} className="border-border border-b last:border-0">
                    <td className="text-muted-foreground px-2 py-2 tabular-nums">
                      {new Date(movement.createdAt).toLocaleString("es-PE")}
                    </td>
                    <td className="px-2 py-2">{STOCK_MOVEMENT_TYPE_LABELS[movement.type]}</td>
                    <td className="text-muted-foreground px-2 py-2">{movement.locationName}</td>
                    <td className="px-2 py-2 text-right font-mono tabular-nums">
                      {movement.quantity > 0 ? "+" : ""}
                      {movement.quantity}
                    </td>
                    <td className="text-muted-foreground px-2 py-2">{movement.reason ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
