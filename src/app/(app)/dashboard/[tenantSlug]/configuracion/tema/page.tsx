import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui";
import { PERMISSIONS } from "@/lib/permissions";
import { hasPermission } from "@/lib/permissions/check";
import { requireActiveTenant } from "@/lib/tenant/active";
import { ThemeForm } from "@/modules/settings/components/theme-form";
import { getTenantTheme } from "@/modules/settings/server/queries";

export const metadata = { title: "Tema" };

export default async function ThemePage({ params }: { params: Promise<{ tenantSlug: string }> }) {
  const { tenantSlug } = await params;
  const tenant = await requireActiveTenant(tenantSlug);

  if (!(await hasPermission(tenant.id, PERMISSIONS.SETTINGS_MANAGE))) {
    notFound();
  }

  const theme = await getTenantTheme(tenant.id);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Tema</h1>
          <p className="text-muted-foreground text-sm">
            Colores y tipografia de {tenant.name}. Se aplicaran a su web publica.
          </p>
        </div>
        <Link
          href={`/dashboard/${tenant.slug}/configuracion`}
          className="text-muted-foreground hover:text-foreground text-sm"
        >
          Volver a configuracion
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle as="h2">Apariencia</CardTitle>
          <CardDescription>Los colores se guardan en formato hexadecimal.</CardDescription>
        </CardHeader>
        <CardContent>
          <ThemeForm tenantSlug={tenant.slug} theme={theme} />
        </CardContent>
      </Card>
    </div>
  );
}
