import Link from "next/link";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui";
import { listTenantDomains } from "@/modules/domains/server/queries";
import { PlatformTenantDomains } from "@/modules/platform/components/tenant-domains";
import { setTenantStatusAction } from "@/modules/platform/server/actions";
import { getPlatformTenant } from "@/modules/platform/server/queries";
import { TenantPlanCard } from "@/modules/platform/components/tenant-plan";
import { TenantBillingCard } from "@/modules/platform/components/saas-billing";
import {
  listSubscriptionEvents,
  listTenantCharges,
} from "@/modules/platform/server/billing-queries";
import {
  getTenantSubscription,
  listModules,
  listPlans,
  listTenantModuleOverrides,
} from "@/modules/platform/server/subscription-queries";

const STATUS_LABEL = {
  active: "Activa",
  suspended: "Suspendida",
  archived: "Archivada",
} as const;

const STATUS_VARIANT = {
  active: "success",
  suspended: "warning",
  archived: "neutral",
} as const;

/**
 * A destructive action needs an explicit act of confirmation (master §36).
 * `onSubmit` with `confirm()` would need a client component; requiring a
 * checkbox keeps the page a Server Component and works without JavaScript.
 */
function StatusAction({
  tenantId,
  status,
  label,
  description,
  destructive,
}: {
  tenantId: string;
  status: "active" | "suspended" | "archived";
  label: string;
  description: string;
  destructive?: boolean;
}) {
  const confirmId = `confirm-${status}`;
  return (
    <form action={setTenantStatusAction} className="flex flex-col gap-3">
      <input type="hidden" name="tenantId" value={tenantId} />
      <input type="hidden" name="status" value={status} />
      <p className="text-muted-foreground text-sm">{description}</p>
      {destructive === true ? (
        <label htmlFor={confirmId} className="flex items-center gap-2 text-sm">
          <input id={confirmId} type="checkbox" required className="size-4" />
          Confirmo que entiendo el efecto de esta accion.
        </label>
      ) : null}
      <Button type="submit" variant={destructive === true ? "destructive" : "secondary"}>
        {label}
      </Button>
    </form>
  );
}

export default async function PlatformTenantDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tenant = await getPlatformTenant(id);
  // The platform SELECT policy on `tenant_domains` lets an operator read any
  // tenant's rows, so the same query the business uses serves this screen too.
  const [domains, subscription, plans, modules, overrides, charges, events] = await Promise.all([
    listTenantDomains(tenant.id),
    getTenantSubscription(tenant.id),
    listPlans(),
    listModules(),
    listTenantModuleOverrides(tenant.id),
    listTenantCharges(tenant.id),
    listSubscriptionEvents(tenant.id),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{tenant.name}</h1>
          <p className="text-muted-foreground text-sm">{tenant.slug}</p>
        </div>
        <Badge variant={STATUS_VARIANT[tenant.status]}>{STATUS_LABEL[tenant.status]}</Badge>
      </div>

      {tenant.status === "suspended" ? (
        <Alert variant="warning">
          <AlertDescription>
            Esta empresa esta suspendida. Su sitio sigue resolviendo para poder mostrar un aviso.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle as="h2">Dominio principal</CardTitle>
            <CardDescription>La direccion canonica de su sitio publico.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="font-mono text-sm">{tenant.primaryDomain ?? "Sin dominio principal"}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle as="h2">Miembros</CardTitle>
            <CardDescription>Usuarios con acceso a esta empresa.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums">{tenant.memberCount}</p>
          </CardContent>
        </Card>
      </div>

      <PlatformTenantDomains tenantId={tenant.id} domains={domains} />

      <Card>
        <CardHeader>
          <CardTitle as="h2">Estado</CardTitle>
          <CardDescription>Suspender bloquea la empresa sin borrar nada.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6 sm:flex-row">
          {tenant.status !== "active" ? (
            <StatusAction
              tenantId={tenant.id}
              status="active"
              label="Reactivar"
              description="Devuelve la empresa a funcionamiento normal."
            />
          ) : null}
          {tenant.status !== "suspended" ? (
            <StatusAction
              tenantId={tenant.id}
              status="suspended"
              label="Suspender"
              description="La empresa deja de operar. No se borra ningun dato."
              destructive
            />
          ) : null}
          {tenant.status !== "archived" ? (
            <StatusAction
              tenantId={tenant.id}
              status="archived"
              label="Archivar"
              description="Su sitio deja de resolver. Los datos se conservan."
              destructive
            />
          ) : null}
        </CardContent>
      </Card>

      <TenantPlanCard
        tenantId={tenant.id}
        subscription={subscription}
        plans={plans}
        modules={modules}
        overrides={overrides}
      />

      <TenantBillingCard
        tenantId={tenant.id}
        charges={charges}
        events={events}
        cancelAtPeriodEnd={subscription?.cancelAtPeriodEnd ?? false}
      />

      <Link href="/super-admin/tenants" className="text-muted-foreground text-sm hover:underline">
        Volver al listado
      </Link>
    </div>
  );
}
