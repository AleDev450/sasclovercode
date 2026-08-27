"use client";

import { useActionState } from "react";
import { Alert, AlertDescription, Button, Input, Label } from "@/components/ui";
import { IDLE_FORM_STATE } from "@/lib/forms/state";
import {
  createLocationAction,
  setLocationActiveAction,
  updateLocationAction,
} from "../server/actions";
import type { Location } from "../server/queries";

function Field({
  name,
  label,
  hint,
  defaultValue,
  errors,
  inputMode,
}: {
  name: string;
  label: string;
  hint?: string;
  defaultValue?: string;
  errors?: readonly string[];
  inputMode?: "text" | "decimal" | "tel";
}) {
  const describedBy =
    errors !== undefined ? `${name}-error` : hint !== undefined ? `${name}-hint` : undefined;

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        name={name}
        defaultValue={defaultValue ?? ""}
        inputMode={inputMode}
        invalid={errors !== undefined}
        aria-describedby={describedBy}
      />
      {errors !== undefined ? (
        <p id={`${name}-error`} className="text-destructive text-sm">
          {errors[0]}
        </p>
      ) : hint !== undefined ? (
        <p id={`${name}-hint`} className="text-muted-foreground text-xs">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/**
 * One form for creating and for editing.
 *
 * The two actions take the same fields and differ only in whether a
 * `locationId` travels with them, so a second nearly-identical component would
 * be two places to forget the same field.
 */
export function LocationForm({
  tenantSlug,
  location,
}: {
  tenantSlug: string;
  location?: Location;
}) {
  const isEdit = location !== undefined;
  const [state, formAction, isPending] = useActionState(
    isEdit ? updateLocationAction : createLocationAction,
    IDLE_FORM_STATE,
  );
  const e = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      {isEdit ? <input type="hidden" name="locationId" value={location.id} /> : null}

      {state.message !== undefined ? (
        <Alert variant={state.status === "success" ? "success" : "warning"}>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <Field
        name="name"
        label="Nombre de la sede"
        hint="Como la llaman ustedes: Miraflores, Centro, Local principal."
        defaultValue={location?.name}
        errors={e.name}
      />

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          name="addressLine"
          label="Direccion"
          defaultValue={location?.addressLine ?? ""}
          errors={e.addressLine}
        />
        <Field
          name="reference"
          label="Referencia"
          hint="Frente al parque, al lado de la farmacia."
          defaultValue={location?.reference ?? ""}
          errors={e.reference}
        />
      </div>

      <div className="grid gap-5 sm:grid-cols-3">
        <Field
          name="district"
          label="Distrito"
          defaultValue={location?.district ?? ""}
          errors={e.district}
        />
        <Field name="city" label="Ciudad" defaultValue={location?.city ?? ""} errors={e.city} />
        <Field
          name="phone"
          label="Telefono"
          inputMode="tel"
          defaultValue={location?.phone ?? ""}
          errors={e.phone}
        />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          name="latitude"
          label="Latitud"
          inputMode="decimal"
          hint="Opcional. Copiala de Google Maps, por ejemplo -12.121500."
          defaultValue={location?.latitude === null ? "" : String(location?.latitude ?? "")}
          errors={e.latitude}
        />
        <Field
          name="longitude"
          label="Longitud"
          inputMode="decimal"
          hint="Si pones una, pon las dos."
          defaultValue={location?.longitude === null ? "" : String(location?.longitude ?? "")}
          errors={e.longitude}
        />
      </div>

      <div>
        <Button type="submit" loading={isPending} loadingLabel="Guardando">
          {isEdit ? "Guardar sede" : "Crear sede"}
        </Button>
      </div>
    </form>
  );
}

export function SetLocationActiveForm({
  tenantSlug,
  locationId,
  isActive,
}: {
  tenantSlug: string;
  locationId: string;
  isActive: boolean;
}) {
  const [state, formAction, isPending] = useActionState(setLocationActiveAction, IDLE_FORM_STATE);

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="locationId" value={locationId} />
      <input type="hidden" name="isActive" value={isActive ? "false" : "true"} />

      {state.message !== undefined ? (
        <Alert variant={state.status === "success" ? "success" : "warning"}>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <Button
        type="submit"
        variant={isActive ? "destructive" : "secondary"}
        loading={isPending}
        loadingLabel="Guardando"
      >
        {isActive ? "Desactivar" : "Activar"}
      </Button>
    </form>
  );
}
