"use client";

import { useActionState } from "react";
import { Alert, AlertDescription, Button, Input, Label } from "@/components/ui";
import { IDLE_FORM_STATE } from "@/lib/forms/state";
import { CASH_MOVEMENT_TYPE_LABELS, MANUAL_CASH_MOVEMENT_TYPES } from "../constants";
import { recordCashMovementAction } from "../server/actions";

const selectClass =
  "border-input bg-background focus-visible:ring-ring h-10 rounded-md border px-3 text-sm focus-visible:ring-2 focus-visible:outline-none";

/**
 * A manual movement: a payout, a deposit, or a correction. Amount is typed as
 * a plain positive number - `payout` is negated by the Server Action
 * regardless, and only `adjustment` actually reads the sign, via a leading
 * "-" (schemas.ts's `signedMoneyField`).
 */
export function CashMovementForm({
  tenantSlug,
  cashSessionId,
}: {
  tenantSlug: string;
  cashSessionId: string;
}) {
  const [state, formAction, isPending] = useActionState(recordCashMovementAction, IDLE_FORM_STATE);
  const errors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="cashSessionId" value={cashSessionId} />

      <div className="flex flex-col gap-2">
        <Label htmlFor="type">Tipo</Label>
        <select id="type" name="type" className={selectClass} defaultValue="payout">
          {MANUAL_CASH_MOVEMENT_TYPES.map((type) => (
            <option key={type} value={type}>
              {CASH_MOVEMENT_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="amount">Monto</Label>
        <Input id="amount" name="amount" inputMode="decimal" className="w-28" placeholder="0.00" />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="reason">Motivo</Label>
        <Input id="reason" name="reason" className="w-56" invalid={errors.reason !== undefined} />
      </div>

      <Button type="submit" variant="outline" loading={isPending} loadingLabel="Guardando">
        Registrar
      </Button>

      {state.message !== undefined ? (
        <Alert variant={state.status === "success" ? "success" : "warning"} className="w-full">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}
      {errors.amount !== undefined ? (
        <p className="text-destructive w-full text-sm">{errors.amount[0]}</p>
      ) : null}
      {errors.reason !== undefined ? (
        <p className="text-destructive w-full text-sm">{errors.reason[0]}</p>
      ) : null}
    </form>
  );
}
