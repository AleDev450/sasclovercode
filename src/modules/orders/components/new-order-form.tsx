"use client";

import { useState } from "react";
import { useActionState } from "react";
import { Alert, AlertDescription, Button, Input, Label } from "@/components/ui";
import { IDLE_FORM_STATE } from "@/lib/forms/state";
import { formatCurrency } from "@/lib/money";
import { ORDER_SOURCES, ORDER_SOURCE_LABELS } from "../lifecycle";
import { createOrderAction } from "../server/actions";

export interface ProductOption {
  readonly id: string;
  readonly name: string;
  readonly basePriceCents: number;
}

export interface LocationOption {
  readonly id: string;
  readonly name: string;
}

export interface CustomerOption {
  readonly id: string;
  readonly name: string;
}

const selectClass =
  "border-input bg-background focus-visible:ring-ring h-10 rounded-md border px-3 text-sm focus-visible:ring-2 focus-visible:outline-none";

/**
 * The new-order form.
 *
 * Lines are added and removed client-side and submitted as parallel arrays,
 * which a plain HTML form can express — so the form still works if the
 * hydration never arrives.
 *
 * The prices shown next to each product are the CATALOGUE's, for orientation
 * only. They are not submitted and not trusted: the database copies the real
 * price when the line is inserted. If a price changed between this page
 * rendering and the order being saved, the saved order is right and this
 * preview was stale — which is the correct way round.
 */
export function NewOrderForm({
  tenantSlug,
  locations,
  customers,
  products,
  currency,
}: {
  tenantSlug: string;
  locations: readonly LocationOption[];
  customers: readonly CustomerOption[];
  products: readonly ProductOption[];
  currency: string;
}) {
  const [state, formAction, isPending] = useActionState(createOrderAction, IDLE_FORM_STATE);
  const [lineCount, setLineCount] = useState(1);
  const errors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />

      {state.message !== undefined ? (
        <Alert variant={state.status === "success" ? "success" : "warning"}>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-5 sm:grid-cols-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor="locationId">Sede</Label>
          <select id="locationId" name="locationId" className={selectClass}>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
          {errors.locationId !== undefined ? (
            <p className="text-destructive text-sm">{errors.locationId[0]}</p>
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="customerId">Cliente</Label>
          <select id="customerId" name="customerId" className={selectClass}>
            {/* Empty is a real answer: most counter sales have no customer. */}
            <option value="">Sin cliente</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="source">Origen</Label>
          <select id="source" name="source" defaultValue="manual" className={selectClass}>
            {ORDER_SOURCES.map((source) => (
              <option key={source} value={source}>
                {ORDER_SOURCE_LABELS[source]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <fieldset className="flex flex-col gap-4">
        <legend className="text-sm font-medium">Productos</legend>

        {Array.from({ length: lineCount }, (_, index) => (
          <div key={index} className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
            <div className="flex flex-col gap-2">
              <Label htmlFor={`itemProductId-${index}`}>Producto</Label>
              <select id={`itemProductId-${index}`} name="itemProductId" className={selectClass}>
                <option value="">Elige un producto</option>
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name} — {formatCurrency(product.basePriceCents, currency)}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor={`itemQuantity-${index}`}>Cantidad</Label>
              <Input
                id={`itemQuantity-${index}`}
                name="itemQuantity"
                defaultValue="1"
                inputMode="decimal"
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor={`itemDiscount-${index}`}>Descuento</Label>
              <Input id={`itemDiscount-${index}`} name="itemDiscount" inputMode="decimal" />
            </div>

            {/* Submitted empty so the parallel arrays stay aligned by index. */}
            <input type="hidden" name="itemVariantId" value="" />
            <input type="hidden" name="itemNotes" value="" />
          </div>
        ))}

        {errors.items !== undefined ? (
          <p className="text-destructive text-sm">{errors.items[0]}</p>
        ) : null}
        {errors.quantity !== undefined ? (
          <p className="text-destructive text-sm">{errors.quantity[0]}</p>
        ) : null}
        {errors.discount !== undefined ? (
          <p className="text-destructive text-sm">{errors.discount[0]}</p>
        ) : null}

        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setLineCount((n) => n + 1)}
          >
            Anadir otra linea
          </Button>
        </div>
      </fieldset>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="shipping">Envio</Label>
          <Input id="shipping" name="shipping" inputMode="decimal" placeholder="0.00" />
          {errors.shipping !== undefined ? (
            <p className="text-destructive text-sm">{errors.shipping[0]}</p>
          ) : null}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="notes">Notas</Label>
          <Input id="notes" name="notes" placeholder="Sin cebolla, para llevar" />
        </div>
      </div>

      <div>
        <Button type="submit" loading={isPending} loadingLabel="Creando">
          Crear pedido
        </Button>
        <p className="text-muted-foreground mt-2 text-xs">
          El pedido se crea en pendiente. Los importes los calcula el sistema con el precio del
          catalogo en este momento.
        </p>
      </div>
    </form>
  );
}
