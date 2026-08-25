"use client";

import { useActionState } from "react";
import { Alert, AlertDescription, Button, Input, Label } from "@/components/ui";
import { IDLE_FORM_STATE } from "@/lib/forms/state";
import { updateBusinessSettingsAction } from "../server/actions";
import type { BusinessSettings } from "../server/queries";

function Field({
  name,
  label,
  defaultValue,
  errors,
  type = "text",
  help,
}: {
  name: string;
  label: string;
  defaultValue: string;
  errors?: readonly string[];
  type?: string;
  help?: string;
}) {
  const errorId = `${name}-error`;
  const helpId = `${name}-help`;
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        name={name}
        type={type}
        defaultValue={defaultValue}
        invalid={errors !== undefined}
        aria-describedby={errors !== undefined ? errorId : help !== undefined ? helpId : undefined}
      />
      {errors !== undefined ? (
        <p id={errorId} className="text-destructive text-sm">
          {errors[0]}
        </p>
      ) : help !== undefined ? (
        <p id={helpId} className="text-muted-foreground text-xs">
          {help}
        </p>
      ) : null}
    </div>
  );
}

export function SettingsForm({
  tenantSlug,
  settings,
}: {
  tenantSlug: string;
  settings: BusinessSettings;
}) {
  const [state, formAction, isPending] = useActionState(
    updateBusinessSettingsAction,
    IDLE_FORM_STATE,
  );
  const e = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />

      {state.status === "success" && state.message !== undefined ? (
        <Alert variant="success">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          name="tradeName"
          label="Nombre comercial"
          defaultValue={settings.tradeName ?? ""}
          errors={e.tradeName}
        />
        <Field
          name="legalName"
          label="Razon social"
          defaultValue={settings.legalName ?? ""}
          errors={e.legalName}
        />
        <Field
          name="taxId"
          label="RUC"
          defaultValue={settings.taxId ?? ""}
          errors={e.taxId}
          help="11 digitos."
        />
        <Field
          name="contactEmail"
          label="Correo de contacto"
          type="email"
          defaultValue={settings.contactEmail ?? ""}
          errors={e.contactEmail}
        />
        <Field name="phone" label="Telefono" defaultValue={settings.phone ?? ""} errors={e.phone} />
        <Field
          name="whatsapp"
          label="WhatsApp"
          defaultValue={settings.whatsapp ?? ""}
          errors={e.whatsapp}
        />
        <Field
          name="addressLine"
          label="Direccion"
          defaultValue={settings.addressLine ?? ""}
          errors={e.addressLine}
        />
        <Field
          name="district"
          label="Distrito"
          defaultValue={settings.district ?? ""}
          errors={e.district}
        />
        <Field name="city" label="Ciudad" defaultValue={settings.city ?? ""} errors={e.city} />
        <Field
          name="currency"
          label="Moneda"
          defaultValue={settings.currency}
          errors={e.currency}
          help="Codigo ISO, por ejemplo PEN."
        />
        <Field
          name="timezone"
          label="Zona horaria"
          defaultValue={settings.timezone}
          errors={e.timezone}
          help="Por ejemplo America/Lima."
        />
      </div>

      <div>
        <Button type="submit" loading={isPending} loadingLabel="Guardando">
          Guardar configuracion
        </Button>
      </div>
    </form>
  );
}
