"use client";

/**
 * Super Admin -> tenant -> Pagos online (Phase 31).
 *
 * The owner asked for this to live on the platform side: from the second plan
 * up, CloverCode chooses and integrates the gateway for the restaurant. So the
 * operator picks the provider, pastes the keys the restaurant's merchant account
 * issued, and switches it on.
 *
 * Secret fields are always EMPTY when the form loads - the stored value is never
 * sent back to a browser, not even masked. Leaving them empty keeps what is
 * stored; typing replaces it.
 */

import { useActionState, useId, useState } from "react";
import { Alert, AlertDescription, Button, Input, Label, Select } from "@/components/ui";
import { IDLE_FORM_STATE } from "@/lib/forms/state";
import type { PaymentGatewayMode, PaymentGatewayProvider } from "@/types/database";
import { setPaymentGatewayAction } from "../server/actions";

interface SecretField {
  readonly name: string;
  readonly label: string;
  readonly hint: string;
  readonly optional?: boolean;
}

const SECRET_FIELDS: Record<PaymentGatewayProvider, readonly SecretField[]> = {
  mercadopago: [
    {
      name: "accessToken",
      label: "Access token",
      hint: "Tus integraciones -> Credenciales. APP_USR-... (produccion) o TEST-... (pruebas).",
    },
    {
      name: "webhookSecret",
      label: "Clave secreta de webhooks",
      hint: "Tus integraciones -> Webhooks. Opcional pero recomendada: valida la firma x-signature.",
      optional: true,
    },
  ],
  izipay: [
    {
      name: "username",
      label: "Usuario (ID de tienda)",
      hint: "Back office -> Configuracion -> Claves de API REST.",
    },
    {
      name: "password",
      label: "Contrasena",
      hint: "La de prueba o la de produccion, segun el modo.",
    },
    { name: "hmacKey", label: "Clave HMAC-SHA-256", hint: "Misma pantalla que la contrasena." },
  ],
  culqi: [
    {
      name: "secretKey",
      label: "Llave secreta",
      hint: "CulqiPanel -> Desarrollo -> API Keys. sk_test_... o sk_live_...",
    },
  ],
};

const PUBLIC_KEY_HINT: Record<PaymentGatewayProvider, string | null> = {
  mercadopago: null,
  izipay: "Clave publica de JavaScript, con el formato 12345678:testpublickey_...",
  culqi: "Llave publica pk_test_... o pk_live_...",
};

export function GatewayForm({
  tenantId,
  current,
}: {
  tenantId: string;
  current: {
    provider: PaymentGatewayProvider;
    mode: PaymentGatewayMode;
    publicKey: string | null;
    isEnabled: boolean;
    hasCredentials: boolean;
  } | null;
}) {
  const [state, formAction, isPending] = useActionState(setPaymentGatewayAction, IDLE_FORM_STATE);
  const [provider, setProvider] = useState<PaymentGatewayProvider>(
    current?.provider ?? "mercadopago",
  );
  const providerId = useId();
  const modeId = useId();
  const publicKeyId = useId();
  const e = state.fieldErrors ?? {};

  const switching = current !== null && current.provider !== provider;
  const keepHint =
    current !== null && current.hasCredentials && !switching
      ? " Guardada: deja vacio para mantenerla."
      : "";

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <input type="hidden" name="tenantId" value={tenantId} />

      {state.message !== undefined ? (
        <Alert variant={state.status === "success" ? "success" : "destructive"}>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={providerId}>Proveedor</Label>
          <Select
            id={providerId}
            name="provider"
            value={provider}
            onChange={(event) => setProvider(event.target.value as PaymentGatewayProvider)}
          >
            <option value="mercadopago">Mercado Pago</option>
            <option value="culqi">Culqi</option>
            <option value="izipay">Izipay</option>
          </Select>
          {switching ? (
            <p className="text-warning text-xs">
              Cambiar de proveedor reemplaza las credenciales: escribe las del nuevo.
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={modeId}>Modo</Label>
          <Select id={modeId} name="mode" defaultValue={current?.mode ?? "test"}>
            <option value="test">Pruebas</option>
            <option value="live">Produccion</option>
          </Select>
        </div>
      </div>

      {PUBLIC_KEY_HINT[provider] !== null ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={publicKeyId}>Llave publica</Label>
          <Input
            id={publicKeyId}
            name="publicKey"
            defaultValue={current?.provider === provider ? (current.publicKey ?? "") : ""}
            invalid={e.publicKey !== undefined}
            autoComplete="off"
          />
          {e.publicKey !== undefined ? (
            <p className="text-destructive text-xs">{e.publicKey[0]}</p>
          ) : (
            <p className="text-muted-foreground text-xs">{PUBLIC_KEY_HINT[provider]}</p>
          )}
        </div>
      ) : (
        <input type="hidden" name="publicKey" value="" />
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {SECRET_FIELDS[provider].map((field) => (
          <SecretInput
            key={`${provider}-${field.name}`}
            field={field}
            keepHint={keepHint}
            errors={e[field.name]}
          />
        ))}
      </div>

      <label className="flex items-center gap-3 text-sm">
        <input
          type="checkbox"
          name="enabled"
          defaultChecked={current?.isEnabled ?? false}
          className="size-4"
        />
        Activar el pago online en la web de este negocio
      </label>

      <div>
        <Button type="submit" loading={isPending} loadingLabel="Guardando">
          Guardar pasarela
        </Button>
      </div>
    </form>
  );
}

function SecretInput({
  field,
  keepHint,
  errors,
}: {
  field: SecretField;
  keepHint: string;
  errors?: readonly string[];
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>
        {field.label}
        {field.optional === true ? " (opcional)" : ""}
      </Label>
      <Input
        id={id}
        name={field.name}
        type="password"
        autoComplete="new-password"
        invalid={errors !== undefined}
      />
      {errors !== undefined ? (
        <p className="text-destructive text-xs">{errors[0]}</p>
      ) : (
        <p className="text-muted-foreground text-xs">
          {field.hint}
          {keepHint}
        </p>
      )}
    </div>
  );
}
