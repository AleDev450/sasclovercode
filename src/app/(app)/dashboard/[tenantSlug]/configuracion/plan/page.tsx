import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui";
import { MODULE_LABELS, SUBSCRIPTION_STATUS_LABELS, type Module } from "@/lib/features";
import { getMyModules } from "@/lib/features/check";
import { formatCurrency } from "@/lib/money";
import { PERMISSIONS } from "@/lib/permissions";
import { hasPermission } from "@/lib/permissions/check";
import { requireActiveTenant } from "@/lib/tenant/active";
import { getTenantSubscription, listModules } from "@/modules/platform/server/subscription-queries";
import { getBusinessSettings } from "@/modules/settings/server/queries";

export const metadata = { title: "Plan" };

/**
 * What the business has contracted, read-only.
 *
 * Read-only on purpose (ADR-025 decision 6): changing a plan is a Super Admin
 * operation (master section 29), so this page has no form. What it answers is
 * UC-2104 - "¿que estoy pagando?" - which is a question an owner is entitled
 * to and which grants nothing by being answered.
 */
export default async function PlanPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
  const { tenantSlug } = await params;
  const tenant = await requireActiveTenant(tenantSlug);

  // No module gate here: a business must always be able to see what it has
  // contracted, including when what it has contracted is very little.
  if (!(await hasPermission(tenant.id, PERMISSIONS.SETTINGS_MANAGE))) {
    notFound();
  }

  const [subscription, modules, active, settings] = await Promise.all([
    getTenantSubscription(tenant.id),
    listModules(),
    getMyModules(tenant.id),
    getBusinessSettings(tenant.id),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link
          href={`/dashboard/${tenant.slug}/configuracion`}
          className="text-muted-foreground text-sm hover:underline"
        >
          ← Configuracion
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Plan</h1>
        <p className="text-muted-foreground text-sm">
          Lo que {tenant.name} tiene contratado en CloverCode.
        </p>
      </div>

      {subscription === null ? (
        <Card>
          <CardHeader>
            <CardTitle as="h2">Sin suscripcion</CardTitle>
            <CardDescription>
              Este negocio no tiene un plan asignado. Escribenos para activarlo.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle as="h2">{subscription.planName}</CardTitle>
                <CardDescription>
                  {formatCurrency(subscription.priceCents, settings.currency)}{" "}
                  {subscription.interval === "monthly" ? "al mes" : "al ano"}
                  {subscription.currentPeriodEnd === null
                    ? ""
                    : ` · periodo hasta el ${new Date(
                        subscription.currentPeriodEnd,
                      ).toLocaleDateString("es-PE")}`}
                </CardDescription>
              </div>
              <Badge
                variant={
                  subscription.status === "active"
                    ? "success"
                    : subscription.status === "suspended" || subscription.status === "cancelled"
                      ? "neutral"
                      : "warning"
                }
              >
                {SUBSCRIPTION_STATUS_LABELS[subscription.status]}
              </Badge>
            </div>
          </CardHeader>

          <CardContent>
            <table className="w-full min-w-[24rem] border-collapse text-sm">
              <caption className="sr-only">Modulos incluidos en el plan de {tenant.name}</caption>
              <thead>
                <tr className="border-border text-muted-foreground border-b text-left text-xs">
                  <th scope="col" className="px-2 py-2 font-medium">
                    Modulo
                  </th>
                  <th scope="col" className="px-2 py-2 font-medium">
                    Estado
                  </th>
                </tr>
              </thead>
              <tbody>
                {modules.map((module) => {
                  // The effective answer, from `my_modules()` - which is the
                  // same function the menu and every page use, so this table
                  // cannot disagree with what the person actually sees.
                  const available = active.has(module.code as Module);
                  return (
                    <tr key={module.code} className="border-border/60 border-b last:border-0">
                      <td className="px-2 py-2">
                        <span className="block">{MODULE_LABELS[module.code as Module]}</span>
                        {module.description === null ? null : (
                          <span className="text-muted-foreground block text-xs">
                            {module.description}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-2">
                        <Badge variant={available ? "success" : "neutral"}>
                          {available ? "Incluido" : "No incluido"}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
