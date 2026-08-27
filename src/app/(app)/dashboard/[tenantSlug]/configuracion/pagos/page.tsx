import { notFound } from "next/navigation";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui";
import { PERMISSIONS } from "@/lib/permissions";
import { hasPermission } from "@/lib/permissions/check";
import { requireActiveTenant } from "@/lib/tenant/active";
import { SetPaymentMethodActiveForm } from "@/modules/payments/components/payment-method-active-form";
import { PaymentMethodForm } from "@/modules/payments/components/payment-method-form";
import { PAYMENT_METHOD_TYPE_LABELS } from "@/modules/payments/constants";
import { listPaymentMethods } from "@/modules/payments/server/queries";

export const metadata = { title: "Metodos de pago" };

/**
 * Its own top-level nav entry rather than a link inside `/configuracion`, for
 * the same reason `/configuracion/dominios` already is one (Phase 09):
 * `admin` holds `payment_methods.manage` but not `settings.manage`, so it
 * cannot reach a link buried in a page it is blocked from opening.
 */
export default async function PaymentMethodsPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const tenant = await requireActiveTenant(tenantSlug);

  if (!(await hasPermission(tenant.id, PERMISSIONS.PAYMENT_METHODS_VIEW))) {
    notFound();
  }

  const canManage = await hasPermission(tenant.id, PERMISSIONS.PAYMENT_METHODS_MANAGE);
  const methods = await listPaymentMethods(tenant.id);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Metodos de pago</h1>
        <p className="text-muted-foreground text-sm">
          Los medios que {tenant.name} acepta para cobrar un pedido. Desactivar uno no afecta los
          pagos que ya se registraron con el.
        </p>
      </div>

      <Card className="overflow-x-auto">
        <table className="w-full min-w-[36rem] border-collapse text-sm">
          <caption className="sr-only">Metodos de pago de {tenant.name}</caption>
          <thead>
            <tr className="border-border text-muted-foreground border-b text-left text-xs">
              <th scope="col" className="px-4 py-3 font-medium">
                Nombre
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Tipo
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Referencia
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
            {methods.map((method) => (
              <tr key={method.id} className="border-border border-b last:border-0">
                <td className="px-4 py-3 font-medium">{method.name}</td>
                <td className="px-4 py-3">{PAYMENT_METHOD_TYPE_LABELS[method.type]}</td>
                <td className="text-muted-foreground px-4 py-3">{method.reference ?? "—"}</td>
                <td className="px-4 py-3">
                  <Badge variant={method.isActive ? "success" : "neutral"}>
                    {method.isActive ? "Activo" : "Inactivo"}
                  </Badge>
                </td>
                {canManage ? (
                  <td className="px-4 py-3">
                    <SetPaymentMethodActiveForm
                      tenantSlug={tenant.slug}
                      paymentMethodId={method.id}
                      isActive={method.isActive}
                    />
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
        {methods.length === 0 ? (
          <p className="text-muted-foreground px-4 py-6 text-sm">Todavia no hay metodos de pago.</p>
        ) : null}
      </Card>

      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle as="h2">Nuevo metodo</CardTitle>
            <CardDescription>
              El nombre es lo que ve el cajero al cobrar - &ldquo;Yape - Alejandro&rdquo; distingue
              dos cuentas del mismo tipo.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PaymentMethodForm tenantSlug={tenant.slug} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
