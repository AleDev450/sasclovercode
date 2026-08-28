"use server";

/**
 * Units, inventory items, suppliers, purchases, manual stock movements,
 * transfers and recipes - Server Actions.
 *
 * Same posture as every other module: `requirePermission`, a Zod parse,
 * one write (or a small, explicitly-accepted non-atomic sequence, same
 * trade-off `orders/server/actions.ts` already accepts for order+items),
 * and the database's own refusal translated into a message a person can
 * act on. Every invariant that matters - the sign-by-type CHECK, the
 * cross-tenant guards, `purchases.total_cost_cents` - is already enforced
 * by the migrations (ADR-022); nothing here re-derives one.
 */

import { revalidatePath } from "next/cache";
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
  createInventoryItemSchema,
  createSupplierSchema,
  createUnitSchema,
  recordPurchaseSchema,
  recordStockMovementSchema,
  recordStockTransferSchema,
  saveRecipeSchema,
  setInventoryItemActiveSchema,
  setSupplierActiveSchema,
  setUnitActiveSchema,
  updateInventoryItemSchema,
  updateSupplierSchema,
} from "../schemas";

function readText(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

async function requireAccess(formData: FormData, permission: Permission) {
  const tenant = await requireActiveTenant(readText(formData, "tenantSlug"));
  await requirePermission(tenant.id, permission);
  return tenant;
}

/**
 * Turns a database refusal into a message a person can act on.
 *
 * The trigger messages (the cross-tenant guards, the recipe/order lookups)
 * are written for exactly this: they name what went wrong, so the string
 * is matched rather than replaced with something generic.
 */
function describeDatabaseError(error: { code?: string; message: string }): FormState | null {
  if (error.code === "P0002") {
    if (error.message.includes("Inventory item not found")) {
      return { status: "error", message: "Ese insumo no existe." };
    }
    if (error.message.includes("Product not found")) {
      return { status: "error", message: "Ese producto no existe." };
    }
    if (error.message.includes("Recipe not found")) {
      return { status: "error", message: "Esa receta no existe." };
    }
    return { status: "error", message: "Ese registro no existe." };
  }

  if (error.code === "23514") {
    if (error.message.includes("different business")) {
      return { status: "error", message: "Ese elemento no pertenece a este negocio." };
    }
    return { status: "error", message: "Esa operacion no esta permitida." };
  }

  if (error.code === "23505") {
    if (error.message.includes("units_tenant_abbreviation_key")) {
      return { status: "error", fieldErrors: { abbreviation: ["Ya existe una unidad con esa abreviatura."] } };
    }
    if (error.message.includes("inventory_items_tenant_name_key")) {
      return { status: "error", fieldErrors: { name: ["Ya existe un insumo con ese nombre."] } };
    }
    if (error.message.includes("suppliers_tenant_name_key")) {
      return { status: "error", fieldErrors: { name: ["Ya existe un proveedor con ese nombre."] } };
    }
    if (error.message.includes("recipe_items_recipe_item_key")) {
      return { status: "error", message: "Un insumo no puede repetirse en la misma receta." };
    }
    return { status: "error", message: "Ese registro ya existe." };
  }

  return null;
}

function revalidateInventory(slug: string): void {
  revalidatePath(`/dashboard/${slug}/inventario`);
  revalidatePath(`/dashboard/${slug}/inventario/proveedores`);
  revalidatePath(`/dashboard/${slug}/inventario/compras`);
}

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

export async function createUnitAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const tenant = await requireAccess(formData, PERMISSIONS.INVENTORY_MANAGE);

  const parsed = createUnitSchema.safeParse({
    name: readText(formData, "name"),
    abbreviation: readText(formData, "abbreviation"),
  });
  if (!parsed.success) return { status: "error", fieldErrors: toFieldErrors(parsed.error) };

  const client = await createSupabaseServerClient();
  const { error } = await client.from("units").insert({
    tenant_id: tenant.id,
    name: parsed.data.name,
    abbreviation: parsed.data.abbreviation,
  });

  if (error) {
    const described = describeDatabaseError(error);
    if (described !== null) return described;
    logger.error("inventory.create_unit_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Unit creation failed.", { cause: error });
  }

  logger.info("unit.created", { tenantId: tenant.id });
  revalidateInventory(tenant.slug);
  return { status: "success", message: "Unidad creada." };
}

export async function setUnitActiveAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const tenant = await requireAccess(formData, PERMISSIONS.INVENTORY_MANAGE);

  const parsed = setUnitActiveSchema.safeParse({
    unitId: readText(formData, "unitId"),
    isActive: readText(formData, "isActive"),
  });
  if (!parsed.success) return { status: "error", message: "Solicitud invalida." };

  const client = await createSupabaseServerClient();
  const { error } = await client
    .from("units")
    .update({ is_active: parsed.data.isActive })
    .eq("tenant_id", tenant.id)
    .eq("id", parsed.data.unitId);

  if (error) {
    logger.error("inventory.set_unit_active_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Unit update failed.", { cause: error });
  }

  logger.info(parsed.data.isActive ? "unit.activated" : "unit.deactivated", { tenantId: tenant.id });
  revalidateInventory(tenant.slug);
  return { status: "success", message: parsed.data.isActive ? "Unidad activada." : "Unidad desactivada." };
}

// ---------------------------------------------------------------------------
// Inventory items
// ---------------------------------------------------------------------------

export async function createInventoryItemAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireAccess(formData, PERMISSIONS.INVENTORY_MANAGE);

  const parsed = createInventoryItemSchema.safeParse({
    unitId: readText(formData, "unitId"),
    name: readText(formData, "name"),
    sku: readText(formData, "sku"),
  });
  if (!parsed.success) return { status: "error", fieldErrors: toFieldErrors(parsed.error) };

  const client = await createSupabaseServerClient();
  const { error } = await client.from("inventory_items").insert({
    tenant_id: tenant.id,
    unit_id: parsed.data.unitId,
    name: parsed.data.name,
    sku: parsed.data.sku,
  });

  if (error) {
    const described = describeDatabaseError(error);
    if (described !== null) return described;
    logger.error("inventory.create_item_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Inventory item creation failed.", { cause: error });
  }

  logger.info("inventory_item.created", { tenantId: tenant.id });
  revalidateInventory(tenant.slug);
  return { status: "success", message: "Insumo creado." };
}

export async function updateInventoryItemAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireAccess(formData, PERMISSIONS.INVENTORY_MANAGE);

  const parsed = updateInventoryItemSchema.safeParse({
    inventoryItemId: readText(formData, "inventoryItemId"),
    unitId: readText(formData, "unitId"),
    name: readText(formData, "name"),
    sku: readText(formData, "sku"),
  });
  if (!parsed.success) return { status: "error", fieldErrors: toFieldErrors(parsed.error) };

  const client = await createSupabaseServerClient();
  const { error } = await client
    .from("inventory_items")
    .update({ unit_id: parsed.data.unitId, name: parsed.data.name, sku: parsed.data.sku })
    .eq("tenant_id", tenant.id)
    .eq("id", parsed.data.inventoryItemId);

  if (error) {
    const described = describeDatabaseError(error);
    if (described !== null) return described;
    logger.error("inventory.update_item_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Inventory item update failed.", { cause: error });
  }

  logger.info("inventory_item.updated", { tenantId: tenant.id });
  revalidateInventory(tenant.slug);
  return { status: "success", message: "Insumo actualizado." };
}

export async function setInventoryItemActiveAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireAccess(formData, PERMISSIONS.INVENTORY_MANAGE);

  const parsed = setInventoryItemActiveSchema.safeParse({
    inventoryItemId: readText(formData, "inventoryItemId"),
    isActive: readText(formData, "isActive"),
  });
  if (!parsed.success) return { status: "error", message: "Solicitud invalida." };

  const client = await createSupabaseServerClient();
  const { error } = await client
    .from("inventory_items")
    .update({ is_active: parsed.data.isActive })
    .eq("tenant_id", tenant.id)
    .eq("id", parsed.data.inventoryItemId);

  if (error) {
    logger.error("inventory.set_item_active_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Inventory item update failed.", { cause: error });
  }

  logger.info(parsed.data.isActive ? "inventory_item.activated" : "inventory_item.deactivated", {
    tenantId: tenant.id,
  });
  revalidateInventory(tenant.slug);
  return { status: "success", message: parsed.data.isActive ? "Insumo activado." : "Insumo desactivado." };
}

// ---------------------------------------------------------------------------
// Suppliers
// ---------------------------------------------------------------------------

export async function createSupplierAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const tenant = await requireAccess(formData, PERMISSIONS.SUPPLIERS_MANAGE);

  const parsed = createSupplierSchema.safeParse({
    name: readText(formData, "name"),
    taxId: readText(formData, "taxId"),
    contactName: readText(formData, "contactName"),
    phone: readText(formData, "phone"),
    email: readText(formData, "email"),
    address: readText(formData, "address"),
    notes: readText(formData, "notes"),
  });
  if (!parsed.success) return { status: "error", fieldErrors: toFieldErrors(parsed.error) };

  const client = await createSupabaseServerClient();
  const { error } = await client.from("suppliers").insert({
    tenant_id: tenant.id,
    name: parsed.data.name,
    tax_id: parsed.data.taxId,
    contact_name: parsed.data.contactName,
    phone: parsed.data.phone,
    email: parsed.data.email,
    address: parsed.data.address,
    notes: parsed.data.notes,
  });

  if (error) {
    const described = describeDatabaseError(error);
    if (described !== null) return described;
    logger.error("inventory.create_supplier_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Supplier creation failed.", { cause: error });
  }

  logger.info("supplier.created", { tenantId: tenant.id });
  revalidateInventory(tenant.slug);
  return { status: "success", message: "Proveedor creado." };
}

export async function updateSupplierAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const tenant = await requireAccess(formData, PERMISSIONS.SUPPLIERS_MANAGE);

  const parsed = updateSupplierSchema.safeParse({
    supplierId: readText(formData, "supplierId"),
    name: readText(formData, "name"),
    taxId: readText(formData, "taxId"),
    contactName: readText(formData, "contactName"),
    phone: readText(formData, "phone"),
    email: readText(formData, "email"),
    address: readText(formData, "address"),
    notes: readText(formData, "notes"),
  });
  if (!parsed.success) return { status: "error", fieldErrors: toFieldErrors(parsed.error) };

  const client = await createSupabaseServerClient();
  const { error } = await client
    .from("suppliers")
    .update({
      name: parsed.data.name,
      tax_id: parsed.data.taxId,
      contact_name: parsed.data.contactName,
      phone: parsed.data.phone,
      email: parsed.data.email,
      address: parsed.data.address,
      notes: parsed.data.notes,
    })
    .eq("tenant_id", tenant.id)
    .eq("id", parsed.data.supplierId);

  if (error) {
    const described = describeDatabaseError(error);
    if (described !== null) return described;
    logger.error("inventory.update_supplier_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Supplier update failed.", { cause: error });
  }

  logger.info("supplier.updated", { tenantId: tenant.id });
  revalidateInventory(tenant.slug);
  return { status: "success", message: "Proveedor actualizado." };
}

export async function setSupplierActiveAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireAccess(formData, PERMISSIONS.SUPPLIERS_MANAGE);

  const parsed = setSupplierActiveSchema.safeParse({
    supplierId: readText(formData, "supplierId"),
    isActive: readText(formData, "isActive"),
  });
  if (!parsed.success) return { status: "error", message: "Solicitud invalida." };

  const client = await createSupabaseServerClient();
  const { error } = await client
    .from("suppliers")
    .update({ is_active: parsed.data.isActive })
    .eq("tenant_id", tenant.id)
    .eq("id", parsed.data.supplierId);

  if (error) {
    logger.error("inventory.set_supplier_active_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Supplier update failed.", { cause: error });
  }

  logger.info(parsed.data.isActive ? "supplier.activated" : "supplier.deactivated", { tenantId: tenant.id });
  revalidateInventory(tenant.slug);
  return { status: "success", message: parsed.data.isActive ? "Proveedor activado." : "Proveedor desactivado." };
}

// ---------------------------------------------------------------------------
// Purchases
// ---------------------------------------------------------------------------

/** Parallel `lineX` fields, the same shape `orders/server/actions.ts` reads its lines with. */
function readPurchaseLines(formData: FormData): unknown[] {
  const itemIds = formData.getAll("lineInventoryItemId");
  const quantities = formData.getAll("lineQuantity");
  const unitCosts = formData.getAll("lineUnitCost");

  return itemIds
    .map((itemId, index) => ({
      inventoryItemId: typeof itemId === "string" ? itemId : "",
      quantity: typeof quantities[index] === "string" ? quantities[index] : "",
      unitCost: typeof unitCosts[index] === "string" ? unitCosts[index] : "",
    }))
    .filter((line) => line.inventoryItemId.length > 0);
}

export async function recordPurchaseAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const tenant = await requireAccess(formData, PERMISSIONS.PURCHASES_CREATE);

  const parsed = recordPurchaseSchema.safeParse({
    supplierId: readText(formData, "supplierId"),
    locationId: readText(formData, "locationId"),
    reference: readText(formData, "reference"),
    notes: readText(formData, "notes"),
    lines: readPurchaseLines(formData),
  });
  if (!parsed.success) return { status: "error", fieldErrors: toFieldErrors(parsed.error) };

  const client = await createSupabaseServerClient();

  const { data: purchase, error: purchaseError } = await client
    .from("purchases")
    .insert({
      tenant_id: tenant.id,
      supplier_id: parsed.data.supplierId,
      location_id: parsed.data.locationId,
      reference: parsed.data.reference,
      notes: parsed.data.notes,
    })
    .select("id")
    .single();

  if (purchaseError || purchase === null) {
    const described = purchaseError ? describeDatabaseError(purchaseError) : null;
    if (described !== null) return described;
    logger.error("inventory.record_purchase_failed", { tenantId: tenant.id, error: purchaseError });
    throw new DatabaseError("Purchase creation failed.", { cause: purchaseError });
  }

  const { error: linesError } = await client.from("stock_movements").insert(
    parsed.data.lines.map((line) => ({
      inventory_item_id: line.inventoryItemId,
      location_id: parsed.data.locationId,
      type: "purchase" as const,
      quantity: line.quantity,
      unit_cost_cents: line.unitCost,
      purchase_id: purchase.id,
    })),
  );

  if (linesError) {
    // The purchase exists with no lines and total_cost_cents at zero - a
    // visible, findable inconsistency rather than a silently half-applied
    // one, the same posture orders/server/actions.ts takes toward an order
    // whose lines failed to insert.
    const described = describeDatabaseError(linesError);
    if (described !== null) return described;
    logger.error("inventory.record_purchase_lines_failed", { tenantId: tenant.id, error: linesError });
    throw new DatabaseError("Purchase line creation failed.", { cause: linesError });
  }

  logger.info("purchase.recorded", { tenantId: tenant.id, purchaseId: purchase.id });
  revalidateInventory(tenant.slug);
  return { status: "success", message: "Compra registrada." };
}

// ---------------------------------------------------------------------------
// Manual stock movements (adjustment, waste, return)
// ---------------------------------------------------------------------------

export async function recordStockMovementAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireAccess(formData, PERMISSIONS.INVENTORY_MANAGE);

  const parsed = recordStockMovementSchema.safeParse({
    inventoryItemId: readText(formData, "inventoryItemId"),
    locationId: readText(formData, "locationId"),
    type: readText(formData, "type"),
    quantity: readText(formData, "quantity"),
    reason: readText(formData, "reason"),
  });
  if (!parsed.success) return { status: "error", fieldErrors: toFieldErrors(parsed.error) };

  // `waste` has exactly one legal sign; what the person typed only matters
  // for `adjustment`/`return`, so it is normalised here the same way
  // recordCashMovementAction (Phase 14) fixes `payout`'s sign regardless
  // of what was typed.
  const quantity = parsed.data.type === "waste" ? -Math.abs(parsed.data.quantity) : parsed.data.quantity;

  const client = await createSupabaseServerClient();
  const { error } = await client.from("stock_movements").insert({
    inventory_item_id: parsed.data.inventoryItemId,
    location_id: parsed.data.locationId,
    type: parsed.data.type,
    quantity,
    reason: parsed.data.reason,
  });

  if (error) {
    const described = describeDatabaseError(error);
    if (described !== null) return described;
    logger.error("inventory.record_movement_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Stock movement creation failed.", { cause: error });
  }

  logger.info("stock_movement.recorded", { tenantId: tenant.id, type: parsed.data.type });
  revalidateInventory(tenant.slug);
  return { status: "success", message: "Movimiento registrado." };
}

// ---------------------------------------------------------------------------
// Transfers
// ---------------------------------------------------------------------------

export async function recordStockTransferAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireAccess(formData, PERMISSIONS.INVENTORY_MANAGE);

  const parsed = recordStockTransferSchema.safeParse({
    inventoryItemId: readText(formData, "inventoryItemId"),
    fromLocationId: readText(formData, "fromLocationId"),
    toLocationId: readText(formData, "toLocationId"),
    quantity: readText(formData, "quantity"),
    reason: readText(formData, "reason"),
  });
  if (!parsed.success) return { status: "error", fieldErrors: toFieldErrors(parsed.error) };

  // A transfer is always exactly two rows, opposite sign, sharing one
  // group id - inserted together in one statement so neither can exist
  // without the other.
  const transferGroupId = crypto.randomUUID();

  const client = await createSupabaseServerClient();
  const { error } = await client.from("stock_movements").insert([
    {
      inventory_item_id: parsed.data.inventoryItemId,
      location_id: parsed.data.fromLocationId,
      type: "transfer" as const,
      quantity: -parsed.data.quantity,
      transfer_group_id: transferGroupId,
      reason: parsed.data.reason,
    },
    {
      inventory_item_id: parsed.data.inventoryItemId,
      location_id: parsed.data.toLocationId,
      type: "transfer" as const,
      quantity: parsed.data.quantity,
      transfer_group_id: transferGroupId,
      reason: parsed.data.reason,
    },
  ]);

  if (error) {
    const described = describeDatabaseError(error);
    if (described !== null) return described;
    logger.error("inventory.record_transfer_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Stock transfer creation failed.", { cause: error });
  }

  logger.info("stock_transfer.recorded", { tenantId: tenant.id });
  revalidateInventory(tenant.slug);
  return { status: "success", message: "Traslado registrado." };
}

// ---------------------------------------------------------------------------
// Recipes
// ---------------------------------------------------------------------------

function readRecipeItems(formData: FormData): unknown[] {
  const itemIds = formData.getAll("recipeItemInventoryItemId");
  const quantities = formData.getAll("recipeItemQuantity");

  return itemIds
    .map((itemId, index) => ({
      inventoryItemId: typeof itemId === "string" ? itemId : "",
      quantity: typeof quantities[index] === "string" ? quantities[index] : "",
    }))
    .filter((item) => item.inventoryItemId.length > 0);
}

export async function saveRecipeAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const tenant = await requireAccess(formData, PERMISSIONS.INVENTORY_MANAGE);

  const parsed = saveRecipeSchema.safeParse({
    productId: readText(formData, "productId"),
    notes: readText(formData, "notes"),
    isActive: readText(formData, "isActive"),
    items: readRecipeItems(formData),
  });
  if (!parsed.success) return { status: "error", fieldErrors: toFieldErrors(parsed.error) };

  const client = await createSupabaseServerClient();

  const { data: recipe, error: recipeError } = await client
    .from("recipes")
    .upsert(
      { product_id: parsed.data.productId, notes: parsed.data.notes, is_active: parsed.data.isActive },
      { onConflict: "product_id" },
    )
    .select("id")
    .single();

  if (recipeError || recipe === null) {
    const described = recipeError ? describeDatabaseError(recipeError) : null;
    if (described !== null) return described;
    logger.error("inventory.save_recipe_failed", { tenantId: tenant.id, error: recipeError });
    throw new DatabaseError("Recipe save failed.", { cause: recipeError });
  }

  const { error: deleteError } = await client.from("recipe_items").delete().eq("recipe_id", recipe.id);
  if (deleteError) {
    logger.error("inventory.clear_recipe_items_failed", { tenantId: tenant.id, error: deleteError });
    throw new DatabaseError("Recipe item removal failed.", { cause: deleteError });
  }

  if (parsed.data.items.length > 0) {
    const { error: itemsError } = await client.from("recipe_items").insert(
      parsed.data.items.map((item, position) => ({
        recipe_id: recipe.id,
        inventory_item_id: item.inventoryItemId,
        quantity: item.quantity,
        position,
      })),
    );

    if (itemsError) {
      const described = describeDatabaseError(itemsError);
      if (described !== null) return described;
      logger.error("inventory.save_recipe_items_failed", { tenantId: tenant.id, error: itemsError });
      throw new DatabaseError("Recipe item creation failed.", { cause: itemsError });
    }
  }

  logger.info("recipe.saved", { tenantId: tenant.id, productId: parsed.data.productId });
  revalidatePath(`/dashboard/${tenant.slug}/catalogo/${parsed.data.productId}`);
  return { status: "success", message: "Receta guardada." };
}
