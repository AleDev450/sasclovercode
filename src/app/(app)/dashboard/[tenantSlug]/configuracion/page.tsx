import { notFound } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui";
import { PERMISSIONS } from "@/lib/permissions";
import { hasPermission } from "@/lib/permissions/check";
import { requireActiveTenant } from "@/lib/tenant/active";
import { SettingsForm } from "@/modules/settings/components/settings-form";
import { getBusinessSettings } from "@/modules/settings/server/queries";

export const metadata = { title: "Configuracion" };

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const tenant = await requireActiveTenant(tenantSlug);

  // The nav hides this entry without the permission, but hiding is cosmetic
  // (master section 45): a typed URL lands here, so the page checks too.
  if (!(await hasPermission(tenant.id, PERMISSIONS.SETTINGS_MANAGE))) {
    notFound();
  }

  const settings = await getBusinessSettings(tenant.id);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Configuracion</h1>
          <p className="text-muted-foreground text-sm">
            Identidad fiscal, contacto y localizacion de {tenant.name}.
          </p>
        </div>
        <Link
          href={`/dashboard/${tenant.slug}/configuracion/tema`}
          className="text-muted-foreground hover:text-foreground text-sm"
        >
          Ir al tema
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle as="h2">Datos del negocio</CardTitle>
          <CardDescription>
            El RUC y la moneda se usaran en la facturacion electronica.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SettingsForm tenantSlug={tenant.slug} settings={settings} />
        </CardContent>
      </Card>
    </div>
  );
}
