"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Alert, AlertDescription, Badge, Button, Card, Input, Label } from "@/components/ui";
import {
  IconArrowRight,
  IconEye,
  IconGlobe,
  IconLayout,
  IconPencil,
  IconTrash,
} from "@/components/ui/icons";
import { IDLE_FORM_STATE } from "@/lib/forms/state";
import { createPageAction, deletePageAction, setPageStatusAction } from "../server/actions";
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
            placeholder="Nuestra carta"
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
            placeholder="carta"
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

/**
 * One page, as a card.
 *
 * WHAT IT REPLACED. A four-column table whose columns were the title, the
 * status, a section COUNT and one button. It read as a database listing of a
 * thing that is not a database row to the person who owns it - and the count
 * was the only hint that a page had content, which is the least useful fact
 * about it.
 *
 * The three actions are the three questions somebody actually has in front of a
 * page: edit it, look at it, and put it in front of customers or take it back.
 */
export function PageCard({ tenantSlug, page }: { tenantSlug: string; page: AdminPage }) {
  const isHome = page.slug === "inicio";

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-lg">
            {isHome ? <IconGlobe className="size-4" /> : <IconLayout className="size-4" />}
          </span>
          <div className="min-w-0">
            <Link
              href={`/dashboard/${tenantSlug}/contenido/${page.id}`}
              className="font-medium hover:underline"
            >
              {page.title}
            </Link>
            <p className="text-muted-foreground truncate font-mono text-xs">
              /sitio/{page.slug}
              {isHome ? " · portada" : null}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Badge variant={page.status === "published" ? "success" : "neutral"} dot>
            {page.status === "published" ? "Publicada" : "Borrador"}
          </Badge>
          <span className="text-muted-foreground text-xs">
            {page.sectionCount} {page.sectionCount === 1 ? "seccion" : "secciones"}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`/dashboard/${tenantSlug}/contenido/${page.id}`}
          className="bg-primary text-primary-foreground shadow-e1 hover:bg-primary/90 inline-flex h-8 items-center gap-2 rounded-md px-3 text-xs font-medium transition-colors"
        >
          <IconPencil className="size-3.5" />
          Editar
        </Link>

        <Link
          href={`/vista/${tenantSlug}/${page.slug}`}
          className="border-input hover:bg-accent inline-flex h-8 items-center gap-2 rounded-md border px-3 text-xs font-medium transition-colors"
        >
          <IconEye className="size-3.5" />
          Ver
          <IconArrowRight className="size-3.5" />
        </Link>

        <PageStatusForm tenantSlug={tenantSlug} page={page} />

        <div className="ml-auto">
          <DeletePageForm tenantSlug={tenantSlug} page={page} />
        </div>
      </div>
    </Card>
  );
}

/**
 * Deleting a page, which was not possible at all until now.
 *
 * The checkbox is the deliberate act master section 36 asks for, and it keeps
 * the form usable without JavaScript. The sections go with it by cascade, which
 * is why the label says so rather than leaving somebody to find out.
 */
export function DeletePageForm({ tenantSlug, page }: { tenantSlug: string; page: AdminPage }) {
  return (
    <form action={deletePageAction} className="flex items-center gap-2">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="pageId" value={page.id} />
      <label className="text-muted-foreground flex items-center gap-1.5 text-xs">
        <input type="checkbox" required className="size-3.5" />
        Confirmar
      </label>
      <Button type="submit" size="sm" variant="ghost" className="text-destructive">
        <IconTrash className="size-3.5" />
        Borrar
      </Button>
    </form>
  );
}
