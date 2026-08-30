import Link from "next/link";
import { notFound } from "next/navigation";
import { PERMISSIONS } from "@/lib/permissions";
import { hasPermission } from "@/lib/permissions/check";
import { MODULES } from "@/lib/features";
import { hasFeature } from "@/lib/features/check";
import { requireActiveTenant } from "@/lib/tenant/active";
import { KITCHEN_STATIONS, KITCHEN_STATION_LABELS } from "@/modules/kitchen/constants";
import { KdsBoard } from "@/modules/kitchen/components/kds-board";
import { listKitchenOrders } from "@/modules/kitchen/server/queries";
import { listLocations } from "@/modules/locations/server/queries";
import type { KitchenStation } from "@/types/database";

export const metadata = { title: "Cocina" };

function isKitchenStation(value: string | undefined): value is KitchenStation {
  return value !== undefined && (KITCHEN_STATIONS as readonly string[]).includes(value);
}

/**
 * Master section 33 (Phase 16): real-time orders, three states, four
 * stations. Reads Phase 13's own orders/order_items; the only new columns
 * are this phase's own `kitchen_station`/`station` (ADR-020). Same
 * permission the `kitchen` role already holds since Phase 03 - no new one.
 */
export default async function KitchenPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{ sede?: string; estacion?: string }>;
}) {
  const { tenantSlug } = await params;
  const { sede, estacion } = await searchParams;
  const tenant = await requireActiveTenant(tenantSlug);

  // Phase 21: the plan decides before the person does. 404, not 403 - the
  // same posture every permission guard here takes toward a section that is
  // not yours to know about.
  if (!(await hasFeature(tenant.id, MODULES.ORDERS))) {
    notFound();
  }

  if (!(await hasPermission(tenant.id, PERMISSIONS.ORDERS_VIEW))) {
    notFound();
  }

  const [locations, canAdvance] = await Promise.all([
    listLocations(tenant.id),
    hasPermission(tenant.id, PERMISSIONS.ORDERS_UPDATE),
  ]);
  const activeLocations = locations.filter((location) => location.isActive);

  const resolvedLocation =
    activeLocations.length === 1
      ? activeLocations[0]!
      : (activeLocations.find((location) => location.id === sede) ?? null);

  if (activeLocations.length > 1 && resolvedLocation === null) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Cocina</h1>
        <p className="text-muted-foreground text-sm">
          Elige una sede para ver su pantalla de cocina.
        </p>
        <div className="flex flex-wrap gap-2">
          {activeLocations.map((location) => (
            <Link
              key={location.id}
              href={`/dashboard/${tenant.slug}/cocina?sede=${location.id}`}
              className="border-border hover:bg-accent rounded-md border px-4 py-3 text-sm font-medium"
            >
              {location.name}
            </Link>
          ))}
        </div>
      </div>
    );
  }

  const station = isKitchenStation(estacion) ? estacion : undefined;

  const tickets = await listKitchenOrders(tenant.id, {
    station,
    locationId: resolvedLocation?.id,
  });

  const stationHref = (value: KitchenStation | undefined): string => {
    const params = new URLSearchParams();
    if (resolvedLocation !== null && activeLocations.length > 1)
      params.set("sede", resolvedLocation.id);
    if (value !== undefined) params.set("estacion", value);
    const query = params.toString();
    return `/dashboard/${tenant.slug}/cocina${query.length > 0 ? `?${query}` : ""}`;
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Cocina</h1>
        <div className="flex flex-wrap gap-2">
          <Link
            href={stationHref(undefined)}
            className={`rounded-full border px-3 py-1 text-sm ${
              station === undefined ? "bg-primary text-primary-foreground" : "hover:bg-accent"
            }`}
          >
            Todas
          </Link>
          {KITCHEN_STATIONS.map((candidate) => (
            <Link
              key={candidate}
              href={stationHref(candidate)}
              className={`rounded-full border px-3 py-1 text-sm ${
                station === candidate ? "bg-primary text-primary-foreground" : "hover:bg-accent"
              }`}
            >
              {KITCHEN_STATION_LABELS[candidate]}
            </Link>
          ))}
        </div>
      </div>

      <KdsBoard
        tenantSlug={tenant.slug}
        tenantId={tenant.id}
        locationId={activeLocations.length > 1 ? (resolvedLocation?.id ?? undefined) : undefined}
        station={station}
        tickets={tickets}
        canAdvance={canAdvance}
      />
    </div>
  );
}
