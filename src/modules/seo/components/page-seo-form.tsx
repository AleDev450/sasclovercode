"use client";

import { useActionState } from "react";
import { Alert, AlertDescription, Button, Input, Label } from "@/components/ui";
import { IDLE_FORM_STATE } from "@/lib/forms/state";
import { updatePageSeoAction } from "../server/actions";

export interface PageSeoValues {
  readonly id: string;
  readonly seoTitle: string | null;
  readonly seoDescription: string | null;
  readonly ogImagePath: string | null;
}

/**
 * Per-page SEO.
 *
 * Every field is optional, and the placeholder text says what happens when it
 * is left empty. That is the whole model of the cascade made visible: a blank
 * field is not a missing value, it is "use the site's".
 */
export function PageSeoForm({ tenantSlug, page }: { tenantSlug: string; page: PageSeoValues }) {
  const [state, formAction, isPending] = useActionState(updatePageSeoAction, IDLE_FORM_STATE);
  const e = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="pageId" value={page.id} />

      {state.status === "success" && state.message !== undefined ? (
        <Alert variant="success">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-2">
        <Label htmlFor="seoTitle">Titulo para buscadores</Label>
        <Input
          id="seoTitle"
          name="seoTitle"
          defaultValue={page.seoTitle ?? ""}
          placeholder="Vacio: se usa el titulo de la pagina"
          invalid={e.seoTitle !== undefined}
          aria-describedby={e.seoTitle !== undefined ? "seoTitle-error" : undefined}
        />
        {e.seoTitle !== undefined ? (
          <p id="seoTitle-error" className="text-destructive text-sm">
            {e.seoTitle[0]}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="seoDescription">Descripcion</Label>
        <textarea
          id="seoDescription"
          name="seoDescription"
          rows={3}
          defaultValue={page.seoDescription ?? ""}
          placeholder="Vacio: se usa la descripcion del sitio"
          aria-invalid={e.seoDescription !== undefined}
          className="border-input bg-background rounded-md border px-3 py-2 text-sm"
        />
        {e.seoDescription !== undefined ? (
          <p className="text-destructive text-sm">{e.seoDescription[0]}</p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="ogImagePath">Imagen al compartir</Label>
        <Input
          id="ogImagePath"
          name="ogImagePath"
          defaultValue={page.ogImagePath ?? ""}
          placeholder="Vacio: se usa la imagen del sitio"
          invalid={e.ogImagePath !== undefined}
        />
        {e.ogImagePath !== undefined ? (
          <p className="text-destructive text-sm">{e.ogImagePath[0]}</p>
        ) : null}
      </div>

      <div>
        <Button type="submit" loading={isPending} loadingLabel="Guardando">
          Guardar SEO de la pagina
        </Button>
      </div>
    </form>
  );
}
