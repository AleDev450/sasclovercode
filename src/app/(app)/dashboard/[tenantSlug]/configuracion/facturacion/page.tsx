import { notFound } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui";
import { PERMISSIONS } from "@/lib/permissions";
import { hasPermission } from "@/lib/permissions/check";
import { MODULES } from "@/lib/features";
import { hasFeature } from "@/lib/features/check";
import { requireActiveTenant } from "@/lib/tenant/active";
import { BillingCredentialsForm } from "@/modules/billing/components/billing-credentials-form";
import {
  BillingActiveToggleForm,
  BillingProviderConfigForm,
} from "@/modules/billing/components/billing-provider-config-form";
import { getBillingProviderConfig } from "@/modules/billing/server/queries";

export const metadata = { title: "Series y proveedor" };

/**
 * Its own top-level nav entry, same reasoning as `/configuracion/pagos`
 * (Phase 14) and `/configuracion/dominios` (Phase 09): `billing.manage` is
 * granted to owner and admin, not folded into `settings.manage` (ADR-021).
 */
export default async function BillingConfigPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const tenant = await requireActiveTenant(tenantSlug);

  // Phase 21: the plan decides before the person does. 404, not 403 - the
  // same posture every permission guard here takes toward a section that is
  // not yours to know about.
  if (!(await hasFeature(tenant.id, MODULES.BILLING))) {
    notFound();
  }

  if (!(await hasPermission(tenant.id, PERMISSIONS.BILLING_MANAGE))) {
    notFound();
  }

  const config = await getBillingProviderConfig(tenant.id);
  if (config === null) notFound();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Series y proveedor</h1>
        <p className="text-muted-foreground text-sm">
          Como {tenant.name} numera sus comprobantes y con que las emite.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle as="h2">Estado</CardTitle>
          <CardDescription>
            Desactivar no borra nada; solo detiene la emision de comprobantes nuevos.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <BillingActiveToggleForm tenantSlug={tenant.slug} isActive={config.isActive} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2">Proveedor y series</CardTitle>
          <CardDescription>
            Las series usan un valor por defecto si las dejas en blanco - no necesitas configurar
            nada para emitir tu primer comprobante.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <BillingProviderConfigForm
            tenantSlug={tenant.slug}
            values={{
              seriesBoleta: config.seriesBoleta,
              seriesFactura: config.seriesFactura,
              seriesNotaCredito: config.seriesNotaCredito,
              seriesNotaDebito: config.seriesNotaDebito,
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2">Credenciales</CardTitle>
          <CardDescription>
            Se guardan cifradas y nadie, ni siquiera este panel, las vuelve a leer. Con el proveedor
            manual no son necesarias.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <BillingCredentialsForm
            tenantSlug={tenant.slug}
            hasCredentials={config.hasCredentials}
            credentialsUpdatedAt={config.credentialsUpdatedAt}
          />
        </CardContent>
      </Card>
    </div>
  );
}
