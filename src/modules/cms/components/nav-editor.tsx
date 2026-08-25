"use client";

import { useActionState, useState } from "react";
import { Alert, AlertDescription, Button, Input, Label } from "@/components/ui";
import { IDLE_FORM_STATE } from "@/lib/forms/state";
import { deleteNavItemAction, toggleNavItemAction, upsertNavItemAction } from "../server/actions";
import type { AdminNavItem } from "../server/admin-queries";

export function NavItemForm({
  tenantSlug,
  pages,
  parents,
}: {
  tenantSlug: string;
  pages: readonly { id: string; title: string; slug: string }[];
  parents: readonly AdminNavItem[];
}) {
  const [state, formAction, isPending] = useActionState(upsertNavItemAction, IDLE_FORM_STATE);
  const [linkType, setLinkType] = useState<"page" | "external">("page");
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
          <Label htmlFor="label">Etiqueta</Label>
          <Input
            id="label"
            name="label"
            required
            maxLength={60}
            invalid={errors.label !== undefined}
          />
          {errors.label !== undefined ? (
            <p className="text-destructive text-sm">{errors.label[0]}</p>
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="linkType">Destino</Label>
          <select
            id="linkType"
            name="linkType"
            value={linkType}
            onChange={(event) => setLinkType(event.target.value as "page" | "external")}
            className="border-input bg-background h-9 rounded-md border px-3 text-sm"
          >
            <option value="page">Una pagina del sitio</option>
            <option value="external">Un enlace externo</option>
          </select>
        </div>
      </div>

      {linkType === "page" ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor="pageId">Pagina</Label>
          <select
            id="pageId"
            name="pageId"
            className="border-input bg-background h-9 rounded-md border px-3 text-sm"
          >
            <option value="">Elige una pagina</option>
            {pages.map((page) => (
              <option key={page.id} value={page.id}>
                {page.title} (/{page.slug})
              </option>
            ))}
          </select>
          {errors.pageId !== undefined ? (
            <p className="text-destructive text-sm">{errors.pageId[0]}</p>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <Label htmlFor="externalUrl">Enlace</Label>
          <Input
            id="externalUrl"
            name="externalUrl"
            placeholder="https://"
            invalid={errors.externalUrl !== undefined}
          />
          {errors.externalUrl !== undefined ? (
            <p className="text-destructive text-sm">{errors.externalUrl[0]}</p>
          ) : (
            <p className="text-muted-foreground text-xs">Debe empezar con https://</p>
          )}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="parentId">Depende de</Label>
          <select
            id="parentId"
            name="parentId"
            className="border-input bg-background h-9 rounded-md border px-3 text-sm"
          >
            <option value="">Nivel principal</option>
            {parents.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
          {errors.parentId !== undefined ? (
            <p className="text-destructive text-sm">{errors.parentId[0]}</p>
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="position">Orden</Label>
          <Input id="position" name="position" type="number" min={0} max={1000} defaultValue={0} />
        </div>
      </div>

      <div>
        <Button type="submit" loading={isPending} loadingLabel="Guardando">
          Anadir al menu
        </Button>
      </div>
    </form>
  );
}

export function NavItemActions({ tenantSlug, item }: { tenantSlug: string; item: AdminNavItem }) {
  return (
    <div className="flex items-center gap-3">
      <form action={toggleNavItemAction}>
        <input type="hidden" name="tenantSlug" value={tenantSlug} />
        <input type="hidden" name="itemId" value={item.id} />
        <input type="hidden" name="isActive" value={String(item.isActive)} />
        <Button type="submit" size="sm" variant="secondary">
          {item.isActive ? "Desactivar" : "Activar"}
        </Button>
      </form>

      <form action={deleteNavItemAction} className="flex items-center gap-2">
        <input type="hidden" name="tenantSlug" value={tenantSlug} />
        <input type="hidden" name="itemId" value={item.id} />
        <label className="flex items-center gap-1 text-xs">
          <input type="checkbox" required className="size-4" />
          Confirmar
        </label>
        <Button type="submit" size="sm" variant="destructive">
          Eliminar
        </Button>
      </form>
    </div>
  );
}
