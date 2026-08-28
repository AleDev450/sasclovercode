"use client";

import { useState } from "react";
import { useActionState } from "react";
import { Alert, AlertDescription, Button, Input, Label } from "@/components/ui";
import { IDLE_FORM_STATE } from "@/lib/forms/state";
import { recordPurchaseAction } from "../server/actions";

export interface SupplierOption {
  readonly id: string;
  readonly name: string;
}

export interface LocationOption {
  readonly id: string;
  readonly name: string;
}

export interface InventoryItemOption {
  readonly id: string;
  readonly name: string;
  readonly unitAbbreviation: string;
}

const selectClass =
  "border-input bg-background focus-visible:ring-ring h-10 rounded-md border px-3 text-sm focus-visible:ring-2 focus-visible:outline-none";

/**
 * Records a purchase: a header (supplier, location) and one or more
 * lines. Lines are added client-side and submitted as parallel arrays -
 * the same shape `NewOrderForm` (Phase 13) uses - so the form still works
 * without JavaScript having hydrated.
 */
export function RecordPurchaseForm({
  tenantSlug,
  suppliers,
  locations,
  items,
}: {
  tenantSlug: string;
  suppliers: readonly SupplierOption[];
  locations: readonly LocationOption[];
  items: readonly InventoryItemOption[];
}) {
  const [state, formAction, isPending] = useActionState(recordPurchaseAction, IDLE_FORM_STATE);
  const [lineCount, setLineCount] = useState(1);
  const errors = state.fieldErrors ?? {};

  if (suppliers.length === 0 || items.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Necesitas al menos un proveedor y un insumo activos para registrar una compra.
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />

      {state.message !== undefined ? (
        <Alert variant={state.status === "success" ? "success" : "warning"}>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor="supplierId">Proveedor</Label>
          <select id="supplierId" name="supplierId" className={selectClass}>
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="locationId">Sede de llegada</Label>
          <select id="locationId" name="locationId" className={selectClass}>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="reference">Comprobante (opcional)</Label>
          <Input id="reference" name="reference" placeholder="F001-123" />
        </div>
      </div>

      <fieldset className="flex flex-col gap-4">
        <legend className="text-sm font-medium">Insumos comprados</legend>

        {Array.from({ length: lineCount }, (_, index) => (
          <div key={index} className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
            <div className="flex flex-col gap-2">
              <Label htmlFor={`lineInventoryItemId-${index}`}>Insumo</Label>
              <select
                id={`lineInventoryItemId-${index}`}
                name="lineInventoryItemId"
                className={selectClass}
              >
                <option value="">Elige un insumo</option>
                {items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} ({item.unitAbbreviation})
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor={`lineQuantity-${index}`}>Cantidad</Label>
              <Input id={`lineQuantity-${index}`} name="lineQuantity" inputMode="decimal" defaultValue="1" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor={`lineUnitCost-${index}`}>Costo unitario</Label>
              <Input id={`lineUnitCost-${index}`} name="lineUnitCost" inputMode="decimal" placeholder="0.00" />
            </div>
          </div>
        ))}

        {errors.lines !== undefined ? <p className="text-destructive text-sm">{errors.lines[0]}</p> : null}

        <div>
          <Button type="button" variant="outline" size="sm" onClick={() => setLineCount((n) => n + 1)}>
            Anadir otro insumo
          </Button>
        </div>
      </fieldset>

      <div className="flex flex-col gap-2">
        <Label htmlFor="notes">Notas</Label>
        <Input id="notes" name="notes" />
      </div>

      <div>
        <Button type="submit" loading={isPending} loadingLabel="Registrando">
          Registrar compra
        </Button>
      </div>
    </form>
  );
}
