"use server";

/**
 * Customer Server Actions.
 *
 * Governed by the `customers.*` permissions Phase 03 already put in the
 * catalogue: reading is `customers.view`, every write here is
 * `customers.manage`. Nothing new was invented for this phase.
 *
 * Same three layers as every write in the product: page guard,
 * explicit `requirePermission` here, RLS underneath.
 *
 * NOTE ON LOGGING: no log line in this file carries a document number, an
 * email, a phone or a name - only ids. A log is where personal data leaves
 * without anyone deciding it should: it gets copied to another system, kept
 * longer than the row, and read by people who do not hold `customers.view`.
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
  customerActiveSchema,
  customerAddressSchema,
  customerSchema,
  deleteAddressSchema,
} from "../schemas";

function readText(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

async function requireCustomerAccess(formData: FormData, permission: Permission) {
  const tenant = await requireActiveTenant(readText(formData, "tenantSlug"));
  await requirePermission(tenant.id, permission);
  return tenant;
}

/**
 * Turns a unique violation into a field message.
 *
 * Which index it was decides the message: "ya existe" without saying what is a
 * support ticket, and here the two candidates lead to different fixes - one
 * means "you already have this person", the other means "you typed someone
 * else's email".
 */
function describeConflict(message: string): FormState {
  if (message.includes("document")) {
    return {
      status: "error",
      fieldErrors: { docNumber: ["Ya tienes un cliente con ese documento."] },
    };
  }
  if (message.includes("email")) {
    return { status: "error", fieldErrors: { email: ["Ya tienes un cliente con ese correo."] } };
  }
  if (message.includes("default")) {
    return {
      status: "error",
      fieldErrors: { isDefault: ["Ya hay una direccion principal. Quita la otra primero."] },
    };
  }
  return { status: "error", message: "Ese valor ya existe." };
}

function revalidateCustomers(slug: string, customerId?: string): void {
  revalidatePath(`/dashboard/${slug}/clientes`);
  if (customerId !== undefined) revalidatePath(`/dashboard/${slug}/clientes/${customerId}`);
}

function readCustomerFields(formData: FormData) {
  return {
    name: readText(formData, "name"),
    docType: readText(formData, "docType"),
    docNumber: readText(formData, "docNumber"),
    email: readText(formData, "email"),
    phone: readText(formData, "phone"),
  };
}

export async function createCustomerAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireCustomerAccess(formData, PERMISSIONS.CUSTOMERS_MANAGE);

  const parsed = customerSchema.safeParse(readCustomerFields(formData));
  if (!parsed.success) return { status: "error", fieldErrors: toFieldErrors(parsed.error) };

  const client = await createSupabaseServerClient();
  const { error } = await client.from("customers").insert({
    tenant_id: tenant.id,
    name: parsed.data.name,
    doc_type: parsed.data.docType,
    doc_number: parsed.data.docNumber,
    email: parsed.data.email,
    phone: parsed.data.phone,
  });

  if (error) {
    if (error.code === "23505") return describeConflict(error.message);
    // The document CHECK raises 23514. Reaching it means this layer and the
    // database disagreed, which is worth a log even though the person just
    // needs to fix the number.
    if (error.code === "23514") {
      logger.warn("customers.document_rejected_by_db", { tenantId: tenant.id });
      return { status: "error", fieldErrors: { docNumber: ["Ese documento no es valido."] } };
    }
    logger.error("customers.create_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Customer creation failed.", { cause: error });
  }

  logger.info("customer.created", { tenantId: tenant.id });
  revalidateCustomers(tenant.slug);
  return { status: "success", message: "Cliente registrado." };
}

export async function updateCustomerAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireCustomerAccess(formData, PERMISSIONS.CUSTOMERS_MANAGE);

  const parsedId = z.uuid().safeParse(readText(formData, "customerId"));
  if (!parsedId.success) return { status: "error", message: "Cliente no encontrado." };

  const parsed = customerSchema.safeParse(readCustomerFields(formData));
  if (!parsed.success) return { status: "error", fieldErrors: toFieldErrors(parsed.error) };

  const client = await createSupabaseServerClient();
  const { error } = await client
    .from("customers")
    .update({
      name: parsed.data.name,
      doc_type: parsed.data.docType,
      doc_number: parsed.data.docNumber,
      email: parsed.data.email,
      phone: parsed.data.phone,
    })
    .eq("tenant_id", tenant.id)
    .eq("id", parsedId.data);

  if (error) {
    if (error.code === "23505") return describeConflict(error.message);
    if (error.code === "23514") {
      return { status: "error", fieldErrors: { docNumber: ["Ese documento no es valido."] } };
    }
    logger.error("customers.update_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Customer update failed.", { cause: error });
  }

  logger.info("customer.updated", { tenantId: tenant.id, customerId: parsedId.data });
  revalidateCustomers(tenant.slug, parsedId.data);
  return { status: "success", message: "Cliente guardado." };
}

/**
 * Deactivates or reactivates a customer.
 *
 * There is no delete, here or in the schema: from Phase 13 an order points at a
 * customer, and a business has to keep its sales records. `is_active = false`
 * says "we no longer deal with this person" without pretending they were never
 * a customer.
 */
export async function setCustomerActiveAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireCustomerAccess(formData, PERMISSIONS.CUSTOMERS_MANAGE);

  const parsed = customerActiveSchema.safeParse({
    customerId: readText(formData, "customerId"),
    isActive: readText(formData, "isActive"),
  });
  if (!parsed.success) return { status: "error", message: "Cliente no encontrado." };

  const client = await createSupabaseServerClient();
  const { error } = await client
    .from("customers")
    .update({ is_active: parsed.data.isActive })
    .eq("tenant_id", tenant.id)
    .eq("id", parsed.data.customerId);

  if (error) {
    logger.error("customers.set_active_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Customer status change failed.", { cause: error });
  }

  logger.info(parsed.data.isActive ? "customer.activated" : "customer.deactivated", {
    tenantId: tenant.id,
    customerId: parsed.data.customerId,
  });
  revalidateCustomers(tenant.slug, parsed.data.customerId);
  return {
    status: "success",
    message: parsed.data.isActive ? "Cliente activo otra vez." : "Cliente desactivado.",
  };
}

/**
 * Adds an address.
 *
 * Inserted WITHOUT `tenant_id`: the trigger derives it from the customer.
 * Sending our own would be harmless here and dangerous as a habit - it is
 * exactly the field an attacker would supply (the Phase 11 AB-1101 lesson).
 */
export async function addCustomerAddressAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireCustomerAccess(formData, PERMISSIONS.CUSTOMERS_MANAGE);

  const parsed = customerAddressSchema.safeParse({
    customerId: readText(formData, "customerId"),
    label: readText(formData, "label"),
    addressLine: readText(formData, "addressLine"),
    district: readText(formData, "district"),
    city: readText(formData, "city"),
    reference: readText(formData, "reference"),
    latitude: readText(formData, "latitude"),
    longitude: readText(formData, "longitude"),
    isDefault: readText(formData, "isDefault") || "false",
  });
  if (!parsed.success) return { status: "error", fieldErrors: toFieldErrors(parsed.error) };

  const client = await createSupabaseServerClient();
  const { error } = await client.from("customer_addresses").insert({
    customer_id: parsed.data.customerId,
    label: parsed.data.label,
    address_line: parsed.data.addressLine,
    district: parsed.data.district,
    city: parsed.data.city,
    reference: parsed.data.reference,
    latitude: parsed.data.latitude,
    longitude: parsed.data.longitude,
    is_default: parsed.data.isDefault,
  });

  if (error) {
    if (error.code === "23505") return describeConflict(error.message);
    // P0002 is the trigger refusing a customer that does not exist - or, more
    // usefully, one this caller cannot see because it belongs to another
    // business.
    if (error.code === "P0002") return { status: "error", message: "Cliente no encontrado." };
    logger.error("customers.address_add_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Address creation failed.", { cause: error });
  }

  logger.info("customer.address.added", {
    tenantId: tenant.id,
    customerId: parsed.data.customerId,
  });
  revalidateCustomers(tenant.slug, parsed.data.customerId);
  return { status: "success", message: "Direccion anadida." };
}

/**
 * Removes an address.
 *
 * An address IS deletable, unlike a customer: it is current contact
 * information, not history, and someone who moved does not want their old
 * address left in the list. The Phase 13 order will copy the delivery address
 * onto itself, so removing it here never changes where something was delivered.
 */
export async function deleteCustomerAddressAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireCustomerAccess(formData, PERMISSIONS.CUSTOMERS_MANAGE);

  const parsed = deleteAddressSchema.safeParse({
    customerId: readText(formData, "customerId"),
    addressId: readText(formData, "addressId"),
  });
  if (!parsed.success) return { status: "error", message: "No se encontro esa direccion." };

  const client = await createSupabaseServerClient();
  const { error } = await client
    .from("customer_addresses")
    .delete()
    .eq("tenant_id", tenant.id)
    .eq("id", parsed.data.addressId);

  if (error) {
    logger.error("customers.address_delete_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Address deletion failed.", { cause: error });
  }

  logger.info("customer.address.removed", {
    tenantId: tenant.id,
    customerId: parsed.data.customerId,
  });
  revalidateCustomers(tenant.slug, parsed.data.customerId);
  return { status: "success", message: "Direccion quitada." };
}
