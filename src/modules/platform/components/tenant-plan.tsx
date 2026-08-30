import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui";
import { SUBSCRIPTION_STATUS_LABELS, type Module } from "@/lib/features";
import { formatMoney } from "@/lib/money";
import type { SubscriptionStatus } from "@/types/database";
import {
  setSubscriptionStatusAction,
  setTenantModuleAction,
  setTenantPlanAction,
} from "../server/actions";
import type {
  ModuleDefinition,
  ModuleOverride,
  Plan,
  TenantSubscription,
} from "../server/subscription-queries";

const STATUS_VARIANT: Readonly<Record<SubscriptionStatus, "success" | "warning" | "neutral">> = {
  trialing: "warning",
  active: "success",
  past_due: "warning",
  suspended: "neutral",
  cancelled: "neutral",
};

const ALL_STATUSES: readonly SubscriptionStatus[] = [
  "trialing",
  "active",
  "past_due",
  "suspended",
  "cancelled",
];

/**
 * Plan and modules for one tenant, on the Super Admin screen.
 *
 * A server component whose forms post straight to Server Actions - the shape
 * the rest of `/super-admin` already uses. Nothing here decides authorization:
 * every action starts with `requirePlatformAdmin()` and RLS refuses the write
 * again underneath.
 */
export function TenantPlanCard({
  tenantId,
  subscription,
  plans,
  modules,
  overrides,
}: {
  tenantId: string;
  subscription: TenantSubscription | null;
  plans: readonly Plan[];
  modules: readonly ModuleDefinition[];
  overrides: readonly ModuleOverride[];
}) {
  if (subscription === null) {
    return (
      <Card>
        <CardHeader>
          <CardTitle as="h2">Plan</CardTitle>
          <CardDescription>Este negocio no tiene suscripcion.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const currentPlan = plans.find((plan) => plan.code === subscription.planCode);
  const overrideFor = (code: Module): ModuleOverride | undefined =>
    overrides.find((override) => override.moduleCode === code);

  /** What the plan alone would say, before any override. */
  const planIncludes = (code: Module): boolean => currentPlan?.modules.includes(code) ?? false;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle as="h2">Plan y modulos</CardTitle>
            <CardDescription>
              {subscription.planName} · {formatMoney(subscription.priceCents)}{" "}
              {subscription.interval === "monthly" ? "al mes" : "al ano"}
            </CardDescription>
          </div>
          <Badge variant={STATUS_VARIANT[subscription.status]}>
            {SUBSCRIPTION_STATUS_LABELS[subscription.status]}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <form action={setTenantPlanAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="tenantId" value={tenantId} />
            <div className="flex min-w-[11rem] flex-col gap-2">
              <label htmlFor="planCode" className="text-sm font-medium">
                Plan
              </label>
              <select
                id="planCode"
                name="planCode"
                className="border-input bg-background h-9 rounded-md border px-2 text-sm"
                defaultValue={subscription.planCode}
              >
                {plans
                  .filter((plan) => plan.isActive || plan.code === subscription.planCode)
                  .map((plan) => (
                    <option key={plan.code} value={plan.code}>
                      {plan.name}
                    </option>
                  ))}
              </select>
            </div>
            <Button type="submit" size="sm" variant="secondary">
              Cambiar plan
            </Button>
          </form>

          <form action={setSubscriptionStatusAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="tenantId" value={tenantId} />
            <div className="flex min-w-[11rem] flex-col gap-2">
              <label htmlFor="subscriptionStatus" className="text-sm font-medium">
                Estado
              </label>
              <select
                id="subscriptionStatus"
                name="status"
                className="border-input bg-background h-9 rounded-md border px-2 text-sm"
                defaultValue={subscription.status}
              >
                {ALL_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {SUBSCRIPTION_STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
            </div>
            <Button type="submit" size="sm" variant="secondary">
              Cambiar estado
            </Button>
          </form>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[38rem] border-collapse text-sm">
            <caption className="sr-only">Modulos de este negocio</caption>
            <thead>
              <tr className="border-border text-muted-foreground border-b text-left text-xs">
                <th scope="col" className="px-2 py-2 font-medium">
                  Modulo
                </th>
                <th scope="col" className="px-2 py-2 font-medium">
                  El plan
                </th>
                <th scope="col" className="px-2 py-2 font-medium">
                  Excepcion
                </th>
                <th scope="col" className="px-2 py-2 font-medium">
                  Resultado
                </th>
                <th scope="col" className="px-2 py-2 font-medium">
                  Cambiar
                </th>
              </tr>
            </thead>
            <tbody>
              {modules.map((module) => {
                const override = overrideFor(module.code);
                const fromPlan = planIncludes(module.code);
                // The same precedence `has_module()` applies, shown so an
                // operator can see WHY a module is on or off.
                const effective = override === undefined ? fromPlan : override.isEnabled;

                return (
                  <tr key={module.code} className="border-border/60 border-b last:border-0">
                    <td className="px-2 py-2">
                      <span className="block">{module.name}</span>
                      <span className="text-muted-foreground block font-mono text-xs">
                        {module.code}
                      </span>
                    </td>
                    <td className="px-2 py-2">{fromPlan ? "Incluido" : "No incluido"}</td>
                    <td className="px-2 py-2">
                      {override === undefined
                        ? "—"
                        : override.isEnabled
                          ? "Forzado si"
                          : "Forzado no"}
                    </td>
                    <td className="px-2 py-2">
                      <Badge variant={effective ? "success" : "neutral"}>
                        {effective ? "Disponible" : "No disponible"}
                      </Badge>
                    </td>
                    <td className="px-2 py-2">
                      <form action={setTenantModuleAction} className="flex items-center gap-2">
                        <input type="hidden" name="tenantId" value={tenantId} />
                        <input type="hidden" name="moduleCode" value={module.code} />
                        <label className="sr-only" htmlFor={`state-${module.code}`}>
                          Estado de {module.name}
                        </label>
                        <select
                          id={`state-${module.code}`}
                          name="state"
                          className="border-input bg-background h-8 rounded-md border px-2 text-xs"
                          defaultValue={
                            override === undefined ? "inherit" : override.isEnabled ? "on" : "off"
                          }
                        >
                          <option value="inherit">Segun el plan</option>
                          <option value="on">Forzar si</option>
                          <option value="off">Forzar no</option>
                        </select>
                        <Button type="submit" size="sm" variant="ghost">
                          Guardar
                        </Button>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
