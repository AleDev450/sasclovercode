"use client";

import { useActionState, useState } from "react";
import { Alert, AlertDescription, Button, Input, Label } from "@/components/ui";
import { IDLE_FORM_STATE } from "@/lib/forms/state";
import { LOYALTY_TRANSACTION_LABELS, MANUAL_LOYALTY_TYPES } from "../points";
import {
  applyCouponAction,
  applyPromotionAction,
  enrollCustomerAction,
  recordLoyaltyAdjustmentAction,
  redeemLoyaltyPointsAction,
  removeOrderPromotionAction,
  updateLoyaltySettingsAction,
} from "../server/actions";

function FieldError({ messages }: { messages?: readonly string[] }) {
  if (messages === undefined) return null;
  return <p className="text-destructive text-sm">{messages[0]}</p>;
}

export interface CustomerOption {
  readonly id: string;
  readonly name: string;
}

export function EnrollCustomerForm({
  tenantSlug,
  customers,
}: {
  tenantSlug: string;
  customers: readonly CustomerOption[];
}) {
  const [state, formAction, isPending] = useActionState(enrollCustomerAction, IDLE_FORM_STATE);

  if (customers.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Todos los clientes registrados ya tienen cuenta de puntos.
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <div className="flex min-w-[14rem] flex-col gap-2">
        <Label htmlFor="customerId">Cliente</Label>
        <select
          id="customerId"
          name="customerId"
          className="border-input bg-background h-10 rounded-md border px-3 text-sm"
          defaultValue=""
        >
          <option value="" disabled>
            Elige un cliente
          </option>
          {customers.map((customer) => (
            <option key={customer.id} value={customer.id}>
              {customer.name}
            </option>
          ))}
        </select>
      </div>
      <Button type="submit" loading={isPending} loadingLabel="Inscribiendo">
        Inscribir
      </Button>
      {state.message !== undefined ? (
        <p
          className={
            state.status === "success"
              ? "text-muted-foreground text-sm"
              : "text-destructive text-sm"
          }
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

/**
 * A manual movement.
 *
 * Signed on purpose: "contamos 20 de menos" and "le regalamos 50" are both
 * real, and one of them is negative. The ledger takes the sign as given -
 * there is no separate "add" and "subtract" button, because that would be two
 * ways to write the same entry.
 */
export function RecordAdjustmentForm({
  tenantSlug,
  accountId,
}: {
  tenantSlug: string;
  accountId: string;
}) {
  const [state, formAction, isPending] = useActionState(
    recordLoyaltyAdjustmentAction,
    IDLE_FORM_STATE,
  );
  const errors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="accountId" value={accountId} />

      <div className="flex min-w-[8rem] flex-col gap-2">
        <Label htmlFor={`type-${accountId}`}>Tipo</Label>
        <select
          id={`type-${accountId}`}
          name="type"
          className="border-input bg-background h-10 rounded-md border px-3 text-sm"
          defaultValue="campaign"
        >
          {MANUAL_LOYALTY_TYPES.map((type) => (
            <option key={type} value={type}>
              {LOYALTY_TRANSACTION_LABELS[type]}
            </option>
          ))}
        </select>
      </div>

      <div className="flex min-w-[7rem] flex-col gap-2">
        <Label htmlFor={`points-${accountId}`}>Puntos</Label>
        <Input
          id={`points-${accountId}`}
          name="points"
          inputMode="numeric"
          invalid={errors.points !== undefined}
          placeholder="20 o -20"
        />
        <FieldError messages={errors.points} />
      </div>

      <div className="flex min-w-[12rem] flex-col gap-2">
        <Label htmlFor={`reason-${accountId}`}>Motivo</Label>
        <Input
          id={`reason-${accountId}`}
          name="reason"
          invalid={errors.reason !== undefined}
          placeholder="Compensacion por demora"
        />
        <FieldError messages={errors.reason} />
      </div>

      <Button type="submit" size="sm" loading={isPending} loadingLabel="Guardando">
        Registrar
      </Button>

      {state.message !== undefined ? (
        <p
          className={
            state.status === "success"
              ? "text-muted-foreground text-sm"
              : "text-destructive text-sm"
          }
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

export interface PromotionOption {
  readonly id: string;
  readonly label: string;
  /** `null` when it can be applied; a sentence when it cannot. */
  readonly blockedReason: string | null;
}

export function ApplyPromotionForm({
  tenantSlug,
  orderId,
  promotions,
}: {
  tenantSlug: string;
  orderId: string;
  promotions: readonly PromotionOption[];
}) {
  const [state, formAction, isPending] = useActionState(applyPromotionAction, IDLE_FORM_STATE);
  const available = promotions.filter((promotion) => promotion.blockedReason === null);

  if (available.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No hay promociones aplicables a este pedido ahora mismo.
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="orderId" value={orderId} />

      <div className="flex min-w-[14rem] flex-col gap-2">
        <Label htmlFor="promotionId">Promocion</Label>
        <select
          id="promotionId"
          name="promotionId"
          className="border-input bg-background h-10 rounded-md border px-3 text-sm"
          defaultValue=""
        >
          <option value="" disabled>
            Elige una promocion
          </option>
          {available.map((promotion) => (
            <option key={promotion.id} value={promotion.id}>
              {promotion.label}
            </option>
          ))}
        </select>
      </div>

      <Button type="submit" size="sm" loading={isPending} loadingLabel="Aplicando">
        Aplicar
      </Button>

      {state.status === "error" && state.message !== undefined ? (
        <p className="text-destructive text-sm">{state.message}</p>
      ) : null}
    </form>
  );
}

export function ApplyCouponForm({ tenantSlug, orderId }: { tenantSlug: string; orderId: string }) {
  const [state, formAction, isPending] = useActionState(applyCouponAction, IDLE_FORM_STATE);
  const errors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="orderId" value={orderId} />

      <div className="flex min-w-[10rem] flex-col gap-2">
        <Label htmlFor="couponCode">Cupon</Label>
        <Input
          id="couponCode"
          name="code"
          invalid={errors.code !== undefined}
          placeholder="VERANO10"
        />
        <FieldError messages={errors.code} />
      </div>

      <Button type="submit" size="sm" variant="secondary" loading={isPending} loadingLabel="...">
        Canjear cupon
      </Button>

      {state.status === "error" && state.message !== undefined ? (
        <p className="text-destructive text-sm">{state.message}</p>
      ) : null}
    </form>
  );
}

export function RemoveDiscountForm({
  tenantSlug,
  orderPromotionId,
}: {
  tenantSlug: string;
  orderPromotionId: string;
}) {
  const [state, formAction, isPending] = useActionState(
    removeOrderPromotionAction,
    IDLE_FORM_STATE,
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="orderPromotionId" value={orderPromotionId} />
      {state.status === "error" && state.message !== undefined ? (
        <p className="text-destructive text-sm">{state.message}</p>
      ) : null}
      <Button type="submit" variant="ghost" size="sm" loading={isPending} loadingLabel="Quitando">
        Quitar
      </Button>
    </form>
  );
}

/**
 * Spending points on this order.
 *
 * `maxPoints` is the smallest of three bounds (balance, what is left to pay,
 * and whole points) computed on the server, so the field cannot offer a number
 * the RPC will refuse.
 */
export function RedeemPointsForm({
  tenantSlug,
  orderId,
  accountId,
  balance,
  maxPoints,
  pointValueCents,
}: {
  tenantSlug: string;
  orderId: string;
  accountId: string;
  balance: number;
  maxPoints: number;
  pointValueCents: number;
}) {
  const [state, formAction, isPending] = useActionState(redeemLoyaltyPointsAction, IDLE_FORM_STATE);
  const [points, setPoints] = useState("");
  const errors = state.fieldErrors ?? {};

  if (maxPoints <= 0) {
    return (
      <p className="text-muted-foreground text-sm">
        {balance === 0
          ? "Este cliente no tiene puntos todavia."
          : `Tiene ${balance} puntos, pero este pedido ya no admite mas descuento.`}
      </p>
    );
  }

  const parsed = Number(points);
  const preview =
    /^\d+$/.test(points.trim()) && parsed > 0 ? (parsed * pointValueCents) / 100 : null;

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="accountId" value={accountId} />

      <div className="flex min-w-[8rem] flex-col gap-2">
        <Label htmlFor="redeemPoints">Puntos a canjear</Label>
        <Input
          id="redeemPoints"
          name="points"
          inputMode="numeric"
          value={points}
          onChange={(event) => setPoints(event.target.value)}
          invalid={errors.points !== undefined}
          placeholder={String(maxPoints)}
        />
        <FieldError messages={errors.points} />
        <p className="text-muted-foreground text-xs">
          Saldo {balance} · maximo util {maxPoints}
          {preview === null ? "" : ` · equivale a ${preview.toFixed(2)}`}
        </p>
      </div>

      <Button type="submit" size="sm" loading={isPending} loadingLabel="Canjeando">
        Canjear
      </Button>

      {state.status === "error" && state.message !== undefined ? (
        <p className="text-destructive text-sm">{state.message}</p>
      ) : null}
    </form>
  );
}

export function LoyaltySettingsForm({
  tenantSlug,
  programme,
}: {
  tenantSlug: string;
  programme: { enabled: boolean; pointsPerSol: number; pointValueCents: number };
}) {
  const [state, formAction, isPending] = useActionState(
    updateLoyaltySettingsAction,
    IDLE_FORM_STATE,
  );
  const errors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />

      {state.message !== undefined ? (
        <Alert variant={state.status === "success" ? "success" : "warning"}>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="loyaltyEnabled"
          value="true"
          defaultChecked={programme.enabled}
          className="size-4"
        />
        Acumular puntos automaticamente al completar un pedido
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="pointsPerSol">Puntos por sol</Label>
          <Input
            id="pointsPerSol"
            name="pointsPerSol"
            inputMode="numeric"
            defaultValue={programme.pointsPerSol}
            invalid={errors.pointsPerSol !== undefined}
          />
          <FieldError messages={errors.pointsPerSol} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="pointValueCents">Valor de un punto (centimos)</Label>
          <Input
            id="pointValueCents"
            name="pointValueCents"
            inputMode="numeric"
            defaultValue={programme.pointValueCents}
            invalid={errors.pointValueCents !== undefined}
          />
          <FieldError messages={errors.pointValueCents} />
        </div>
      </div>

      <div>
        <Button type="submit" loading={isPending} loadingLabel="Guardando">
          Guardar programa
        </Button>
      </div>
    </form>
  );
}
