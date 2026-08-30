"use client";

import { useActionState, useState } from "react";
import { Alert, AlertDescription, Button, Input, Label } from "@/components/ui";
import { IDLE_FORM_STATE } from "@/lib/forms/state";
import { formatMoney } from "@/lib/money";
import type { PromotionType } from "@/types/database";
import { PROMOTION_TYPE_LABELS } from "../promotions";
import {
  createCouponAction,
  createPromotionAction,
  deleteCouponAction,
  deletePromotionAction,
  setCouponActiveAction,
  setPromotionActiveAction,
  updatePromotionAction,
} from "../server/actions";

function FieldError({ messages }: { messages?: readonly string[] }) {
  if (messages === undefined) return null;
  return <p className="text-destructive text-sm">{messages[0]}</p>;
}

/** `datetime-local` wants `YYYY-MM-DDTHH:mm`, and an ISO string is longer. */
function toLocalInput(iso: string | null): string {
  if (iso === null) return "";
  return new Date(iso).toISOString().slice(0, 16);
}

export interface PromotionDefaults {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly type: PromotionType;
  readonly percentOff: number | null;
  readonly amountOffCents: number | null;
  readonly minOrderCents: number;
  readonly startsAt: string | null;
  readonly endsAt: string | null;
  readonly maxRedemptions: number | null;
  readonly isActive: boolean;
}

/**
 * The value field follows the type.
 *
 * Both CHECK constraints say a percentage carries a percentage and a fixed
 * amount carries an amount, so showing the wrong one would be offering the
 * user a field the database will refuse. Client state, not a round trip: this
 * is presentation, and the schema plus the constraints are what decide.
 */
function PromotionFields({
  errors,
  defaults,
}: {
  errors: Readonly<Record<string, readonly string[]>>;
  defaults?: PromotionDefaults;
}) {
  const [type, setType] = useState<PromotionType>(defaults?.type ?? "percentage");

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="name">Nombre</Label>
          <Input
            id="name"
            name="name"
            defaultValue={defaults?.name}
            invalid={errors.name !== undefined}
            placeholder="Verano 10%"
          />
          <FieldError messages={errors.name} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="type">Tipo</Label>
          <select
            id="type"
            name="type"
            className="border-input bg-background h-10 rounded-md border px-3 text-sm"
            value={type}
            onChange={(event) => setType(event.target.value as PromotionType)}
          >
            {(Object.keys(PROMOTION_TYPE_LABELS) as PromotionType[]).map((option) => (
              <option key={option} value={option}>
                {PROMOTION_TYPE_LABELS[option]}
              </option>
            ))}
          </select>
          <FieldError messages={errors.type} />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {type === "percentage" ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor="percentOff">Porcentaje</Label>
            <Input
              id="percentOff"
              name="percentOff"
              inputMode="numeric"
              defaultValue={defaults?.percentOff ?? ""}
              invalid={errors.percentOff !== undefined}
              placeholder="10"
            />
            <FieldError messages={errors.percentOff} />
          </div>
        ) : (
          <input type="hidden" name="percentOff" value="" />
        )}

        {type === "fixed_amount" ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor="amountOffCents">Monto</Label>
            <Input
              id="amountOffCents"
              name="amountOffCents"
              inputMode="decimal"
              defaultValue={
                defaults?.amountOffCents === undefined || defaults.amountOffCents === null
                  ? ""
                  : formatMoney(defaults.amountOffCents)
              }
              invalid={errors.amountOffCents !== undefined}
              placeholder="10.00"
            />
            <FieldError messages={errors.amountOffCents} />
          </div>
        ) : (
          <input type="hidden" name="amountOffCents" value="" />
        )}

        <div className="flex flex-col gap-2">
          <Label htmlFor="minOrderCents">Pedido minimo</Label>
          <Input
            id="minOrderCents"
            name="minOrderCents"
            inputMode="decimal"
            defaultValue={
              defaults === undefined || defaults.minOrderCents === 0
                ? ""
                : formatMoney(defaults.minOrderCents)
            }
            invalid={errors.minOrderCents !== undefined}
            placeholder="50.00"
          />
          <FieldError messages={errors.minOrderCents} />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="maxRedemptions">Tope de canjes</Label>
          <Input
            id="maxRedemptions"
            name="maxRedemptions"
            inputMode="numeric"
            defaultValue={defaults?.maxRedemptions ?? ""}
            invalid={errors.maxRedemptions !== undefined}
            placeholder="Sin tope"
          />
          <FieldError messages={errors.maxRedemptions} />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="startsAt">Desde (opcional)</Label>
          <Input
            id="startsAt"
            name="startsAt"
            type="datetime-local"
            defaultValue={toLocalInput(defaults?.startsAt ?? null)}
            invalid={errors.startsAt !== undefined}
          />
          <FieldError messages={errors.startsAt} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="endsAt">Hasta (opcional)</Label>
          <Input
            id="endsAt"
            name="endsAt"
            type="datetime-local"
            defaultValue={toLocalInput(defaults?.endsAt ?? null)}
            invalid={errors.endsAt !== undefined}
          />
          <FieldError messages={errors.endsAt} />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="description">Descripcion (opcional)</Label>
        <Input id="description" name="description" defaultValue={defaults?.description ?? ""} />
        <FieldError messages={errors.description} />
      </div>
    </>
  );
}

export function CreatePromotionForm({ tenantSlug }: { tenantSlug: string }) {
  const [state, formAction, isPending] = useActionState(createPromotionAction, IDLE_FORM_STATE);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      {state.message !== undefined ? (
        <Alert variant={state.status === "success" ? "success" : "warning"}>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}
      <PromotionFields errors={state.fieldErrors ?? {}} />
      <div>
        <Button type="submit" loading={isPending} loadingLabel="Creando">
          Crear promocion
        </Button>
      </div>
    </form>
  );
}

export function UpdatePromotionForm({
  tenantSlug,
  promotion,
}: {
  tenantSlug: string;
  promotion: PromotionDefaults;
}) {
  const [state, formAction, isPending] = useActionState(updatePromotionAction, IDLE_FORM_STATE);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="promotionId" value={promotion.id} />
      {state.message !== undefined ? (
        <Alert variant={state.status === "success" ? "success" : "warning"}>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}
      <PromotionFields errors={state.fieldErrors ?? {}} defaults={promotion} />
      <div>
        <Button type="submit" loading={isPending} loadingLabel="Guardando">
          Guardar promocion
        </Button>
      </div>
    </form>
  );
}

export function SetPromotionActiveForm({
  tenantSlug,
  promotionId,
  isActive,
}: {
  tenantSlug: string;
  promotionId: string;
  isActive: boolean;
}) {
  const [, formAction, isPending] = useActionState(setPromotionActiveAction, IDLE_FORM_STATE);

  return (
    <form action={formAction}>
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="promotionId" value={promotionId} />
      <input type="hidden" name="isActive" value={isActive ? "false" : "true"} />
      <Button type="submit" variant="ghost" size="sm" loading={isPending} loadingLabel="Guardando">
        {isActive ? "Desactivar" : "Activar"}
      </Button>
    </form>
  );
}

export function DeletePromotionForm({
  tenantSlug,
  promotionId,
  promotionName,
}: {
  tenantSlug: string;
  promotionId: string;
  promotionName: string;
}) {
  const [state, formAction, isPending] = useActionState(deletePromotionAction, IDLE_FORM_STATE);

  return (
    <form
      action={formAction}
      // Master section 36. Deleting takes the coupons with it, which the button
      // does not say on its own.
      onSubmit={(event) => {
        if (
          !window.confirm(
            `Eliminar "${promotionName}" y sus cupones? Los pedidos ya descontados no cambian.`,
          )
        ) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="promotionId" value={promotionId} />
      {state.status === "error" && state.message !== undefined ? (
        <p className="text-destructive text-sm">{state.message}</p>
      ) : null}
      <Button type="submit" variant="ghost" size="sm" loading={isPending} loadingLabel="Eliminando">
        Eliminar
      </Button>
    </form>
  );
}

export function CreateCouponForm({
  tenantSlug,
  promotionId,
}: {
  tenantSlug: string;
  promotionId: string;
}) {
  const [state, formAction, isPending] = useActionState(createCouponAction, IDLE_FORM_STATE);
  const errors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="promotionId" value={promotionId} />

      <div className="flex min-w-[9rem] flex-col gap-2">
        <Label htmlFor={`code-${promotionId}`}>Codigo</Label>
        <Input
          id={`code-${promotionId}`}
          name="code"
          invalid={errors.code !== undefined}
          placeholder="VERANO10"
        />
        <FieldError messages={errors.code} />
      </div>

      <div className="flex min-w-[7rem] flex-col gap-2">
        <Label htmlFor={`couponMax-${promotionId}`}>Tope</Label>
        <Input
          id={`couponMax-${promotionId}`}
          name="maxRedemptions"
          inputMode="numeric"
          invalid={errors.maxRedemptions !== undefined}
          placeholder="Sin tope"
        />
        <FieldError messages={errors.maxRedemptions} />
      </div>

      <div className="flex min-w-[11rem] flex-col gap-2">
        <Label htmlFor={`couponExpires-${promotionId}`}>Caduca</Label>
        <Input
          id={`couponExpires-${promotionId}`}
          name="expiresAt"
          type="datetime-local"
          invalid={errors.expiresAt !== undefined}
        />
        <FieldError messages={errors.expiresAt} />
      </div>

      <Button type="submit" size="sm" loading={isPending} loadingLabel="Creando">
        Anadir cupon
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

export function SetCouponActiveForm({
  tenantSlug,
  couponId,
  isActive,
}: {
  tenantSlug: string;
  couponId: string;
  isActive: boolean;
}) {
  const [, formAction, isPending] = useActionState(setCouponActiveAction, IDLE_FORM_STATE);

  return (
    <form action={formAction}>
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="couponId" value={couponId} />
      <input type="hidden" name="isActive" value={isActive ? "false" : "true"} />
      <Button type="submit" variant="ghost" size="sm" loading={isPending} loadingLabel="...">
        {isActive ? "Desactivar" : "Activar"}
      </Button>
    </form>
  );
}

export function DeleteCouponForm({
  tenantSlug,
  couponId,
}: {
  tenantSlug: string;
  couponId: string;
}) {
  const [, formAction, isPending] = useActionState(deleteCouponAction, IDLE_FORM_STATE);

  return (
    <form action={formAction}>
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="couponId" value={couponId} />
      <Button type="submit" variant="ghost" size="sm" loading={isPending} loadingLabel="...">
        Eliminar
      </Button>
    </form>
  );
}
