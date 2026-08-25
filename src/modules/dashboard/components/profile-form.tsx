"use client";

import { useActionState } from "react";
import { Alert, AlertDescription, Button, Input, Label } from "@/components/ui";
import { IDLE_FORM_STATE } from "@/lib/forms/state";
import { updateProfileAction } from "../server/profile-actions";

export function ProfileForm({ email, fullName }: { email: string; fullName: string | null }) {
  const [state, formAction, isPending] = useActionState(updateProfileAction, IDLE_FORM_STATE);
  const fieldErrors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {state.status === "success" && state.message !== undefined ? (
        <Alert variant="success">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Correo</Label>
        <Input id="email" name="email" type="email" value={email} readOnly disabled />
        <p className="text-muted-foreground text-xs">
          El correo lo gestiona el sistema de acceso y no se edita aqui.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="fullName">Nombre</Label>
        <Input
          id="fullName"
          name="fullName"
          defaultValue={fullName ?? ""}
          required
          maxLength={120}
          invalid={fieldErrors.fullName !== undefined}
          aria-describedby={fieldErrors.fullName !== undefined ? "fullName-error" : undefined}
        />
        {fieldErrors.fullName !== undefined ? (
          <p id="fullName-error" className="text-destructive text-sm">
            {fieldErrors.fullName[0]}
          </p>
        ) : null}
      </div>

      <div>
        <Button type="submit" loading={isPending} loadingLabel="Guardando">
          Guardar cambios
        </Button>
      </div>
    </form>
  );
}
