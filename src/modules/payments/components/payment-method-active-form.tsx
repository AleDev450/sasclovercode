"use client";

import { useActionState } from "react";
import { Alert, AlertDescription, Button } from "@/components/ui";
import { IDLE_FORM_STATE } from "@/lib/forms/state";
import { setPaymentMethodActiveAction } from "../server/actions";

export function SetPaymentMethodActiveForm({
  tenantSlug,
  paymentMethodId,
  isActive,
}: {
  tenantSlug: string;
  paymentMethodId: string;
  isActive: boolean;
}) {
  const [state, formAction, isPending] = useActionState(setPaymentMethodActiveAction, IDLE_FORM_STATE);

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="paymentMethodId" value={paymentMethodId} />
      <input type="hidden" name="isActive" value={isActive ? "false" : "true"} />

      {state.message !== undefined ? (
        <Alert variant={state.status === "success" ? "success" : "warning"}>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <Button
        type="submit"
        variant={isActive ? "destructive" : "secondary"}
        size="sm"
        loading={isPending}
        loadingLabel="Guardando"
      >
        {isActive ? "Desactivar" : "Activar"}
      </Button>
    </form>
  );
}
