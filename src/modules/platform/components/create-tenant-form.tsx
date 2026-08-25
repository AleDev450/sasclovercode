"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Alert, AlertDescription, Button, Input, Label, buttonVariants } from "@/components/ui";
import { IDLE_FORM_STATE } from "@/lib/forms/state";
import { createTenantAction } from "../server/actions";

function FieldError({ id, messages }: { id: string; messages?: readonly string[] }) {
  if (messages === undefined || messages.length === 0) return null;
  return (
    <p id={id} className="text-destructive text-sm">
      {messages[0]}
    </p>
  );
}

export function CreateTenantForm() {
  const [state, formAction, isPending] = useActionState(createTenantAction, IDLE_FORM_STATE);
  const fieldErrors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {state.status === "error" && state.message !== undefined ? (
        <Alert variant="destructive">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-2">
        <Label htmlFor="name">Nombre</Label>
        <Input
          id="name"
          name="name"
          required
          maxLength={120}
          autoComplete="off"
          invalid={fieldErrors.name !== undefined}
          aria-describedby={fieldErrors.name !== undefined ? "name-error" : undefined}
        />
        <FieldError id="name-error" messages={fieldErrors.name} />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="slug">Slug</Label>
        <Input
          id="slug"
          name="slug"
          required
          minLength={3}
          maxLength={63}
          autoComplete="off"
          invalid={fieldErrors.slug !== undefined}
          aria-describedby={fieldErrors.slug !== undefined ? "slug-error" : "slug-help"}
        />
        <FieldError id="slug-error" messages={fieldErrors.slug} />
        <p id="slug-help" className="text-muted-foreground text-xs">
          Sera su dominio: <code className="font-mono">slug.clovercodeapp.com</code>. Solo
          minusculas, numeros y guiones.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="ownerEmail">Correo del propietario</Label>
        <Input
          id="ownerEmail"
          name="ownerEmail"
          type="email"
          required
          autoComplete="off"
          invalid={fieldErrors.ownerEmail !== undefined}
          aria-describedby={fieldErrors.ownerEmail !== undefined ? "owner-error" : "owner-help"}
        />
        <FieldError id="owner-error" messages={fieldErrors.ownerEmail} />
        <p id="owner-help" className="text-muted-foreground text-xs">
          Debe tener cuenta antes de asignarlo.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" loading={isPending} loadingLabel="Creando empresa">
          Crear empresa
        </Button>
        <Link href="/super-admin/tenants" className={buttonVariants({ variant: "ghost" })}>
          Cancelar
        </Link>
      </div>
    </form>
  );
}
