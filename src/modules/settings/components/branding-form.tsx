"use client";

import { useActionState } from "react";
import { Alert, AlertDescription, Button } from "@/components/ui";
import { IDLE_FORM_STATE } from "@/lib/forms/state";
import { AssetPicker } from "@/modules/assets/components/asset-picker";
import { updateBrandingAction } from "../server/actions";

/**
 * The logo and the favicon.
 *
 * Both slots pass a FIXED `basename`, so uploading a new logo REPLACES the old
 * one at `tenants/{id}/branding/logo.png` rather than leaving the previous nine
 * behind in a bucket nobody can see. That is the right behaviour for a slot
 * with exactly one occupant, and the wrong one for a gallery - which is why the
 * control takes it as an option rather than deciding for itself.
 *
 * The paths only reach `tenant_themes` when this form is submitted. Dropping a
 * file uploads it and shows it; changing your mind before pressing save costs
 * an orphaned file and nothing else.
 */
export function BrandingForm({
  tenantSlug,
  logoPath,
  faviconPath,
}: {
  tenantSlug: string;
  logoPath: string | null;
  faviconPath: string | null;
}) {
  const [state, formAction, isPending] = useActionState(updateBrandingAction, IDLE_FORM_STATE);

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />

      {state.status !== "idle" && state.message !== undefined ? (
        <Alert variant={state.status === "success" ? "success" : "destructive"}>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-6 sm:grid-cols-2">
        <AssetPicker
          tenantSlug={tenantSlug}
          folder="branding"
          name="logoPath"
          basename="logo"
          label="Logo"
          aspect="logo"
          defaultValue={logoPath}
          hint="Se muestra en la cabecera de tu web. PNG con fondo transparente queda mejor."
        />

        <AssetPicker
          tenantSlug={tenantSlug}
          folder="branding"
          name="faviconPath"
          basename="favicon"
          label="Favicon"
          aspect="square"
          defaultValue={faviconPath}
          hint="El iconito de la pestana del navegador. Cuadrado, 64x64 o mas."
        />
      </div>

      <div>
        <Button type="submit" loading={isPending} loadingLabel="Guardando">
          Guardar marca
        </Button>
      </div>
    </form>
  );
}
