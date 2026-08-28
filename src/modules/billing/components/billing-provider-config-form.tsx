"use client";

import { useActionState } from "react";
import { Alert, AlertDescription, Button, Input, Label } from "@/components/ui";
import { IDLE_FORM_STATE } from "@/lib/forms/state";
import { saveBillingProviderConfigAction, setBillingActiveAction } from "../server/actions";

export interface BillingProviderConfigValues {
  readonly seriesBoleta: string | null;
  readonly seriesFactura: string | null;
  readonly seriesNotaCredito: string | null;
  readonly seriesNotaDebito: string | null;
}

/**
 * Series overrides and provider choice.
 *
 * `providerName` is a fixed hidden field, not a free-text input: the ADR-021
 * decision is one shipped implementation, `manual` (`ManualBillingProvider`),
 * so a text box a person could mistype into is a worse interface than the
 * true state of the world, not a more flexible one. A blank series field
 * means "use the default" - `default_billing_series()` (Phase 17 migrations)
 * already assigns B001/F001/BC01/BD01 with no setup needed at all.
 */
export function BillingProviderConfigForm({
  tenantSlug,
  values,
}: {
  tenantSlug: string;
  values: BillingProviderConfigValues;
}) {
  const [state, formAction, isPending] = useActionState(saveBillingProviderConfigAction, IDLE_FORM_STATE);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="providerName" value="manual" />

      {state.message !== undefined ? (
        <Alert variant={state.status === "success" ? "success" : "warning"}>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <p className="text-muted-foreground text-sm">
        Proveedor: <span className="text-foreground font-medium">Manual</span> - emites cada
        comprobante tu mismo (SEE-SOL de SUNAT o tu PSE) y registras aqui el resultado.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="seriesBoleta">Serie de boleta</Label>
          <Input id="seriesBoleta" name="seriesBoleta" placeholder="B001" defaultValue={values.seriesBoleta ?? ""} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="seriesFactura">Serie de factura</Label>
          <Input id="seriesFactura" name="seriesFactura" placeholder="F001" defaultValue={values.seriesFactura ?? ""} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="seriesNotaCredito">Serie de nota de credito</Label>
          <Input
            id="seriesNotaCredito"
            name="seriesNotaCredito"
            placeholder="BC01"
            defaultValue={values.seriesNotaCredito ?? ""}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="seriesNotaDebito">Serie de nota de debito</Label>
          <Input
            id="seriesNotaDebito"
            name="seriesNotaDebito"
            placeholder="BD01"
            defaultValue={values.seriesNotaDebito ?? ""}
          />
        </div>
      </div>
      <p className="text-muted-foreground text-xs">
        Deja una serie en blanco para usar el valor por defecto que se muestra como ejemplo.
      </p>

      <div>
        <Button type="submit" loading={isPending} loadingLabel="Guardando">
          Guardar
        </Button>
      </div>
    </form>
  );
}

export function BillingActiveToggleForm({
  tenantSlug,
  isActive,
}: {
  tenantSlug: string;
  isActive: boolean;
}) {
  const [state, formAction, isPending] = useActionState(setBillingActiveAction, IDLE_FORM_STATE);

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="isActive" value={isActive ? "false" : "true"} />

      {state.message !== undefined ? (
        <Alert variant={state.status === "success" ? "success" : "warning"}>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <Button
        type="submit"
        variant={isActive ? "destructive" : "secondary"}
        size="sm"
        loading={isPending}
        loadingLabel="Guardando"
      >
        {isActive ? "Desactivar facturacion" : "Activar facturacion"}
      </Button>
    </form>
  );
}
