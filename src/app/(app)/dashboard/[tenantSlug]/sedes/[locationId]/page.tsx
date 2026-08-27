import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui";
import { PERMISSIONS } from "@/lib/permissions";
import { hasPermission } from "@/lib/permissions/check";
import { requireActiveTenant } from "@/lib/tenant/active";
import { LocationForm, SetLocationActiveForm } from "@/modules/locations/components/location-form";
import { ScheduleEditor } from "@/modules/locations/components/schedule-editor";
import { getLocation, listLocationHours } from "@/modules/locations/server/queries";

export const metadata = { title: "Sede" };

export default async function LocationDetailPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; locationId: string }>;
}) {
  const { tenantSlug, locationId } = await params;
  const tenant = await requireActiveTenant(tenantSlug);

  if (!(await hasPermission(tenant.id, PERMISSIONS.LOCATIONS_VIEW))) {
    notFound();
  }

  const location = await getLocation(tenant.id, locationId);
  if (location === null) notFound();

  const canManage = await hasPermission(tenant.id, PERMISSIONS.LOCATIONS_MANAGE);
  const shifts = await listLocationHours(tenant.id, location.id);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{location.name}</h1>
          <p className="text-muted-foreground text-sm">
            {location.addressLine ?? "Sin direccion todavia"}
          </p>
        </div>
        <Badge variant={location.isActive ? "success" : "neutral"}>
          {location.isActive ? "Activa" : "Inactiva"}
        </Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle as="h2">Datos de la sede</CardTitle>
          <CardDescription>
            La direccion y el telefono se muestran en la web publica del negocio.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {canManage ? (
            <LocationForm tenantSlug={tenant.slug} location={location} />
          ) : (
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground text-xs">Direccion</dt>
                <dd>{location.addressLine ?? "-"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">Distrito</dt>
                <dd>{location.district ?? "-"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">Telefono</dt>
                <dd>{location.phone ?? "-"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">Referencia</dt>
                <dd>{location.reference ?? "-"}</dd>
              </div>
            </dl>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2">Horario</CardTitle>
          <CardDescription>
            Un dia puede tener varios tramos. Los tramos no pueden cruzarse entre si.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {canManage ? (
            <ScheduleEditor tenantSlug={tenant.slug} locationId={location.id} shifts={shifts} />
          ) : (
            <p className="text-muted-foreground text-sm">
              {shifts.length === 0 ? "Sin horario definido." : `${shifts.length} tramos definidos.`}
            </p>
          )}
        </CardContent>
      </Card>

      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle as="h2">Estado</CardTitle>
            <CardDescription>
              Una sede no se borra: se desactiva. Su historial de pedidos y documentos se conserva,
              y deja de aparecer en la web.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SetLocationActiveForm
              tenantSlug={tenant.slug}
              locationId={location.id}
              isActive={location.isActive}
            />
          </CardContent>
        </Card>
      ) : null}

      <Link
        href={`/dashboard/${tenant.slug}/sedes`}
        className="text-muted-foreground text-sm hover:underline"
      >
        Volver a sedes
      </Link>
    </div>
  );
}
