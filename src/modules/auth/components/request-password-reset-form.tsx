"use client";

import { useActionState } from "react";
import { Alert, AlertDescription, Button } from "@/components/ui";
import { requestPasswordResetAction } from "../server/actions";
import { IDLE_FORM_STATE } from "../server/form-state";
import { FormField } from "./form-field";

export function RequestPasswordResetForm() {
  const [state, formAction, isPending] = useActionState(
    requestPasswordResetAction,
    IDLE_FORM_STATE,
  );

  // On success the form is replaced by the confirmation. Leaving the field in
  // place invites a second submission, and the answer would be the same.
  if (state.status === "success") {
    return (
      <Alert variant="success">
        <AlertDescription>{state.message}</AlertDescription>
      </Alert>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      {state.status === "error" && state.message !== undefined ? (
        <Alert variant="destructive">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <FormField
        id="email"
        name="email"
        type="email"
        label="Correo electronico"
        autoComplete="email"
        autoFocus
        required
        errors={state.fieldErrors?.email}
        hint="Te enviaremos un enlace para crear una contrasena nueva."
      />

      <Button type="submit" loading={isPending} loadingLabel="Enviando enlace">
        Enviar enlace
      </Button>
    </form>
  );
}
