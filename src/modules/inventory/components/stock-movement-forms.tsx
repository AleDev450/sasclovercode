"use client";

import { useActionState } from "react";
import { Alert, AlertDescription, Button, Input, Label } from "@/components/ui";
import { IDLE_FORM_STATE } from "@/lib/forms/state";
import { MANUAL_STOCK_MOVEMENT_TYPES, STOCK_MOVEMENT_TYPE_LABELS } from "../constants";
import { recordStockMovementAction, recordStockTransferAction } from "../server/actions";

export interface InventoryItemOption {
  readonly id: string;
  readonly name: string;
  readonly unitAbbreviation: string;
}

export interface LocationOption {
  readonly id: string;
  readonly name: string;
}

const selectClass =
  "border-input bg-background focus-visible:ring-ring h-10 rounded-md border px-3 text-sm focus-visible:ring-2 focus-visible:outline-none";

/**
 * Adjustment, waste or return. `waste`'s sign is fixed by the Server
 * Action regardless of what is typed - the quantity field here only
 * really carries a direction for `adjustment`/`return`.
 */
export function RecordStockMovementForm({
  tenantSlug,
  items,
  locations,
}: {
  tenantSlug: string;
  items: readonly InventoryItemOption[];
  locations: readonly LocationOption[];
}) {
  const [state, formAction, isPending] = useActionState(recordStockMovementAction, IDLE_FORM_STATE);
  const errors = state.fieldErrors ?? {};

  if (items.length === 0) {
    return <p className="text-muted-foreground text-sm">Crea al menos un insumo primero.</p>;
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />

      {state.message !== undefined ? (
        <Alert variant={state.status === "success" ? "success" : "warning"}>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="inventoryItemId">Insumo</Label>
          <select id="inventoryItemId" name="inventoryItemId" className={selectClass}>
            {items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} ({item.unitAbbreviation})
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="locationId">Sede</Label>
          <select id="locationId" name="locationId" className={selectClass}>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="type">Tipo</Label>
          <select id="type" name="type" className={selectClass} defaultValue="adjustment">
            {MANUAL_STOCK_MOVEMENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {STOCK_MOVEMENT_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="quantity">Cantidad</Label>
          <Input
            id="quantity"
            name="quantity"
            inputMode="decimal"
            placeholder="-2 o 2"
            invalid={errors.quantity !== undefined}
          />
          {errors.quantity !== undefined ? (
            <p className="text-destructive text-sm">{errors.quantity[0]}</p>
          ) : null}
          <p className="text-muted-foreground text-xs">
            Para ajuste o devolucion, un signo negativo la resta del stock.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="reason">Motivo</Label>
        <Input id="reason" name="reason" invalid={errors.reason !== undefined} />
        {errors.reason !== undefined ? (
          <p className="text-destructive text-sm">{errors.reason[0]}</p>
        ) : null}
      </div>

      <div>
        <Button type="submit" loading={isPending} loadingLabel="Registrando">
          Registrar movimiento
        </Button>
      </div>
    </form>
  );
}

export function RecordStockTransferForm({
  tenantSlug,
  items,
  locations,
}: {
  tenantSlug: string;
  items: readonly InventoryItemOption[];
  locations: readonly LocationOption[];
}) {
  const [state, formAction, isPending] = useActionState(recordStockTransferAction, IDLE_FORM_STATE);
  const errors = state.fieldErrors ?? {};

  if (items.length === 0 || locations.length < 2) {
    return (
      <p className="text-muted-foreground text-sm">
        Necesitas al menos un insumo y dos sedes para registrar un traslado.
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />

      {state.message !== undefined ? (
        <Alert variant={state.status === "success" ? "success" : "warning"}>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-2">
        <Label htmlFor="transferInventoryItemId">Insumo</Label>
        <select id="transferInventoryItemId" name="inventoryItemId" className={selectClass}>
          {items.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name} ({item.unitAbbreviation})
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="fromLocationId">Origen</Label>
          <select id="fromLocationId" name="fromLocationId" className={selectClass}>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="toLocationId">Destino</Label>
          <select id="toLocationId" name="toLocationId" className={selectClass} defaultValue={locations[1]?.id}>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
          {errors.toLocationId !== undefined ? (
            <p className="text-destructive text-sm">{errors.toLocationId[0]}</p>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="transferQuantity">Cantidad</Label>
        <Input
          id="transferQuantity"
          name="quantity"
          inputMode="decimal"
          invalid={errors.quantity !== undefined}
        />
        {errors.quantity !== undefined ? (
          <p className="text-destructive text-sm">{errors.quantity[0]}</p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="transferReason">Motivo (opcional)</Label>
        <Input id="transferReason" name="reason" />
      </div>

      <div>
        <Button type="submit" loading={isPending} loadingLabel="Registrando">
          Registrar traslado
        </Button>
      </div>
    </form>
  );
}
