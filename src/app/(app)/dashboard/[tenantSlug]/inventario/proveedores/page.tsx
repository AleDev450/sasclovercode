import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui";
import { PERMISSIONS } from "@/lib/permissions";
import { hasPermission } from "@/lib/permissions/check";
import { MODULES } from "@/lib/features";
import { hasFeature } from "@/lib/features/check";
import { requireActiveTenant } from "@/lib/tenant/active";
import {
  CreateSupplierForm,
  SetSupplierActiveForm,
} from "@/modules/inventory/components/supplier-forms";
import { listSuppliers } from "@/modules/inventory/server/queries";

export const metadata = { title: "Proveedores" };

export default async function SuppliersPage({
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

  if (!(await hasPermission(tenant.id, PERMISSIONS.SUPPLIERS_VIEW))) {
    notFound();
  }

  const canManage = await hasPermission(tenant.id, PERMISSIONS.SUPPLIERS_MANAGE);
  const suppliers = await listSuppliers(tenant.id);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href={`/dashboard/${tenant.slug}/inventario`}
          className="text-muted-foreground text-sm hover:underline"
        >
          ← Inventario
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Proveedores</h1>
        <p className="text-muted-foreground text-sm">A quien le compra {tenant.name}.</p>
      </div>

      <Card className="overflow-x-auto">
        <table className="w-full min-w-[40rem] border-collapse text-sm">
          <caption className="sr-only">Proveedores de {tenant.name}</caption>
          <thead>
            <tr className="border-border text-muted-foreground border-b text-left text-xs">
              <th scope="col" className="px-4 py-3 font-medium">
                Nombre
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                RUC
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Contacto
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Estado
              </th>
              {canManage ? (
                <th scope="col" className="px-4 py-3 font-medium">
                  Accion
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {suppliers.map((supplier) => (
              <tr key={supplier.id} className="border-border border-b last:border-0">
                <td className="px-4 py-3 font-medium">{supplier.name}</td>
                <td className="text-muted-foreground px-4 py-3 font-mono">
                  {supplier.taxId ?? "—"}
                </td>
                <td className="text-muted-foreground px-4 py-3">
                  {supplier.contactName ?? supplier.phone ?? supplier.email ?? "—"}
                </td>
                <td className="px-4 py-3">
                  <Badge variant={supplier.isActive ? "success" : "neutral"}>
                    {supplier.isActive ? "Activo" : "Inactivo"}
                  </Badge>
                </td>
                {canManage ? (
                  <td className="px-4 py-3">
                    <SetSupplierActiveForm
                      tenantSlug={tenant.slug}
                      supplierId={supplier.id}
                      isActive={supplier.isActive}
                    />
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
        {suppliers.length === 0 ? (
          <p className="text-muted-foreground px-4 py-6 text-sm">Todavia no hay proveedores.</p>
        ) : null}
      </Card>

      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle as="h2">Nuevo proveedor</CardTitle>
            <CardDescription>
              Un vendedor sin RUC formal es un registro tan valido como uno con el.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CreateSupplierForm tenantSlug={tenant.slug} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
