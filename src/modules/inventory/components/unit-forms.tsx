"use client";

import { useActionState } from "react";
import { Alert, AlertDescription, Button, Input, Label } from "@/components/ui";
import { IDLE_FORM_STATE } from "@/lib/forms/state";
import { createUnitAction, setUnitActiveAction } from "../server/actions";

export function CreateUnitForm({ tenantSlug }: { tenantSlug: string }) {
  const [state, formAction, isPending] = useActionState(createUnitAction, IDLE_FORM_STATE);
  const errors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />

      {state.message !== undefined ? (
        <Alert variant={state.status === "success" ? "success" : "warning"}>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-[2fr_1fr_auto]">
        <div className="flex flex-col gap-2">
          <Label htmlFor="name">Nombre</Label>
          <Input
            id="name"
            name="name"
            placeholder="Kilogramo"
            invalid={errors.name !== undefined}
          />
          {errors.name !== undefined ? (
            <p className="text-destructive text-sm">{errors.name[0]}</p>
          ) : null}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="abbreviation">Abreviatura</Label>
          <Input
            id="abbreviation"
            name="abbreviation"
            placeholder="kg"
            invalid={errors.abbreviation !== undefined}
          />
          {errors.abbreviation !== undefined ? (
            <p className="text-destructive text-sm">{errors.abbreviation[0]}</p>
          ) : null}
        </div>
        <div className="flex items-end">
          <Button type="submit" loading={isPending} loadingLabel="Creando">
            Anadir unidad
          </Button>
        </div>
      </div>
    </form>
  );
}

export function SetUnitActiveForm({
  tenantSlug,
  unitId,
  isActive,
}: {
  tenantSlug: string;
  unitId: string;
  isActive: boolean;
}) {
  const [state, formAction, isPending] = useActionState(setUnitActiveAction, IDLE_FORM_STATE);

  return (
    <form action={formAction} className="flex flex-col gap-1">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="unitId" value={unitId} />
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
      {state.message !== undefined && state.status === "error" ? (
        <p className="text-destructive text-xs">{state.message}</p>
      ) : null}
    </form>
  );
}
