import { notFound } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui";
import { PERMISSIONS } from "@/lib/permissions";
import { hasPermission } from "@/lib/permissions/check";
import { requireActiveTenant } from "@/lib/tenant/active";
import { listLocations } from "@/modules/locations/server/queries";
import { CashRegisterCard } from "@/modules/payments/components/cash-register-card";
import { CashRegisterForm } from "@/modules/payments/components/cash-register-form";
import { listCashRegisters, listCashSessions } from "@/modules/payments/server/queries";
import { getBusinessSettings } from "@/modules/settings/server/queries";

export const metadata = { title: "Caja" };

export default async function CashPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const tenant = await requireActiveTenant(tenantSlug);

  if (!(await hasPermission(tenant.id, PERMISSIONS.CASH_VIEW))) {
    notFound();
  }

  const [registers, canOpen, canManage, settings] = await Promise.all([
    listCashRegisters(tenant.id),
    hasPermission(tenant.id, PERMISSIONS.CASH_OPEN),
    hasPermission(tenant.id, PERMISSIONS.CASH_MANAGE),
    getBusinessSettings(tenant.id),
  ]);

  const recentSessionsByRegister = new Map(
    await Promise.all(
      registers.map(async (register) => [register.id, await listCashSessions(tenant.id, register.id, 5)] as const),
    ),
  );

  const locations = canManage
    ? (await listLocations(tenant.id)).filter((location) => location.isActive)
    : [];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Caja</h1>
        <p className="text-muted-foreground text-sm">
          Cada caja se abre con un monto inicial y se cierra contando el efectivo. Lo que el
          sistema espera encontrar lo calcula la venta registrada, no lo que se escriba aqui.
        </p>
      </div>

      {registers.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Todavia no hay ninguna caja creada{canManage ? ": crea la primera abajo." : "."}
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {registers.map((register) => (
            <CashRegisterCard
              key={register.id}
              tenantSlug={tenant.slug}
              register={register}
              canOpen={canOpen}
              recentSessions={recentSessionsByRegister.get(register.id) ?? []}
              currency={settings.currency}
            />
          ))}
        </div>
      )}

      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle as="h2">Nueva caja</CardTitle>
            <CardDescription>Una caja pertenece a una sede.</CardDescription>
          </CardHeader>
          <CardContent>
            {locations.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No hay ninguna sede activa. Crea una en Sedes primero.
              </p>
            ) : (
              <CashRegisterForm tenantSlug={tenant.slug} locations={locations} />
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
