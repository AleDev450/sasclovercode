"use client";

import { useActionState } from "react";
import { Alert, AlertDescription, Button, Input, Label } from "@/components/ui";
import { IDLE_FORM_STATE, type FormState } from "@/lib/forms/state";
import { formatMoney } from "@/lib/money";
import {
  addOptionAction,
  addProductImageAction,
  addVariantAction,
  createCategoryAction,
  createProductAction,
  deleteProductChildAction,
  setProductAvailabilityAction,
  setProductStatusAction,
  updateCategoryAction,
  updateProductAction,
} from "../server/actions";
import type { Category, Product, ProductDetail } from "../server/queries";

type Action = (previous: FormState, formData: FormData) => Promise<FormState>;

function Field({
  name,
  label,
  hint,
  defaultValue,
  errors,
  inputMode,
  placeholder,
}: {
  name: string;
  label: string;
  hint?: string;
  defaultValue?: string;
  errors?: readonly string[];
  inputMode?: "text" | "decimal";
  placeholder?: string;
}) {
  const describedBy =
    errors !== undefined ? `${name}-error` : hint !== undefined ? `${name}-hint` : undefined;

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        name={name}
        defaultValue={defaultValue ?? ""}
        placeholder={placeholder}
        inputMode={inputMode}
        invalid={errors !== undefined}
        aria-describedby={describedBy}
      />
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

function Feedback({ state }: { state: FormState }) {
  if (state.message === undefined) return null;
  return (
    <Alert variant={state.status === "success" ? "success" : "warning"}>
      <AlertDescription>{state.message}</AlertDescription>
    </Alert>
  );
}

export function CategoryForm({
  tenantSlug,
  category,
}: {
  tenantSlug: string;
  category?: Category;
}) {
  const isEdit = category !== undefined;
  const [state, formAction, isPending] = useActionState(
    isEdit ? updateCategoryAction : createCategoryAction,
    IDLE_FORM_STATE,
  );
  const e = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      {isEdit ? <input type="hidden" name="categoryId" value={category.id} /> : null}
      <Feedback state={state} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="name" label="Nombre" defaultValue={category?.name} errors={e.name} />
        <Field
          name="slug"
          label="Slug"
          hint="Como aparece en la direccion: entradas, postres."
          defaultValue={category?.slug}
          errors={e.slug}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          name="position"
          label="Orden"
          defaultValue={String(category?.position ?? 0)}
          errors={e.position}
        />

        <div className="flex flex-col gap-2">
          <Label htmlFor="kitchenStation">Estacion de cocina</Label>
          <select
            id="kitchenStation"
            name="kitchenStation"
            defaultValue={category?.kitchenStation ?? "kitchen"}
            className="border-input bg-background h-9 rounded-md border px-3 text-sm"
          >
            <option value="kitchen">Cocina</option>
            <option value="bar">Barra</option>
            <option value="sushi">Sushi</option>
            <option value="desserts">Postres</option>
          </select>
          <p className="text-muted-foreground text-xs">
            Que pantalla del KDS (Fase 16) muestra los productos de esta categoria.
          </p>
        </div>
      </div>

      {isEdit ? (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="isActive"
            value="true"
            defaultChecked={category.isActive}
            className="size-4"
          />
          Visible en la web
        </label>
      ) : null}

      <div>
        <Button type="submit" loading={isPending} loadingLabel="Guardando">
          {isEdit ? "Guardar categoria" : "Crear categoria"}
        </Button>
      </div>
    </form>
  );
}

export function ProductForm({
  tenantSlug,
  categories,
  product,
}: {
  tenantSlug: string;
  categories: readonly Category[];
  product?: Product;
}) {
  const isEdit = product !== undefined;
  const [state, formAction, isPending] = useActionState(
    isEdit ? updateProductAction : createProductAction,
    IDLE_FORM_STATE,
  );
  const e = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      {isEdit ? <input type="hidden" name="productId" value={product.id} /> : null}
      <Feedback state={state} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="name" label="Nombre" defaultValue={product?.name} errors={e.name} />
        <Field
          name="slug"
          label="Slug"
          hint="maki-acevichado"
          defaultValue={product?.slug}
          errors={e.slug}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field
          name="basePrice"
          label="Precio"
          inputMode="decimal"
          placeholder="24.90"
          hint="En soles, con dos decimales."
          // The stored value is an integer number of cents; the form shows and
          // reads the decimal string, and `parseMoney` is the only bridge.
          defaultValue={product === undefined ? "" : formatMoney(product.basePriceCents)}
          errors={e.basePrice}
        />

        <div className="flex flex-col gap-2">
          <Label htmlFor="categoryId">Categoria</Label>
          <select
            id="categoryId"
            name="categoryId"
            defaultValue={product?.categoryId ?? ""}
            className="border-input bg-background h-9 rounded-md border px-3 text-sm"
          >
            <option value="">Sin categoria</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
          {e.categoryId !== undefined ? (
            <p className="text-destructive text-sm">{e.categoryId[0]}</p>
          ) : null}
        </div>

        <Field
          name="position"
          label="Orden"
          defaultValue={String(product?.position ?? 0)}
          errors={e.position}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="description">Descripcion</Label>
        <textarea
          id="description"
          name="description"
          rows={3}
          defaultValue={product?.description ?? ""}
          className="border-input bg-background rounded-md border px-3 py-2 text-sm"
        />
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="isFeatured"
          value="true"
          defaultChecked={product?.isFeatured ?? false}
          className="size-4"
        />
        Destacado
      </label>

      <div>
        <Button type="submit" loading={isPending} loadingLabel="Guardando">
          {isEdit ? "Guardar producto" : "Crear producto"}
        </Button>
      </div>
    </form>
  );
}

/** A one-button form for an action that takes only ids. */
function MiniForm({
  action,
  label,
  loadingLabel,
  variant = "secondary",
  size,
  children,
}: {
  action: Action;
  label: string;
  loadingLabel: string;
  variant?: "secondary" | "destructive" | "ghost";
  size?: "sm";
  children: React.ReactNode;
}) {
  const [state, formAction, isPending] = useActionState(action, IDLE_FORM_STATE);

  return (
    <form action={formAction} className="flex flex-col gap-2">
      {children}
      <Feedback state={state} />
      <Button
        type="submit"
        variant={variant}
        size={size}
        loading={isPending}
        loadingLabel={loadingLabel}
      >
        {label}
      </Button>
    </form>
  );
}

export function ProductStatusForms({
  tenantSlug,
  product,
}: {
  tenantSlug: string;
  product: ProductDetail;
}) {
  return (
    <div className="flex flex-wrap items-start gap-4">
      {product.status !== "active" ? (
        <MiniForm action={setProductStatusAction} label="Publicar" loadingLabel="Publicando">
          <input type="hidden" name="tenantSlug" value={tenantSlug} />
          <input type="hidden" name="productId" value={product.id} />
          <input type="hidden" name="status" value="active" />
        </MiniForm>
      ) : (
        <MiniForm action={setProductStatusAction} label="Pasar a borrador" loadingLabel="Guardando">
          <input type="hidden" name="tenantSlug" value={tenantSlug} />
          <input type="hidden" name="productId" value={product.id} />
          <input type="hidden" name="status" value="draft" />
        </MiniForm>
      )}

      {/*
        Availability is a separate control on purpose. Running out of ceviche at
        three o'clock is not the same act as taking it off the menu, and the two
        buttons should not be able to be mistaken for each other.
      */}
      <MiniForm
        action={setProductAvailabilityAction}
        label={product.isAvailable ? "Marcar agotado" : "Marcar disponible"}
        loadingLabel="Guardando"
      >
        <input type="hidden" name="tenantSlug" value={tenantSlug} />
        <input type="hidden" name="productId" value={product.id} />
        <input type="hidden" name="isAvailable" value={product.isAvailable ? "false" : "true"} />
      </MiniForm>

      {product.status !== "archived" ? (
        <MiniForm
          action={setProductStatusAction}
          label="Archivar"
          loadingLabel="Archivando"
          variant="destructive"
        >
          <input type="hidden" name="tenantSlug" value={tenantSlug} />
          <input type="hidden" name="productId" value={product.id} />
          <input type="hidden" name="status" value="archived" />
        </MiniForm>
      ) : null}
    </div>
  );
}

export function DeleteChildForm({
  tenantSlug,
  productId,
  childId,
  kind,
}: {
  tenantSlug: string;
  productId: string;
  childId: string;
  kind: "image" | "variant" | "option";
}) {
  return (
    <MiniForm
      action={deleteProductChildAction}
      label="Quitar"
      loadingLabel="Quitando"
      variant="ghost"
      size="sm"
    >
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="childId" value={childId} />
      <input type="hidden" name="kind" value={kind} />
    </MiniForm>
  );
}

export function AddImageForm({ tenantSlug, productId }: { tenantSlug: string; productId: string }) {
  const [state, formAction, isPending] = useActionState(addProductImageAction, IDLE_FORM_STATE);
  const e = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="productId" value={productId} />
      <Feedback state={state} />

      <Field
        name="path"
        label="Ruta de la imagen"
        hint="Subela en Configuracion y pega aqui su ruta: tenants/…/products/foto.jpg"
        errors={e.path}
      />
      <Field name="altText" label="Texto alternativo" errors={e.altText} />

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="isPrimary" value="true" className="size-4" />
        Es la imagen principal
      </label>
      {e.isPrimary !== undefined ? (
        <p className="text-destructive text-sm">{e.isPrimary[0]}</p>
      ) : null}

      <div>
        <Button type="submit" loading={isPending} loadingLabel="Anadiendo">
          Anadir imagen
        </Button>
      </div>
    </form>
  );
}

export function AddVariantForm({
  tenantSlug,
  productId,
}: {
  tenantSlug: string;
  productId: string;
}) {
  const [state, formAction, isPending] = useActionState(addVariantAction, IDLE_FORM_STATE);
  const e = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="productId" value={productId} />
      <Feedback state={state} />

      <div className="grid gap-4 sm:grid-cols-3">
        <Field name="name" label="Nombre" placeholder="Familiar" errors={e.name} />
        <Field
          name="price"
          label="Precio"
          inputMode="decimal"
          placeholder="39.00"
          errors={e.price}
        />
        <Field name="sku" label="SKU" hint="Opcional." errors={e.sku} />
      </div>

      <div>
        <Button type="submit" loading={isPending} loadingLabel="Anadiendo">
          Anadir variante
        </Button>
      </div>
    </form>
  );
}

export function AddOptionForm({
  tenantSlug,
  productId,
}: {
  tenantSlug: string;
  productId: string;
}) {
  const [state, formAction, isPending] = useActionState(addOptionAction, IDLE_FORM_STATE);
  const e = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="productId" value={productId} />
      <Feedback state={state} />

      <div className="grid gap-4 sm:grid-cols-3">
        <Field name="groupLabel" label="Grupo" placeholder="Extras" errors={e.groupLabel} />
        <Field name="name" label="Opcion" placeholder="Extra queso" errors={e.name} />
        <Field
          name="priceDelta"
          label="Ajuste de precio"
          inputMode="decimal"
          placeholder="3.00"
          hint="Puede ser negativo. Vacio es sin cambio."
          errors={e.priceDelta}
        />
      </div>

      <div>
        <Button type="submit" loading={isPending} loadingLabel="Anadiendo">
          Anadir opcion
        </Button>
      </div>
    </form>
  );
}
