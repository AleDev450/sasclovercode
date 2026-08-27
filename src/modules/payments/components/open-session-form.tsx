"use client";

import { useActionState } from "react";
import { Alert, AlertDescription, Button, Input, Label } from "@/components/ui";
import { IDLE_FORM_STATE } from "@/lib/forms/state";
import { openCashSessionAction } from "../server/actions";

export function OpenSessionForm({
  tenantSlug,
  cashRegisterId,
}: {
  tenantSlug: string;
  cashRegisterId: string;
}) {
  const [state, formAction, isPending] = useActionState(openCashSessionAction, IDLE_FORM_STATE);
  const errors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="cashRegisterId" value={cashRegisterId} />

      <div className="flex flex-col gap-2">
        <Label htmlFor={`opening-${cashRegisterId}`}>Monto inicial</Label>
        <Input
          id={`opening-${cashRegisterId}`}
          name="opening"
          inputMode="decimal"
          defaultValue="0.00"
          className="w-32"
          invalid={errors.opening !== undefined}
        />
      </div>

      <Button type="submit" loading={isPending} loadingLabel="Abriendo">
        Abrir caja
      </Button>

      {state.message !== undefined ? (
        <Alert variant={state.status === "success" ? "success" : "warning"} className="w-full">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}
      {errors.opening !== undefined ? (
        <p className="text-destructive w-full text-sm">{errors.opening[0]}</p>
      ) : null}
    </form>
  );
}
