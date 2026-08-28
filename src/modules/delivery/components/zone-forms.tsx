"use client";

import { useActionState } from "react";
import { Alert, AlertDescription, Button, Input, Label } from "@/components/ui";
import { IDLE_FORM_STATE } from "@/lib/forms/state";
import { formatMoney } from "@/lib/money";
import {
  createDeliveryZoneAction,
  deleteDeliveryRateAction,
  deleteDeliveryZoneAction,
  saveDeliveryRateAction,
  setDeliveryZoneActiveAction,
  updateDeliveryZoneAction,
} from "../server/actions";

function FieldError({ messages }: { messages?: readonly string[] }) {
  if (messages === undefined) return null;
  return <p className="text-destructive text-sm">{messages[0]}</p>;
}

function ZoneFields({
  errors,
  defaults,
}: {
  errors: Readonly<Record<string, readonly string[]>>;
  defaults?: {
    readonly name: string;
    readonly district: string | null;
    readonly notes: string | null;
  };
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="flex flex-col gap-2">
        <Label htmlFor="name">Nombre</Label>
        <Input
          id="name"
          name="name"
          defaultValue={defaults?.name}
          invalid={errors.name !== undefined}
          placeholder="Miraflores"
        />
        <FieldError messages={errors.name} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="district">Distrito (opcional)</Label>
        <Input id="district" name="district" defaultValue={defaults?.district ?? ""} />
        <FieldError messages={errors.district} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="notes">Notas (opcional)</Label>
        <Input id="notes" name="notes" defaultValue={defaults?.notes ?? ""} />
        <FieldError messages={errors.notes} />
      </div>
    </div>
  );
}

export function CreateZoneForm({ tenantSlug }: { tenantSlug: string }) {
  const [state, formAction, isPending] = useActionState(createDeliveryZoneAction, IDLE_FORM_STATE);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      {state.message !== undefined ? (
        <Alert variant={state.status === "success" ? "success" : "warning"}>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}
      <ZoneFields errors={state.fieldErrors ?? {}} />
      <div>
        <Button type="submit" loading={isPending} loadingLabel="Creando">
          Anadir zona
        </Button>
      </div>
    </form>
  );
}

export interface ZoneDefaults {
  readonly id: string;
  readonly name: string;
  readonly district: string | null;
  readonly notes: string | null;
  readonly isActive: boolean;
}

export function UpdateZoneForm({ tenantSlug, zone }: { tenantSlug: string; zone: ZoneDefaults }) {
  const [state, formAction, isPending] = useActionState(updateDeliveryZoneAction, IDLE_FORM_STATE);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="zoneId" value={zone.id} />
      {state.message !== undefined ? (
        <Alert variant={state.status === "success" ? "success" : "warning"}>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}
      <ZoneFields errors={state.fieldErrors ?? {}} defaults={zone} />
      <div>
        <Button type="submit" loading={isPending} loadingLabel="Guardando">
          Guardar zona
        </Button>
      </div>
    </form>
  );
}

export function SetZoneActiveForm({
  tenantSlug,
  zoneId,
  isActive,
}: {
  tenantSlug: string;
  zoneId: string;
  isActive: boolean;
}) {
  const [, formAction, isPending] = useActionState(setDeliveryZoneActiveAction, IDLE_FORM_STATE);

  return (
    <form action={formAction}>
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="zoneId" value={zoneId} />
      <input type="hidden" name="isActive" value={isActive ? "false" : "true"} />
      <Button type="submit" variant="ghost" size="sm" loading={isPending} loadingLabel="Guardando">
        {isActive ? "Desactivar" : "Activar"}
      </Button>
    </form>
  );
}

export function DeleteZoneForm({
  tenantSlug,
  zoneId,
  zoneName,
}: {
  tenantSlug: string;
  zoneId: string;
  zoneName: string;
}) {
  const [state, formAction, isPending] = useActionState(deleteDeliveryZoneAction, IDLE_FORM_STATE);

  return (
    <form
      action={formAction}
      // Master section 36: a destructive action confirms. Deleting a zone
      // removes its rates too, which is not obvious from the button.
      onSubmit={(event) => {
        if (
          !window.confirm(
            `Eliminar la zona "${zoneName}" y sus tarifas? Las entregas ya hechas la conservan.`,
          )
        ) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="zoneId" value={zoneId} />
      {state.message !== undefined && state.status === "error" ? (
        <p className="text-destructive text-sm">{state.message}</p>
      ) : null}
      <Button type="submit" variant="ghost" size="sm" loading={isPending} loadingLabel="Eliminando">
        Eliminar
      </Button>
    </form>
  );
}

export interface RateDefaults {
  readonly id: string;
  readonly feeCents: number;
  readonly minOrderFreeCents: number | null;
  readonly estimatedMinutes: number | null;
}

export function SaveRateForm({
  tenantSlug,
  zoneId,
  locationId,
  locationName,
  rate,
}: {
  tenantSlug: string;
  zoneId: string;
  /** Empty string is the zone default, which is what the action reads as NULL. */
  locationId: string;
  locationName: string;
  rate?: RateDefaults;
}) {
  const [state, formAction, isPending] = useActionState(saveDeliveryRateAction, IDLE_FORM_STATE);
  const errors = state.fieldErrors ?? {};
  const fieldId = `${zoneId}-${locationId === "" ? "default" : locationId}`;

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="zoneId" value={zoneId} />
      <input type="hidden" name="locationId" value={locationId} />

      <div className="flex min-w-[7rem] flex-col gap-2">
        <Label htmlFor={`fee-${fieldId}`}>{locationName}</Label>
        <Input
          id={`fee-${fieldId}`}
          name="feeCents"
          inputMode="decimal"
          defaultValue={rate === undefined ? "" : formatMoney(rate.feeCents)}
          invalid={errors.feeCents !== undefined}
          placeholder="8.00"
        />
        <FieldError messages={errors.feeCents} />
      </div>

      <div className="flex min-w-[8rem] flex-col gap-2">
        <Label htmlFor={`free-${fieldId}`}>Gratis desde</Label>
        <Input
          id={`free-${fieldId}`}
          name="minOrderFreeCents"
          inputMode="decimal"
          defaultValue={
            rate?.minOrderFreeCents === undefined || rate.minOrderFreeCents === null
              ? ""
              : formatMoney(rate.minOrderFreeCents)
          }
          invalid={errors.minOrderFreeCents !== undefined}
          placeholder="50.00"
        />
        <FieldError messages={errors.minOrderFreeCents} />
      </div>

      <div className="flex min-w-[6rem] flex-col gap-2">
        <Label htmlFor={`min-${fieldId}`}>Minutos</Label>
        <Input
          id={`min-${fieldId}`}
          name="estimatedMinutes"
          inputMode="numeric"
          defaultValue={rate?.estimatedMinutes ?? ""}
          invalid={errors.estimatedMinutes !== undefined}
          placeholder="40"
        />
        <FieldError messages={errors.estimatedMinutes} />
      </div>

      <Button type="submit" size="sm" loading={isPending} loadingLabel="Guardando">
        Guardar
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

export function DeleteRateForm({ tenantSlug, rateId }: { tenantSlug: string; rateId: string }) {
  const [, formAction, isPending] = useActionState(deleteDeliveryRateAction, IDLE_FORM_STATE);

  return (
    <form action={formAction}>
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="rateId" value={rateId} />
      <Button type="submit" variant="ghost" size="sm" loading={isPending} loadingLabel="Quitando">
        Quitar tarifa
      </Button>
    </form>
  );
}
