"use client";

import { useActionState } from "react";
import { Alert, AlertDescription, Button, Input, Label } from "@/components/ui";
import { IDLE_FORM_STATE } from "@/lib/forms/state";
import {
  createInventoryItemAction,
  setInventoryItemActiveAction,
  updateInventoryItemAction,
} from "../server/actions";

export interface UnitOption {
  readonly id: string;
  readonly name: string;
  readonly abbreviation: string;
}

const selectClass =
  "border-input bg-background focus-visible:ring-ring h-10 rounded-md border px-3 text-sm focus-visible:ring-2 focus-visible:outline-none";

export function CreateInventoryItemForm({
  tenantSlug,
  units,
}: {
  tenantSlug: string;
  units: readonly UnitOption[];
}) {
  const [state, formAction, isPending] = useActionState(createInventoryItemAction, IDLE_FORM_STATE);
  const errors = state.fieldErrors ?? {};

  if (units.length === 0) {
    return <p className="text-muted-foreground text-sm">Crea al menos una unidad primero.</p>;
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />

      {state.message !== undefined ? (
        <Alert variant={state.status === "success" ? "success" : "warning"}>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor="name">Nombre</Label>
          <Input
            id="name"
            name="name"
            placeholder="Salmon fresco"
            invalid={errors.name !== undefined}
          />
          {errors.name !== undefined ? (
            <p className="text-destructive text-sm">{errors.name[0]}</p>
          ) : null}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="unitId">Unidad</Label>
          <select id="unitId" name="unitId" className={selectClass} defaultValue={units[0]?.id}>
            {units.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.name} ({unit.abbreviation})
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="sku">Codigo (opcional)</Label>
          <Input id="sku" name="sku" placeholder="Codigo del proveedor" />
        </div>
      </div>

      <div>
        <Button type="submit" loading={isPending} loadingLabel="Creando">
          Anadir insumo
        </Button>
      </div>
    </form>
  );
}

export function UpdateInventoryItemForm({
  tenantSlug,
  units,
  item,
}: {
  tenantSlug: string;
  units: readonly UnitOption[];
  item: {
    readonly id: string;
    readonly name: string;
    readonly sku: string | null;
    readonly unitId: string;
  };
}) {
  const [state, formAction, isPending] = useActionState(updateInventoryItemAction, IDLE_FORM_STATE);
  const errors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="inventoryItemId" value={item.id} />

      {state.message !== undefined ? (
        <Alert variant={state.status === "success" ? "success" : "warning"}>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor="name">Nombre</Label>
          <Input
            id="name"
            name="name"
            defaultValue={item.name}
            invalid={errors.name !== undefined}
          />
          {errors.name !== undefined ? (
            <p className="text-destructive text-sm">{errors.name[0]}</p>
          ) : null}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="unitId">Unidad</Label>
          <select id="unitId" name="unitId" className={selectClass} defaultValue={item.unitId}>
            {units.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.name} ({unit.abbreviation})
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="sku">Codigo (opcional)</Label>
          <Input id="sku" name="sku" defaultValue={item.sku ?? ""} />
        </div>
      </div>

      <div>
        <Button type="submit" loading={isPending} loadingLabel="Guardando">
          Guardar
        </Button>
      </div>
    </form>
  );
}

export function SetInventoryItemActiveForm({
  tenantSlug,
  inventoryItemId,
  isActive,
}: {
  tenantSlug: string;
  inventoryItemId: string;
  isActive: boolean;
}) {
  const [, formAction, isPending] = useActionState(setInventoryItemActiveAction, IDLE_FORM_STATE);

  return (
    <form action={formAction}>
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="inventoryItemId" value={inventoryItemId} />
      <input type="hidden" name="isActive" value={isActive ? "false" : "true"} />
      <Button
        type="submit"
        variant={isActive ? "destructive" : "secondary"}
        size="sm"
        loading={isPending}
        loadingLabel="Guardando"
      >
        {isActive ? "Desactivar" : "Activar"}
      </Button>
    </form>
  );
}
