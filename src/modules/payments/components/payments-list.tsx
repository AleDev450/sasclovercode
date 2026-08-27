"use client";

import { useActionState } from "react";
import { Alert, AlertDescription, Badge, Button, Input } from "@/components/ui";
import { IDLE_FORM_STATE } from "@/lib/forms/state";
import { formatCurrency } from "@/lib/money";
import type { OrderPayment } from "@/modules/orders/server/queries";
import { voidPaymentAction } from "../server/actions";

/**
 * One payment row, with its own void form.
 *
 * A separate component and not a row inside a shared form: `useActionState`
 * is one pending state per call, and each payment needs its own - voiding one
 * must not show every other row as "saving".
 */
function PaymentRow({
  tenantSlug,
  orderId,
  payment,
  currency,
  canVoid,
}: {
  tenantSlug: string;
  orderId: string;
  payment: OrderPayment;
  currency: string;
  canVoid: boolean;
}) {
  const [state, formAction, isPending] = useActionState(voidPaymentAction, IDLE_FORM_STATE);
  const errors = state.fieldErrors ?? {};
  const isVoided = payment.voidedAt !== null;

  return (
    <li className="flex flex-col gap-2 border-border border-b py-3 last:border-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <span className={isVoided ? "text-muted-foreground line-through" : undefined}>
            {payment.methodName}
          </span>
          {payment.reference !== null ? (
            <span className="text-muted-foreground text-sm"> · {payment.reference}</span>
          ) : null}
        </div>
        <span className={`tabular-nums ${isVoided ? "text-muted-foreground line-through" : ""}`}>
          {formatCurrency(payment.amountCents, currency)}
        </span>
      </div>

      {isVoided ? (
        <p className="text-muted-foreground text-xs">Anulado: {payment.voidReason}</p>
      ) : canVoid ? (
        <form action={formAction} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="tenantSlug" value={tenantSlug} />
          <input type="hidden" name="orderId" value={orderId} />
          <input type="hidden" name="paymentId" value={payment.id} />
          <Input
            name="reason"
            placeholder="Motivo de la anulacion"
            className="h-8 max-w-xs text-sm"
            invalid={errors.reason !== undefined}
          />
          <Button type="submit" variant="destructive" size="sm" loading={isPending} loadingLabel="Anulando">
            Anular
          </Button>
        </form>
      ) : null}
      {errors.reason !== undefined ? <p className="text-destructive text-xs">{errors.reason[0]}</p> : null}
      {state.message !== undefined && state.status === "error" && errors.reason === undefined ? (
        <Alert variant="warning">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}
    </li>
  );
}

export function PaymentsList({
  tenantSlug,
  orderId,
  payments,
  currency,
  canVoid,
}: {
  tenantSlug: string;
  orderId: string;
  payments: readonly OrderPayment[];
  currency: string;
  canVoid: boolean;
}) {
  if (payments.length === 0) {
    return <p className="text-muted-foreground text-sm">Todavia no se registro ningun pago.</p>;
  }

  return (
    <ul className="flex flex-col">
      {payments.map((payment) => (
        <PaymentRow
          key={payment.id}
          tenantSlug={tenantSlug}
          orderId={orderId}
          payment={payment}
          currency={currency}
          canVoid={canVoid}
        />
      ))}
    </ul>
  );
}

export function PaymentBalance({
  totalCents,
  paidCents,
  balanceCents,
  currency,
}: {
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  currency: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <span>
        Pagado <span className="tabular-nums font-medium">{formatCurrency(paidCents, currency)}</span>{" "}
        de {formatCurrency(totalCents, currency)}
      </span>
      <Badge variant={balanceCents === 0 ? "success" : "neutral"}>
        {balanceCents === 0 ? "Pagado" : `Falta ${formatCurrency(balanceCents, currency)}`}
      </Badge>
    </div>
  );
}
