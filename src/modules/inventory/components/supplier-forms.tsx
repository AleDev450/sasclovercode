"use client";

import { useActionState } from "react";
import { Alert, AlertDescription, Button, Input, Label } from "@/components/ui";
import { IDLE_FORM_STATE } from "@/lib/forms/state";
import {
  createSupplierAction,
  setSupplierActiveAction,
  updateSupplierAction,
} from "../server/actions";

function SupplierFields({
  errors,
  defaults,
}: {
  errors: Readonly<Record<string, readonly string[]>>;
  defaults?: {
    readonly name: string;
    readonly taxId: string | null;
    readonly contactName: string | null;
    readonly phone: string | null;
    readonly email: string | null;
    readonly address: string | null;
    readonly notes: string | null;
  };
}) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="name">Nombre</Label>
          <Input
            id="name"
            name="name"
            defaultValue={defaults?.name}
            invalid={errors.name !== undefined}
          />
          {errors.name !== undefined ? (
            <p className="text-destructive text-sm">{errors.name[0]}</p>
          ) : null}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="taxId">RUC (opcional)</Label>
          <Input
            id="taxId"
            name="taxId"
            defaultValue={defaults?.taxId ?? ""}
            invalid={errors.taxId !== undefined}
          />
          {errors.taxId !== undefined ? (
            <p className="text-destructive text-sm">{errors.taxId[0]}</p>
          ) : null}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="contactName">Contacto</Label>
          <Input id="contactName" name="contactName" defaultValue={defaults?.contactName ?? ""} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="phone">Telefono</Label>
          <Input
            id="phone"
            name="phone"
            defaultValue={defaults?.phone ?? ""}
            invalid={errors.phone !== undefined}
          />
          {errors.phone !== undefined ? (
            <p className="text-destructive text-sm">{errors.phone[0]}</p>
          ) : null}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="email">Correo</Label>
          <Input
            id="email"
            name="email"
            defaultValue={defaults?.email ?? ""}
            invalid={errors.email !== undefined}
          />
          {errors.email !== undefined ? (
            <p className="text-destructive text-sm">{errors.email[0]}</p>
          ) : null}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="address">Direccion</Label>
          <Input id="address" name="address" defaultValue={defaults?.address ?? ""} />
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="notes">Notas</Label>
        <Input id="notes" name="notes" defaultValue={defaults?.notes ?? ""} />
      </div>
    </>
  );
}

export function CreateSupplierForm({ tenantSlug }: { tenantSlug: string }) {
  const [state, formAction, isPending] = useActionState(createSupplierAction, IDLE_FORM_STATE);
  const errors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      {state.message !== undefined ? (
        <Alert variant={state.status === "success" ? "success" : "warning"}>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}
      <SupplierFields errors={errors} />
      <div>
        <Button type="submit" loading={isPending} loadingLabel="Creando">
          Anadir proveedor
        </Button>
      </div>
    </form>
  );
}

export interface SupplierDefaults {
  readonly id: string;
  readonly name: string;
  readonly taxId: string | null;
  readonly contactName: string | null;
  readonly phone: string | null;
  readonly email: string | null;
  readonly address: string | null;
  readonly notes: string | null;
  readonly isActive: boolean;
}

export function UpdateSupplierForm({
  tenantSlug,
  supplier,
}: {
  tenantSlug: string;
  supplier: SupplierDefaults;
}) {
  const [state, formAction, isPending] = useActionState(updateSupplierAction, IDLE_FORM_STATE);
  const errors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="supplierId" value={supplier.id} />
      {state.message !== undefined ? (
        <Alert variant={state.status === "success" ? "success" : "warning"}>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}
      <SupplierFields errors={errors} defaults={supplier} />
      <div>
        <Button type="submit" loading={isPending} loadingLabel="Guardando">
          Guardar
        </Button>
      </div>
    </form>
  );
}

export function SetSupplierActiveForm({
  tenantSlug,
  supplierId,
  isActive,
}: {
  tenantSlug: string;
  supplierId: string;
  isActive: boolean;
}) {
  const [, formAction, isPending] = useActionState(setSupplierActiveAction, IDLE_FORM_STATE);

  return (
    <form action={formAction}>
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="supplierId" value={supplierId} />
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
