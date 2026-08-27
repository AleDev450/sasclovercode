"use client";

import { useActionState } from "react";
import { Alert, AlertDescription, Button, Input, Label } from "@/components/ui";
import { IDLE_FORM_STATE } from "@/lib/forms/state";
import type { OrderStatus } from "@/types/database";
import { ORDER_STATUS_LABELS, isTerminal, nextForwardStatus } from "../lifecycle";
import { advanceOrderStatusAction, cancelOrderAction } from "../server/actions";

/**
 * The forward button.
 *
 * Which button to draw comes from the state machine, not from a list written
 * here: `nextForwardStatus` reads the same map that TEST-1301 pins to the SQL
 * table. A button for a transition the database refuses is the failure this
 * avoids.
 */
export function AdvanceOrderForm({
  tenantSlug,
  orderId,
  status,
}: {
  tenantSlug: string;
  orderId: string;
  status: OrderStatus;
}) {
  const [state, formAction, isPending] = useActionState(advanceOrderStatusAction, IDLE_FORM_STATE);

  const next = nextForwardStatus(status);
  if (next === null) return null;

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="toStatus" value={next} />

      {state.message !== undefined ? (
        <Alert variant={state.status === "success" ? "success" : "warning"}>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <Button type="submit" loading={isPending} loadingLabel="Guardando">
        Pasar a {ORDER_STATUS_LABELS[next].toLowerCase()}
      </Button>
    </form>
  );
}

/**
 * Cancelling, which is deliberately not the same control as advancing.
 *
 * Different permission (`orders.cancel`), different visual weight, and a reason
 * that is required rather than optional — the database refuses a cancellation
 * without one, so asking for it here is the difference between a form and an
 * error message.
 */
export function CancelOrderForm({
  tenantSlug,
  orderId,
  status,
}: {
  tenantSlug: string;
  orderId: string;
  status: OrderStatus;
}) {
  const [state, formAction, isPending] = useActionState(cancelOrderAction, IDLE_FORM_STATE);

  if (isTerminal(status)) return null;
  const errors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="orderId" value={orderId} />

      {state.message !== undefined ? (
        <Alert variant={state.status === "success" ? "success" : "warning"}>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-2">
        <Label htmlFor="reason">Motivo de la anulacion</Label>
        <Input
          id="reason"
          name="reason"
          placeholder="El cliente se retiro"
          invalid={errors.reason !== undefined}
          aria-describedby={errors.reason !== undefined ? "reason-error" : undefined}
        />
        {errors.reason !== undefined ? (
          <p id="reason-error" className="text-destructive text-sm">
            {errors.reason[0]}
          </p>
        ) : null}
      </div>

      <Button type="submit" variant="destructive" loading={isPending} loadingLabel="Anulando">
        Anular pedido
      </Button>
      <p className="text-muted-foreground text-xs">
        Un pedido anulado no se puede reabrir. Queda registrado con su motivo.
      </p>
    </form>
  );
}
