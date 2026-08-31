import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
} from "@/components/ui";
import { formatMoney } from "@/lib/money";
import {
  OutstandingChargesTable,
  RecentChargesTable,
  RunCycleForm,
} from "@/modules/platform/components/saas-billing";
import {
  listOutstandingCharges,
  listRecentCharges,
} from "@/modules/platform/server/billing-queries";
import { listPlans } from "@/modules/platform/server/subscription-queries";

export const metadata = { title: "Cobranza" };

/**
 * CloverCode's own collections board.
 *
 * The platform layout already ran `requirePlatformAdmin()`, and every action on
 * this page checks again, and every SQL function checks a third time.
 *
 * MASTER SECTION 22: nothing here is the restaurant's billing. That lives in
 * the tenant dashboard, under Facturacion, and the two share no table.
 */
export default async function SaasBillingPage() {
  const [outstanding, recent, plans] = await Promise.all([
    listOutstandingCharges(),
    listRecentCharges(),
    listPlans(),
  ]);

  const owedCents = outstanding.reduce((sum, charge) => sum + charge.amountCents, 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Cobranza</h1>
          <p className="text-muted-foreground text-sm">
            Lo que CloverCode le cobra a los negocios. Nada de esto es la facturacion que ellos
            emiten a sus clientes.
          </p>
        </div>
        <RunCycleForm />
      </div>

      <Card>
        <CardHeader>
          <CardTitle as="h2">Terminos de los planes</CardTitle>
          <CardDescription>
            En solo lectura: <code>plans</code> es catalogo del producto y cambia por migracion,
            igual que su precio y sus modulos.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[34rem] border-collapse text-sm">
            <caption className="sr-only">Terminos comerciales de cada plan</caption>
            <thead>
              <tr className="border-border text-muted-foreground border-b text-left text-xs">
                <th scope="col" className="px-2 py-2 font-medium">
                  Plan
                </th>
                <th scope="col" className="px-2 py-2 font-medium">
                  Precio
                </th>
                <th scope="col" className="px-2 py-2 font-medium">
                  Prueba
                </th>
                <th scope="col" className="px-2 py-2 font-medium">
                  Gracia
                </th>
              </tr>
            </thead>
            <tbody>
              {plans.map((plan) => (
                <tr key={plan.code} className="border-border/60 border-b last:border-0">
                  <td className="px-2 py-2">
                    {plan.name}
                    {plan.isDefault ? (
                      <span className="text-muted-foreground text-xs"> · por defecto</span>
                    ) : null}
                  </td>
                  <td className="px-2 py-2 tabular-nums">
                    {formatMoney(plan.priceCents)} {plan.currency}{" "}
                    {plan.interval === "monthly" ? "/ mes" : "/ ano"}
                  </td>
                  <td className="px-2 py-2 tabular-nums">{plan.trialDays} dias</td>
                  <td className="px-2 py-2 tabular-nums">{plan.graceDays} dias</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {outstanding.length === 0 && recent.length === 0 ? (
        <EmptyState
          title="Todavia no hay cargos emitidos"
          description="Corre el ciclo de cobranza para emitir los cargos de los periodos que ya empezaron."
        />
      ) : (
        <>
          {outstanding.length === 0 ? (
            <EmptyState
              title="Nada por cobrar"
              description="Ningun negocio tiene cargos pendientes ahora mismo."
            />
          ) : (
            <>
              <Card>
                <CardHeader>
                  <CardTitle as="h2">Pendiente de cobro</CardTitle>
                  <CardDescription>
                    {outstanding.length} cargo(s) por {formatMoney(owedCents)}{" "}
                    {outstanding[0]!.currency}.
                  </CardDescription>
                </CardHeader>
              </Card>
              <OutstandingChargesTable charges={outstanding} />
            </>
          )}

          {recent.length > 0 ? <RecentChargesTable charges={recent} /> : null}
        </>
      )}
    </div>
  );
}
