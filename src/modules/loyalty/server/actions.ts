"use server";

/**
 * Promotions, coupons, order discounts and points - Server Actions.
 *
 * Same posture as every other module: `requirePermission`, a Zod parse, one
 * write, and the database's own refusal translated into a message a person can
 * act on. Every invariant that matters - eligibility, the redemption counters,
 * `promotion_discount_cents`, `total_cents`, the points balance - is enforced
 * by the migrations (ADR-024); nothing here re-derives one.
 *
 * Two deliberate exceptions, both documented in ADR-024:
 *
 *   applying a promotion RESOLVES the discount here, because the amount
 *   depends on the type, the goods and the shipping, and that rule belongs
 *   somewhere a person can read it (decision 5);
 *
 *   redeeming points goes through an RPC, because it is two writes that must
 *   not be able to happen separately (decision 4).
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
import { discountFor, ineligibilityReason, INELIGIBILITY_LABELS } from "../promotions";
import type { PromotionRule } from "../promotions";
import {
  applyCouponSchema,
  applyPromotionSchema,
  createCouponSchema,
  createPromotionSchema,
  deleteCouponSchema,
  deletePromotionSchema,
  enrollCustomerSchema,
  loyaltySettingsSchema,
  recordLoyaltyAdjustmentSchema,
  redeemLoyaltyPointsSchema,
  removeOrderPromotionSchema,
  setCouponActiveSchema,
  setPromotionActiveSchema,
  updatePromotionSchema,
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
 * The trigger messages are written for exactly this: they name what went
 * wrong, so the string is matched rather than replaced with something generic.
 */
function describeDatabaseError(error: { code?: string; message: string }): FormState | null {
  if (error.code === "P0002") {
    if (error.message.includes("Promotion not found")) {
      return { status: "error", message: "Esa promocion no existe." };
    }
    if (error.message.includes("Coupon not found")) {
      return { status: "error", message: "Ese cupon no existe." };
    }
    if (error.message.includes("Loyalty account not found")) {
      return { status: "error", message: "Esa cuenta de puntos no existe." };
    }
    if (error.message.includes("Order not found")) {
      return { status: "error", message: "Ese pedido no existe." };
    }
    return { status: "error", message: "Ese registro no existe." };
  }

  if (error.code === "P0001") {
    if (error.message.includes("no longer pending")) {
      return {
        status: "error",
        message: "Solo se pueden cambiar los descuentos mientras el pedido esta pendiente.",
      };
    }
    if (error.message.includes("not active")) {
      return { status: "error", message: "Eso ya no esta activo." };
    }
    if (error.message.includes("has expired")) {
      return { status: "error", message: "Ese cupon ya caduco." };
    }
    if (error.message.includes("has not started")) {
      return { status: "error", message: "Esa promocion aun no empieza." };
    }
    if (error.message.includes("has ended")) {
      return { status: "error", message: "Esa promocion ya termino." };
    }
    if (error.message.includes("no redemptions left")) {
      return { status: "error", message: "Ya no quedan canjes disponibles." };
    }
    if (error.message.includes("does not reach the minimum")) {
      return { status: "error", message: "Este pedido no alcanza el minimo de la promocion." };
    }
    if (error.message.includes("larger than the order")) {
      return { status: "error", message: "Ese descuento es mayor que el pedido." };
    }
    if (error.message.includes("not have enough points")) {
      return { status: "error", fieldErrors: { points: ["No hay saldo suficiente."] } };
    }
    if (error.message.includes("not worth anything")) {
      return { status: "error", message: "Esos puntos no alcanzan para un descuento." };
    }
    return { status: "error", message: "Esa operacion no esta permitida." };
  }

  if (error.code === "23514") {
    if (error.message.includes("different business")) {
      return { status: "error", message: "Eso no pertenece a este negocio." };
    }
    if (error.message.includes("does not belong to that promotion")) {
      return { status: "error", message: "Ese cupon no corresponde a esa promocion." };
    }
    if (error.message.includes("points_balance")) {
      return { status: "error", message: "El saldo no puede quedar negativo." };
    }
    return { status: "error", message: "Esa operacion no esta permitida." };
  }

  if (error.code === "23505") {
    if (error.message.includes("promotions_tenant_name_key")) {
      return {
        status: "error",
        fieldErrors: { name: ["Ya tienes una promocion con ese nombre."] },
      };
    }
    if (error.message.includes("coupons_tenant_code_key")) {
      return { status: "error", fieldErrors: { code: ["Ya usas ese codigo."] } };
    }
    if (error.message.includes("order_promotions_order_promotion_key")) {
      return { status: "error", message: "Esa promocion ya esta aplicada a este pedido." };
    }
    if (error.message.includes("loyalty_accounts_customer_id_key")) {
      return { status: "error", message: "Ese cliente ya tiene cuenta de puntos." };
    }
    if (error.message.includes("loyalty_transactions_earn_per_order_key")) {
      return { status: "error", message: "Ese pedido ya acredito sus puntos." };
    }
    return { status: "error", message: "Ese registro ya existe." };
  }

  if (error.code === "42501") {
    return { status: "error", message: "No tienes permiso para hacer eso." };
  }

  return null;
}

function revalidatePromotions(slug: string): void {
  revalidatePath(`/dashboard/${slug}/promociones`);
}

function revalidateLoyalty(slug: string): void {
  revalidatePath(`/dashboard/${slug}/fidelizacion`);
}

function revalidateOrder(slug: string, orderId?: string): void {
  revalidatePath(`/dashboard/${slug}/pedidos`);
  if (orderId !== undefined) revalidatePath(`/dashboard/${slug}/pedidos/${orderId}`);
}

// ---------------------------------------------------------------------------
// Promotions
// ---------------------------------------------------------------------------

function promotionValues(data: {
  name: string;
  description: string | null;
  type: "percentage" | "fixed_amount" | "free_delivery";
  percentOff: number | null;
  amountOffCents: number | null;
  minOrderCents: number;
  startsAt: string | null;
  endsAt: string | null;
  maxRedemptions: number | null;
}) {
  return {
    name: data.name,
    description: data.description,
    type: data.type,
    percent_off: data.percentOff,
    amount_off_cents: data.amountOffCents,
    min_order_cents: data.minOrderCents,
    starts_at: data.startsAt,
    ends_at: data.endsAt,
    max_redemptions: data.maxRedemptions,
  };
}

function readPromotionForm(formData: FormData) {
  return {
    name: readText(formData, "name"),
    description: readText(formData, "description"),
    type: readText(formData, "type"),
    percentOff: readText(formData, "percentOff"),
    amountOffCents: readText(formData, "amountOffCents"),
    minOrderCents: readText(formData, "minOrderCents"),
    startsAt: readText(formData, "startsAt"),
    endsAt: readText(formData, "endsAt"),
    maxRedemptions: readText(formData, "maxRedemptions"),
  };
}

export async function createPromotionAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireAccess(formData, PERMISSIONS.PROMOTIONS_MANAGE);

  const parsed = createPromotionSchema.safeParse(readPromotionForm(formData));
  if (!parsed.success) return { status: "error", fieldErrors: toFieldErrors(parsed.error) };

  const client = await createSupabaseServerClient();
  const { error } = await client
    .from("promotions")
    .insert({ tenant_id: tenant.id, ...promotionValues(parsed.data) });

  if (error) {
    const described = describeDatabaseError(error);
    if (described !== null) return described;
    logger.error("loyalty.create_promotion_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Promotion creation failed.", { cause: error });
  }

  logger.info("promotion.created", { tenantId: tenant.id });
  revalidatePromotions(tenant.slug);
  return { status: "success", message: "Promocion creada." };
}

export async function updatePromotionAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireAccess(formData, PERMISSIONS.PROMOTIONS_MANAGE);

  const parsed = updatePromotionSchema.safeParse({
    ...readPromotionForm(formData),
    promotionId: readText(formData, "promotionId"),
  });
  if (!parsed.success) return { status: "error", fieldErrors: toFieldErrors(parsed.error) };

  const client = await createSupabaseServerClient();
  const { error } = await client
    .from("promotions")
    .update(promotionValues(parsed.data))
    .eq("tenant_id", tenant.id)
    .eq("id", parsed.data.promotionId);

  if (error) {
    const described = describeDatabaseError(error);
    if (described !== null) return described;
    logger.error("loyalty.update_promotion_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Promotion update failed.", { cause: error });
  }

  logger.info("promotion.updated", { tenantId: tenant.id });
  revalidatePromotions(tenant.slug);
  return { status: "success", message: "Promocion actualizada." };
}

export async function setPromotionActiveAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireAccess(formData, PERMISSIONS.PROMOTIONS_MANAGE);

  const parsed = setPromotionActiveSchema.safeParse({
    promotionId: readText(formData, "promotionId"),
    isActive: readText(formData, "isActive"),
  });
  if (!parsed.success) return { status: "error", message: "Solicitud invalida." };

  const client = await createSupabaseServerClient();
  const { error } = await client
    .from("promotions")
    .update({ is_active: parsed.data.isActive })
    .eq("tenant_id", tenant.id)
    .eq("id", parsed.data.promotionId);

  if (error) {
    logger.error("loyalty.set_promotion_active_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Promotion update failed.", { cause: error });
  }

  logger.info(parsed.data.isActive ? "promotion.activated" : "promotion.deactivated", {
    tenantId: tenant.id,
  });
  revalidatePromotions(tenant.slug);
  return {
    status: "success",
    message: parsed.data.isActive ? "Promocion activada." : "Promocion desactivada.",
  };
}

export async function deletePromotionAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireAccess(formData, PERMISSIONS.PROMOTIONS_MANAGE);

  const parsed = deletePromotionSchema.safeParse({
    promotionId: readText(formData, "promotionId"),
  });
  if (!parsed.success) return { status: "error", message: "Solicitud invalida." };

  const client = await createSupabaseServerClient();
  const { error } = await client
    .from("promotions")
    .delete()
    .eq("tenant_id", tenant.id)
    .eq("id", parsed.data.promotionId);

  if (error) {
    const described = describeDatabaseError(error);
    if (described !== null) return described;
    logger.error("loyalty.delete_promotion_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Promotion deletion failed.", { cause: error });
  }

  logger.info("promotion.deleted", { tenantId: tenant.id });
  revalidatePromotions(tenant.slug);
  return { status: "success", message: "Promocion eliminada." };
}

// ---------------------------------------------------------------------------
// Coupons
// ---------------------------------------------------------------------------

export async function createCouponAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireAccess(formData, PERMISSIONS.PROMOTIONS_MANAGE);

  const parsed = createCouponSchema.safeParse({
    promotionId: readText(formData, "promotionId"),
    code: readText(formData, "code"),
    maxRedemptions: readText(formData, "maxRedemptions"),
    expiresAt: readText(formData, "expiresAt"),
  });
  if (!parsed.success) return { status: "error", fieldErrors: toFieldErrors(parsed.error) };

  const client = await createSupabaseServerClient();
  const { error } = await client.from("coupons").insert({
    promotion_id: parsed.data.promotionId,
    code: parsed.data.code,
    max_redemptions: parsed.data.maxRedemptions,
    expires_at: parsed.data.expiresAt,
  });

  if (error) {
    const described = describeDatabaseError(error);
    if (described !== null) return described;
    logger.error("loyalty.create_coupon_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Coupon creation failed.", { cause: error });
  }

  logger.info("coupon.created", { tenantId: tenant.id });
  revalidatePromotions(tenant.slug);
  return { status: "success", message: "Cupon creado." };
}

export async function setCouponActiveAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireAccess(formData, PERMISSIONS.PROMOTIONS_MANAGE);

  const parsed = setCouponActiveSchema.safeParse({
    couponId: readText(formData, "couponId"),
    isActive: readText(formData, "isActive"),
  });
  if (!parsed.success) return { status: "error", message: "Solicitud invalida." };

  const client = await createSupabaseServerClient();
  const { error } = await client
    .from("coupons")
    .update({ is_active: parsed.data.isActive })
    .eq("tenant_id", tenant.id)
    .eq("id", parsed.data.couponId);

  if (error) {
    logger.error("loyalty.set_coupon_active_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Coupon update failed.", { cause: error });
  }

  logger.info(parsed.data.isActive ? "coupon.activated" : "coupon.deactivated", {
    tenantId: tenant.id,
  });
  revalidatePromotions(tenant.slug);
  return {
    status: "success",
    message: parsed.data.isActive ? "Cupon activado." : "Cupon desactivado.",
  };
}

export async function deleteCouponAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireAccess(formData, PERMISSIONS.PROMOTIONS_MANAGE);

  const parsed = deleteCouponSchema.safeParse({ couponId: readText(formData, "couponId") });
  if (!parsed.success) return { status: "error", message: "Solicitud invalida." };

  const client = await createSupabaseServerClient();
  const { error } = await client
    .from("coupons")
    .delete()
    .eq("tenant_id", tenant.id)
    .eq("id", parsed.data.couponId);

  if (error) {
    logger.error("loyalty.delete_coupon_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Coupon deletion failed.", { cause: error });
  }

  logger.info("coupon.deleted", { tenantId: tenant.id });
  revalidatePromotions(tenant.slug);
  return { status: "success", message: "Cupon eliminado." };
}

// ---------------------------------------------------------------------------
// Applying a discount
// ---------------------------------------------------------------------------

interface OrderBasis {
  readonly goodsCents: number;
  readonly shippingCents: number;
}

/**
 * What the discount is measured against.
 *
 * Goods come from the lines rather than from `orders.subtotal_cents`, because
 * that column is the GROSS of the lines while a discount is measured on what
 * is actually owed for them - the same number `guard_order_promotion()` uses,
 * so the preview and the refusal cannot disagree.
 */
async function readOrderBasis(
  client: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  tenantId: string,
  orderId: string,
): Promise<OrderBasis | null> {
  const { data: order, error } = await client
    .from("orders")
    .select("id, shipping_cents")
    .eq("tenant_id", tenantId)
    .eq("id", orderId)
    .maybeSingle();

  if (error) throw new DatabaseError("Order lookup failed.", { cause: error });
  if (order === null) return null;

  const { data: lines, error: lineError } = await client
    .from("order_items")
    .select("total_cents")
    .eq("tenant_id", tenantId)
    .eq("order_id", orderId);

  if (lineError) throw new DatabaseError("Order line lookup failed.", { cause: lineError });

  return {
    goodsCents: (lines ?? []).reduce((sum, line) => sum + line.total_cents, 0),
    shippingCents: order.shipping_cents,
  };
}

function toRule(row: {
  id: string;
  name: string;
  type: PromotionRule["type"];
  percent_off: number | null;
  amount_off_cents: number | null;
  min_order_cents: number;
  starts_at: string | null;
  ends_at: string | null;
  max_redemptions: number | null;
  times_redeemed: number;
  is_active: boolean;
}): PromotionRule {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    percentOff: row.percent_off,
    amountOffCents: row.amount_off_cents,
    minOrderCents: row.min_order_cents,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    maxRedemptions: row.max_redemptions,
    timesRedeemed: row.times_redeemed,
    isActive: row.is_active,
  };
}

const RULE_COLUMNS =
  "id, name, type, percent_off, amount_off_cents, min_order_cents, starts_at, ends_at, max_redemptions, times_redeemed, is_active";

export async function applyPromotionAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireAccess(formData, PERMISSIONS.PROMOTIONS_MANAGE);

  const parsed = applyPromotionSchema.safeParse({
    orderId: readText(formData, "orderId"),
    promotionId: readText(formData, "promotionId"),
  });
  if (!parsed.success) return { status: "error", message: "Solicitud invalida." };

  const client = await createSupabaseServerClient();

  const basis = await readOrderBasis(client, tenant.id, parsed.data.orderId);
  if (basis === null) return { status: "error", message: "Ese pedido no existe." };

  const { data: row, error: lookupError } = await client
    .from("promotions")
    .select(RULE_COLUMNS)
    .eq("tenant_id", tenant.id)
    .eq("id", parsed.data.promotionId)
    .maybeSingle();

  if (lookupError) {
    logger.error("loyalty.apply_lookup_failed", { tenantId: tenant.id, error: lookupError });
    throw new DatabaseError("Promotion lookup failed.", { cause: lookupError });
  }
  if (row === null) return { status: "error", message: "Esa promocion no existe." };

  const rule = toRule(row as unknown as Parameters<typeof toRule>[0]);

  // Checked here so the refusal is a sentence on the screen. The trigger checks
  // all of it again, because this answer can be stale by a page render.
  const reason = ineligibilityReason(rule, basis);
  if (reason !== null) return { status: "error", message: INELIGIBILITY_LABELS[reason] };

  const { error } = await client.from("order_promotions").insert({
    order_id: parsed.data.orderId,
    promotion_id: rule.id,
    source: "promotion",
    label_snapshot: rule.name,
    discount_cents: discountFor(rule, basis),
  });

  if (error) {
    const described = describeDatabaseError(error);
    if (described !== null) return described;
    logger.error("loyalty.apply_promotion_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Promotion application failed.", { cause: error });
  }

  logger.info("order.promotion_applied", { tenantId: tenant.id, orderId: parsed.data.orderId });
  revalidateOrder(tenant.slug, parsed.data.orderId);
  return { status: "success", message: "Descuento aplicado." };
}

export async function applyCouponAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireAccess(formData, PERMISSIONS.PROMOTIONS_MANAGE);

  const parsed = applyCouponSchema.safeParse({
    orderId: readText(formData, "orderId"),
    code: readText(formData, "code"),
  });
  if (!parsed.success) return { status: "error", fieldErrors: toFieldErrors(parsed.error) };

  const client = await createSupabaseServerClient();

  const basis = await readOrderBasis(client, tenant.id, parsed.data.orderId);
  if (basis === null) return { status: "error", message: "Ese pedido no existe." };

  const { data: coupon, error: couponError } = await client
    .from("coupons")
    .select("id, promotion_id, is_active, expires_at, max_redemptions, times_redeemed, code")
    .eq("tenant_id", tenant.id)
    .ilike("code", parsed.data.code)
    .maybeSingle();

  if (couponError) {
    logger.error("loyalty.coupon_lookup_failed", { tenantId: tenant.id, error: couponError });
    throw new DatabaseError("Coupon lookup failed.", { cause: couponError });
  }
  if (coupon === null) {
    return { status: "error", fieldErrors: { code: ["Ese cupon no existe."] } };
  }
  if (!coupon.is_active) {
    return { status: "error", fieldErrors: { code: ["Ese cupon esta desactivado."] } };
  }
  if (coupon.expires_at !== null && new Date(coupon.expires_at) <= new Date()) {
    return { status: "error", fieldErrors: { code: ["Ese cupon ya caduco."] } };
  }
  if (coupon.max_redemptions !== null && coupon.times_redeemed >= coupon.max_redemptions) {
    return { status: "error", fieldErrors: { code: ["Ese cupon agoto sus canjes."] } };
  }

  const { data: row, error: lookupError } = await client
    .from("promotions")
    .select(RULE_COLUMNS)
    .eq("tenant_id", tenant.id)
    .eq("id", coupon.promotion_id)
    .maybeSingle();

  if (lookupError) {
    logger.error("loyalty.apply_lookup_failed", { tenantId: tenant.id, error: lookupError });
    throw new DatabaseError("Promotion lookup failed.", { cause: lookupError });
  }
  if (row === null) return { status: "error", message: "Ese cupon no abre ninguna promocion." };

  const rule = toRule(row as unknown as Parameters<typeof toRule>[0]);

  const reason = ineligibilityReason(rule, basis);
  if (reason !== null) return { status: "error", message: INELIGIBILITY_LABELS[reason] };

  const { error } = await client.from("order_promotions").insert({
    order_id: parsed.data.orderId,
    promotion_id: rule.id,
    coupon_id: coupon.id,
    source: "coupon",
    label_snapshot: `${rule.name} (${coupon.code})`,
    discount_cents: discountFor(rule, basis),
  });

  if (error) {
    const described = describeDatabaseError(error);
    if (described !== null) return described;
    logger.error("loyalty.apply_coupon_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Coupon application failed.", { cause: error });
  }

  logger.info("order.promotion_applied", { tenantId: tenant.id, orderId: parsed.data.orderId });
  revalidateOrder(tenant.slug, parsed.data.orderId);
  return { status: "success", message: "Cupon aplicado." };
}

export async function removeOrderPromotionAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireAccess(formData, PERMISSIONS.PROMOTIONS_MANAGE);

  const parsed = removeOrderPromotionSchema.safeParse({
    orderPromotionId: readText(formData, "orderPromotionId"),
  });
  if (!parsed.success) return { status: "error", message: "Solicitud invalida." };

  const client = await createSupabaseServerClient();

  // Read the order first: the row is about to be gone, and the path to
  // revalidate is on it.
  const { data: existing } = await client
    .from("order_promotions")
    .select("order_id")
    .eq("tenant_id", tenant.id)
    .eq("id", parsed.data.orderPromotionId)
    .maybeSingle();

  const { error } = await client
    .from("order_promotions")
    .delete()
    .eq("tenant_id", tenant.id)
    .eq("id", parsed.data.orderPromotionId);

  if (error) {
    const described = describeDatabaseError(error);
    if (described !== null) return described;
    logger.error("loyalty.remove_discount_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Discount removal failed.", { cause: error });
  }

  logger.info("order.promotion_removed", { tenantId: tenant.id });
  revalidateOrder(tenant.slug, existing?.order_id);
  return { status: "success", message: "Descuento retirado." };
}

// ---------------------------------------------------------------------------
// Points
// ---------------------------------------------------------------------------

export async function enrollCustomerAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireAccess(formData, PERMISSIONS.LOYALTY_MANAGE);

  const parsed = enrollCustomerSchema.safeParse({ customerId: readText(formData, "customerId") });
  if (!parsed.success) return { status: "error", message: "Solicitud invalida." };

  const client = await createSupabaseServerClient();
  const { error } = await client
    .from("loyalty_accounts")
    .insert({ customer_id: parsed.data.customerId });

  if (error) {
    const described = describeDatabaseError(error);
    if (described !== null) return described;
    logger.error("loyalty.enroll_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Enrolment failed.", { cause: error });
  }

  logger.info("loyalty.account_enrolled", { tenantId: tenant.id });
  revalidateLoyalty(tenant.slug);
  return { status: "success", message: "Cliente inscrito." };
}

export async function recordLoyaltyAdjustmentAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireAccess(formData, PERMISSIONS.LOYALTY_MANAGE);

  const parsed = recordLoyaltyAdjustmentSchema.safeParse({
    accountId: readText(formData, "accountId"),
    type: readText(formData, "type"),
    points: readText(formData, "points"),
    reason: readText(formData, "reason"),
  });
  if (!parsed.success) return { status: "error", fieldErrors: toFieldErrors(parsed.error) };

  const client = await createSupabaseServerClient();
  const { error } = await client.from("loyalty_transactions").insert({
    account_id: parsed.data.accountId,
    type: parsed.data.type,
    points: parsed.data.points,
    reason: parsed.data.reason,
  });

  if (error) {
    const described = describeDatabaseError(error);
    if (described !== null) return described;
    logger.error("loyalty.adjustment_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Loyalty adjustment failed.", { cause: error });
  }

  logger.info("loyalty.points_adjusted", { tenantId: tenant.id });
  revalidateLoyalty(tenant.slug);
  return { status: "success", message: "Movimiento registrado." };
}

export async function redeemLoyaltyPointsAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireAccess(formData, PERMISSIONS.LOYALTY_MANAGE);

  const parsed = redeemLoyaltyPointsSchema.safeParse({
    orderId: readText(formData, "orderId"),
    accountId: readText(formData, "accountId"),
    points: readText(formData, "points"),
  });
  if (!parsed.success) return { status: "error", fieldErrors: toFieldErrors(parsed.error) };

  const client = await createSupabaseServerClient();

  // Through the RPC, not two inserts: the ledger entry and the discount must
  // both happen or neither (ADR-024 decision 4).
  const { error } = await client.rpc("redeem_loyalty_points", {
    p_order_id: parsed.data.orderId,
    p_account_id: parsed.data.accountId,
    p_points: parsed.data.points,
  });

  if (error) {
    const described = describeDatabaseError(error);
    if (described !== null) return described;
    logger.error("loyalty.redeem_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Point redemption failed.", { cause: error });
  }

  logger.info("loyalty.points_redeemed", { tenantId: tenant.id, orderId: parsed.data.orderId });
  revalidateOrder(tenant.slug, parsed.data.orderId);
  revalidateLoyalty(tenant.slug);
  return { status: "success", message: "Puntos canjeados." };
}

export async function updateLoyaltySettingsAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireAccess(formData, PERMISSIONS.SETTINGS_MANAGE);

  const parsed = loyaltySettingsSchema.safeParse({
    loyaltyEnabled: readText(formData, "loyaltyEnabled") || "false",
    pointsPerSol: readText(formData, "pointsPerSol"),
    pointValueCents: readText(formData, "pointValueCents"),
  });
  if (!parsed.success) return { status: "error", fieldErrors: toFieldErrors(parsed.error) };

  const client = await createSupabaseServerClient();
  const { error } = await client
    .from("tenant_settings")
    .update({
      loyalty_enabled: parsed.data.loyaltyEnabled,
      loyalty_points_per_sol: parsed.data.pointsPerSol,
      loyalty_point_value_cents: parsed.data.pointValueCents,
    })
    .eq("tenant_id", tenant.id);

  if (error) {
    logger.error("loyalty.settings_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Loyalty settings update failed.", { cause: error });
  }

  logger.info("loyalty.settings_updated", { tenantId: tenant.id });
  revalidatePath(`/dashboard/${tenant.slug}/configuracion`);
  revalidateLoyalty(tenant.slug);
  return { status: "success", message: "Programa de puntos actualizado." };
}
