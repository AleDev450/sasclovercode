"use client";

import { useActionState } from "react";
import { Alert, AlertDescription, Button } from "@/components/ui";
import { updatePasswordAction } from "../server/actions";
import { IDLE_FORM_STATE } from "../server/form-state";
import { FormField } from "./form-field";

export function UpdatePasswordForm() {
  const [state, formAction, isPending] = useActionState(updatePasswordAction, IDLE_FORM_STATE);

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      {state.status === "error" && state.message !== undefined ? (
        <Alert variant="destructive">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <FormField
        id="password"
        name="password"
        type="password"
        label="Nueva contrasena"
        // `new-password` is what makes a password manager offer to generate one.
        autoComplete="new-password"
        autoFocus
        required
        errors={state.fieldErrors?.password}
        hint="Minimo 8 caracteres."
      />

      <FormField
        id="confirmPassword"
        name="confirmPassword"
        type="password"
        label="Confirmar contrasena"
        autoComplete="new-password"
        required
        errors={state.fieldErrors?.confirmPassword}
      />

      <Button type="submit" loading={isPending} loadingLabel="Guardando contrasena">
        Guardar contrasena
      </Button>
    </form>
  );
}
