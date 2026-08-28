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
import { requireActiveTenant } from "@/lib/tenant/active";
import {
  CreateZoneForm,
  DeleteRateForm,
  DeleteZoneForm,
  SaveRateForm,
  SetZoneActiveForm,
  UpdateZoneForm,
} from "@/modules/delivery/components/zone-forms";
import { listDeliveryRates, listDeliveryZones } from "@/modules/delivery/server/queries";
import { listLocations } from "@/modules/locations/server/queries";
import { getBusinessSettings } from "@/modules/settings/server/queries";

export const metadata = { title: "Zonas de reparto" };

export default async function DeliveryZonesPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const tenant = await requireActiveTenant(tenantSlug);

  if (!(await hasPermission(tenant.id, PERMISSIONS.DELIVERY_ZONES_VIEW))) {
    notFound();
  }

  const canManage = await hasPermission(tenant.id, PERMISSIONS.DELIVERY_ZONES_MANAGE);

  const [zones, rates, locations, settings] = await Promise.all([
    listDeliveryZones(tenant.id),
    listDeliveryRates(tenant.id),
    listLocations(tenant.id),
    getBusinessSettings(tenant.id),
  ]);

  const activeLocations = locations.filter((location) => location.isActive);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Zonas de reparto</h1>
        <p className="text-muted-foreground text-sm">
          A donde reparte {tenant.name} y cuanto cobra por llegar. La tarifa por defecto aplica
          desde cualquier sede; una tarifa de sede la reemplaza solo para esa sede.
        </p>
      </div>

      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle as="h2">Nueva zona</CardTitle>
            <CardDescription>Un area con nombre, normalmente un distrito.</CardDescription>
          </CardHeader>
          <CardContent>
            <CreateZoneForm tenantSlug={tenant.slug} />
          </CardContent>
        </Card>
      ) : null}

      {zones.length === 0 ? (
        <EmptyState
          title="Aun no tienes zonas de reparto"
          description="Crea tu primera zona para poder adjuntar entregas a los pedidos y cobrar el envio."
        />
      ) : (
        zones.map((zone) => {
          const zoneRates = rates.filter((rate) => rate.zoneId === zone.id);
          const defaultRate = zoneRates.find((rate) => rate.locationId === null);

          return (
            <Card key={zone.id}>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <CardTitle as="h2">
                      {zone.name} {zone.isActive ? null : <Badge variant="neutral">Inactiva</Badge>}
                    </CardTitle>
                    <CardDescription>
                      {zone.district ?? "Sin distrito declarado"}
                      {zone.notes === null ? "" : ` · ${zone.notes}`}
                    </CardDescription>
                  </div>
                  {canManage ? (
                    <div className="flex items-center gap-1">
                      <SetZoneActiveForm
                        tenantSlug={tenant.slug}
                        zoneId={zone.id}
                        isActive={zone.isActive}
                      />
                      <DeleteZoneForm
                        tenantSlug={tenant.slug}
                        zoneId={zone.id}
                        zoneName={zone.name}
                      />
                    </div>
                  ) : null}
                </div>
              </CardHeader>

              <CardContent className="flex flex-col gap-6">
                {canManage ? <UpdateZoneForm tenantSlug={tenant.slug} zone={zone} /> : null}

                <div className="flex flex-col gap-4">
                  <h3 className="text-sm font-medium">Tarifas</h3>

                  {!canManage ? (
                    <table className="w-full min-w-[24rem] border-collapse text-sm">
                      <caption className="sr-only">Tarifas de {zone.name}</caption>
                      <thead>
                        <tr className="border-border text-muted-foreground border-b text-left text-xs">
                          <th scope="col" className="px-2 py-2 font-medium">
                            Sede
                          </th>
                          <th scope="col" className="px-2 py-2 font-medium">
                            Costo
                          </th>
                          <th scope="col" className="px-2 py-2 font-medium">
                            Gratis desde
                          </th>
                          <th scope="col" className="px-2 py-2 font-medium">
                            Minutos
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {zoneRates.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="text-muted-foreground px-2 py-3">
                              Sin tarifas. No se puede repartir a esta zona todavia.
                            </td>
                          </tr>
                        ) : (
                          zoneRates.map((rate) => (
                            <tr key={rate.id} className="border-border/60 border-b last:border-0">
                              <td className="px-2 py-2">
                                {rate.locationName ?? "Todas las sedes"}
                              </td>
                              <td className="px-2 py-2 tabular-nums">
                                {formatCurrency(rate.feeCents, settings.currency)}
                              </td>
                              <td className="px-2 py-2 tabular-nums">
                                {rate.minOrderFreeCents === null
                                  ? "—"
                                  : formatCurrency(rate.minOrderFreeCents, settings.currency)}
                              </td>
                              <td className="px-2 py-2 tabular-nums">
                                {rate.estimatedMinutes ?? "—"}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  ) : (
                    <div className="flex flex-col gap-5">
                      <div className="flex flex-wrap items-end gap-3">
                        <SaveRateForm
                          tenantSlug={tenant.slug}
                          zoneId={zone.id}
                          locationId=""
                          locationName="Todas las sedes"
                          rate={defaultRate}
                        />
                        {defaultRate !== undefined ? (
                          <DeleteRateForm tenantSlug={tenant.slug} rateId={defaultRate.id} />
                        ) : null}
                      </div>

                      {activeLocations.length > 1
                        ? activeLocations.map((location) => {
                            const rate = zoneRates.find((row) => row.locationId === location.id);
                            return (
                              <div key={location.id} className="flex flex-wrap items-end gap-3">
                                <SaveRateForm
                                  tenantSlug={tenant.slug}
                                  zoneId={zone.id}
                                  locationId={location.id}
                                  locationName={location.name}
                                  rate={rate}
                                />
                                {rate !== undefined ? (
                                  <DeleteRateForm tenantSlug={tenant.slug} rateId={rate.id} />
                                ) : null}
                              </div>
                            );
                          })
                        : null}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}
