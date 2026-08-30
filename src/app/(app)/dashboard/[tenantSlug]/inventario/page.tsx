import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui";
import { PERMISSIONS } from "@/lib/permissions";
import { hasPermission } from "@/lib/permissions/check";
import { MODULES } from "@/lib/features";
import { hasFeature } from "@/lib/features/check";
import { requireActiveTenant } from "@/lib/tenant/active";
import {
  CreateInventoryItemForm,
  SetInventoryItemActiveForm,
} from "@/modules/inventory/components/inventory-item-forms";
import {
  RecordStockMovementForm,
  RecordStockTransferForm,
} from "@/modules/inventory/components/stock-movement-forms";
import { CreateUnitForm, SetUnitActiveForm } from "@/modules/inventory/components/unit-forms";
import { listInventoryItems, listUnits } from "@/modules/inventory/server/queries";
import { listLocations } from "@/modules/locations/server/queries";

export const metadata = { title: "Inventario" };

export default async function InventoryPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const tenant = await requireActiveTenant(tenantSlug);

  // Phase 21: the plan decides before the person does. 404, not 403 - the
  // same posture every permission guard here takes toward a section that is
  // not yours to know about.
  if (!(await hasFeature(tenant.id, MODULES.INVENTORY))) {
    notFound();
  }

  if (!(await hasPermission(tenant.id, PERMISSIONS.INVENTORY_VIEW))) {
    notFound();
  }

  const canManage = await hasPermission(tenant.id, PERMISSIONS.INVENTORY_MANAGE);

  const [units, items, locations] = await Promise.all([
    listUnits(tenant.id),
    listInventoryItems(tenant.id),
    listLocations(tenant.id),
  ]);

  const activeUnits = units.filter((unit) => unit.isActive);
  const activeItems = items
    .filter((item) => item.isActive)
    .map((item) => ({ id: item.id, name: item.name, unitAbbreviation: item.unitAbbreviation }));
  const activeLocations = locations.filter((location) => location.isActive);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Inventario</h1>
          <p className="text-muted-foreground text-sm">
            Lo que {tenant.name} compra y consume para preparar lo que vende.
          </p>
        </div>
        <div className="flex gap-4 text-sm">
          <Link
            href={`/dashboard/${tenant.slug}/inventario/proveedores`}
            className="hover:underline"
          >
            Proveedores
          </Link>
          <Link href={`/dashboard/${tenant.slug}/inventario/compras`} className="hover:underline">
            Compras
          </Link>
        </div>
      </div>

      <Card className="overflow-x-auto">
        <CardHeader>
          <CardTitle as="h2">Unidades</CardTitle>
          <CardDescription>En que se mide cada insumo.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <table className="w-full min-w-[28rem] border-collapse text-sm">
            <caption className="sr-only">Unidades de {tenant.name}</caption>
            <thead>
              <tr className="border-border text-muted-foreground border-b text-left text-xs">
                <th scope="col" className="px-2 py-2 font-medium">
                  Nombre
                </th>
                <th scope="col" className="px-2 py-2 font-medium">
                  Abreviatura
                </th>
                <th scope="col" className="px-2 py-2 font-medium">
                  Estado
                </th>
                {canManage ? (
                  <th scope="col" className="px-2 py-2 font-medium">
                    Accion
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {units.map((unit) => (
                <tr key={unit.id} className="border-border border-b last:border-0">
                  <td className="px-2 py-2">{unit.name}</td>
                  <td className="text-muted-foreground px-2 py-2 font-mono">{unit.abbreviation}</td>
                  <td className="px-2 py-2">
                    <Badge variant={unit.isActive ? "success" : "neutral"}>
                      {unit.isActive ? "Activa" : "Inactiva"}
                    </Badge>
                  </td>
                  {canManage ? (
                    <td className="px-2 py-2">
                      <SetUnitActiveForm
                        tenantSlug={tenant.slug}
                        unitId={unit.id}
                        isActive={unit.isActive}
                      />
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
          {canManage ? <CreateUnitForm tenantSlug={tenant.slug} /> : null}
        </CardContent>
      </Card>

      <Card className="overflow-x-auto">
        <CardHeader>
          <CardTitle as="h2">Insumos</CardTitle>
          <CardDescription>Lo que se compra y se consume, no lo que se vende.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <table className="w-full min-w-[36rem] border-collapse text-sm">
            <caption className="sr-only">Insumos de {tenant.name}</caption>
            <thead>
              <tr className="border-border text-muted-foreground border-b text-left text-xs">
                <th scope="col" className="px-2 py-2 font-medium">
                  Nombre
                </th>
                <th scope="col" className="px-2 py-2 font-medium">
                  Unidad
                </th>
                <th scope="col" className="px-2 py-2 font-medium">
                  Codigo
                </th>
                <th scope="col" className="px-2 py-2 font-medium">
                  Estado
                </th>
                <th scope="col" className="px-2 py-2 font-medium">
                  Accion
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-border border-b last:border-0">
                  <td className="px-2 py-2">
                    <Link
                      href={`/dashboard/${tenant.slug}/inventario/${item.id}`}
                      className="hover:underline"
                    >
                      {item.name}
                    </Link>
                  </td>
                  <td className="text-muted-foreground px-2 py-2 font-mono">
                    {item.unitAbbreviation}
                  </td>
                  <td className="text-muted-foreground px-2 py-2">{item.sku ?? "—"}</td>
                  <td className="px-2 py-2">
                    <Badge variant={item.isActive ? "success" : "neutral"}>
                      {item.isActive ? "Activo" : "Inactivo"}
                    </Badge>
                  </td>
                  <td className="px-2 py-2">
                    {canManage ? (
                      <SetInventoryItemActiveForm
                        tenantSlug={tenant.slug}
                        inventoryItemId={item.id}
                        isActive={item.isActive}
                      />
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {items.length === 0 ? (
            <p className="text-muted-foreground text-sm">Todavia no hay insumos.</p>
          ) : null}
          {canManage ? (
            <CreateInventoryItemForm tenantSlug={tenant.slug} units={activeUnits} />
          ) : null}
        </CardContent>
      </Card>

      {canManage ? (
        <div className="grid gap-6 sm:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle as="h2">Ajuste, merma o devolucion</CardTitle>
              <CardDescription>Cada movimiento queda registrado con su motivo.</CardDescription>
            </CardHeader>
            <CardContent>
              <RecordStockMovementForm
                tenantSlug={tenant.slug}
                items={activeItems}
                locations={activeLocations.map((l) => ({ id: l.id, name: l.name }))}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle as="h2">Traslado entre sedes</CardTitle>
              <CardDescription>Dos movimientos, uno en cada sede, siempre juntos.</CardDescription>
            </CardHeader>
            <CardContent>
              <RecordStockTransferForm
                tenantSlug={tenant.slug}
                items={activeItems}
                locations={activeLocations.map((l) => ({ id: l.id, name: l.name }))}
              />
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
