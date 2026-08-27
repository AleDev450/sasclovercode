"use client";

import { useActionState, useState } from "react";
import { Alert, AlertDescription, Button, Input, Label } from "@/components/ui";
import { IDLE_FORM_STATE } from "@/lib/forms/state";
import { formatMoney } from "@/lib/money";
import { recordPaymentAction } from "../server/actions";

export interface PaymentMethodOption {
  readonly id: string;
  readonly name: string;
  readonly type: string;
}

export interface OpenSessionOption {
  readonly id: string;
  readonly cashRegisterName: string;
}

const selectClass =
  "border-input bg-background focus-visible:ring-ring h-10 rounded-md border px-3 text-sm focus-visible:ring-2 focus-visible:outline-none";

/**
 * Registers a payment against an order.
 *
 * The cash-session field only appears for a `cash` method, and only because
 * that is what a person filling this in needs to see - the actual rule ("cash
 * requires an open session at this location") is not re-checked here at all.
 * It lives once, in `guard_payment()`, so this form and Phase 15's POS can
 * never enforce two different versions of it.
 */
export function RecordPaymentForm({
  tenantSlug,
  orderId,
  balanceCents,
  methods,
  openSessions,
}: {
  tenantSlug: string;
  orderId: string;
  balanceCents: number;
  methods: readonly PaymentMethodOption[];
  openSessions: readonly OpenSessionOption[];
}) {
  const [state, formAction, isPending] = useActionState(recordPaymentAction, IDLE_FORM_STATE);
  const [methodId, setMethodId] = useState(methods[0]?.id ?? "");
  const errors = state.fieldErrors ?? {};

  const selectedType = methods.find((method) => method.id === methodId)?.type;
  const isCash = selectedType === "cash";

  if (methods.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No hay metodos de pago activos. Configura uno en Metodos de pago.
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="orderId" value={orderId} />

      {state.message !== undefined ? (
        <Alert variant={state.status === "success" ? "success" : "warning"}>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="paymentMethodId">Metodo</Label>
          <select
            id="paymentMethodId"
            name="paymentMethodId"
            className={selectClass}
            value={methodId}
            onChange={(event) => setMethodId(event.target.value)}
          >
            {methods.map((method) => (
              <option key={method.id} value={method.id}>
                {method.name}
              </option>
            ))}
          </select>
          {errors.paymentMethodId !== undefined ? (
            <p className="text-destructive text-sm">{errors.paymentMethodId[0]}</p>
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="amount">Monto</Label>
          <Input
            id="amount"
            name="amount"
            inputMode="decimal"
            defaultValue={formatMoney(balanceCents)}
            invalid={errors.amount !== undefined}
          />
          {errors.amount !== undefined ? (
            <p className="text-destructive text-sm">{errors.amount[0]}</p>
          ) : null}
        </div>
      </div>

      {isCash ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor="cashSessionId">Sesion de caja</Label>
          <select id="cashSessionId" name="cashSessionId" className={selectClass} defaultValue="">
            <option value="" disabled>
              Elige una sesion abierta
            </option>
            {openSessions.map((session) => (
              <option key={session.id} value={session.id}>
                {session.cashRegisterName}
              </option>
            ))}
          </select>
          {openSessions.length === 0 ? (
            <p className="text-muted-foreground text-xs">
              No hay ninguna caja abierta en esta sede. Abre una en Caja.
            </p>
          ) : null}
          {errors.cashSessionId !== undefined ? (
            <p className="text-destructive text-sm">{errors.cashSessionId[0]}</p>
          ) : null}
        </div>
      ) : (
        // Submitted empty for a non-cash method: `cashSessionId` parses to
        // null, and the database refuses it being anything else.
        <input type="hidden" name="cashSessionId" value="" />
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="reference">Referencia</Label>
          <Input id="reference" name="reference" placeholder="Codigo de operacion" />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="notes">Notas</Label>
          <Input id="notes" name="notes" />
        </div>
      </div>

      <div>
        <Button type="submit" loading={isPending} loadingLabel="Registrando">
          Registrar pago
        </Button>
      </div>
    </form>
  );
}
