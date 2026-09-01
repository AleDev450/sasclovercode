"use server";

/**
 * Payments, cash registers, cash sessions and cash movements - Server Actions.
 *
 * Same posture as `orders/server/actions.ts`: every action does
 * `requirePermission` then a Zod parse then one write, and translates the
 * database's own refusal into a message a person can act on rather than
 * inventing a second copy of the rule to check client-side. The database
 * already enforces every invariant that matters (ADR-018); nothing here
 * re-derives one.
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
  closeCashSessionSchema,
  createCashRegisterSchema,
  createPaymentMethodSchema,
  openCashSessionSchema,
  recordCashMovementSchema,
  recordPaymentSchema,
  setCashRegisterActiveSchema,
  setPaymentMethodActiveSchema,
  updatePaymentMethodSchema,
  voidPaymentSchema,
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
 * The trigger messages (guard_payment, guard_payment_void, close_cash_session
 * and the tenant-derivation guards) are written for exactly this: they name
 * what went wrong, so the string is matched rather than replaced with
 * something generic.
 */
function describeDatabaseError(error: { code?: string; message: string }): FormState | null {
  if (error.code === "P0001") {
    if (error.message.includes("cancelled order")) {
      return { status: "error", message: "Ese pedido esta anulado y no puede recibir pagos." };
    }
    if (error.message.includes("overpaid")) {
      return {
        status: "error",
        fieldErrors: { amount: ["Ese monto deja el pedido sobrepagado."] },
      };
    }
    if (error.message.includes("already voided")) {
      return { status: "error", message: "Este pago ya estaba anulado." };
    }
    if (error.message.includes("Only voiding fields")) {
      return { status: "error", message: "Un pago solo se puede anular, no editar." };
    }
    if (error.message.includes("already closed")) {
      return { status: "error", message: "Esa sesion de caja ya esta cerrada." };
    }
    return { status: "error", message: "Esa operacion no esta permitida." };
  }

  if (error.code === "23514") {
    if (error.message.includes("requires a reason")) {
      return { status: "error", fieldErrors: { reason: ["Escribe por que se anula."] } };
    }
    if (error.message.includes("open cash session")) {
      return {
        status: "error",
        fieldErrors: { cashSessionId: ["Abre una sesion de caja primero."] },
      };
    }
    if (error.message.includes("Only a cash payment")) {
      return {
        status: "error",
        fieldErrors: { cashSessionId: ["Solo un pago en efectivo usa una sesion de caja."] },
      };
    }
    if (error.message.includes("payment method")) {
      return {
        status: "error",
        fieldErrors: { paymentMethodId: ["Ese metodo no esta disponible."] },
      };
    }
    if (error.message.includes("cash session") || error.message.includes("cash register")) {
      return {
        status: "error",
        fieldErrors: { cashSessionId: ["Esa sesion no esta disponible."] },
      };
    }
    if (error.message.includes("location")) {
      return { status: "error", fieldErrors: { locationId: ["Esa sede no esta disponible."] } };
    }
    if (error.message.includes("not active")) {
      return { status: "error", message: "Ese elemento esta desactivado." };
    }
  }

  if (error.code === "23505" && error.message.includes("cash_sessions_one_open_per_register")) {
    return { status: "error", message: "Esa caja ya tiene una sesion abierta." };
  }

  return null;
}

function revalidateCash(slug: string, orderId?: string): void {
  revalidatePath(`/dashboard/${slug}/caja`);
  revalidatePath(`/dashboard/${slug}/configuracion/pagos`);
  if (orderId !== undefined) revalidatePath(`/dashboard/${slug}/pedidos/${orderId}`);
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

export async function recordPaymentAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireAccess(formData, PERMISSIONS.PAYMENTS_CREATE);

  const parsed = recordPaymentSchema.safeParse({
    orderId: readText(formData, "orderId"),
    paymentMethodId: readText(formData, "paymentMethodId"),
    cashSessionId: readText(formData, "cashSessionId"),
    amount: readText(formData, "amount"),
    reference: readText(formData, "reference"),
    notes: readText(formData, "notes"),
  });
  if (!parsed.success) return { status: "error", fieldErrors: toFieldErrors(parsed.error) };

  const client = await createSupabaseServerClient();
  const { error } = await client.from("payments").insert({
    order_id: parsed.data.orderId,
    payment_method_id: parsed.data.paymentMethodId,
    cash_session_id: parsed.data.cashSessionId,
    amount_cents: parsed.data.amount,
    reference: parsed.data.reference,
    notes: parsed.data.notes,
  });

  if (error) {
    const described = describeDatabaseError(error);
    if (described !== null) return described;
    logger.error("payments.record_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Payment creation failed.", { cause: error });
  }

  logger.info("payment.recorded", { tenantId: tenant.id, orderId: parsed.data.orderId });
  revalidateCash(tenant.slug, parsed.data.orderId);
  return { status: "success", message: "Pago registrado." };
}

export async function voidPaymentAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireAccess(formData, PERMISSIONS.PAYMENTS_VOID);

  const parsed = voidPaymentSchema.safeParse({
    paymentId: readText(formData, "paymentId"),
    reason: readText(formData, "reason"),
  });
  if (!parsed.success) return { status: "error", fieldErrors: toFieldErrors(parsed.error) };

  const orderId = readText(formData, "orderId") || undefined;

  const client = await createSupabaseServerClient();
  const { error } = await client
    .from("payments")
    .update({ voided_at: new Date().toISOString(), void_reason: parsed.data.reason })
    .eq("tenant_id", tenant.id)
    .eq("id", parsed.data.paymentId);

  if (error) {
    const described = describeDatabaseError(error);
    if (described !== null) return described;
    logger.error("payments.void_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Payment void failed.", { cause: error });
  }

  logger.info("payment.voided", { tenantId: tenant.id, paymentId: parsed.data.paymentId });
  revalidateCash(tenant.slug, orderId);
  return { status: "success", message: "Pago anulado." };
}

// ---------------------------------------------------------------------------
// Payment methods
// ---------------------------------------------------------------------------

export async function createPaymentMethodAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireAccess(formData, PERMISSIONS.PAYMENT_METHODS_MANAGE);

  const parsed = createPaymentMethodSchema.safeParse({
    type: readText(formData, "type"),
    name: readText(formData, "name"),
    reference: readText(formData, "reference"),
  });
  if (!parsed.success) return { status: "error", fieldErrors: toFieldErrors(parsed.error) };

  const client = await createSupabaseServerClient();
  const { error } = await client.from("payment_methods").insert({
    tenant_id: tenant.id,
    type: parsed.data.type,
    name: parsed.data.name,
    reference: parsed.data.reference,
  });

  if (error) {
    if (error.code === "23505") {
      return { status: "error", fieldErrors: { name: ["Ya existe un metodo con ese nombre."] } };
    }
    logger.error("payment_methods.create_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Payment method creation failed.", { cause: error });
  }

  logger.info("payment_method.created", { tenantId: tenant.id });
  revalidateCash(tenant.slug);
  return { status: "success", message: "Metodo de pago creado." };
}

export async function updatePaymentMethodAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireAccess(formData, PERMISSIONS.PAYMENT_METHODS_MANAGE);

  const parsed = updatePaymentMethodSchema.safeParse({
    paymentMethodId: readText(formData, "paymentMethodId"),
    name: readText(formData, "name"),
    reference: readText(formData, "reference"),
  });
  if (!parsed.success) return { status: "error", fieldErrors: toFieldErrors(parsed.error) };

  const client = await createSupabaseServerClient();
  const { error } = await client
    .from("payment_methods")
    .update({ name: parsed.data.name, reference: parsed.data.reference })
    .eq("tenant_id", tenant.id)
    .eq("id", parsed.data.paymentMethodId);

  if (error) {
    if (error.code === "23505") {
      return { status: "error", fieldErrors: { name: ["Ya existe un metodo con ese nombre."] } };
    }
    logger.error("payment_methods.update_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Payment method update failed.", { cause: error });
  }

  logger.info("payment_method.updated", { tenantId: tenant.id });
  revalidateCash(tenant.slug);
  return { status: "success", message: "Metodo de pago actualizado." };
}

export async function setPaymentMethodActiveAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireAccess(formData, PERMISSIONS.PAYMENT_METHODS_MANAGE);

  const parsed = setPaymentMethodActiveSchema.safeParse({
    paymentMethodId: readText(formData, "paymentMethodId"),
    isActive: readText(formData, "isActive"),
  });
  if (!parsed.success) return { status: "error", message: "Solicitud invalida." };

  const client = await createSupabaseServerClient();
  const { error } = await client
    .from("payment_methods")
    .update({ is_active: parsed.data.isActive })
    .eq("tenant_id", tenant.id)
    .eq("id", parsed.data.paymentMethodId);

  if (error) {
    logger.error("payment_methods.set_active_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Payment method update failed.", { cause: error });
  }

  logger.info(parsed.data.isActive ? "payment_method.activated" : "payment_method.deactivated", {
    tenantId: tenant.id,
  });
  revalidateCash(tenant.slug);
  return {
    status: "success",
    message: parsed.data.isActive ? "Metodo activado." : "Metodo desactivado.",
  };
}

// ---------------------------------------------------------------------------
// Cash registers
// ---------------------------------------------------------------------------

export async function createCashRegisterAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireAccess(formData, PERMISSIONS.CASH_MANAGE);

  const parsed = createCashRegisterSchema.safeParse({
    locationId: readText(formData, "locationId"),
    name: readText(formData, "name"),
  });
  if (!parsed.success) return { status: "error", fieldErrors: toFieldErrors(parsed.error) };

  const client = await createSupabaseServerClient();
  const { error } = await client.from("cash_registers").insert({
    tenant_id: tenant.id,
    location_id: parsed.data.locationId,
    name: parsed.data.name,
  });

  if (error) {
    const described = describeDatabaseError(error);
    if (described !== null) return described;
    if (error.code === "23505") {
      return {
        status: "error",
        fieldErrors: { name: ["Ya existe una caja con ese nombre en esa sede."] },
      };
    }
    logger.error("cash_registers.create_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Cash register creation failed.", { cause: error });
  }

  logger.info("cash_register.created", { tenantId: tenant.id });
  revalidateCash(tenant.slug);
  return { status: "success", message: "Caja creada." };
}

export async function setCashRegisterActiveAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireAccess(formData, PERMISSIONS.CASH_MANAGE);

  const parsed = setCashRegisterActiveSchema.safeParse({
    cashRegisterId: readText(formData, "cashRegisterId"),
    isActive: readText(formData, "isActive"),
  });
  if (!parsed.success) return { status: "error", message: "Solicitud invalida." };

  const client = await createSupabaseServerClient();
  const { error } = await client
    .from("cash_registers")
    .update({ is_active: parsed.data.isActive })
    .eq("tenant_id", tenant.id)
    .eq("id", parsed.data.cashRegisterId);

  if (error) {
    logger.error("cash_registers.set_active_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Cash register update failed.", { cause: error });
  }

  logger.info(parsed.data.isActive ? "cash_register.activated" : "cash_register.deactivated", {
    tenantId: tenant.id,
  });
  revalidateCash(tenant.slug);
  return {
    status: "success",
    message: parsed.data.isActive ? "Caja activada." : "Caja desactivada.",
  };
}

// ---------------------------------------------------------------------------
// Cash sessions
// ---------------------------------------------------------------------------

export async function openCashSessionAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireAccess(formData, PERMISSIONS.CASH_OPEN);

  const parsed = openCashSessionSchema.safeParse({
    cashRegisterId: readText(formData, "cashRegisterId"),
    opening: readText(formData, "opening"),
    notes: readText(formData, "notes"),
  });
  if (!parsed.success) return { status: "error", fieldErrors: toFieldErrors(parsed.error) };

  const client = await createSupabaseServerClient();
  const { error } = await client.from("cash_sessions").insert({
    cash_register_id: parsed.data.cashRegisterId,
    opening_cents: parsed.data.opening,
    notes: parsed.data.notes,
  });

  if (error) {
    const described = describeDatabaseError(error);
    if (described !== null) return described;
    logger.error("cash_sessions.open_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Cash session open failed.", { cause: error });
  }

  logger.info("cash_session.opened", { tenantId: tenant.id });
  revalidateCash(tenant.slug);
  return { status: "success", message: "Caja abierta." };
}

export async function closeCashSessionAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireAccess(formData, PERMISSIONS.CASH_CLOSE);

  const parsed = closeCashSessionSchema.safeParse({
    cashSessionId: readText(formData, "cashSessionId"),
    closing: readText(formData, "closing"),
  });
  if (!parsed.success) return { status: "error", fieldErrors: toFieldErrors(parsed.error) };

  const client = await createSupabaseServerClient();
  const { error } = await client
    .from("cash_sessions")
    .update({ closing_cents: parsed.data.closing })
    .eq("tenant_id", tenant.id)
    .eq("id", parsed.data.cashSessionId);

  if (error) {
    const described = describeDatabaseError(error);
    if (described !== null) return described;
    logger.error("cash_sessions.close_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Cash session close failed.", { cause: error });
  }

  logger.info("cash_session.closed", { tenantId: tenant.id });
  revalidateCash(tenant.slug);
  return { status: "success", message: "Caja cerrada." };
}

// ---------------------------------------------------------------------------
// Cash movements (manual: payout / deposit / adjustment)
// ---------------------------------------------------------------------------

export async function recordCashMovementAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireAccess(formData, PERMISSIONS.CASH_MANAGE);

  const parsed = recordCashMovementSchema.safeParse({
    cashSessionId: readText(formData, "cashSessionId"),
    type: readText(formData, "type"),
    amount: readText(formData, "amount"),
    reason: readText(formData, "reason"),
  });
  if (!parsed.success) return { status: "error", fieldErrors: toFieldErrors(parsed.error) };

  // `payout` and `deposit` have exactly one legal sign; what the cashier typed
  // (`signedMoneyField`) only matters for `adjustment`, so it is normalised
  // here rather than trusted, the same way the amount itself is still checked
  // by `cash_movements_sign_by_type` in the database.
  const amountCents =
    parsed.data.type === "payout"
      ? -Math.abs(parsed.data.amount)
      : parsed.data.type === "deposit"
        ? Math.abs(parsed.data.amount)
        : parsed.data.amount;

  const client = await createSupabaseServerClient();
  const { error } = await client.from("cash_movements").insert({
    cash_session_id: parsed.data.cashSessionId,
    type: parsed.data.type,
    amount_cents: amountCents,
    reason: parsed.data.reason,
  });

  if (error) {
    const described = describeDatabaseError(error);
    if (described !== null) return described;
    logger.error("cash_movements.record_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Cash movement creation failed.", { cause: error });
  }

  logger.info("cash_movement.recorded", { tenantId: tenant.id, type: parsed.data.type });
  revalidateCash(tenant.slug);
  return { status: "success", message: "Movimiento registrado." };
}
