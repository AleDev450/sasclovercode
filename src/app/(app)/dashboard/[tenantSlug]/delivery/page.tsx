import { notFound } from "next/navigation";
import { EmptyState } from "@/components/ui";
import { PERMISSIONS } from "@/lib/permissions";
import { hasPermission } from "@/lib/permissions/check";
import { requireActiveTenant } from "@/lib/tenant/active";
import { DeliveryTable } from "@/modules/delivery/components/delivery-board";
import type { CourierOption } from "@/modules/delivery/components/delivery-forms";
import {
  listClosedDeliveries,
  listCouriers,
  listOpenDeliveries,
} from "@/modules/delivery/server/queries";
import { getBusinessSettings } from "@/modules/settings/server/queries";

export const metadata = { title: "Delivery" };

export default async function DeliveryPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const tenant = await requireActiveTenant(tenantSlug);

  // The nav hides this without the permission, but hiding is cosmetic (§45).
  // A typed URL lands here, so the page checks too - and answers 404, not 403,
  // to avoid confirming the section exists.
  if (!(await hasPermission(tenant.id, PERMISSIONS.DELIVERIES_VIEW))) {
    notFound();
  }

  const canManage = await hasPermission(tenant.id, PERMISSIONS.DELIVERIES_MANAGE);

  const [open, closed, couriers, settings] = await Promise.all([
    listOpenDeliveries(tenant.id),
    listClosedDeliveries(tenant.id),
    // Returns zero rows without `deliveries.manage`, by design of the function.
    // A viewer sees names only if they could also assign, which is the same
    // posture the roster takes toward `members.view`.
    canManage ? listCouriers(tenant.id) : Promise.resolve([]),
    getBusinessSettings(tenant.id),
  ]);

  const courierOptions: readonly CourierOption[] = couriers.map((courier) => ({
    userId: courier.userId,
    label: courier.fullName ?? courier.email,
  }));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Delivery</h1>
        <p className="text-muted-foreground text-sm">
          Las entregas de {tenant.name}: a donde van, quien las lleva y en que estado estan.
        </p>
      </div>

      {open.length === 0 && closed.length === 0 ? (
        <EmptyState
          title="Aun no hay entregas"
          description="Cuando adjuntes una entrega a un pedido, aparecera aqui para asignarle un repartidor y seguirla."
        />
      ) : (
        <>
          {open.length === 0 ? (
            <EmptyState
              title="Nada en curso"
              description="Todas las entregas estan cerradas. Las nuevas apareceran aqui en cuanto se adjunten a un pedido."
            />
          ) : (
            <DeliveryTable
              tenantSlug={tenant.slug}
              deliveries={open}
              couriers={courierOptions}
              currency={settings.currency}
              canManage={canManage}
              title="En curso"
              description="Lo que todavia espera a alguien."
              showActions
            />
          )}

          {closed.length > 0 ? (
            <DeliveryTable
              tenantSlug={tenant.slug}
              deliveries={closed}
              couriers={courierOptions}
              currency={settings.currency}
              canManage={canManage}
              title="Cerradas"
              description="Las ultimas 50 entregas terminadas o anuladas."
              showActions={false}
            />
          ) : null}
        </>
      )}
    </div>
  );
}
