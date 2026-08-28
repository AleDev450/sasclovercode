"use client";

import { useActionState } from "react";
import { Alert, AlertDescription, Badge, Button, Label } from "@/components/ui";
import { IDLE_FORM_STATE } from "@/lib/forms/state";
import { clearBillingCredentialsAction, setBillingCredentialsAction } from "../server/actions";

const textareaClass =
  "border-input bg-background focus-visible:ring-ring min-h-24 rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none";

/**
 * Writes a credential into Supabase Vault, and only that.
 *
 * The textarea starts blank on every render, never pre-filled: there is no
 * function anywhere in this project that reads a stored credential back
 * (ADR-021) - `has_billing_credentials()` reports presence only. Submitting
 * blank changes nothing; the placeholder tells a returning user that.
 */
export function BillingCredentialsForm({
  tenantSlug,
  hasCredentials,
  credentialsUpdatedAt,
}: {
  tenantSlug: string;
  hasCredentials: boolean;
  credentialsUpdatedAt: string | null;
}) {
  const [state, formAction, isPending] = useActionState(setBillingCredentialsAction, IDLE_FORM_STATE);
  const [clearState, clearAction, isClearing] = useActionState(
    clearBillingCredentialsAction,
    IDLE_FORM_STATE,
  );
  const errors = state.fieldErrors ?? {};

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={hasCredentials ? "success" : "neutral"}>
          {hasCredentials ? "Credenciales configuradas" : "Sin credenciales"}
        </Badge>
        {hasCredentials && credentialsUpdatedAt !== null ? (
          <span className="text-muted-foreground text-xs">
            Actualizadas el {new Date(credentialsUpdatedAt).toLocaleString("es-PE")}
          </span>
        ) : null}
      </div>

      <form action={formAction} className="flex flex-col gap-3">
        <input type="hidden" name="tenantSlug" value={tenantSlug} />

        {state.message !== undefined ? (
          <Alert variant={state.status === "success" ? "success" : "warning"}>
            <AlertDescription>{state.message}</AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-col gap-2">
          <Label htmlFor="credentials">
            {hasCredentials ? "Reemplazar credenciales" : "Credenciales del proveedor"}
          </Label>
          <textarea
            id="credentials"
            name="credentials"
            className={textareaClass}
            placeholder="Pega aqui el token, usuario/clave o certificado que te dio tu PSE"
          />
          {errors.credentials !== undefined ? (
            <p className="text-destructive text-sm">{errors.credentials[0]}</p>
          ) : null}
        </div>

        <div>
          <Button type="submit" loading={isPending} loadingLabel="Guardando">
            Guardar credenciales
          </Button>
        </div>
      </form>

      {hasCredentials ? (
        <form action={clearAction} className="flex flex-col gap-2">
          <input type="hidden" name="tenantSlug" value={tenantSlug} />
          {clearState.message !== undefined ? (
            <Alert variant={clearState.status === "success" ? "success" : "warning"}>
              <AlertDescription>{clearState.message}</AlertDescription>
            </Alert>
          ) : null}
          <div>
            <Button type="submit" variant="destructive" size="sm" loading={isClearing} loadingLabel="Quitando">
              Quitar credenciales
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
