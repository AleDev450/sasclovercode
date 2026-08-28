"use server";

/**
 * Delivery zones, rates, and the delivery of an order - Server Actions.
 *
 * Same posture as every other module: `requirePermission`, a Zod parse, one
 * write, and the database's own refusal translated into a message a person can
 * act on. Every invariant that matters - the cross-tenant guards, the state
 * machine, `orders.shipping_cents` and `total_cents` - is enforced by the
 * migrations (ADR-023); nothing here re-derives one.
 *
 * The single exception, and it is deliberate: `attachDeliveryAction` RESOLVES
 * which rate applies before writing, because that depends on the order's branch
 * and its subtotal. ADR-023 decision 3 explains why that rule lives in the
 * application rather than in a trigger. The database still refuses a zone
 * belonging to another business, which is the part the application cannot
 * guarantee.
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
import { feeForSubtotal, resolveRate, type RateCandidate } from "../rates";
import {
  advanceDeliveryStatusSchema,
  assignCourierSchema,
  attachDeliverySchema,
  closeDeliverySchema,
  createDeliveryZoneSchema,
  deleteDeliveryRateSchema,
  deleteDeliveryZoneSchema,
  detachDeliverySchema,
  saveDeliveryRateSchema,
  setDeliveryZoneActiveSchema,
  updateDeliveryAddressSchema,
  updateDeliveryFeeSchema,
  updateDeliveryZoneSchema,
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
 * The trigger messages are written for exactly this: they name what went wrong,
 * so the string is matched rather than replaced with something generic.
 */
function describeDatabaseError(error: { code?: string; message: string }): FormState | null {
  if (error.code === "P0002") {
    if (error.message.includes("Delivery zone not found")) {
      return { status: "error", message: "Esa zona no existe." };
    }
    if (error.message.includes("Order not found")) {
      return { status: "error", message: "Ese pedido no existe." };
    }
    return { status: "error", message: "Ese registro no existe." };
  }

  if (error.code === "P0001") {
    if (error.message.includes("cannot take a delivery")) {
      return {
        status: "error",
        message: "Solo se puede adjuntar una entrega mientras el pedido esta pendiente.",
      };
    }
    if (error.message.includes("cannot change its delivery cost")) {
      return {
        status: "error",
        message: "El costo del envio ya no se puede cambiar: el pedido dejo de estar pendiente.",
      };
    }
    if (error.message.includes("cannot drop its delivery")) {
      return {
        status: "error",
        message: "Solo se puede retirar la entrega mientras el pedido esta pendiente.",
      };
    }
    if (error.message.includes("cannot go from")) {
      return { status: "error", message: "Ese cambio de estado no esta permitido." };
    }
    return { status: "error", message: "Esa operacion no esta permitida." };
  }

  if (error.code === "23514") {
    if (error.message.includes("delivery zone belongs to a different business")) {
      return { status: "error", message: "Esa zona no pertenece a este negocio." };
    }
    if (error.message.includes("location belongs to a different business")) {
      return { status: "error", message: "Esa sede no pertenece a este negocio." };
    }
    if (error.message.includes("courier is not an active member")) {
      return { status: "error", message: "Esa persona no es miembro activo de este negocio." };
    }
    if (error.message.includes("requires a reason")) {
      return { status: "error", fieldErrors: { failureReason: ["Escribe un motivo."] } };
    }
    if (error.message.includes("coordinates_together")) {
      return { status: "error", message: "Escribe las dos coordenadas o ninguna." };
    }
    return { status: "error", message: "Esa operacion no esta permitida." };
  }

  if (error.code === "23505") {
    if (error.message.includes("delivery_zones_tenant_name_key")) {
      return { status: "error", fieldErrors: { name: ["Ya tienes una zona con ese nombre."] } };
    }
    if (error.message.includes("order_deliveries_order_id_key")) {
      return { status: "error", message: "Ese pedido ya tiene una entrega." };
    }
    if (
      error.message.includes("delivery_rates_zone_location_key") ||
      error.message.includes("delivery_rates_zone_default_key")
    ) {
      return { status: "error", message: "Ya existe una tarifa para esa zona y esa sede." };
    }
    return { status: "error", message: "Ese registro ya existe." };
  }

  return null;
}

function revalidateConfig(slug: string): void {
  revalidatePath(`/dashboard/${slug}/configuracion/delivery`);
}

function revalidateBoard(slug: string, orderId?: string): void {
  revalidatePath(`/dashboard/${slug}/delivery`);
  revalidatePath(`/dashboard/${slug}/pedidos`);
  if (orderId !== undefined) revalidatePath(`/dashboard/${slug}/pedidos/${orderId}`);
}

// ---------------------------------------------------------------------------
// Zones
// ---------------------------------------------------------------------------

export async function createDeliveryZoneAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireAccess(formData, PERMISSIONS.DELIVERY_ZONES_MANAGE);

  const parsed = createDeliveryZoneSchema.safeParse({
    name: readText(formData, "name"),
    district: readText(formData, "district"),
    notes: readText(formData, "notes"),
  });
  if (!parsed.success) return { status: "error", fieldErrors: toFieldErrors(parsed.error) };

  const client = await createSupabaseServerClient();
  const { error } = await client.from("delivery_zones").insert({
    tenant_id: tenant.id,
    name: parsed.data.name,
    district: parsed.data.district,
    notes: parsed.data.notes,
  });

  if (error) {
    const described = describeDatabaseError(error);
    if (described !== null) return described;
    logger.error("delivery.create_zone_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Delivery zone creation failed.", { cause: error });
  }

  logger.info("delivery_zone.created", { tenantId: tenant.id });
  revalidateConfig(tenant.slug);
  return { status: "success", message: "Zona creada." };
}

export async function updateDeliveryZoneAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireAccess(formData, PERMISSIONS.DELIVERY_ZONES_MANAGE);

  const parsed = updateDeliveryZoneSchema.safeParse({
    zoneId: readText(formData, "zoneId"),
    name: readText(formData, "name"),
    district: readText(formData, "district"),
    notes: readText(formData, "notes"),
  });
  if (!parsed.success) return { status: "error", fieldErrors: toFieldErrors(parsed.error) };

  const client = await createSupabaseServerClient();
  const { error } = await client
    .from("delivery_zones")
    .update({
      name: parsed.data.name,
      district: parsed.data.district,
      notes: parsed.data.notes,
    })
    .eq("tenant_id", tenant.id)
    .eq("id", parsed.data.zoneId);

  if (error) {
    const described = describeDatabaseError(error);
    if (described !== null) return described;
    logger.error("delivery.update_zone_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Delivery zone update failed.", { cause: error });
  }

  logger.info("delivery_zone.updated", { tenantId: tenant.id });
  revalidateConfig(tenant.slug);
  return { status: "success", message: "Zona actualizada." };
}

export async function setDeliveryZoneActiveAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireAccess(formData, PERMISSIONS.DELIVERY_ZONES_MANAGE);

  const parsed = setDeliveryZoneActiveSchema.safeParse({
    zoneId: readText(formData, "zoneId"),
    isActive: readText(formData, "isActive"),
  });
  if (!parsed.success) return { status: "error", message: "Solicitud invalida." };

  const client = await createSupabaseServerClient();
  const { error } = await client
    .from("delivery_zones")
    .update({ is_active: parsed.data.isActive })
    .eq("tenant_id", tenant.id)
    .eq("id", parsed.data.zoneId);

  if (error) {
    logger.error("delivery.set_zone_active_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Delivery zone update failed.", { cause: error });
  }

  logger.info(parsed.data.isActive ? "delivery_zone.activated" : "delivery_zone.deactivated", {
    tenantId: tenant.id,
  });
  revalidateConfig(tenant.slug);
  return {
    status: "success",
    message: parsed.data.isActive ? "Zona activada." : "Zona desactivada.",
  };
}

export async function deleteDeliveryZoneAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireAccess(formData, PERMISSIONS.DELIVERY_ZONES_MANAGE);

  const parsed = deleteDeliveryZoneSchema.safeParse({ zoneId: readText(formData, "zoneId") });
  if (!parsed.success) return { status: "error", message: "Solicitud invalida." };

  const client = await createSupabaseServerClient();
  const { error } = await client
    .from("delivery_zones")
    .delete()
    .eq("tenant_id", tenant.id)
    .eq("id", parsed.data.zoneId);

  if (error) {
    const described = describeDatabaseError(error);
    if (described !== null) return described;
    logger.error("delivery.delete_zone_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Delivery zone deletion failed.", { cause: error });
  }

  logger.info("delivery_zone.deleted", { tenantId: tenant.id });
  revalidateConfig(tenant.slug);
  return { status: "success", message: "Zona eliminada." };
}

// ---------------------------------------------------------------------------
// Rates
// ---------------------------------------------------------------------------

export async function saveDeliveryRateAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireAccess(formData, PERMISSIONS.DELIVERY_ZONES_MANAGE);

  const parsed = saveDeliveryRateSchema.safeParse({
    zoneId: readText(formData, "zoneId"),
    locationId: readText(formData, "locationId"),
    feeCents: readText(formData, "feeCents"),
    minOrderFreeCents: readText(formData, "minOrderFreeCents"),
    estimatedMinutes: readText(formData, "estimatedMinutes"),
  });
  if (!parsed.success) return { status: "error", fieldErrors: toFieldErrors(parsed.error) };

  const client = await createSupabaseServerClient();

  const values = {
    fee_cents: parsed.data.feeCents,
    min_order_free_cents: parsed.data.minOrderFreeCents,
    estimated_minutes: parsed.data.estimatedMinutes,
  };

  // Upsert by hand rather than with `onConflict`: the uniqueness lives in two
  // PARTIAL indexes (one per branch, one for the zone default), and PostgREST's
  // conflict target cannot name a partial index. Two statements instead of one
  // is the honest cost of the constraint being expressed correctly.
  //
  // The two branches differ only in how "the existing row" is matched, because
  // `location_id = NULL` is never true in SQL - the default rate has to be
  // found with IS NULL.
  const lookup = client
    .from("delivery_rates")
    .select("id")
    .eq("tenant_id", tenant.id)
    .eq("zone_id", parsed.data.zoneId);

  const { data: existing, error: lookupError } = await (
    parsed.data.locationId === null
      ? lookup.is("location_id", null)
      : lookup.eq("location_id", parsed.data.locationId)
  ).maybeSingle();

  if (lookupError) {
    logger.error("delivery.save_rate_lookup_failed", { tenantId: tenant.id, error: lookupError });
    throw new DatabaseError("Delivery rate lookup failed.", { cause: lookupError });
  }

  const { error } =
    existing === null
      ? await client.from("delivery_rates").insert({
          zone_id: parsed.data.zoneId,
          location_id: parsed.data.locationId,
          ...values,
        })
      : await client
          .from("delivery_rates")
          .update(values)
          .eq("tenant_id", tenant.id)
          .eq("id", existing.id);

  if (error) {
    const described = describeDatabaseError(error);
    if (described !== null) return described;
    logger.error("delivery.save_rate_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Delivery rate save failed.", { cause: error });
  }

  logger.info("delivery_rate.saved", { tenantId: tenant.id });
  revalidateConfig(tenant.slug);
  return { status: "success", message: "Tarifa guardada." };
}

export async function deleteDeliveryRateAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireAccess(formData, PERMISSIONS.DELIVERY_ZONES_MANAGE);

  const parsed = deleteDeliveryRateSchema.safeParse({ rateId: readText(formData, "rateId") });
  if (!parsed.success) return { status: "error", message: "Solicitud invalida." };

  const client = await createSupabaseServerClient();
  const { error } = await client
    .from("delivery_rates")
    .delete()
    .eq("tenant_id", tenant.id)
    .eq("id", parsed.data.rateId);

  if (error) {
    logger.error("delivery.delete_rate_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Delivery rate deletion failed.", { cause: error });
  }

  logger.info("delivery_rate.deleted", { tenantId: tenant.id });
  revalidateConfig(tenant.slug);
  return { status: "success", message: "Tarifa eliminada." };
}

// ---------------------------------------------------------------------------
// The delivery of an order
// ---------------------------------------------------------------------------

export async function attachDeliveryAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireAccess(formData, PERMISSIONS.DELIVERIES_MANAGE);

  const parsed = attachDeliverySchema.safeParse({
    orderId: readText(formData, "orderId"),
    zoneId: readText(formData, "zoneId"),
    addressLine: readText(formData, "addressLine"),
    district: readText(formData, "district"),
    city: readText(formData, "city"),
    reference: readText(formData, "reference"),
    recipientName: readText(formData, "recipientName"),
    recipientPhone: readText(formData, "recipientPhone"),
    notes: readText(formData, "notes"),
    latitude: readText(formData, "latitude"),
    longitude: readText(formData, "longitude"),
  });
  if (!parsed.success) return { status: "error", fieldErrors: toFieldErrors(parsed.error) };

  const client = await createSupabaseServerClient();

  const { data: order, error: orderError } = await client
    .from("orders")
    .select("id, location_id, subtotal_cents, discount_cents")
    .eq("tenant_id", tenant.id)
    .eq("id", parsed.data.orderId)
    .maybeSingle();

  if (orderError) {
    logger.error("delivery.attach_order_lookup_failed", { tenantId: tenant.id, error: orderError });
    throw new DatabaseError("Order lookup failed.", { cause: orderError });
  }
  if (order === null) return { status: "error", message: "Ese pedido no existe." };

  const { data: zone, error: zoneError } = await client
    .from("delivery_zones")
    .select("id, name, is_active")
    .eq("tenant_id", tenant.id)
    .eq("id", parsed.data.zoneId)
    .maybeSingle();

  if (zoneError) {
    logger.error("delivery.attach_zone_lookup_failed", { tenantId: tenant.id, error: zoneError });
    throw new DatabaseError("Delivery zone lookup failed.", { cause: zoneError });
  }
  if (zone === null) return { status: "error", fieldErrors: { zoneId: ["Esa zona no existe."] } };
  if (!zone.is_active) {
    return { status: "error", fieldErrors: { zoneId: ["Esa zona esta desactivada."] } };
  }

  const { data: rateRows, error: rateError } = await client
    .from("delivery_rates")
    .select(
      "id, zone_id, location_id, fee_cents, min_order_free_cents, estimated_minutes, is_active",
    )
    .eq("tenant_id", tenant.id)
    .eq("zone_id", parsed.data.zoneId);

  if (rateError) {
    logger.error("delivery.attach_rate_lookup_failed", { tenantId: tenant.id, error: rateError });
    throw new DatabaseError("Delivery rate lookup failed.", { cause: rateError });
  }

  const candidates: RateCandidate[] = (rateRows ?? []).map((row) => ({
    id: row.id,
    zoneId: row.zone_id,
    locationId: row.location_id,
    feeCents: row.fee_cents,
    minOrderFreeCents: row.min_order_free_cents,
    estimatedMinutes: row.estimated_minutes,
    isActive: row.is_active,
  }));

  const rate = resolveRate(candidates, {
    zoneId: parsed.data.zoneId,
    locationId: order.location_id,
  });

  if (rate === null) {
    return {
      status: "error",
      fieldErrors: { zoneId: ["Esa zona no tiene una tarifa activa para la sede del pedido."] },
    };
  }

  // The free-delivery threshold is compared against what the customer actually
  // pays for the goods, so a discount counts toward it. Comparing against the
  // gross subtotal would promise "free from S/ 50" and then charge somebody who
  // paid exactly that.
  const goodsCents = order.subtotal_cents - order.discount_cents;

  const { error } = await client.from("order_deliveries").insert({
    order_id: parsed.data.orderId,
    zone_id: parsed.data.zoneId,
    zone_name_snapshot: zone.name,
    fee_cents: feeForSubtotal(rate, goodsCents),
    address_line: parsed.data.addressLine,
    district: parsed.data.district,
    city: parsed.data.city,
    reference: parsed.data.reference,
    latitude: parsed.data.latitude,
    longitude: parsed.data.longitude,
    recipient_name: parsed.data.recipientName,
    recipient_phone: parsed.data.recipientPhone,
    notes: parsed.data.notes,
  });

  if (error) {
    const described = describeDatabaseError(error);
    if (described !== null) return described;
    logger.error("delivery.attach_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Delivery attach failed.", { cause: error });
  }

  logger.info("delivery.attached", { tenantId: tenant.id, orderId: parsed.data.orderId });
  revalidateBoard(tenant.slug, parsed.data.orderId);
  return { status: "success", message: "Entrega adjuntada." };
}

export async function updateDeliveryAddressAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireAccess(formData, PERMISSIONS.DELIVERIES_MANAGE);

  const parsed = updateDeliveryAddressSchema.safeParse({
    deliveryId: readText(formData, "deliveryId"),
    addressLine: readText(formData, "addressLine"),
    district: readText(formData, "district"),
    city: readText(formData, "city"),
    reference: readText(formData, "reference"),
    recipientName: readText(formData, "recipientName"),
    recipientPhone: readText(formData, "recipientPhone"),
    notes: readText(formData, "notes"),
    latitude: readText(formData, "latitude"),
    longitude: readText(formData, "longitude"),
  });
  if (!parsed.success) return { status: "error", fieldErrors: toFieldErrors(parsed.error) };

  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .from("order_deliveries")
    .update({
      address_line: parsed.data.addressLine,
      district: parsed.data.district,
      city: parsed.data.city,
      reference: parsed.data.reference,
      latitude: parsed.data.latitude,
      longitude: parsed.data.longitude,
      recipient_name: parsed.data.recipientName,
      recipient_phone: parsed.data.recipientPhone,
      notes: parsed.data.notes,
    })
    .eq("tenant_id", tenant.id)
    .eq("id", parsed.data.deliveryId)
    .select("order_id")
    .maybeSingle();

  if (error) {
    const described = describeDatabaseError(error);
    if (described !== null) return described;
    logger.error("delivery.update_address_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Delivery update failed.", { cause: error });
  }

  logger.info("delivery.address_updated", {
    tenantId: tenant.id,
    deliveryId: parsed.data.deliveryId,
  });
  revalidateBoard(tenant.slug, data?.order_id);
  return { status: "success", message: "Direccion actualizada." };
}

export async function updateDeliveryFeeAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireAccess(formData, PERMISSIONS.DELIVERIES_MANAGE);

  const parsed = updateDeliveryFeeSchema.safeParse({
    deliveryId: readText(formData, "deliveryId"),
    feeCents: readText(formData, "feeCents"),
  });
  if (!parsed.success) return { status: "error", fieldErrors: toFieldErrors(parsed.error) };

  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .from("order_deliveries")
    .update({ fee_cents: parsed.data.feeCents })
    .eq("tenant_id", tenant.id)
    .eq("id", parsed.data.deliveryId)
    .select("order_id")
    .maybeSingle();

  if (error) {
    const described = describeDatabaseError(error);
    if (described !== null) return described;
    logger.error("delivery.update_fee_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Delivery fee update failed.", { cause: error });
  }

  logger.info("delivery.fee_updated", { tenantId: tenant.id, deliveryId: parsed.data.deliveryId });
  revalidateBoard(tenant.slug, data?.order_id);
  return { status: "success", message: "Costo actualizado." };
}

export async function assignCourierAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireAccess(formData, PERMISSIONS.DELIVERIES_MANAGE);

  const parsed = assignCourierSchema.safeParse({
    deliveryId: readText(formData, "deliveryId"),
    courierUserId: readText(formData, "courierUserId"),
  });
  if (!parsed.success) return { status: "error", message: "Solicitud invalida." };

  const client = await createSupabaseServerClient();

  const { data: current, error: lookupError } = await client
    .from("order_deliveries")
    .select("id, status")
    .eq("tenant_id", tenant.id)
    .eq("id", parsed.data.deliveryId)
    .maybeSingle();

  if (lookupError) {
    logger.error("delivery.assign_lookup_failed", { tenantId: tenant.id, error: lookupError });
    throw new DatabaseError("Delivery lookup failed.", { cause: lookupError });
  }
  if (current === null) return { status: "error", message: "Esa entrega no existe." };

  // Naming a courier on an unassigned delivery IS the assignment (FR-1919).
  // Naming a different one on a delivery already under way is a reassignment,
  // which leaves the state alone: the parcel did not go back to the shop.
  const nextStatus =
    current.status === "pending" || current.status === "failed" ? "assigned" : current.status;

  const { data, error } = await client
    .from("order_deliveries")
    .update({ courier_user_id: parsed.data.courierUserId, status: nextStatus })
    .eq("tenant_id", tenant.id)
    .eq("id", parsed.data.deliveryId)
    .select("order_id")
    .maybeSingle();

  if (error) {
    const described = describeDatabaseError(error);
    if (described !== null) return described;
    logger.error("delivery.assign_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Courier assignment failed.", { cause: error });
  }

  logger.info("delivery.courier_assigned", {
    tenantId: tenant.id,
    deliveryId: parsed.data.deliveryId,
  });
  revalidateBoard(tenant.slug, data?.order_id);
  return { status: "success", message: "Repartidor asignado." };
}

export async function advanceDeliveryStatusAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireAccess(formData, PERMISSIONS.DELIVERIES_MANAGE);

  const parsed = advanceDeliveryStatusSchema.safeParse({
    deliveryId: readText(formData, "deliveryId"),
    status: readText(formData, "status"),
  });
  if (!parsed.success) return { status: "error", message: "Solicitud invalida." };

  // Ending badly goes through `closeDeliveryAction`, which demands a reason.
  // Refusing it here keeps the two paths from disagreeing about that rule.
  if (parsed.data.status === "failed" || parsed.data.status === "cancelled") {
    return { status: "error", message: "Ese cambio necesita un motivo." };
  }

  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .from("order_deliveries")
    .update({ status: parsed.data.status })
    .eq("tenant_id", tenant.id)
    .eq("id", parsed.data.deliveryId)
    .select("order_id")
    .maybeSingle();

  if (error) {
    const described = describeDatabaseError(error);
    if (described !== null) return described;
    logger.error("delivery.advance_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Delivery status change failed.", { cause: error });
  }

  logger.info("delivery.status_changed", {
    tenantId: tenant.id,
    deliveryId: parsed.data.deliveryId,
    status: parsed.data.status,
  });
  revalidateBoard(tenant.slug, data?.order_id);
  return { status: "success", message: "Entrega actualizada." };
}

export async function closeDeliveryAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireAccess(formData, PERMISSIONS.DELIVERIES_MANAGE);

  const parsed = closeDeliverySchema.safeParse({
    deliveryId: readText(formData, "deliveryId"),
    status: readText(formData, "status"),
    failureReason: readText(formData, "failureReason"),
  });
  if (!parsed.success) return { status: "error", fieldErrors: toFieldErrors(parsed.error) };

  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .from("order_deliveries")
    .update({ status: parsed.data.status, failure_reason: parsed.data.failureReason })
    .eq("tenant_id", tenant.id)
    .eq("id", parsed.data.deliveryId)
    .select("order_id")
    .maybeSingle();

  if (error) {
    const described = describeDatabaseError(error);
    if (described !== null) return described;
    logger.error("delivery.close_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Delivery close failed.", { cause: error });
  }

  logger.info(parsed.data.status === "failed" ? "delivery.failed" : "delivery.status_changed", {
    tenantId: tenant.id,
    deliveryId: parsed.data.deliveryId,
    status: parsed.data.status,
  });
  revalidateBoard(tenant.slug, data?.order_id);
  return {
    status: "success",
    message: parsed.data.status === "failed" ? "Entrega marcada como fallida." : "Entrega anulada.",
  };
}

export async function detachDeliveryAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireAccess(formData, PERMISSIONS.DELIVERIES_MANAGE);

  const parsed = detachDeliverySchema.safeParse({ deliveryId: readText(formData, "deliveryId") });
  if (!parsed.success) return { status: "error", message: "Solicitud invalida." };

  const client = await createSupabaseServerClient();

  // Read the order first: the row is about to be gone, and the path to
  // revalidate is on it.
  const { data: existing } = await client
    .from("order_deliveries")
    .select("order_id")
    .eq("tenant_id", tenant.id)
    .eq("id", parsed.data.deliveryId)
    .maybeSingle();

  const { error } = await client
    .from("order_deliveries")
    .delete()
    .eq("tenant_id", tenant.id)
    .eq("id", parsed.data.deliveryId);

  if (error) {
    const described = describeDatabaseError(error);
    if (described !== null) return described;
    logger.error("delivery.detach_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Delivery detach failed.", { cause: error });
  }

  logger.info("delivery.detached", { tenantId: tenant.id, deliveryId: parsed.data.deliveryId });
  revalidateBoard(tenant.slug, existing?.order_id);
  return { status: "success", message: "Entrega retirada del pedido." };
}
