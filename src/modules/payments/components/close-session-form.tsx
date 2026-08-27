"use client";

import { useActionState } from "react";
import { Alert, AlertDescription, Button, Input, Label } from "@/components/ui";
import { IDLE_FORM_STATE } from "@/lib/forms/state";
import { formatCurrency, formatMoney } from "@/lib/money";
import { closeCashSessionAction } from "../server/actions";

/**
 * Closing a session.
 *
 * `runningTotalCents` is a PREVIEW, computed by
 * `getCashSessionDetail` at read time from the same ledger
 * `close_cash_session()` will sum in the database. It is shown so the
 * cashier is not counting blind, but it is not what gets stored - the
 * trigger recomputes `expected_cents` itself when this form submits, the
 * same way an order's total is never trusted from a form (Phase 13).
 */
export function CloseSessionForm({
  tenantSlug,
  cashSessionId,
  runningTotalCents,
  currency,
}: {
  tenantSlug: string;
  cashSessionId: string;
  runningTotalCents: number;
  currency: string;
}) {
  const [state, formAction, isPending] = useActionState(closeCashSessionAction, IDLE_FORM_STATE);
  const errors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="cashSessionId" value={cashSessionId} />

      {state.message !== undefined ? (
        <Alert variant={state.status === "success" ? "success" : "warning"}>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <p className="text-muted-foreground text-sm">
        Segun el registro, en la caja deberia haber{" "}
        <span className="font-medium">{formatCurrency(runningTotalCents, currency)}</span>. Cuenta
        el efectivo antes de cerrar.
      </p>

      <div className="flex flex-col gap-2">
        <Label htmlFor="closing">Monto contado</Label>
        <Input
          id="closing"
          name="closing"
          inputMode="decimal"
          defaultValue={formatMoney(runningTotalCents)}
          className="w-40"
          invalid={errors.closing !== undefined}
        />
        {errors.closing !== undefined ? (
          <p className="text-destructive text-sm">{errors.closing[0]}</p>
        ) : null}
      </div>

      <div>
        <Button type="submit" variant="destructive" loading={isPending} loadingLabel="Cerrando">
          Cerrar caja
        </Button>
      </div>
    </form>
  );
}
