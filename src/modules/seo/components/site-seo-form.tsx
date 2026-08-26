"use client";

import { useActionState } from "react";
import { Alert, AlertDescription, Button, Input, Label } from "@/components/ui";
import { IDLE_FORM_STATE } from "@/lib/forms/state";
import { updateTenantSeoAction } from "../server/actions";
import type { SiteSeo } from "../metadata";

function Field({
  name,
  label,
  hint,
  value,
  errors,
  multiline = false,
}: {
  name: string;
  label: string;
  hint?: string;
  value: string | null;
  errors?: readonly string[];
  multiline?: boolean;
}) {
  const describedBy =
    errors !== undefined ? `${name}-error` : hint !== undefined ? `${name}-hint` : undefined;

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={name}>{label}</Label>
      {multiline ? (
        <textarea
          id={name}
          name={name}
          defaultValue={value ?? ""}
          rows={3}
          aria-invalid={errors !== undefined}
          aria-describedby={describedBy}
          className="border-input bg-background rounded-md border px-3 py-2 text-sm"
        />
      ) : (
        <Input
          id={name}
          name={name}
          defaultValue={value ?? ""}
          invalid={errors !== undefined}
          aria-describedby={describedBy}
        />
      )}
      {errors !== undefined ? (
        <p id={`${name}-error`} className="text-destructive text-sm">
          {errors[0]}
        </p>
      ) : hint !== undefined ? (
        <p id={`${name}-hint`} className="text-muted-foreground text-xs">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function SiteSeoForm({ tenantSlug, seo }: { tenantSlug: string; seo: SiteSeo }) {
  const [state, formAction, isPending] = useActionState(updateTenantSeoAction, IDLE_FORM_STATE);
  const e = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />

      {state.status === "success" && state.message !== undefined ? (
        <Alert variant="success">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          name="siteTitle"
          label="Titulo del sitio"
          hint="Lo que se lee en la pestana del navegador y en Google."
          value={seo.siteTitle}
          errors={e.siteTitle}
        />
        <Field
          name="siteDescription"
          label="Descripcion"
          hint="Dos lineas describiendo el negocio. Google muestra unos 160 caracteres."
          value={seo.siteDescription}
          errors={e.siteDescription}
          multiline
        />
      </div>

      <fieldset className="border-border flex flex-col gap-5 rounded-md border p-4">
        <legend className="px-1 text-sm font-medium">Al compartir el enlace</legend>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            name="ogTitle"
            label="Titulo"
            hint="Si lo dejas vacio se usa el titulo del sitio."
            value={seo.ogTitle}
            errors={e.ogTitle}
          />
          <Field
            name="ogDescription"
            label="Descripcion"
            value={seo.ogDescription}
            errors={e.ogDescription}
            multiline
          />
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            name="ogImagePath"
            label="Imagen"
            hint="Ruta de un archivo ya subido en Configuracion, por ejemplo tenants/…/branding/logo.png"
            value={seo.ogImagePath}
            errors={e.ogImagePath}
          />
          <Field
            name="twitterImagePath"
            label="Imagen para X"
            hint="Opcional. Si esta vacia se usa la anterior."
            value={seo.twitterImagePath}
            errors={e.twitterImagePath}
          />
        </div>
      </fieldset>

      <div className="flex flex-col gap-2">
        <Label htmlFor="robotsIndex">Aparecer en buscadores</Label>
        <select
          id="robotsIndex"
          name="robotsIndex"
          defaultValue={seo.robotsIndex ? "true" : "false"}
          className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm sm:w-72"
        >
          <option value="true">Si, quiero aparecer en Google</option>
          <option value="false">No, todavia no</option>
        </select>
        {e.robotsIndex !== undefined ? (
          <p className="text-destructive text-sm">{e.robotsIndex[0]}</p>
        ) : (
          <p className="text-muted-foreground text-xs">
            Desactivalo mientras el sitio esta en construccion.
          </p>
        )}
      </div>

      <Field
        name="googleVerification"
        label="Codigo de Google Search Console"
        hint="Solo el codigo, no la etiqueta completa."
        value={seo.googleVerification}
        errors={e.googleVerification}
      />

      <div>
        <Button type="submit" loading={isPending} loadingLabel="Guardando">
          Guardar SEO
        </Button>
      </div>
    </form>
  );
}
