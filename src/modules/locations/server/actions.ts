"use server";

/**
 * Location Server Actions.
 *
 * Same three layers as every other write in the product: the page guard, the
 * explicit `requirePermission` here, and RLS underneath. A Server Action is an
 * HTTP endpoint, so the page guard is never the check that matters.
 *
 * Two rules of this phase live in the database and are only REPORTED here:
 * a business cannot deactivate its last active branch, and two shifts cannot
 * overlap. Both are triggers, so they hold for a platform operator and a
 * migration too - this layer turns them into a sentence.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { DatabaseError } from "@/lib/errors";
import type { FormState } from "@/lib/forms/state";
import { logger } from "@/lib/logger";
import { PERMISSIONS } from "@/lib/permissions";
import { requirePermission } from "@/lib/permissions/check";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireActiveTenant } from "@/lib/tenant/active";
import { toFieldErrors } from "@/lib/validation";
import { locationHourSchema, locationSchema } from "../schemas";

function readText(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

async function requireLocationAccess(formData: FormData) {
  const tenant = await requireActiveTenant(readText(formData, "tenantSlug"));
  await requirePermission(tenant.id, PERMISSIONS.LOCATIONS_MANAGE);
  return tenant;
}

function readLocationFields(formData: FormData) {
  return {
    name: readText(formData, "name"),
    addressLine: readText(formData, "addressLine"),
    district: readText(formData, "district"),
    city: readText(formData, "city"),
    reference: readText(formData, "reference"),
    phone: readText(formData, "phone"),
    latitude: readText(formData, "latitude"),
    longitude: readText(formData, "longitude"),
  };
}

/** The columns, from validated input. Shared by create and update. */
function toRow(input: z.output<typeof locationSchema>) {
  return {
    name: input.name,
    address_line: input.addressLine,
    district: input.district,
    city: input.city,
    reference: input.reference,
    phone: input.phone,
    latitude: input.latitude,
    longitude: input.longitude,
  };
}

/** Turns a constraint violation into a field message. */
function describeWriteError(code: string | undefined): FormState | null {
  if (code === "23505") {
    return { status: "error", fieldErrors: { name: ["Ya tienes una sede con ese nombre."] } };
  }
  return null;
}

export async function createLocationAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireLocationAccess(formData);

  const parsed = locationSchema.safeParse(readLocationFields(formData));
  if (!parsed.success) {
    return { status: "error", fieldErrors: toFieldErrors(parsed.error) };
  }

  const client = await createSupabaseServerClient();
  const { error } = await client
    .from("locations")
    // `tenant_id` comes from the tenant the SERVER resolved, never from the
    // form. Even if it did, the insert policy evaluates the permission against
    // the tenant of the row, so a forged value would be refused.
    .insert({ tenant_id: tenant.id, ...toRow(parsed.data) });

  if (error) {
    const described = describeWriteError(error.code);
    if (described !== null) return described;
    logger.error("location.create_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Location creation failed.", { cause: error });
  }

  logger.info("location.created", { tenantId: tenant.id });
  revalidatePath(`/dashboard/${tenant.slug}/sedes`);
  revalidatePath("/sitio", "layout");

  return { status: "success", message: "Sede creada." };
}

export async function updateLocationAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireLocationAccess(formData);

  const parsedId = z.uuid().safeParse(readText(formData, "locationId"));
  if (!parsedId.success) return { status: "error", message: "Sede no encontrada." };

  const parsed = locationSchema.safeParse(readLocationFields(formData));
  if (!parsed.success) {
    return { status: "error", fieldErrors: toFieldErrors(parsed.error) };
  }

  const client = await createSupabaseServerClient();
  const { error } = await client
    .from("locations")
    .update(toRow(parsed.data))
    // Filtered by tenant AND id: the id came from a form, so it is client
    // input, and this is what stops it addressing another company's branch.
    .eq("tenant_id", tenant.id)
    .eq("id", parsedId.data);

  if (error) {
    const described = describeWriteError(error.code);
    if (described !== null) return described;
    logger.error("location.update_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Location update failed.", { cause: error });
  }

  logger.info("location.updated", { tenantId: tenant.id, locationId: parsedId.data });
  revalidatePath(`/dashboard/${tenant.slug}/sedes`);
  revalidatePath("/sitio", "layout");

  return { status: "success", message: "Sede guardada." };
}

const setActiveSchema = z.object({
  locationId: z.uuid(),
  isActive: z.enum(["true", "false"]).transform((value) => value === "true"),
});

export async function setLocationActiveAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireLocationAccess(formData);

  const parsed = setActiveSchema.safeParse({
    locationId: readText(formData, "locationId"),
    isActive: readText(formData, "isActive"),
  });
  if (!parsed.success) return { status: "error", message: "Sede no encontrada." };

  const client = await createSupabaseServerClient();
  const { error } = await client
    .from("locations")
    .update({ is_active: parsed.data.isActive })
    .eq("tenant_id", tenant.id)
    .eq("id", parsed.data.locationId);

  if (error) {
    /*
     * P0001 is the trigger refusing to leave the business with no active
     * branch. It is not a fault, it is the rule doing its job - so it becomes a
     * sentence rather than an error page.
     *
     * Worth explaining rather than just refusing: from Phase 13 an order needs
     * a branch to happen at, and somebody closing their only shop for the
     * holidays deserves to know that is why.
     */
    if (error.code === "P0001") {
      return {
        status: "error",
        message:
          "No puedes desactivar tu unica sede activa. Crea otra antes, o desactiva el negocio entero desde CloverCode.",
      };
    }
    logger.error("location.set_active_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Location activation failed.", { cause: error });
  }

  logger.info(parsed.data.isActive ? "location.activated" : "location.deactivated", {
    tenantId: tenant.id,
    locationId: parsed.data.locationId,
  });
  revalidatePath(`/dashboard/${tenant.slug}/sedes`);
  revalidatePath("/sitio", "layout");

  return {
    status: "success",
    message: parsed.data.isActive ? "Sede activada." : "Sede desactivada.",
  };
}

export async function addLocationHourAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireLocationAccess(formData);

  const parsed = locationHourSchema.safeParse({
    locationId: readText(formData, "locationId"),
    dayOfWeek: readText(formData, "dayOfWeek"),
    opensAt: readText(formData, "opensAt"),
    closesAt: readText(formData, "closesAt"),
  });
  if (!parsed.success) {
    return { status: "error", fieldErrors: toFieldErrors(parsed.error) };
  }

  const client = await createSupabaseServerClient();
  // `tenant_id` is deliberately absent: a trigger derives it from the location,
  // so a caller cannot attach a shift to another business's branch by sending
  // their own tenant id alongside it (SPEC AB-1002).
  const { error } = await client.from("location_hours").insert({
    location_id: parsed.data.locationId,
    day_of_week: parsed.data.dayOfWeek,
    opens_at: parsed.data.opensAt,
    closes_at: parsed.data.closesAt,
  });

  if (error) {
    // 23P01 is the overlap trigger. Also the SQLSTATE an exclusion constraint
    // raises, which is what this rule would be if btree_gist were available.
    if (error.code === "23P01") {
      return {
        status: "error",
        fieldErrors: { opensAt: ["Ese tramo se cruza con otro del mismo dia."] },
      };
    }
    logger.error("location.hours_add_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Location hour creation failed.", { cause: error });
  }

  logger.info("location.hours.added", {
    tenantId: tenant.id,
    locationId: parsed.data.locationId,
    day: parsed.data.dayOfWeek,
  });
  revalidatePath(`/dashboard/${tenant.slug}/sedes/${parsed.data.locationId}`);
  revalidatePath("/sitio", "layout");

  return { status: "success", message: "Horario anadido." };
}

export async function deleteLocationHourAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireLocationAccess(formData);

  const parsedId = z.uuid().safeParse(readText(formData, "hourId"));
  if (!parsedId.success) return { status: "error", message: "Horario no encontrado." };

  const client = await createSupabaseServerClient();
  const { error } = await client
    .from("location_hours")
    .delete()
    .eq("tenant_id", tenant.id)
    .eq("id", parsedId.data);

  if (error) {
    logger.error("location.hours_delete_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Location hour deletion failed.", { cause: error });
  }

  logger.info("location.hours.removed", { tenantId: tenant.id, hourId: parsedId.data });
  revalidatePath(`/dashboard/${tenant.slug}/sedes`);
  revalidatePath("/sitio", "layout");

  return { status: "success", message: "Horario quitado." };
}
