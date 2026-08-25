"use client";

import { useActionState } from "react";
import { Alert, AlertDescription, Button } from "@/components/ui";
import { signInAction } from "../server/actions";
import { IDLE_FORM_STATE } from "../server/form-state";
import { FormField } from "./form-field";

export interface SignInFormProps {
  /**
   * Where to land after signing in. Already filtered by `safeRedirectPath` on
   * the server before it reaches this component, and filtered AGAIN in the
   * action, because a client can post any value it likes.
   */
  readonly next?: string;
}

export function SignInForm({ next }: SignInFormProps) {
  const [state, formAction, isPending] = useActionState(signInAction, IDLE_FORM_STATE);

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      {state.status === "error" && state.message !== undefined ? (
        <Alert variant="destructive">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      {next === undefined ? null : <input type="hidden" name="next" value={next} />}

      <FormField
        id="email"
        name="email"
        type="email"
        label="Correo electronico"
        autoComplete="email"
        // The first field of the page a user came here to use.
        autoFocus
        required
        errors={state.fieldErrors?.email}
      />

      <FormField
        id="password"
        name="password"
        type="password"
        label="Contrasena"
        // `current-password` tells a password manager to fill, not to generate.
        autoComplete="current-password"
        required
        errors={state.fieldErrors?.password}
      />

      <Button type="submit" loading={isPending} loadingLabel="Iniciando sesion">
        Iniciar sesion
      </Button>
    </form>
  );
}
