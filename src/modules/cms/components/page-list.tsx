"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Alert, AlertDescription, Badge, Button, Input, Label } from "@/components/ui";
import { IDLE_FORM_STATE } from "@/lib/forms/state";
import { createPageAction, setPageStatusAction } from "../server/actions";
import type { AdminPage } from "../server/admin-queries";

export function CreatePageForm({ tenantSlug }: { tenantSlug: string }) {
  const [state, formAction, isPending] = useActionState(createPageAction, IDLE_FORM_STATE);
  const errors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />

      {state.status === "success" && state.message !== undefined ? (
        <Alert variant="success">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="title">Titulo</Label>
          <Input
            id="title"
            name="title"
            required
            maxLength={200}
            invalid={errors.title !== undefined}
            aria-describedby={errors.title !== undefined ? "title-error" : undefined}
          />
          {errors.title !== undefined ? (
            <p id="title-error" className="text-destructive text-sm">
              {errors.title[0]}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="slug">Enlace</Label>
          <Input
            id="slug"
            name="slug"
            required
            maxLength={80}
            invalid={errors.slug !== undefined}
            aria-describedby={errors.slug !== undefined ? "slug-error" : "slug-help"}
          />
          {errors.slug !== undefined ? (
            <p id="slug-error" className="text-destructive text-sm">
              {errors.slug[0]}
            </p>
          ) : (
            <p id="slug-help" className="text-muted-foreground text-xs">
              Se vera como <code className="font-mono">/sitio/tu-enlace</code>. Usa{" "}
              <code className="font-mono">inicio</code> para la portada.
            </p>
          )}
        </div>
      </div>

      <div>
        <Button type="submit" loading={isPending} loadingLabel="Creando">
          Crear pagina
        </Button>
      </div>
    </form>
  );
}

/**
 * Publishing is a state change with visible consequences, so it is a form with
 * its own submit rather than a toggle that fires on change: the person decides
 * when it happens.
 */
export function PageStatusForm({ tenantSlug, page }: { tenantSlug: string; page: AdminPage }) {
  const [, formAction, isPending] = useActionState(setPageStatusAction, IDLE_FORM_STATE);
  const next = page.status === "published" ? "draft" : "published";

  return (
    <form action={formAction}>
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="pageId" value={page.id} />
      <input type="hidden" name="status" value={next} />
      <Button
        type="submit"
        size="sm"
        variant={next === "published" ? "default" : "secondary"}
        loading={isPending}
        loadingLabel="Guardando"
      >
        {next === "published" ? "Publicar" : "Despublicar"}
      </Button>
    </form>
  );
}

export function PageRow({ tenantSlug, page }: { tenantSlug: string; page: AdminPage }) {
  return (
    <tr className="border-border border-b last:border-0">
      <th scope="row" className="px-4 py-3 text-left font-medium">
        <Link href={`/dashboard/${tenantSlug}/contenido/${page.id}`} className="hover:underline">
          {page.title}
        </Link>
        <span className="text-muted-foreground block font-mono text-xs font-normal">
          /{page.slug}
        </span>
      </th>
      <td className="px-4 py-3">
        <Badge variant={page.status === "published" ? "success" : "neutral"}>
          {page.status === "published" ? "Publicada" : "Borrador"}
        </Badge>
      </td>
      <td className="px-4 py-3 text-sm tabular-nums">{page.sectionCount}</td>
      <td className="px-4 py-3">
        <PageStatusForm tenantSlug={tenantSlug} page={page} />
      </td>
    </tr>
  );
}
