"use client";

import { useState } from "react";
import { useActionState } from "react";
import { Alert, AlertDescription, Button, Input, Label } from "@/components/ui";
import { IDLE_FORM_STATE } from "@/lib/forms/state";
import { saveRecipeAction } from "../server/actions";

export interface InventoryItemOption {
  readonly id: string;
  readonly name: string;
  readonly unitAbbreviation: string;
}

export interface RecipeLine {
  readonly inventoryItemId: string;
  readonly quantity: number;
}

const selectClass =
  "border-input bg-background focus-visible:ring-ring h-10 rounded-md border px-3 text-sm focus-visible:ring-2 focus-visible:outline-none";

/**
 * What one unit of this product consumes. Saving replaces the whole
 * ingredient list at once (`saveRecipeAction` deletes and re-inserts) -
 * simpler than diffing individual rows for a form that edits a recipe as
 * a single unit, and how a business actually thinks about "the recipe"
 * (one thing, not a list of independent edits).
 */
export function RecipeForm({
  tenantSlug,
  productId,
  items,
  initial,
}: {
  tenantSlug: string;
  productId: string;
  items: readonly InventoryItemOption[];
  initial: { readonly notes: string | null; readonly isActive: boolean; readonly lines: readonly RecipeLine[] };
}) {
  const [state, formAction, isPending] = useActionState(saveRecipeAction, IDLE_FORM_STATE);
  const [lines, setLines] = useState<readonly RecipeLine[]>(
    initial.lines.length > 0 ? initial.lines : [{ inventoryItemId: items[0]?.id ?? "", quantity: 1 }],
  );
  const errors = state.fieldErrors ?? {};

  if (items.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Crea al menos un insumo en Inventario antes de armar una receta.
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="productId" value={productId} />

      {state.message !== undefined ? (
        <Alert variant={state.status === "success" ? "success" : "warning"}>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <fieldset className="flex flex-col gap-4">
        <legend className="text-sm font-medium">Ingredientes</legend>

        {lines.map((line, index) => (
          <div key={index} className="grid gap-3 sm:grid-cols-[2fr_1fr]">
            <div className="flex flex-col gap-2">
              <Label htmlFor={`recipeItemInventoryItemId-${index}`}>Insumo</Label>
              <select
                id={`recipeItemInventoryItemId-${index}`}
                name="recipeItemInventoryItemId"
                className={selectClass}
                defaultValue={line.inventoryItemId}
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
              <Label htmlFor={`recipeItemQuantity-${index}`}>Cantidad por unidad vendida</Label>
              <Input
                id={`recipeItemQuantity-${index}`}
                name="recipeItemQuantity"
                inputMode="decimal"
                defaultValue={line.quantity}
              />
            </div>
          </div>
        ))}

        {errors.items !== undefined ? <p className="text-destructive text-sm">{errors.items[0]}</p> : null}

        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setLines((prev) => [...prev, { inventoryItemId: "", quantity: 1 }])}
          >
            Anadir ingrediente
          </Button>
        </div>
      </fieldset>

      <div className="flex flex-col gap-2">
        <Label htmlFor="notes">Notas</Label>
        <Input id="notes" name="notes" defaultValue={initial.notes ?? ""} />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="isActive">Descuento automatico</Label>
        <select
          id="isActive"
          name="isActive"
          className={selectClass}
          defaultValue={initial.isActive ? "true" : "false"}
        >
          <option value="true">Activo - descuenta stock al completar un pedido</option>
          <option value="false">Pausado - conserva la receta, sin descontar stock</option>
        </select>
      </div>

      <div>
        <Button type="submit" loading={isPending} loadingLabel="Guardando">
          Guardar receta
        </Button>
      </div>
    </form>
  );
}
