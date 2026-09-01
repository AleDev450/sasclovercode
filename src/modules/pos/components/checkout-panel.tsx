"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Alert, AlertDescription, Button, Input, Label } from "@/components/ui";
import { IDLE_FORM_STATE } from "@/lib/forms/state";
import { formatCurrency, formatMoney, parseMoney } from "@/lib/money";
import { createOrderForPos } from "@/modules/orders/server/actions";
import { recordPaymentAction } from "@/modules/payments/server/actions";
import { changeDueCents, remainingBalanceCents, type CartLine, type Tender } from "../cart";

export interface PosPaymentMethod {
  readonly id: string;
  readonly name: string;
  readonly type: string;
}

export interface PosOpenSession {
  readonly id: string;
  readonly cashRegisterName: string;
}

interface StagedTender extends Tender {
  readonly localId: string;
  readonly methodName: string;
  readonly methodType: string;
  readonly cashSessionId: string | null;
  readonly reference: string | null;
}

export interface CompletedSale {
  readonly orderId: string;
  readonly orderNumber: number;
  readonly paymentErrors: readonly string[];
}

const selectClass =
  "border-input bg-background focus-visible:ring-ring h-10 rounded-md border px-3 text-sm focus-visible:ring-2 focus-visible:outline-none";

function buildOrderFormData(
  tenantSlug: string,
  locationId: string,
  customerId: string | null,
  cart: readonly CartLine[],
): FormData {
  const formData = new FormData();
  formData.set("tenantSlug", tenantSlug);
  formData.set("locationId", locationId);
  formData.set("customerId", customerId ?? "");
  formData.set("source", "pos");
  formData.set("shipping", "");
  formData.set("notes", "");
  for (const line of cart) {
    formData.append("itemProductId", line.productId);
    formData.append("itemVariantId", line.variantId ?? "");
    formData.append("itemQuantity", String(line.quantity));
    formData.append("itemDiscount", "");
    formData.append("itemNotes", "");
  }
  return formData;
}

function buildPaymentFormData(tenantSlug: string, orderId: string, tender: StagedTender): FormData {
  const formData = new FormData();
  formData.set("tenantSlug", tenantSlug);
  formData.set("orderId", orderId);
  formData.set("paymentMethodId", tender.paymentMethodId);
  formData.set("cashSessionId", tender.cashSessionId ?? "");
  formData.set("amount", formatMoney(tender.amountCents));
  formData.set("reference", tender.reference ?? "");
  formData.set("notes", "");
  return formData;
}

/**
 * Staged tenders and the actual charge. Nothing here re-implements a rule
 * Phase 14 already enforces (the overpay cap, cash needing an open session):
 * this panel only decides what a cash tender's CHANGE is, which is a
 * cashier-facing number that is never sent to the database at all - a
 * payment is capped at the remaining balance regardless of how much cash was
 * physically handed over.
 */
export function CheckoutPanel({
  tenantSlug,
  locationId,
  cart,
  customerId,
  totalCents,
  currency,
  canCheckout,
  paymentMethods,
  openSessions,
  onComplete,
}: {
  tenantSlug: string;
  locationId: string;
  cart: readonly CartLine[];
  customerId: string | null;
  totalCents: number;
  currency: string;
  canCheckout: boolean;
  paymentMethods: readonly PosPaymentMethod[];
  openSessions: readonly PosOpenSession[];
  onComplete: (sale: CompletedSale) => void;
}) {
  const [tenders, setTenders] = useState<readonly StagedTender[]>([]);
  const [methodId, setMethodId] = useState(paymentMethods[0]?.id ?? "");
  const [sessionId, setSessionId] = useState(openSessions[0]?.id ?? "");
  const [amountInput, setAmountInput] = useState("");
  const [reference, setReference] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [lastChangeCents, setLastChangeCents] = useState<number | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, startSubmit] = useTransition();

  const method = paymentMethods.find((candidate) => candidate.id === methodId);
  const isCash = method?.type === "cash";
  const remainingCents = remainingBalanceCents(totalCents, tenders);

  function addTender() {
    setAddError(null);
    setLastChangeCents(null);

    if (method === undefined) {
      setAddError("Elige un metodo de pago.");
      return;
    }
    if (isCash && sessionId === "") {
      setAddError("Abre una sesion de caja antes de cobrar en efectivo.");
      return;
    }

    const parsed = parseMoney(
      amountInput.trim().length === 0 ? formatMoney(remainingCents) : amountInput,
    );
    if (!parsed.ok || parsed.cents === undefined || parsed.cents <= 0) {
      setAddError(parsed.reason ?? "Ingresa un monto valido.");
      return;
    }

    // The payment applied is capped at what's owed regardless of method -
    // the database enforces the same cap (Phase 14). Only cash can be
    // TENDERED for more than that: the excess becomes change, never a
    // payment amount. A card or Yape charge has no change to hand back, so
    // typing more than the balance there just clamps with nothing left over.
    const appliedCents = Math.min(parsed.cents, remainingCents);
    if (appliedCents <= 0) {
      setAddError("El pedido ya esta pagado por completo.");
      return;
    }

    const change = isCash ? changeDueCents(remainingCents, parsed.cents) : 0;

    setTenders((current) => [
      ...current,
      {
        localId: crypto.randomUUID(),
        paymentMethodId: method.id,
        methodName: method.name,
        methodType: method.type,
        amountCents: appliedCents,
        cashSessionId: isCash ? sessionId : null,
        reference: reference.trim().length > 0 ? reference.trim() : null,
      },
    ]);
    setAmountInput("");
    setReference("");
    if (change > 0) setLastChangeCents(change);
  }

  function removeTender(localId: string) {
    setTenders((current) => current.filter((tender) => tender.localId !== localId));
    setLastChangeCents(null);
  }

  function submit() {
    setSubmitError(null);
    startSubmit(async () => {
      const orderResult = await createOrderForPos(
        buildOrderFormData(tenantSlug, locationId, customerId, cart),
      );

      if (orderResult.status !== "success" || orderResult.orderId === undefined) {
        setSubmitError(orderResult.message ?? "No se pudo crear el pedido.");
        return;
      }

      const paymentErrors: string[] = [];
      for (const tender of tenders) {
        const result = await recordPaymentAction(
          IDLE_FORM_STATE,
          buildPaymentFormData(tenantSlug, orderResult.orderId, tender),
        );
        if (result.status === "error") {
          paymentErrors.push(result.message ?? `El pago con ${tender.methodName} no se registro.`);
        }
      }

      onComplete({
        orderId: orderResult.orderId,
        orderNumber: orderResult.orderNumber ?? 0,
        paymentErrors,
      });
    });
  }

  const canSubmit = cart.length > 0 && !isSubmitting;
  const primaryLabel = tenders.length > 0 ? "Cobrar" : "Crear pedido sin pago";

  return (
    <div className="flex flex-col gap-4 border-t pt-4">
      {canCheckout ? (
        <>
          {tenders.length > 0 ? (
            <ul className="flex flex-col gap-1">
              {tenders.map((tender) => (
                <li key={tender.localId} className="flex items-center justify-between text-sm">
                  <span>
                    {tender.methodName}
                    {tender.reference !== null ? (
                      <span className="text-muted-foreground"> · {tender.reference}</span>
                    ) : null}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="tabular-nums">
                      {formatCurrency(tender.amountCents, currency)}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Quitar este pago"
                      onClick={() => removeTender(tender.localId)}
                    >
                      ×
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          ) : null}

          {remainingCents > 0 ? (
            <div className="flex items-end gap-2">
              <div className="flex flex-col gap-1">
                <Label htmlFor="pos-method">Metodo</Label>
                <select
                  id="pos-method"
                  className={selectClass}
                  value={methodId}
                  onChange={(event) => setMethodId(event.target.value)}
                >
                  {paymentMethods.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.name}
                    </option>
                  ))}
                </select>
              </div>

              {isCash ? (
                <div className="flex flex-col gap-1">
                  <Label htmlFor="pos-session">Caja</Label>
                  <select
                    id="pos-session"
                    className={selectClass}
                    value={sessionId}
                    onChange={(event) => setSessionId(event.target.value)}
                  >
                    {openSessions.length === 0 ? <option value="">Ninguna abierta</option> : null}
                    {openSessions.map((session) => (
                      <option key={session.id} value={session.id}>
                        {session.cashRegisterName}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              <div className="flex flex-col gap-1">
                <Label htmlFor="pos-amount">Monto</Label>
                <Input
                  id="pos-amount"
                  inputMode="decimal"
                  className="w-28"
                  placeholder={formatMoney(remainingCents)}
                  value={amountInput}
                  onChange={(event) => setAmountInput(event.target.value)}
                />
              </div>

              <div className="flex flex-col gap-1">
                <Label htmlFor="pos-reference">Ref.</Label>
                <Input
                  id="pos-reference"
                  className="w-24"
                  value={reference}
                  onChange={(event) => setReference(event.target.value)}
                />
              </div>

              <Button type="button" variant="outline" onClick={addTender}>
                Agregar
              </Button>
            </div>
          ) : null}

          {addError !== null ? (
            <Alert variant="warning">
              <AlertDescription>{addError}</AlertDescription>
            </Alert>
          ) : null}
          {lastChangeCents !== null && lastChangeCents > 0 ? (
            <Alert variant="success">
              <AlertDescription>
                Vuelto: {formatCurrency(lastChangeCents, currency)}
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="flex items-center justify-between text-sm">
            <span>Falta por cobrar</span>
            <span className="font-medium tabular-nums">
              {formatCurrency(remainingCents, currency)}
            </span>
          </div>
        </>
      ) : null}

      {submitError !== null ? (
        <Alert variant="warning">
          <AlertDescription>{submitError}</AlertDescription>
        </Alert>
      ) : null}

      <Button
        type="button"
        size="lg"
        disabled={!canSubmit}
        loading={isSubmitting}
        loadingLabel="Procesando"
        onClick={submit}
      >
        {primaryLabel}
      </Button>

      {canCheckout && tenders.length === 0 && cart.length > 0 ? (
        <p className="text-muted-foreground text-xs">
          Sin pagos agregados, el pedido queda creado y pendiente de cobro. Puedes registrar el pago
          despues desde{" "}
          <Link href={`/dashboard/${tenantSlug}/pedidos`} className="underline">
            Pedidos
          </Link>
          .
        </p>
      ) : null}
    </div>
  );
}
