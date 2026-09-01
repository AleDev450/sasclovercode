"use client";

import { useActionState } from "react";
import { Alert, AlertDescription, Button, Input, Label } from "@/components/ui";
import { IDLE_FORM_STATE } from "@/lib/forms/state";
import { PAYMENT_METHOD_TYPES, PAYMENT_METHOD_TYPE_LABELS } from "../constants";
import { createPaymentMethodAction } from "../server/actions";

const selectClass =
  "border-input bg-background focus-visible:ring-ring h-10 rounded-md border px-3 text-sm focus-visible:ring-2 focus-visible:outline-none";

export function PaymentMethodForm({ tenantSlug }: { tenantSlug: string }) {
  const [state, formAction, isPending] = useActionState(createPaymentMethodAction, IDLE_FORM_STATE);
  const errors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />

      {state.message !== undefined ? (
        <Alert variant={state.status === "success" ? "success" : "warning"}>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor="type">Tipo</Label>
          <select id="type" name="type" className={selectClass} defaultValue="cash">
            {PAYMENT_METHOD_TYPES.map((type) => (
              <option key={type} value={type}>
                {PAYMENT_METHOD_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="name">Nombre</Label>
          <Input
            id="name"
            name="name"
            placeholder="Yape - Alejandro"
            invalid={errors.name !== undefined}
          />
          {errors.name !== undefined ? (
            <p className="text-destructive text-sm">{errors.name[0]}</p>
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="reference">Referencia</Label>
          <Input id="reference" name="reference" placeholder="987 654 321" />
        </div>
      </div>

      <div>
        <Button type="submit" loading={isPending} loadingLabel="Creando">
          Anadir metodo
        </Button>
      </div>
    </form>
  );
}
