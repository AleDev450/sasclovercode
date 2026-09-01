"use client";

import { useActionState } from "react";
import { Alert, AlertDescription, Button, Input } from "@/components/ui";
import { IDLE_FORM_STATE } from "@/lib/forms/state";
import {
  acceptBillingDocumentAction,
  cancelBillingDocumentAction,
  markBillingDocumentSentAction,
  rejectBillingDocumentAction,
} from "../server/actions";

interface ActionFormProps {
  readonly tenantSlug: string;
  readonly orderId: string;
  readonly documentId: string;
}

/** `pending -> sent`: hands the document to the configured BillingProvider. */
export function MarkSentForm({ tenantSlug, orderId, documentId }: ActionFormProps) {
  const [state, formAction, isPending] = useActionState(
    markBillingDocumentSentAction,
    IDLE_FORM_STATE,
  );

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="documentId" value={documentId} />
      {state.message !== undefined ? (
        <Alert variant={state.status === "success" ? "success" : "warning"}>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}
      <Button type="submit" size="sm" loading={isPending} loadingLabel="Enviando">
        Marcar enviado
      </Button>
    </form>
  );
}

/** `sent -> accepted`: SUNAT (or the PSE) returned a CDR of acceptance. */
export function AcceptForm({ tenantSlug, orderId, documentId }: ActionFormProps) {
  const [state, formAction, isPending] = useActionState(
    acceptBillingDocumentAction,
    IDLE_FORM_STATE,
  );

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="documentId" value={documentId} />
      {state.message !== undefined ? (
        <Alert variant={state.status === "success" ? "success" : "warning"}>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}
      <Button
        type="submit"
        size="sm"
        variant="secondary"
        loading={isPending}
        loadingLabel="Guardando"
      >
        Marcar aceptado
      </Button>
    </form>
  );
}

/** `sent -> rejected`: terminal. The fix is a new, corrected document (ADR-021). */
export function RejectForm({ tenantSlug, orderId, documentId }: ActionFormProps) {
  const [state, formAction, isPending] = useActionState(
    rejectBillingDocumentAction,
    IDLE_FORM_STATE,
  );
  const errors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="documentId" value={documentId} />
      <Input
        name="reason"
        placeholder="Motivo del rechazo"
        className="h-8 max-w-xs text-sm"
        invalid={errors.reason !== undefined}
      />
      <Button
        type="submit"
        size="sm"
        variant="destructive"
        loading={isPending}
        loadingLabel="Guardando"
      >
        Rechazar
      </Button>
      {errors.reason !== undefined ? (
        <p className="text-destructive w-full text-xs">{errors.reason[0]}</p>
      ) : null}
      {state.message !== undefined && state.status === "error" && errors.reason === undefined ? (
        <p className="text-destructive w-full text-xs">{state.message}</p>
      ) : null}
    </form>
  );
}

/** `pending -> cancelled` or `accepted -> cancelled`. Never reachable from `sent`. */
export function CancelDocumentForm({ tenantSlug, orderId, documentId }: ActionFormProps) {
  const [state, formAction, isPending] = useActionState(
    cancelBillingDocumentAction,
    IDLE_FORM_STATE,
  );
  const errors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="documentId" value={documentId} />
      <Input
        name="reason"
        placeholder="Motivo de la anulacion"
        className="h-8 max-w-xs text-sm"
        invalid={errors.reason !== undefined}
      />
      <Button
        type="submit"
        size="sm"
        variant="destructive"
        loading={isPending}
        loadingLabel="Anulando"
      >
        Anular
      </Button>
      {errors.reason !== undefined ? (
        <p className="text-destructive w-full text-xs">{errors.reason[0]}</p>
      ) : null}
      {state.message !== undefined && state.status === "error" && errors.reason === undefined ? (
        <p className="text-destructive w-full text-xs">{state.message}</p>
      ) : null}
    </form>
  );
}
