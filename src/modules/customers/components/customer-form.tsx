"use client";

import { useActionState } from "react";
import { Alert, AlertDescription, Button, Input, Label } from "@/components/ui";
import { IDLE_FORM_STATE } from "@/lib/forms/state";
import { DOC_TYPES, DOC_TYPE_LABELS } from "../documents";
import {
  createCustomerAction,
  setCustomerActiveAction,
  updateCustomerAction,
} from "../server/actions";
import type { Customer } from "../server/queries";

function Field({
  name,
  label,
  hint,
  defaultValue,
  errors,
  inputMode,
  type,
}: {
  name: string;
  label: string;
  hint?: string;
  defaultValue?: string;
  errors?: readonly string[];
  inputMode?: "text" | "tel" | "email" | "numeric";
  type?: string;
}) {
  const describedBy =
    errors !== undefined ? `${name}-error` : hint !== undefined ? `${name}-hint` : undefined;

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        name={name}
        type={type}
        defaultValue={defaultValue ?? ""}
        inputMode={inputMode}
        invalid={errors !== undefined}
        aria-describedby={describedBy}
      />
      {errors !== undefined ? (
        <p id={`${name}-error`} className="text-destructive text-sm">
          {errors[0]}
        </p>
      ) : hint !== undefined ? (
        <p id={`${name}-hint`} className="text-muted-foreground text-xs">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/**
 * One form for creating and for editing.
 *
 * Same reasoning as the location form of Phase 10: the two actions take the
 * same fields and differ only in whether a `customerId` travels with them, so a
 * second near-identical component would be a second place to forget a field.
 */
export function CustomerForm({
  tenantSlug,
  customer,
}: {
  tenantSlug: string;
  customer?: Customer;
}) {
  const isEdit = customer !== undefined;
  const [state, formAction, isPending] = useActionState(
    isEdit ? updateCustomerAction : createCustomerAction,
    IDLE_FORM_STATE,
  );
  const e = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      {isEdit ? <input type="hidden" name="customerId" value={customer.id} /> : null}

      {state.message !== undefined ? (
        <Alert variant={state.status === "success" ? "success" : "warning"}>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <Field
        name="name"
        label="Nombre o razon social"
        hint="El nombre de la persona, o el de la empresa si pide factura."
        defaultValue={customer?.name}
        errors={e.name}
      />

      <div className="grid gap-5 sm:grid-cols-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor="docType">Tipo de documento</Label>
          <select
            id="docType"
            name="docType"
            defaultValue={customer?.docType ?? ""}
            aria-describedby={e.docType !== undefined ? "docType-error" : undefined}
            className="border-input bg-background focus-visible:ring-ring h-10 rounded-md border px-3 text-sm focus-visible:ring-2 focus-visible:outline-none"
          >
            {/* Empty is a real answer: most walk-in customers never give one. */}
            <option value="">Sin documento</option>
            {DOC_TYPES.map((type) => (
              <option key={type} value={type}>
                {DOC_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
          {e.docType !== undefined ? (
            <p id="docType-error" className="text-destructive text-sm">
              {e.docType[0]}
            </p>
          ) : null}
        </div>

        <div className="sm:col-span-2">
          <Field
            name="docNumber"
            label="Numero de documento"
            hint="Se guarda sin puntos ni espacios."
            inputMode="numeric"
            defaultValue={customer?.docNumber ?? ""}
            errors={e.docNumber}
          />
        </div>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          name="phone"
          label="Telefono"
          hint="Es como lo van a buscar en la caja."
          inputMode="tel"
          defaultValue={customer?.phone ?? ""}
          errors={e.phone}
        />
        <Field
          name="email"
          label="Correo"
          type="email"
          inputMode="email"
          defaultValue={customer?.email ?? ""}
          errors={e.email}
        />
      </div>

      <div>
        <Button type="submit" loading={isPending} loadingLabel="Guardando">
          {isEdit ? "Guardar cliente" : "Registrar cliente"}
        </Button>
      </div>
    </form>
  );
}

export function SetCustomerActiveForm({
  tenantSlug,
  customerId,
  isActive,
}: {
  tenantSlug: string;
  customerId: string;
  isActive: boolean;
}) {
  const [state, formAction, isPending] = useActionState(setCustomerActiveAction, IDLE_FORM_STATE);

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="customerId" value={customerId} />
      <input type="hidden" name="isActive" value={isActive ? "false" : "true"} />

      {state.message !== undefined ? (
        <Alert variant={state.status === "success" ? "success" : "warning"}>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <Button
        type="submit"
        variant={isActive ? "destructive" : "secondary"}
        loading={isPending}
        loadingLabel="Guardando"
      >
        {isActive ? "Desactivar" : "Activar"}
      </Button>
      <p className="text-muted-foreground text-xs">
        {isActive
          ? "Deja de aparecer en el listado. No se borra: sus pedidos futuros lo necesitan."
          : "Vuelve a aparecer en el listado."}
      </p>
    </form>
  );
}
