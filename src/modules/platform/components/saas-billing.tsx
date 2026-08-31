import Link from "next/link";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui";
import { formatCurrency } from "@/lib/money";
import type { SaasPaymentStatus } from "@/types/database";
import { isOverdue, SAAS_PAYMENT_STATUS_LABELS, SUBSCRIPTION_EVENT_LABELS } from "../billing";
import {
  recordSaasPaymentAction,
  runSubscriptionBillingAction,
  setCancelAtPeriodEndAction,
  voidSaasPaymentAction,
} from "../server/actions";
import type {
  SaasCharge,
  SaasChargeWithTenant,
  SubscriptionEvent,
} from "../server/billing-queries";

const STATUS_VARIANT: Readonly<
  Record<SaasPaymentStatus, "success" | "warning" | "neutral" | "destructive">
> = {
  pending: "warning",
  paid: "success",
  failed: "destructive",
  refunded: "neutral",
  void: "neutral",
};

function ChargeStatusBadge({ charge }: { charge: { status: SaasPaymentStatus; dueAt: string } }) {
  const overdue = isOverdue(charge);
  return (
    <Badge variant={overdue ? "destructive" : STATUS_VARIANT[charge.status]}>
      {overdue ? "Vencido" : SAAS_PAYMENT_STATUS_LABELS[charge.status]}
    </Badge>
  );
}

/**
 * The button that runs the cycle.
 *
 * ADR-026 decision 2: there is no scheduler, so a person presses this. The
 * function behind it is idempotent, which is exactly what makes a button an
 * acceptable trigger - pressing it twice does nothing the second time.
 */
export function RunCycleForm() {
  return (
    <form action={runSubscriptionBillingAction}>
      <Button type="submit">Correr ciclo de cobranza</Button>
    </form>
  );
}

function RecordPaymentForm({ chargeId }: { chargeId: string }) {
  return (
    <form action={recordSaasPaymentAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="paymentId" value={chargeId} />
      <div className="flex min-w-[8rem] flex-col gap-1">
        <label htmlFor={`method-${chargeId}`} className="text-muted-foreground text-xs">
          Metodo
        </label>
        <input
          id={`method-${chargeId}`}
          name="method"
          className="border-input bg-background h-8 rounded-md border px-2 text-xs"
          placeholder="Transferencia"
          required
        />
      </div>
      <div className="flex min-w-[9rem] flex-col gap-1">
        <label htmlFor={`reference-${chargeId}`} className="text-muted-foreground text-xs">
          Referencia
        </label>
        <input
          id={`reference-${chargeId}`}
          name="reference"
          className="border-input bg-background h-8 rounded-md border px-2 text-xs"
          placeholder="Op. 004512"
        />
      </div>
      <Button type="submit" size="sm">
        Registrar pago
      </Button>
    </form>
  );
}

function VoidChargeForm({ chargeId }: { chargeId: string }) {
  return (
    <form action={voidSaasPaymentAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="paymentId" value={chargeId} />
      <div className="flex min-w-[10rem] flex-col gap-1">
        <label htmlFor={`reason-${chargeId}`} className="text-muted-foreground text-xs">
          Motivo
        </label>
        <input
          id={`reason-${chargeId}`}
          name="reason"
          className="border-input bg-background h-8 rounded-md border px-2 text-xs"
          placeholder="Emitido por error"
          required
        />
      </div>
      <Button type="submit" size="sm" variant="ghost">
        Anular cargo
      </Button>
    </form>
  );
}

/** The collections board: everything owed, across every business. */
export function OutstandingChargesTable({ charges }: { charges: readonly SaasChargeWithTenant[] }) {
  return (
    <Card className="overflow-x-auto">
      <CardHeader>
        <CardTitle as="h2">Por cobrar</CardTitle>
        <CardDescription>
          Cargos pendientes, del mas antiguo al mas nuevo. El mas viejo es el que decide si un
          negocio se suspende.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <table className="w-full min-w-[52rem] border-collapse text-sm">
          <caption className="sr-only">Cargos pendientes de cobro</caption>
          <thead>
            <tr className="border-border text-muted-foreground border-b text-left text-xs">
              <th scope="col" className="px-2 py-2 font-medium">
                Negocio
              </th>
              <th scope="col" className="px-2 py-2 font-medium">
                Periodo
              </th>
              <th scope="col" className="px-2 py-2 font-medium">
                Importe
              </th>
              <th scope="col" className="px-2 py-2 font-medium">
                Vence
              </th>
              <th scope="col" className="px-2 py-2 font-medium">
                Estado
              </th>
              <th scope="col" className="px-2 py-2 font-medium">
                Acciones
              </th>
            </tr>
          </thead>
          <tbody>
            {charges.map((charge) => (
              <tr key={charge.id} className="border-border/60 border-b align-top last:border-0">
                <td className="px-2 py-3">
                  <Link
                    href={`/super-admin/tenants/${charge.tenantId}`}
                    className="font-medium hover:underline"
                  >
                    {charge.tenantName}
                  </Link>
                  <span className="text-muted-foreground block font-mono text-xs">
                    {charge.planCode}
                  </span>
                </td>
                <td className="px-2 py-3 text-xs">
                  {new Date(charge.periodStart).toLocaleDateString("es-PE")} →{" "}
                  {new Date(charge.periodEnd).toLocaleDateString("es-PE")}
                </td>
                <td className="px-2 py-3 tabular-nums">
                  {formatCurrency(charge.amountCents, charge.currency)}
                </td>
                <td className="px-2 py-3 tabular-nums">
                  {new Date(charge.dueAt).toLocaleDateString("es-PE")}
                </td>
                <td className="px-2 py-3">
                  <ChargeStatusBadge charge={charge} />
                </td>
                <td className="px-2 py-3">
                  <div className="flex flex-col gap-2">
                    <RecordPaymentForm chargeId={charge.id} />
                    <VoidChargeForm chargeId={charge.id} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

/** Everything issued lately, whatever its status. */
export function RecentChargesTable({ charges }: { charges: readonly SaasChargeWithTenant[] }) {
  return (
    <Card className="overflow-x-auto">
      <CardHeader>
        <CardTitle as="h2">Ultimos cargos</CardTitle>
        <CardDescription>Lo emitido recientemente, cobrado o no.</CardDescription>
      </CardHeader>
      <CardContent>
        <table className="w-full min-w-[44rem] border-collapse text-sm">
          <caption className="sr-only">Cargos recientes</caption>
          <thead>
            <tr className="border-border text-muted-foreground border-b text-left text-xs">
              <th scope="col" className="px-2 py-2 font-medium">
                Negocio
              </th>
              <th scope="col" className="px-2 py-2 font-medium">
                Periodo
              </th>
              <th scope="col" className="px-2 py-2 font-medium">
                Importe
              </th>
              <th scope="col" className="px-2 py-2 font-medium">
                Estado
              </th>
              <th scope="col" className="px-2 py-2 font-medium">
                Cobrado
              </th>
            </tr>
          </thead>
          <tbody>
            {charges.map((charge) => (
              <tr key={charge.id} className="border-border/60 border-b last:border-0">
                <td className="px-2 py-2">
                  <Link
                    href={`/super-admin/tenants/${charge.tenantId}`}
                    className="hover:underline"
                  >
                    {charge.tenantName}
                  </Link>
                </td>
                <td className="px-2 py-2 text-xs">
                  {new Date(charge.periodStart).toLocaleDateString("es-PE")}
                </td>
                <td className="px-2 py-2 tabular-nums">
                  {formatCurrency(charge.amountCents, charge.currency)}
                </td>
                <td className="px-2 py-2">
                  <ChargeStatusBadge charge={charge} />
                </td>
                <td className="text-muted-foreground px-2 py-2 text-xs">
                  {charge.paidAt === null
                    ? (charge.notes ?? "—")
                    : `${new Date(charge.paidAt).toLocaleDateString("es-PE")} · ${charge.method ?? ""} ${charge.reference ?? ""}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

/** One business's charges and history, on its Super Admin page. */
export function TenantBillingCard({
  tenantId,
  charges,
  events,
  cancelAtPeriodEnd,
}: {
  tenantId: string;
  charges: readonly SaasCharge[];
  events: readonly SubscriptionEvent[];
  cancelAtPeriodEnd: boolean;
}) {
  const owed = charges.filter((charge) => charge.status === "pending");

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle as="h2">Cobranza</CardTitle>
            <CardDescription>
              Lo que CloverCode le cobra a este negocio. No tiene relacion con lo que el negocio le
              cobra a sus clientes.
            </CardDescription>
          </div>
          {owed.length > 0 ? (
            <Badge variant="warning">
              {owed.length} pendiente(s) ·{" "}
              {formatCurrency(
                owed.reduce((sum, charge) => sum + charge.amountCents, 0),
                owed[0]!.currency,
              )}
            </Badge>
          ) : (
            <Badge variant="success">Al dia</Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-6">
        <form action={setCancelAtPeriodEndAction} className="flex flex-wrap items-center gap-3">
          <input type="hidden" name="tenantId" value={tenantId} />
          <input type="hidden" name="cancel" value={cancelAtPeriodEnd ? "false" : "true"} />
          <span className="text-sm">
            {cancelAtPeriodEnd
              ? "Se cancelara al terminar el periodo pagado."
              : "La suscripcion se renueva al terminar el periodo."}
          </span>
          <Button type="submit" size="sm" variant="secondary">
            {cancelAtPeriodEnd ? "No cancelar" : "Cancelar al fin del periodo"}
          </Button>
        </form>

        {charges.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Sin cargos todavia. Se emiten al correr el ciclo de cobranza.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] border-collapse text-sm">
              <caption className="sr-only">Cargos de este negocio</caption>
              <thead>
                <tr className="border-border text-muted-foreground border-b text-left text-xs">
                  <th scope="col" className="px-2 py-2 font-medium">
                    Periodo
                  </th>
                  <th scope="col" className="px-2 py-2 font-medium">
                    Importe
                  </th>
                  <th scope="col" className="px-2 py-2 font-medium">
                    Estado
                  </th>
                  <th scope="col" className="px-2 py-2 font-medium">
                    Accion
                  </th>
                </tr>
              </thead>
              <tbody>
                {charges.map((charge) => (
                  <tr key={charge.id} className="border-border/60 border-b align-top last:border-0">
                    <td className="px-2 py-3 text-xs">
                      {new Date(charge.periodStart).toLocaleDateString("es-PE")} →{" "}
                      {new Date(charge.periodEnd).toLocaleDateString("es-PE")}
                    </td>
                    <td className="px-2 py-3 tabular-nums">
                      {formatCurrency(charge.amountCents, charge.currency)}
                    </td>
                    <td className="px-2 py-3">
                      <ChargeStatusBadge charge={charge} />
                      {charge.notes === null ? null : (
                        <span className="text-muted-foreground mt-1 block text-xs">
                          {charge.notes}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-3">
                      {charge.status === "pending" ? (
                        <div className="flex flex-col gap-2">
                          <RecordPaymentForm chargeId={charge.id} />
                          <VoidChargeForm chargeId={charge.id} />
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-xs">
                          {charge.paidAt === null
                            ? "—"
                            : new Date(charge.paidAt).toLocaleDateString("es-PE")}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div>
          <h3 className="mb-2 text-sm font-medium">Historial</h3>
          {events.length === 0 ? (
            <p className="text-muted-foreground text-sm">Sin movimientos.</p>
          ) : (
            <ol className="flex flex-col gap-1 text-sm">
              {events.map((event) => (
                <li key={event.id} className="flex flex-wrap gap-2">
                  <span className="text-muted-foreground tabular-nums">
                    {new Date(event.createdAt).toLocaleString("es-PE")}
                  </span>
                  <span>{SUBSCRIPTION_EVENT_LABELS[event.type]}</span>
                  {event.fromStatus !== null && event.toStatus !== null ? (
                    <span className="text-muted-foreground">
                      · {event.fromStatus} → {event.toStatus}
                    </span>
                  ) : null}
                  {event.fromPlan !== null && event.toPlan !== null ? (
                    <span className="text-muted-foreground">
                      · {event.fromPlan} → {event.toPlan}
                    </span>
                  ) : null}
                  {event.detail !== null ? (
                    <span className="text-muted-foreground">· {event.detail}</span>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
