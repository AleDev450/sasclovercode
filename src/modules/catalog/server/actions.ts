"use server";

/**
 * Catalogue Server Actions.
 *
 * Governed by the `products.*` permissions Phase 03 already put in the
 * catalogue, so nothing new was invented for this phase: creating a product is
 * `products.create`, everything about an existing one - including its images,
 * variants and options - is `products.update`.
 *
 * Same three layers as every write in the product: page guard, explicit
 * `requirePermission` here, RLS underneath.
 *
 * Prices arrive as strings and become integers in the schema. No action here
 * ever performs arithmetic on money; there is nothing to get wrong because
 * there is nothing to compute.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { DatabaseError } from "@/lib/errors";
import type { FormState } from "@/lib/forms/state";
import { logger } from "@/lib/logger";
import { PERMISSIONS } from "@/lib/permissions";
import { requirePermission } from "@/lib/permissions/check";
import type { Permission } from "@/lib/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireActiveTenant } from "@/lib/tenant/active";
import { toFieldErrors } from "@/lib/validation";
import {
  categorySchema,
  productAvailabilitySchema,
  productImageSchema,
  productOptionSchema,
  productSchema,
  productStatusSchema,
  productVariantSchema,
} from "../schemas";

function readText(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

async function requireCatalogAccess(formData: FormData, permission: Permission) {
  const tenant = await requireActiveTenant(readText(formData, "tenantSlug"));
  await requirePermission(tenant.id, permission);
  return tenant;
}

/**
 * Turns a constraint violation into a field message.
 *
 * 23505 is a unique index. Which one it was decides the message, because
 * "already exists" without saying what is a support ticket.
 */
function describeConflict(message: string): FormState {
  if (message.includes("slug")) {
    return { status: "error", fieldErrors: { slug: ["Ya tienes algo con ese slug."] } };
  }
  if (message.includes("sku")) {
    return { status: "error", fieldErrors: { sku: ["Ya usas ese SKU en otro producto."] } };
  }
  if (message.includes("name")) {
    return { status: "error", fieldErrors: { name: ["Ya tienes algo con ese nombre."] } };
  }
  if (message.includes("primary")) {
    return {
      status: "error",
      fieldErrors: { isPrimary: ["Ya hay una imagen principal. Quita la otra primero."] },
    };
  }
  return { status: "error", message: "Ese valor ya existe." };
}

function revalidateCatalog(slug: string, productId?: string): void {
  revalidatePath(`/dashboard/${slug}/catalogo`);
  if (productId !== undefined) revalidatePath(`/dashboard/${slug}/catalogo/${productId}`);
  // The public site renders the catalogue.
  revalidatePath("/sitio", "layout");
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export async function createCategoryAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireCatalogAccess(formData, PERMISSIONS.PRODUCTS_CREATE);

  const parsed = categorySchema.safeParse({
    name: readText(formData, "name"),
    slug: readText(formData, "slug"),
    description: readText(formData, "description"),
    position: readText(formData, "position") || 0,
  });
  if (!parsed.success) return { status: "error", fieldErrors: toFieldErrors(parsed.error) };

  const client = await createSupabaseServerClient();
  const { error } = await client.from("categories").insert({
    tenant_id: tenant.id,
    name: parsed.data.name,
    slug: parsed.data.slug,
    description: parsed.data.description,
    position: parsed.data.position,
  });

  if (error) {
    if (error.code === "23505") return describeConflict(error.message);
    logger.error("catalog.category.create_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Category creation failed.", { cause: error });
  }

  logger.info("catalog.category.created", { tenantId: tenant.id });
  revalidateCatalog(tenant.slug);
  return { status: "success", message: "Categoria creada." };
}

export async function updateCategoryAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireCatalogAccess(formData, PERMISSIONS.PRODUCTS_UPDATE);

  const parsedId = z.uuid().safeParse(readText(formData, "categoryId"));
  if (!parsedId.success) return { status: "error", message: "Categoria no encontrada." };

  const parsed = categorySchema.safeParse({
    name: readText(formData, "name"),
    slug: readText(formData, "slug"),
    description: readText(formData, "description"),
    position: readText(formData, "position") || 0,
  });
  if (!parsed.success) return { status: "error", fieldErrors: toFieldErrors(parsed.error) };

  const isActive = readText(formData, "isActive") !== "false";

  const client = await createSupabaseServerClient();
  const { error } = await client
    .from("categories")
    .update({
      name: parsed.data.name,
      slug: parsed.data.slug,
      description: parsed.data.description,
      position: parsed.data.position,
      is_active: isActive,
    })
    .eq("tenant_id", tenant.id)
    .eq("id", parsedId.data);

  if (error) {
    if (error.code === "23505") return describeConflict(error.message);
    logger.error("catalog.category.update_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Category update failed.", { cause: error });
  }

  logger.info("catalog.category.updated", { tenantId: tenant.id, categoryId: parsedId.data });
  revalidateCatalog(tenant.slug);
  return { status: "success", message: "Categoria guardada." };
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

function readProductFields(formData: FormData) {
  return {
    name: readText(formData, "name"),
    slug: readText(formData, "slug"),
    description: readText(formData, "description"),
    categoryId: readText(formData, "categoryId"),
    basePrice: readText(formData, "basePrice"),
    position: readText(formData, "position") || 0,
    isFeatured: readText(formData, "isFeatured") || "false",
  };
}

export async function createProductAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireCatalogAccess(formData, PERMISSIONS.PRODUCTS_CREATE);

  const parsed = productSchema.safeParse(readProductFields(formData));
  if (!parsed.success) return { status: "error", fieldErrors: toFieldErrors(parsed.error) };

  const client = await createSupabaseServerClient();
  const { error } = await client.from("products").insert({
    tenant_id: tenant.id,
    category_id: parsed.data.categoryId,
    name: parsed.data.name,
    slug: parsed.data.slug,
    description: parsed.data.description,
    base_price_cents: parsed.data.basePrice,
    position: parsed.data.position,
    is_featured: parsed.data.isFeatured,
    // Always draft. A product goes public when its owner says so, not as a side
    // effect of being typed in.
    status: "draft",
  });

  if (error) {
    if (error.code === "23505") return describeConflict(error.message);
    // The category-tenant guard raises 23514.
    if (error.code === "23514") {
      return { status: "error", fieldErrors: { categoryId: ["Esa categoria no es tuya."] } };
    }
    logger.error("catalog.product.create_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Product creation failed.", { cause: error });
  }

  logger.info("catalog.product.created", { tenantId: tenant.id });
  revalidateCatalog(tenant.slug);
  return { status: "success", message: "Producto creado en borrador." };
}

export async function updateProductAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireCatalogAccess(formData, PERMISSIONS.PRODUCTS_UPDATE);

  const parsedId = z.uuid().safeParse(readText(formData, "productId"));
  if (!parsedId.success) return { status: "error", message: "Producto no encontrado." };

  const parsed = productSchema.safeParse(readProductFields(formData));
  if (!parsed.success) return { status: "error", fieldErrors: toFieldErrors(parsed.error) };

  const client = await createSupabaseServerClient();
  const { error } = await client
    .from("products")
    .update({
      category_id: parsed.data.categoryId,
      name: parsed.data.name,
      slug: parsed.data.slug,
      description: parsed.data.description,
      base_price_cents: parsed.data.basePrice,
      position: parsed.data.position,
      is_featured: parsed.data.isFeatured,
    })
    .eq("tenant_id", tenant.id)
    .eq("id", parsedId.data);

  if (error) {
    if (error.code === "23505") return describeConflict(error.message);
    if (error.code === "23514") {
      return { status: "error", fieldErrors: { categoryId: ["Esa categoria no es tuya."] } };
    }
    logger.error("catalog.product.update_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Product update failed.", { cause: error });
  }

  logger.info("catalog.product.updated", { tenantId: tenant.id, productId: parsedId.data });
  revalidateCatalog(tenant.slug, parsedId.data);
  return { status: "success", message: "Producto guardado." };
}

export async function setProductStatusAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireCatalogAccess(formData, PERMISSIONS.PRODUCTS_UPDATE);

  const parsed = productStatusSchema.safeParse({
    productId: readText(formData, "productId"),
    status: readText(formData, "status"),
  });
  if (!parsed.success) return { status: "error", message: "Producto no encontrado." };

  const client = await createSupabaseServerClient();
  const { error } = await client
    .from("products")
    .update({ status: parsed.data.status })
    .eq("tenant_id", tenant.id)
    .eq("id", parsed.data.productId);

  if (error) {
    logger.error("catalog.product.status_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Product status change failed.", { cause: error });
  }

  logger.info("catalog.product.status_changed", {
    tenantId: tenant.id,
    productId: parsed.data.productId,
    to: parsed.data.status,
  });
  revalidateCatalog(tenant.slug, parsed.data.productId);

  const messages = {
    draft: "Producto en borrador. Ya no aparece en la web.",
    active: "Producto publicado.",
    archived: "Producto archivado. Los pedidos antiguos no se tocan.",
  } as const;
  return { status: "success", message: messages[parsed.data.status] };
}

/**
 * Sold out today, without unpublishing.
 *
 * The whole point of `is_available` being separate from `status`: a kitchen
 * marking the ceviche gone at three o'clock is not the same act as taking it
 * off the menu, and one click should not be able to be mistaken for the other.
 */
export async function setProductAvailabilityAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireCatalogAccess(formData, PERMISSIONS.PRODUCTS_UPDATE);

  const parsed = productAvailabilitySchema.safeParse({
    productId: readText(formData, "productId"),
    isAvailable: readText(formData, "isAvailable"),
  });
  if (!parsed.success) return { status: "error", message: "Producto no encontrado." };

  const client = await createSupabaseServerClient();
  const { error } = await client
    .from("products")
    .update({ is_available: parsed.data.isAvailable })
    .eq("tenant_id", tenant.id)
    .eq("id", parsed.data.productId);

  if (error) {
    logger.error("catalog.product.availability_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Product availability change failed.", { cause: error });
  }

  logger.info("catalog.product.availability", {
    tenantId: tenant.id,
    productId: parsed.data.productId,
    available: parsed.data.isAvailable,
  });
  revalidateCatalog(tenant.slug, parsed.data.productId);
  return {
    status: "success",
    message: parsed.data.isAvailable ? "Disponible otra vez." : "Marcado como agotado.",
  };
}

// ---------------------------------------------------------------------------
// Images, variants and options
// ---------------------------------------------------------------------------

/**
 * The three child writers share a shape: validate, insert WITHOUT `tenant_id`,
 * let the trigger derive it. Sending our own would be harmless here and
 * dangerous as a habit - it is the value an attacker would supply (AB-1101).
 */
export async function addProductImageAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireCatalogAccess(formData, PERMISSIONS.PRODUCTS_UPDATE);

  const parsed = productImageSchema.safeParse({
    productId: readText(formData, "productId"),
    path: readText(formData, "path"),
    altText: readText(formData, "altText"),
    isPrimary: readText(formData, "isPrimary") || "false",
  });
  if (!parsed.success) return { status: "error", fieldErrors: toFieldErrors(parsed.error) };

  const client = await createSupabaseServerClient();
  const { error } = await client.from("product_images").insert({
    product_id: parsed.data.productId,
    path: parsed.data.path,
    alt_text: parsed.data.altText,
    is_primary: parsed.data.isPrimary,
  });

  if (error) {
    if (error.code === "23505") return describeConflict(error.message);
    if (error.code === "23514") {
      return { status: "error", fieldErrors: { path: ["Esa ruta no es de esta empresa."] } };
    }
    logger.error("catalog.image.add_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Product image creation failed.", { cause: error });
  }

  logger.info("catalog.image.added", { tenantId: tenant.id, productId: parsed.data.productId });
  revalidateCatalog(tenant.slug, parsed.data.productId);
  return { status: "success", message: "Imagen anadida." };
}

export async function addVariantAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireCatalogAccess(formData, PERMISSIONS.PRODUCTS_UPDATE);

  const parsed = productVariantSchema.safeParse({
    productId: readText(formData, "productId"),
    name: readText(formData, "name"),
    sku: readText(formData, "sku"),
    price: readText(formData, "price"),
    position: readText(formData, "position") || 0,
  });
  if (!parsed.success) return { status: "error", fieldErrors: toFieldErrors(parsed.error) };

  const client = await createSupabaseServerClient();
  const { error } = await client.from("product_variants").insert({
    product_id: parsed.data.productId,
    name: parsed.data.name,
    sku: parsed.data.sku,
    price_cents: parsed.data.price,
    position: parsed.data.position,
  });

  if (error) {
    if (error.code === "23505") return describeConflict(error.message);
    logger.error("catalog.variant.add_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Variant creation failed.", { cause: error });
  }

  logger.info("catalog.variant.added", { tenantId: tenant.id, productId: parsed.data.productId });
  revalidateCatalog(tenant.slug, parsed.data.productId);
  return { status: "success", message: "Variante anadida." };
}

export async function addOptionAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireCatalogAccess(formData, PERMISSIONS.PRODUCTS_UPDATE);

  const parsed = productOptionSchema.safeParse({
    productId: readText(formData, "productId"),
    groupLabel: readText(formData, "groupLabel"),
    name: readText(formData, "name"),
    priceDelta: readText(formData, "priceDelta"),
    position: readText(formData, "position") || 0,
  });
  if (!parsed.success) return { status: "error", fieldErrors: toFieldErrors(parsed.error) };

  const client = await createSupabaseServerClient();
  const { error } = await client.from("product_options").insert({
    product_id: parsed.data.productId,
    group_label: parsed.data.groupLabel,
    name: parsed.data.name,
    price_delta_cents: parsed.data.priceDelta,
    position: parsed.data.position,
  });

  if (error) {
    if (error.code === "23505") return describeConflict(error.message);
    logger.error("catalog.option.add_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Option creation failed.", { cause: error });
  }

  logger.info("catalog.option.added", { tenantId: tenant.id, productId: parsed.data.productId });
  revalidateCatalog(tenant.slug, parsed.data.productId);
  return { status: "success", message: "Opcion anadida." };
}

const CHILD_TABLES = {
  image: "product_images",
  variant: "product_variants",
  option: "product_options",
} as const;

const deleteChildSchema = z.object({
  kind: z.enum(["image", "variant", "option"]),
  childId: z.uuid(),
  productId: z.uuid(),
});

/**
 * One deleter for the three child tables.
 *
 * The table is chosen from a closed map, never from the form value directly:
 * `from(readText(formData, "table"))` would be a client-controlled table name.
 */
export async function deleteProductChildAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireCatalogAccess(formData, PERMISSIONS.PRODUCTS_UPDATE);

  const parsed = deleteChildSchema.safeParse({
    kind: readText(formData, "kind"),
    childId: readText(formData, "childId"),
    productId: readText(formData, "productId"),
  });
  if (!parsed.success) return { status: "error", message: "No se encontro ese elemento." };

  const client = await createSupabaseServerClient();
  const { error } = await client
    .from(CHILD_TABLES[parsed.data.kind])
    .delete()
    .eq("tenant_id", tenant.id)
    .eq("id", parsed.data.childId);

  if (error) {
    logger.error("catalog.child.delete_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Deletion failed.", { cause: error });
  }

  logger.info(`catalog.${parsed.data.kind}.removed`, {
    tenantId: tenant.id,
    productId: parsed.data.productId,
  });
  revalidateCatalog(tenant.slug, parsed.data.productId);
  return { status: "success", message: "Elemento quitado." };
}
