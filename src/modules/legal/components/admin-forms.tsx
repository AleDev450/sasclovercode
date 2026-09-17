"use client";

/**
 * The dashboard side of Phase 30: editing a policy, answering a complaint.
 */

import { useActionState, useId } from "react";
import { Alert, AlertDescription, Button, Label, Textarea } from "@/components/ui";
import { IDLE_FORM_STATE } from "@/lib/forms/state";
import type { LegalDocumentKind } from "@/types/database";
import { answerComplaintAction, saveLegalDocumentAction } from "../server/actions";

export function LegalDocumentForm({
  tenantSlug,
  kind,
  title,
  body,
}: {
  tenantSlug: string;
  kind: LegalDocumentKind;
  title: string;
  /** The stored text, or the template filled with the business's data. */
  body: string;
}) {
  const [state, formAction, isPending] = useActionState(saveLegalDocumentAction, IDLE_FORM_STATE);
  const id = useId();

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="kind" value={kind} />

      {state.status === "success" && state.message !== undefined ? (
        <Alert variant="success">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <Label htmlFor={id} className="sr-only">
        {title}
      </Label>
      <Textarea
        id={id}
        name="body"
        rows={18}
        defaultValue={body}
        invalid={state.fieldErrors?.body !== undefined}
        className="font-mono text-xs leading-relaxed"
      />
      {state.fieldErrors?.body !== undefined ? (
        <p className="text-destructive text-xs">{state.fieldErrors.body[0]}</p>
      ) : (
        <p className="text-muted-foreground text-xs">
          Formato: <code>### Titulo</code> para un subtitulo, <code>- texto</code> para una lista y{" "}
          <code>**texto**</code> para negrita. Deja una linea en blanco entre parrafos.
        </p>
      )}

      <div>
        <Button type="submit" loading={isPending} loadingLabel="Guardando">
          Guardar y publicar
        </Button>
      </div>
    </form>
  );
}

export function ComplaintAnswerForm({
  tenantSlug,
  complaintId,
  response,
}: {
  tenantSlug: string;
  complaintId: string;
  response: string | null;
}) {
  const [state, formAction, isPending] = useActionState(answerComplaintAction, IDLE_FORM_STATE);
  const id = useId();

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="complaintId" value={complaintId} />

      {state.message !== undefined ? (
        <Alert variant={state.status === "success" ? "success" : "warning"}>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <Label htmlFor={id}>Respuesta del proveedor</Label>
      <Textarea
        id={id}
        name="response"
        rows={5}
        maxLength={5000}
        defaultValue={response ?? ""}
        invalid={state.fieldErrors?.response !== undefined}
      />
      <p className="text-muted-foreground text-xs">
        Queda registrada con la fecha y tu usuario. Lo que el consumidor escribio no se puede
        modificar.
      </p>

      <div>
        <Button type="submit" size="sm" loading={isPending} loadingLabel="Guardando">
          {response === null ? "Registrar respuesta" : "Actualizar respuesta"}
        </Button>
      </div>
    </form>
  );
}
