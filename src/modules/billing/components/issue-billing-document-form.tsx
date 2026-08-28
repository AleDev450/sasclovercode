"use client";

import { useActionState, useState } from "react";
import { Alert, AlertDescription, Button, Label } from "@/components/ui";
import { IDLE_FORM_STATE } from "@/lib/forms/state";
import { CustomerPicker, type PickedCustomer } from "@/modules/pos/components/customer-picker";
import type { BillingDocumentType } from "@/types/database";
import { BILLING_DOCUMENT_TYPES, BILLING_DOCUMENT_TYPE_LABELS } from "../lifecycle";
import { issueBillingDocumentAction } from "../server/actions";

const selectClass =
  "border-input bg-background focus-visible:ring-ring h-10 rounded-md border px-3 text-sm focus-visible:ring-2 focus-visible:outline-none";

export interface RelatableDocument {
  readonly id: string;
  readonly label: string;
}

const NOTE_TYPES: readonly BillingDocumentType[] = ["nota_credito", "nota_debito"];

/**
 * Emits a new document for this order.
 *
 * `boleta`/`factura` show a customer picker (required, with a RUC, for
 * `factura` - `billing_documents_factura_needs_ruc_customer` is what actually
 * enforces that, not this form). `nota_credito`/`nota_debito` show which
 * earlier document of THIS order they correct instead - "one document = one
 * whole order" (Phase 17's own scope decision) keeps that list short.
 */
export function IssueBillingDocumentForm({
  tenantSlug,
  orderId,
  initialCustomer,
  relatableDocuments,
}: {
  tenantSlug: string;
  orderId: string;
  initialCustomer: PickedCustomer | null;
  relatableDocuments: readonly RelatableDocument[];
}) {
  const [state, formAction, isPending] = useActionState(issueBillingDocumentAction, IDLE_FORM_STATE);
  const [type, setType] = useState<BillingDocumentType>("boleta");
  const [customer, setCustomer] = useState<PickedCustomer | null>(initialCustomer);
  const errors = state.fieldErrors ?? {};
  const isNote = NOTE_TYPES.includes(type);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="orderId" value={orderId} />

      {state.message !== undefined ? (
        <Alert variant={state.status === "success" ? "success" : "warning"}>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-2">
        <Label htmlFor="type">Tipo de comprobante</Label>
        <select
          id="type"
          name="type"
          className={selectClass}
          value={type}
          onChange={(event) => setType(event.target.value as BillingDocumentType)}
        >
          {BILLING_DOCUMENT_TYPES.map((option) => (
            <option key={option} value={option}>
              {BILLING_DOCUMENT_TYPE_LABELS[option]}
            </option>
          ))}
        </select>
      </div>

      {isNote ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor="relatedDocumentId">Documento que corrige</Label>
          <select id="relatedDocumentId" name="relatedDocumentId" className={selectClass} defaultValue="">
            <option value="" disabled>
              Elige un comprobante de este pedido
            </option>
            {relatableDocuments.map((doc) => (
              <option key={doc.id} value={doc.id}>
                {doc.label}
              </option>
            ))}
          </select>
          {relatableDocuments.length === 0 ? (
            <p className="text-muted-foreground text-xs">
              Este pedido todavia no tiene una boleta o factura que corregir.
            </p>
          ) : null}
          {errors.relatedDocumentId !== undefined ? (
            <p className="text-destructive text-sm">{errors.relatedDocumentId[0]}</p>
          ) : null}
          <input type="hidden" name="customerId" value="" />
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <Label htmlFor="customerId">
            Cliente {type === "factura" ? "(con RUC, obligatorio para factura)" : "(opcional)"}
          </Label>
          <CustomerPicker
            tenantSlug={tenantSlug}
            selected={customer}
            onSelect={setCustomer}
            onClear={() => setCustomer(null)}
          />
          <input type="hidden" name="customerId" value={customer?.id ?? ""} />
          <input type="hidden" name="relatedDocumentId" value="" />
          {errors.customerId !== undefined ? (
            <p className="text-destructive text-sm">{errors.customerId[0]}</p>
          ) : null}
        </div>
      )}

      <div>
        <Button type="submit" loading={isPending} loadingLabel="Emitiendo">
          Emitir comprobante
        </Button>
      </div>
    </form>
  );
}
