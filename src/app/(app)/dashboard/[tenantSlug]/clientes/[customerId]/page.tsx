import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui";
import { PERMISSIONS } from "@/lib/permissions";
import { hasPermission } from "@/lib/permissions/check";
import { requireActiveTenant } from "@/lib/tenant/active";
import { AddressManager } from "@/modules/customers/components/address-manager";
import { CustomerForm, SetCustomerActiveForm } from "@/modules/customers/components/customer-form";
import { DOC_TYPE_LABELS } from "@/modules/customers/documents";
import { getCustomerDetail } from "@/modules/customers/server/queries";

export const metadata = { title: "Cliente" };

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; customerId: string }>;
}) {
  const { tenantSlug, customerId } = await params;
  const tenant = await requireActiveTenant(tenantSlug);

  if (!(await hasPermission(tenant.id, PERMISSIONS.CUSTOMERS_VIEW))) {
    notFound();
  }

  const canManage = await hasPermission(tenant.id, PERMISSIONS.CUSTOMERS_MANAGE);
  const customer = await getCustomerDetail(tenant.id, customerId);

  // A customer that does not exist and one belonging to another business give
  // the SAME answer. Telling them apart would let someone discover which ids
  // exist elsewhere by trying them.
  if (customer === null) notFound();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link
          href={`/dashboard/${tenant.slug}/clientes`}
          className="text-muted-foreground text-sm hover:underline"
        >
          ← Clientes
        </Link>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{customer.name}</h1>
          <Badge variant={customer.isActive ? "success" : "neutral"}>
            {customer.isActive ? "Activo" : "Inactivo"}
          </Badge>
        </div>
        <p className="text-muted-foreground text-sm">
          {customer.docType === null
            ? "Sin documento registrado."
            : `${DOC_TYPE_LABELS[customer.docType]} ${customer.docNumber}`}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle as="h2">Datos del cliente</CardTitle>
          <CardDescription>
            {canManage
              ? "El documento se valida al guardar; un RUC mal escrito no entra."
              : "Solo lectura: no tienes permiso para editar clientes."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {canManage ? (
            <CustomerForm tenantSlug={tenant.slug} customer={customer} />
          ) : (
            <dl className="grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground text-xs">Telefono</dt>
                <dd className="text-sm">{customer.phone ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">Correo</dt>
                <dd className="text-sm">{customer.email ?? "—"}</dd>
              </div>
            </dl>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2">Direcciones</CardTitle>
          <CardDescription>Donde entregarle. Puede tener varias.</CardDescription>
        </CardHeader>
        <CardContent>
          <AddressManager
            tenantSlug={tenant.slug}
            customerId={customer.id}
            addresses={customer.addresses}
            canManage={canManage}
          />
        </CardContent>
      </Card>

      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle as="h2">Estado</CardTitle>
            <CardDescription>
              Un cliente no se borra: desde la Fase 13 sus pedidos apuntan aqui.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SetCustomerActiveForm
              tenantSlug={tenant.slug}
              customerId={customer.id}
              isActive={customer.isActive}
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
