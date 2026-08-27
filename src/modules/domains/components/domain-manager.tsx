"use client";

import { useActionState } from "react";
import { Alert, AlertDescription, Button, Input, Label } from "@/components/ui";
import { IDLE_FORM_STATE } from "@/lib/forms/state";
import {
  addDomainAction,
  checkDomainDnsAction,
  deleteDomainAction,
  setPrimaryDomainAction,
} from "../server/actions";

export function AddDomainForm({ tenantSlug }: { tenantSlug: string }) {
  const [state, formAction, isPending] = useActionState(addDomainAction, IDLE_FORM_STATE);
  const errors = state.fieldErrors?.domain;

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />

      {state.status === "success" && state.message !== undefined ? (
        <Alert variant="success">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-2">
        <Label htmlFor="domain">Dominio</Label>
        <div className="flex flex-wrap items-start gap-2">
          <Input
            id="domain"
            name="domain"
            placeholder="sugurolls.com"
            autoComplete="off"
            spellCheck={false}
            invalid={errors !== undefined}
            aria-describedby={errors !== undefined ? "domain-error" : "domain-hint"}
            className="w-full font-mono sm:w-80"
          />
          <Button type="submit" loading={isPending} loadingLabel="Anadiendo">
            Anadir
          </Button>
        </div>
        {errors !== undefined ? (
          <p id="domain-error" className="text-destructive text-sm">
            {errors[0]}
          </p>
        ) : (
          <p id="domain-hint" className="text-muted-foreground text-xs">
            Escribe el dominio sin https:// ni barras. Despues te diremos que registros crear.
          </p>
        )}
      </div>
    </form>
  );
}

/**
 * One button, one form.
 *
 * A single form with several submit buttons would be shorter, but each of these
 * calls a different Server Action with a different permission story, and a
 * shared form makes it easy to send the wrong one by adding a button later.
 */
function ActionForm({
  action,
  tenantSlug,
  domainId,
  label,
  loadingLabel,
  variant = "secondary",
  confirm,
}: {
  action: typeof checkDomainDnsAction;
  tenantSlug: string;
  domainId: string;
  label: string;
  loadingLabel: string;
  variant?: "secondary" | "destructive";
  confirm?: string;
}) {
  const [state, formAction, isPending] = useActionState(action, IDLE_FORM_STATE);
  const confirmId = `confirm-${label}-${domainId}`;

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="domainId" value={domainId} />

      {state.message !== undefined ? (
        <Alert variant={state.status === "success" ? "success" : "warning"}>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      {confirm !== undefined ? (
        // A checkbox rather than `confirm()`: it keeps the decision explicit
        // (master section 36) and works with JavaScript disabled.
        <label htmlFor={confirmId} className="flex items-center gap-2 text-sm">
          <input id={confirmId} type="checkbox" required className="size-4" />
          {confirm}
        </label>
      ) : null}

      <Button type="submit" variant={variant} loading={isPending} loadingLabel={loadingLabel}>
        {label}
      </Button>
    </form>
  );
}

export function CheckDnsForm(props: { tenantSlug: string; domainId: string }) {
  return (
    <ActionForm
      action={checkDomainDnsAction}
      label="Comprobar DNS"
      loadingLabel="Comprobando"
      {...props}
    />
  );
}

export function SetPrimaryForm(props: { tenantSlug: string; domainId: string }) {
  return (
    <ActionForm
      action={setPrimaryDomainAction}
      label="Usar como principal"
      loadingLabel="Guardando"
      {...props}
    />
  );
}

export function DeleteDomainForm(props: { tenantSlug: string; domainId: string }) {
  return (
    <ActionForm
      action={deleteDomainAction}
      label="Quitar"
      loadingLabel="Quitando"
      variant="destructive"
      confirm="Confirmo que quiero desconectar este dominio."
      {...props}
    />
  );
}
