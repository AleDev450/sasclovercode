"use client";

import { useActionState } from "react";
import { Alert, AlertDescription, Badge, Button, Input, Label } from "@/components/ui";
import { IDLE_FORM_STATE } from "@/lib/forms/state";
import { addCustomerAddressAction, deleteCustomerAddressAction } from "../server/actions";
import type { CustomerAddress } from "../server/queries";

function AddressForm({ tenantSlug, customerId }: { tenantSlug: string; customerId: string }) {
  const [state, formAction, isPending] = useActionState(addCustomerAddressAction, IDLE_FORM_STATE);
  const e = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="customerId" value={customerId} />

      {state.message !== undefined ? (
        <Alert variant={state.status === "success" ? "success" : "warning"}>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-5 sm:grid-cols-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor="label">Nombre</Label>
          <Input
            id="label"
            name="label"
            placeholder="Casa"
            invalid={e.label !== undefined}
            aria-describedby={e.label !== undefined ? "label-error" : undefined}
          />
          {e.label !== undefined ? (
            <p id="label-error" className="text-destructive text-sm">
              {e.label[0]}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-2 sm:col-span-2">
          <Label htmlFor="addressLine">Direccion</Label>
          <Input
            id="addressLine"
            name="addressLine"
            invalid={e.addressLine !== undefined}
            aria-describedby={e.addressLine !== undefined ? "addressLine-error" : undefined}
          />
          {e.addressLine !== undefined ? (
            <p id="addressLine-error" className="text-destructive text-sm">
              {e.addressLine[0]}
            </p>
          ) : null}
        </div>
      </div>

      <div className="grid gap-5 sm:grid-cols-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor="district">Distrito</Label>
          <Input id="district" name="district" />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="city">Ciudad</Label>
          <Input id="city" name="city" />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="reference">Referencia</Label>
          <Input id="reference" name="reference" placeholder="Frente al parque" />
        </div>
      </div>

      {/*
       * Optional, and both or neither. Saved here so a delivery (Phase 19) can
       * inherit them instead of asking for the same house on every order.
       */}
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="latitude">Latitud (opcional)</Label>
          <Input
            id="latitude"
            name="latitude"
            inputMode="decimal"
            placeholder="-12.121500"
            invalid={e.latitude !== undefined}
          />
          {e.latitude !== undefined ? (
            <p className="text-destructive text-sm">{e.latitude[0]}</p>
          ) : null}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="longitude">Longitud (opcional)</Label>
          <Input
            id="longitude"
            name="longitude"
            inputMode="decimal"
            placeholder="-77.029700"
            invalid={e.longitude !== undefined}
          />
          {e.longitude !== undefined ? (
            <p className="text-destructive text-sm">{e.longitude[0]}</p>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="isDefault" value="true" className="size-4" />
          Usar como direccion principal
        </label>
        {e.isDefault !== undefined ? (
          <p className="text-destructive text-sm">{e.isDefault[0]}</p>
        ) : null}
      </div>

      <div>
        <Button type="submit" loading={isPending} loadingLabel="Guardando">
          Anadir direccion
        </Button>
      </div>
    </form>
  );
}

function DeleteAddressForm({
  tenantSlug,
  customerId,
  addressId,
}: {
  tenantSlug: string;
  customerId: string;
  addressId: string;
}) {
  const [, formAction, isPending] = useActionState(deleteCustomerAddressAction, IDLE_FORM_STATE);

  return (
    <form action={formAction}>
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="customerId" value={customerId} />
      <input type="hidden" name="addressId" value={addressId} />
      <Button type="submit" variant="ghost" size="sm" loading={isPending} loadingLabel="Quitando">
        Quitar
      </Button>
    </form>
  );
}

/**
 * The addresses of one customer, with the form to add another.
 *
 * Unlike the customer itself, an address can be removed: it is current contact
 * information rather than history. Phase 13 will copy the delivery address onto
 * the order, so removing one never rewrites where something was delivered.
 */
export function AddressManager({
  tenantSlug,
  customerId,
  addresses,
  canManage,
}: {
  tenantSlug: string;
  customerId: string;
  addresses: readonly CustomerAddress[];
  canManage: boolean;
}) {
  return (
    <div className="flex flex-col gap-6">
      {addresses.length === 0 ? (
        <p className="text-muted-foreground text-sm">Aun no tiene direcciones.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {addresses.map((address) => (
            <li
              key={address.id}
              className="border-border flex items-start justify-between gap-4 rounded-md border p-4"
            >
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{address.label}</span>
                  {address.isDefault ? <Badge variant="success">Principal</Badge> : null}
                </div>
                <span className="text-muted-foreground text-sm">
                  {address.addressLine}
                  {address.district !== null ? `, ${address.district}` : ""}
                  {address.city !== null ? `, ${address.city}` : ""}
                </span>
                {address.reference !== null ? (
                  <span className="text-muted-foreground text-xs">{address.reference}</span>
                ) : null}
              </div>
              {canManage ? (
                <DeleteAddressForm
                  tenantSlug={tenantSlug}
                  customerId={customerId}
                  addressId={address.id}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canManage ? <AddressForm tenantSlug={tenantSlug} customerId={customerId} /> : null}
    </div>
  );
}
