"use client";

import { useActionState } from "react";
import { Alert, AlertDescription, Button } from "@/components/ui";
import { changePasswordAction } from "../server/actions";
import { IDLE_FORM_STATE } from "../server/form-state";
import { FormField } from "./form-field";

export function ChangePasswordForm() {
  const [state, formAction, isPending] = useActionState(changePasswordAction, IDLE_FORM_STATE);

  return (
    // Keyed on the outcome so a successful change clears the three fields.
    <form
      key={state.status === "success" ? "done" : "editing"}
      action={formAction}
      className="flex flex-col gap-5"
      noValidate
    >
      {state.message !== undefined ? (
        <Alert variant={state.status === "success" ? "success" : "destructive"}>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <FormField
        id="currentPassword"
        name="currentPassword"
        type="password"
        label="Contrasena actual"
        autoComplete="current-password"
        required
        errors={state.fieldErrors?.currentPassword}
      />

      <FormField
        id="password"
        name="password"
        type="password"
        label="Nueva contrasena"
        autoComplete="new-password"
        required
        errors={state.fieldErrors?.password}
        hint="Minimo 8 caracteres."
      />

      <FormField
        id="confirmPassword"
        name="confirmPassword"
        type="password"
        label="Confirmar nueva contrasena"
        autoComplete="new-password"
        required
        errors={state.fieldErrors?.confirmPassword}
      />

      <div>
        <Button type="submit" loading={isPending} loadingLabel="Guardando contrasena">
          Cambiar contrasena
        </Button>
      </div>
    </form>
  );
}
