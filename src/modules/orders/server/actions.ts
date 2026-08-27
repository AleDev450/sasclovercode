"use server";

/**
 * Order Server Actions.
 *
 * Governed by the four `orders.*` permissions Phase 03 already put in the
 * catalogue. The split that matters: **cancelling is not updating.**
 * `orders.cancel` is a permission a cook does not have, and it is checked here
 * rather than inferred from which fields changed.
 *
 * The other thing to notice: no action here sends a price or a total. The
 * database copies the price from the catalogue and computes every total, so
 * these functions carry decisions (what, how many, how much discount) and never
 * amounts that could be tampered with.
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
  addOrderItemSchema,
  advanceOrderSchema,
  cancelOrderSchema,
  createOrderSchema,
  removeOrderItemSchema,
  type OrderItemInput,
} from "../schemas";

function readText(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

async function requireOrderAccess(formData: FormData, permission: Permission) {
  const tenant = await requireActiveTenant(readText(formData, "tenantSlug"));
  await requirePermission(tenant.id, permission);
  return tenant;
}

/**
 * Turns a database refusal into something a person can act on.
 *
 * The state machine and the tenant guards raise P0001 and 23514 with messages
 * written for exactly this: they name the transition or the mismatch, so the
 * message is passed through rather than replaced with "algo salio mal".
 */
function describeDatabaseError(error: { code?: string; message: string }): FormState | null {
  if (error.code === "P0001") {
    if (error.message.includes("cannot go from")) {
      return { status: "error", message: "Ese cambio de estado no esta permitido." };
    }
    if (error.message.includes("no lines")) {
      return { status: "error", message: "Un pedido sin productos no puede avanzar." };
    }
    if (error.message.includes("no longer pending")) {
      return {
        status: "error",
        message: "El pedido ya fue confirmado: sus lineas no se pueden cambiar.",
      };
    }
    return { status: "error", message: "Esa operacion no esta permitida." };
  }

  if (error.code === "23514") {
    if (error.message.includes("archived")) {
      return { status: "error", message: "Ese producto esta archivado." };
    }
    if (error.message.includes("location")) {
      return { status: "error", message: "Esa sede no esta disponible." };
    }
    if (error.message.includes("customer")) {
      return { status: "error", message: "Ese cliente no es de esta empresa." };
    }
    if (error.message.includes("product")) {
      return { status: "error", message: "Ese producto no es de esta empresa." };
    }
    if (error.message.includes("variant")) {
      return { status: "error", message: "Esa variante no es de ese producto." };
    }
    if (error.message.includes("reason")) {
      return { status: "error", fieldErrors: { reason: ["Escribe por que se anula."] } };
    }
    if (error.message.includes("discount")) {
      return {
        status: "error",
        fieldErrors: { discount: ["El descuento no puede superar el importe."] },
      };
    }
  }

  return null;
}

function revalidateOrders(slug: string, orderId?: string): void {
  revalidatePath(`/dashboard/${slug}/pedidos`);
  if (orderId !== undefined) revalidatePath(`/dashboard/${slug}/pedidos/${orderId}`);
}

/**
 * Reads the repeated line fields out of the form.
 *
 * The new-order form submits parallel arrays (`items.productId` repeated), which
 * is what a plain HTML form can express without JavaScript.
 */
function readItems(formData: FormData): unknown[] {
  const productIds = formData.getAll("itemProductId");
  const variantIds = formData.getAll("itemVariantId");
  const quantities = formData.getAll("itemQuantity");
  const discounts = formData.getAll("itemDiscount");
  const notes = formData.getAll("itemNotes");

  return (
    productIds
      .map((productId, index) => ({
        productId: typeof productId === "string" ? productId : "",
        variantId: typeof variantIds[index] === "string" ? variantIds[index] : "",
        quantity: typeof quantities[index] === "string" ? quantities[index] : "",
        discount: typeof discounts[index] === "string" ? discounts[index] : "",
        notes: typeof notes[index] === "string" ? notes[index] : "",
      }))
      // A blank row is a row the cashier did not fill in, not an error.
      .filter((item) => item.productId.length > 0)
  );
}

/** The insert payload for one line. Note the absence of any price. */
function toItemRow(orderId: string, item: OrderItemInput, position: number) {
  return {
    order_id: orderId,
    product_id: item.productId,
    variant_id: item.variantId,
    quantity: item.quantity,
    discount_cents: item.discount,
    notes: item.notes,
    position,
    // `name_snapshot` and `unit_price_cents` are NOT sent. The trigger fills
    // them from the catalogue; sending our own would be the vulnerability this
    // design exists to remove (AB-1301). They are declared NOT NULL, so the
    // placeholders below exist only to satisfy the insert before the BEFORE
    // trigger overwrites them.
    name_snapshot: "-",
    unit_price_cents: 0,
  };
}

export async function createOrderAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireOrderAccess(formData, PERMISSIONS.ORDERS_CREATE);

  const parsed = createOrderSchema.safeParse({
    locationId: readText(formData, "locationId"),
    customerId: readText(formData, "customerId"),
    source: readText(formData, "source") || "manual",
    shipping: readText(formData, "shipping"),
    notes: readText(formData, "notes"),
    items: readItems(formData),
  });
  if (!parsed.success) return { status: "error", fieldErrors: toFieldErrors(parsed.error) };

  const client = await createSupabaseServerClient();

  const { data: order, error: orderError } = await client
    .from("orders")
    .insert({
      tenant_id: tenant.id,
      location_id: parsed.data.locationId,
      customer_id: parsed.data.customerId,
      source: parsed.data.source,
      shipping_cents: parsed.data.shipping,
      notes: parsed.data.notes,
    })
    .select("id")
    .single();

  if (orderError) {
    const described = describeDatabaseError(orderError);
    if (described !== null) return described;
    // 23505 is the per-tenant number racing another cashier. The row is not
    // written, so retrying is safe and invisible.
    if (orderError.code === "23505") {
      return { status: "error", message: "Otro pedido se creo al mismo tiempo. Intenta de nuevo." };
    }
    logger.error("orders.create_failed", { tenantId: tenant.id, error: orderError });
    throw new DatabaseError("Order creation failed.", { cause: orderError });
  }

  const { error: itemsError } = await client
    .from("order_items")
    .insert(parsed.data.items.map((item, index) => toItemRow(order.id, item, index)));

  if (itemsError) {
    // The order exists and the lines did not go in. It stays in `pending` with
    // no lines, which is a state the machine already refuses to advance - so
    // the failure is visible rather than silently half-applied.
    const described = describeDatabaseError(itemsError);
    logger.error("orders.create_items_failed", { tenantId: tenant.id, error: itemsError });
    if (described !== null) return described;
    throw new DatabaseError("Order lines failed.", { cause: itemsError });
  }

  logger.info("order.created", { tenantId: tenant.id, orderId: order.id });
  revalidateOrders(tenant.slug, order.id);
  return { status: "success", message: "Pedido creado." };
}

export async function addOrderItemAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireOrderAccess(formData, PERMISSIONS.ORDERS_UPDATE);

  const parsed = addOrderItemSchema.safeParse({
    orderId: readText(formData, "orderId"),
    productId: readText(formData, "productId"),
    variantId: readText(formData, "variantId"),
    quantity: readText(formData, "quantity"),
    discount: readText(formData, "discount"),
    notes: readText(formData, "notes"),
  });
  if (!parsed.success) return { status: "error", fieldErrors: toFieldErrors(parsed.error) };

  const client = await createSupabaseServerClient();
  const { error } = await client
    .from("order_items")
    .insert(toItemRow(parsed.data.orderId, parsed.data, 0));

  if (error) {
    const described = describeDatabaseError(error);
    if (described !== null) return described;
    logger.error("orders.item_add_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Order line creation failed.", { cause: error });
  }

  logger.info("order.item.added", { tenantId: tenant.id, orderId: parsed.data.orderId });
  revalidateOrders(tenant.slug, parsed.data.orderId);
  return { status: "success", message: "Producto anadido." };
}

export async function removeOrderItemAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireOrderAccess(formData, PERMISSIONS.ORDERS_UPDATE);

  const parsed = removeOrderItemSchema.safeParse({
    orderId: readText(formData, "orderId"),
    itemId: readText(formData, "itemId"),
  });
  if (!parsed.success) return { status: "error", message: "No se encontro esa linea." };

  const client = await createSupabaseServerClient();
  const { error } = await client
    .from("order_items")
    .delete()
    .eq("tenant_id", tenant.id)
    .eq("id", parsed.data.itemId);

  if (error) {
    const described = describeDatabaseError(error);
    if (described !== null) return described;
    logger.error("orders.item_remove_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Order line deletion failed.", { cause: error });
  }

  logger.info("order.item.removed", { tenantId: tenant.id, orderId: parsed.data.orderId });
  revalidateOrders(tenant.slug, parsed.data.orderId);
  return { status: "success", message: "Producto quitado." };
}

/**
 * Moves an order one step forward.
 *
 * The destination is validated against the enum here and against
 * `order_transitions` in the database. This layer cannot express "which step
 * comes next" — that is the machine's job, and duplicating it here is exactly
 * how a UI and a backend drift apart.
 */
export async function advanceOrderStatusAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireOrderAccess(formData, PERMISSIONS.ORDERS_UPDATE);

  const parsed = advanceOrderSchema.safeParse({
    orderId: readText(formData, "orderId"),
    toStatus: readText(formData, "toStatus"),
  });
  if (!parsed.success) return { status: "error", message: "Ese estado no existe." };

  const client = await createSupabaseServerClient();
  const { error } = await client
    .from("orders")
    .update({ status: parsed.data.toStatus })
    .eq("tenant_id", tenant.id)
    .eq("id", parsed.data.orderId);

  if (error) {
    const described = describeDatabaseError(error);
    if (described !== null) return described;
    logger.error("orders.advance_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Order status change failed.", { cause: error });
  }

  logger.info("order.status_changed", {
    tenantId: tenant.id,
    orderId: parsed.data.orderId,
    to: parsed.data.toStatus,
  });
  revalidateOrders(tenant.slug, parsed.data.orderId);
  return { status: "success", message: "Pedido actualizado." };
}

/**
 * Cancels an order.
 *
 * A separate action with a separate permission, and not a special case of
 * advancing. A cook holds `orders.update` and moves food along; voiding a sale
 * is a different decision, and `orders.cancel` is what says who may make it.
 */
export async function cancelOrderAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireOrderAccess(formData, PERMISSIONS.ORDERS_CANCEL);

  const parsed = cancelOrderSchema.safeParse({
    orderId: readText(formData, "orderId"),
    reason: readText(formData, "reason"),
  });
  if (!parsed.success) return { status: "error", fieldErrors: toFieldErrors(parsed.error) };

  const client = await createSupabaseServerClient();
  const { error } = await client
    .from("orders")
    .update({ status: "cancelled", cancel_reason: parsed.data.reason })
    .eq("tenant_id", tenant.id)
    .eq("id", parsed.data.orderId);

  if (error) {
    const described = describeDatabaseError(error);
    if (described !== null) return described;
    logger.error("orders.cancel_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Order cancellation failed.", { cause: error });
  }

  logger.info("order.cancelled", { tenantId: tenant.id, orderId: parsed.data.orderId });
  revalidateOrders(tenant.slug, parsed.data.orderId);
  return { status: "success", message: "Pedido anulado." };
}
