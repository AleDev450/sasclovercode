import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui";
import { PERMISSIONS } from "@/lib/permissions";
import { hasPermission } from "@/lib/permissions/check";
import { requireActiveTenant } from "@/lib/tenant/active";
import { LocationForm } from "@/modules/locations/components/location-form";
import { listLocations } from "@/modules/locations/server/queries";

export const metadata = { title: "Sedes" };

export default async function LocationsPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const tenant = await requireActiveTenant(tenantSlug);

  // The nav hides this entry without the permission, but hiding is cosmetic
  // (master section 45): a typed URL lands here, so the page checks too.
  if (!(await hasPermission(tenant.id, PERMISSIONS.LOCATIONS_VIEW))) {
    notFound();
  }

  const canManage = await hasPermission(tenant.id, PERMISSIONS.LOCATIONS_MANAGE);
  const locations = await listLocations(tenant.id);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Sedes</h1>
        <p className="text-muted-foreground text-sm">
          Los locales desde los que opera {tenant.name}. Los pedidos, la caja y el stock se
          registran siempre en una sede.
        </p>
      </div>

      <Card className="overflow-x-auto">
        <table className="w-full min-w-[36rem] border-collapse text-sm">
          <caption className="sr-only">Sedes de {tenant.name}</caption>
          <thead>
            <tr className="border-border text-muted-foreground border-b text-left text-xs">
              <th scope="col" className="px-4 py-3 font-medium">
                Sede
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Direccion
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Estado
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Accion
              </th>
            </tr>
          </thead>
          <tbody>
            {locations.map((location) => (
              <tr key={location.id} className="border-border border-b last:border-0">
                <td className="px-4 py-3 font-medium">{location.name}</td>
                <td className="text-muted-foreground px-4 py-3">
                  {location.addressLine ?? "Sin direccion"}
                  {location.district !== null ? `, ${location.district}` : ""}
                </td>
                <td className="px-4 py-3">
                  <Badge variant={location.isActive ? "success" : "neutral"}>
                    {location.isActive ? "Activa" : "Inactiva"}
                  </Badge>
                </td>
                <td className="px-4 py-3">
                  <Link
                    href={`/dashboard/${tenant.slug}/sedes/${location.id}`}
                    className="text-sm hover:underline"
                  >
                    {canManage ? "Editar" : "Ver"}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle as="h2">Nueva sede</CardTitle>
            <CardDescription>
              Solo el nombre es obligatorio. El horario se define despues, dentro de la sede.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <LocationForm tenantSlug={tenant.slug} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
