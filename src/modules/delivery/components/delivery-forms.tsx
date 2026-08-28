"use client";

import { useActionState, useState } from "react";
import { Alert, AlertDescription, Button, Input, Label } from "@/components/ui";
import { IDLE_FORM_STATE } from "@/lib/forms/state";
import { formatMoney } from "@/lib/money";
import type { DeliveryStatus } from "@/types/database";
import { DELIVERY_STATUS_LABELS, nextForwardStatus } from "../lifecycle";
import {
  advanceDeliveryStatusAction,
  assignCourierAction,
  attachDeliveryAction,
  closeDeliveryAction,
  detachDeliveryAction,
  updateDeliveryAddressAction,
  updateDeliveryFeeAction,
} from "../server/actions";

function FieldError({ messages }: { messages?: readonly string[] }) {
  if (messages === undefined) return null;
  return <p className="text-destructive text-sm">{messages[0]}</p>;
}

export interface ZoneOption {
  readonly id: string;
  readonly name: string;
}

export interface AddressOption {
  readonly id: string;
  readonly label: string;
  readonly addressLine: string;
  readonly district: string | null;
  readonly city: string | null;
  readonly reference: string | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
}

interface AddressValues {
  readonly addressLine: string;
  readonly district: string;
  readonly city: string;
  readonly reference: string;
  readonly latitude: string;
  readonly longitude: string;
  readonly recipientName: string;
  readonly recipientPhone: string;
  readonly notes: string;
}

const EMPTY_ADDRESS: AddressValues = {
  addressLine: "",
  district: "",
  city: "",
  reference: "",
  latitude: "",
  longitude: "",
  recipientName: "",
  recipientPhone: "",
  notes: "",
};

function AddressFields({
  errors,
  values,
  onChange,
  idPrefix,
}: {
  errors: Readonly<Record<string, readonly string[]>>;
  values: AddressValues;
  onChange: (next: AddressValues) => void;
  idPrefix: string;
}) {
  const set = (key: keyof AddressValues) => (event: React.ChangeEvent<HTMLInputElement>) =>
    onChange({ ...values, [key]: event.target.value });

  return (
    <>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${idPrefix}-addressLine`}>Direccion</Label>
        <Input
          id={`${idPrefix}-addressLine`}
          name="addressLine"
          value={values.addressLine}
          onChange={set("addressLine")}
          invalid={errors.addressLine !== undefined}
          placeholder="Av. Larco 123, dpto 402"
        />
        <FieldError messages={errors.addressLine} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${idPrefix}-district`}>Distrito</Label>
          <Input
            id={`${idPrefix}-district`}
            name="district"
            value={values.district}
            onChange={set("district")}
          />
          <FieldError messages={errors.district} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${idPrefix}-city`}>Ciudad</Label>
          <Input id={`${idPrefix}-city`} name="city" value={values.city} onChange={set("city")} />
          <FieldError messages={errors.city} />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`${idPrefix}-reference`}>Referencia</Label>
        <Input
          id={`${idPrefix}-reference`}
          name="reference"
          value={values.reference}
          onChange={set("reference")}
          placeholder="Frente al parque Kennedy"
        />
        <FieldError messages={errors.reference} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${idPrefix}-latitude`}>Latitud (opcional)</Label>
          <Input
            id={`${idPrefix}-latitude`}
            name="latitude"
            inputMode="decimal"
            value={values.latitude}
            onChange={set("latitude")}
            invalid={errors.latitude !== undefined}
            placeholder="-12.121500"
          />
          <FieldError messages={errors.latitude} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${idPrefix}-longitude`}>Longitud (opcional)</Label>
          <Input
            id={`${idPrefix}-longitude`}
            name="longitude"
            inputMode="decimal"
            value={values.longitude}
            onChange={set("longitude")}
            invalid={errors.longitude !== undefined}
            placeholder="-77.029700"
          />
          <FieldError messages={errors.longitude} />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${idPrefix}-recipientName`}>Recibe (opcional)</Label>
          <Input
            id={`${idPrefix}-recipientName`}
            name="recipientName"
            value={values.recipientName}
            onChange={set("recipientName")}
          />
          <FieldError messages={errors.recipientName} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${idPrefix}-recipientPhone`}>Telefono (opcional)</Label>
          <Input
            id={`${idPrefix}-recipientPhone`}
            name="recipientPhone"
            value={values.recipientPhone}
            onChange={set("recipientPhone")}
          />
          <FieldError messages={errors.recipientPhone} />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`${idPrefix}-notes`}>Notas para el repartidor (opcional)</Label>
        <Input id={`${idPrefix}-notes`} name="notes" value={values.notes} onChange={set("notes")} />
        <FieldError messages={errors.notes} />
      </div>
    </>
  );
}

/**
 * Attaching a delivery to an order.
 *
 * The fee is NOT a field: the server resolves it from the zone and the order's
 * branch (ADR-023 decision 3). A price the browser could send would be a price
 * the customer chose.
 */
export function AttachDeliveryForm({
  tenantSlug,
  orderId,
  zones,
  addresses,
}: {
  tenantSlug: string;
  orderId: string;
  zones: readonly ZoneOption[];
  addresses: readonly AddressOption[];
}) {
  const [state, formAction, isPending] = useActionState(attachDeliveryAction, IDLE_FORM_STATE);
  const [values, setValues] = useState<AddressValues>(EMPTY_ADDRESS);
  const errors = state.fieldErrors ?? {};

  if (zones.length === 0) {
    return (
      <Alert variant="warning">
        <AlertDescription>
          Este negocio todavia no tiene zonas de reparto activas. Configuralas antes de adjuntar una
          entrega.
        </AlertDescription>
      </Alert>
    );
  }

  // Copying the customer's saved address, coordinates included - the reason
  // Phase 19 put latitude/longitude on `customer_addresses` at all.
  function useSavedAddress(event: React.ChangeEvent<HTMLSelectElement>): void {
    const chosen = addresses.find((address) => address.id === event.target.value);
    if (chosen === undefined) return;
    setValues({
      ...values,
      addressLine: chosen.addressLine,
      district: chosen.district ?? "",
      city: chosen.city ?? "",
      reference: chosen.reference ?? "",
      latitude: chosen.latitude === null ? "" : String(chosen.latitude),
      longitude: chosen.longitude === null ? "" : String(chosen.longitude),
    });
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

      {addresses.length > 0 ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor="savedAddress">Usar una direccion guardada</Label>
          <select
            id="savedAddress"
            className="border-input bg-background h-10 rounded-md border px-3 text-sm"
            defaultValue=""
            onChange={useSavedAddress}
          >
            <option value="">Escribir una nueva</option>
            {addresses.map((address) => (
              <option key={address.id} value={address.id}>
                {address.label} - {address.addressLine}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <Label htmlFor="zoneId">Zona</Label>
        <select
          id="zoneId"
          name="zoneId"
          className="border-input bg-background h-10 rounded-md border px-3 text-sm"
          defaultValue=""
        >
          <option value="" disabled>
            Elige una zona
          </option>
          {zones.map((zone) => (
            <option key={zone.id} value={zone.id}>
              {zone.name}
            </option>
          ))}
        </select>
        <FieldError messages={errors.zoneId} />
      </div>

      <AddressFields errors={errors} values={values} onChange={setValues} idPrefix="attach" />

      <div>
        <Button type="submit" loading={isPending} loadingLabel="Adjuntando">
          Adjuntar entrega
        </Button>
      </div>
    </form>
  );
}

export interface DeliveryAddressDefaults {
  readonly id: string;
  readonly addressLine: string;
  readonly district: string | null;
  readonly city: string | null;
  readonly reference: string | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly recipientName: string | null;
  readonly recipientPhone: string | null;
  readonly notes: string | null;
}

export function UpdateDeliveryAddressForm({
  tenantSlug,
  delivery,
}: {
  tenantSlug: string;
  delivery: DeliveryAddressDefaults;
}) {
  const [state, formAction, isPending] = useActionState(
    updateDeliveryAddressAction,
    IDLE_FORM_STATE,
  );
  const [values, setValues] = useState<AddressValues>({
    addressLine: delivery.addressLine,
    district: delivery.district ?? "",
    city: delivery.city ?? "",
    reference: delivery.reference ?? "",
    latitude: delivery.latitude === null ? "" : String(delivery.latitude),
    longitude: delivery.longitude === null ? "" : String(delivery.longitude),
    recipientName: delivery.recipientName ?? "",
    recipientPhone: delivery.recipientPhone ?? "",
    notes: delivery.notes ?? "",
  });

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="deliveryId" value={delivery.id} />

      {state.message !== undefined ? (
        <Alert variant={state.status === "success" ? "success" : "warning"}>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <AddressFields
        errors={state.fieldErrors ?? {}}
        values={values}
        onChange={setValues}
        idPrefix="edit"
      />

      <div>
        <Button type="submit" loading={isPending} loadingLabel="Guardando">
          Guardar direccion
        </Button>
      </div>
    </form>
  );
}

/** Correcting what was agreed. The database refuses it once the order settles. */
export function UpdateDeliveryFeeForm({
  tenantSlug,
  deliveryId,
  feeCents,
}: {
  tenantSlug: string;
  deliveryId: string;
  feeCents: number;
}) {
  const [state, formAction, isPending] = useActionState(updateDeliveryFeeAction, IDLE_FORM_STATE);
  const errors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="deliveryId" value={deliveryId} />

      <div className="flex min-w-[8rem] flex-col gap-2">
        <Label htmlFor="feeCents">Costo del envio</Label>
        <Input
          id="feeCents"
          name="feeCents"
          inputMode="decimal"
          defaultValue={formatMoney(feeCents)}
          invalid={errors.feeCents !== undefined}
        />
        <FieldError messages={errors.feeCents} />
      </div>

      <Button type="submit" size="sm" loading={isPending} loadingLabel="Guardando">
        Actualizar costo
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

export interface CourierOption {
  readonly userId: string;
  readonly label: string;
}

export function AssignCourierForm({
  tenantSlug,
  deliveryId,
  couriers,
  currentCourierId,
}: {
  tenantSlug: string;
  deliveryId: string;
  couriers: readonly CourierOption[];
  currentCourierId: string | null;
}) {
  const [state, formAction, isPending] = useActionState(assignCourierAction, IDLE_FORM_STATE);

  if (couriers.length === 0) {
    return <p className="text-muted-foreground text-sm">No hay miembros activos para asignar.</p>;
  }

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="deliveryId" value={deliveryId} />
      <label className="sr-only" htmlFor={`courier-${deliveryId}`}>
        Repartidor
      </label>
      <select
        id={`courier-${deliveryId}`}
        name="courierUserId"
        className="border-input bg-background h-9 rounded-md border px-2 text-sm"
        defaultValue={currentCourierId ?? ""}
      >
        <option value="" disabled>
          Elegir
        </option>
        {couriers.map((courier) => (
          <option key={courier.userId} value={courier.userId}>
            {courier.label}
          </option>
        ))}
      </select>
      <Button type="submit" size="sm" variant="secondary" loading={isPending} loadingLabel="...">
        {currentCourierId === null ? "Asignar" : "Reasignar"}
      </Button>
      {state.status === "error" && state.message !== undefined ? (
        <p className="text-destructive text-sm">{state.message}</p>
      ) : null}
    </form>
  );
}

export function AdvanceDeliveryForm({
  tenantSlug,
  deliveryId,
  status,
}: {
  tenantSlug: string;
  deliveryId: string;
  status: DeliveryStatus;
}) {
  const [state, formAction, isPending] = useActionState(
    advanceDeliveryStatusAction,
    IDLE_FORM_STATE,
  );
  const next = nextForwardStatus(status);

  if (next === null) return null;

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="deliveryId" value={deliveryId} />
      <input type="hidden" name="status" value={next} />
      <Button type="submit" size="sm" loading={isPending} loadingLabel="...">
        {next === "in_transit"
          ? "Marcar en camino"
          : `Marcar ${DELIVERY_STATUS_LABELS[next].toLowerCase()}`}
      </Button>
      {state.status === "error" && state.message !== undefined ? (
        <p className="text-destructive text-sm">{state.message}</p>
      ) : null}
    </form>
  );
}

/**
 * Ending a delivery badly.
 *
 * A separate form from `AdvanceDeliveryForm` because it needs a reason, which
 * both the CHECK and the trigger demand - and because master section 36 asks
 * that a destructive action be a deliberate act, not a neighbouring button.
 */
export function CloseDeliveryForm({
  tenantSlug,
  deliveryId,
  status,
}: {
  tenantSlug: string;
  deliveryId: string;
  status: "failed" | "cancelled";
}) {
  const [state, formAction, isPending] = useActionState(closeDeliveryAction, IDLE_FORM_STATE);
  const [open, setOpen] = useState(false);
  const errors = state.fieldErrors ?? {};
  const label = status === "failed" ? "No se pudo entregar" : "Anular entrega";

  if (!open) {
    return (
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
        {label}
      </Button>
    );
  }

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="deliveryId" value={deliveryId} />
      <input type="hidden" name="status" value={status} />

      <div className="flex min-w-[12rem] flex-col gap-2">
        <Label htmlFor={`reason-${status}-${deliveryId}`}>Motivo</Label>
        <Input
          id={`reason-${status}-${deliveryId}`}
          name="failureReason"
          invalid={errors.failureReason !== undefined}
          placeholder={status === "failed" ? "Nadie en casa" : "El cliente cancelo"}
        />
        <FieldError messages={errors.failureReason} />
      </div>

      <Button type="submit" size="sm" variant="destructive" loading={isPending} loadingLabel="...">
        Confirmar
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
        Cancelar
      </Button>

      {state.status === "error" && state.message !== undefined ? (
        <p className="text-destructive text-sm">{state.message}</p>
      ) : null}
    </form>
  );
}

export function DetachDeliveryForm({
  tenantSlug,
  deliveryId,
}: {
  tenantSlug: string;
  deliveryId: string;
}) {
  const [state, formAction, isPending] = useActionState(detachDeliveryAction, IDLE_FORM_STATE);

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (
          !window.confirm("Retirar la entrega de este pedido? El costo del envio volvera a cero.")
        ) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="deliveryId" value={deliveryId} />
      {state.status === "error" && state.message !== undefined ? (
        <p className="text-destructive text-sm">{state.message}</p>
      ) : null}
      <Button type="submit" variant="ghost" size="sm" loading={isPending} loadingLabel="Retirando">
        Retirar entrega
      </Button>
    </form>
  );
}
