"use server";

/**
 * Platform Server Actions.
 *
 * Every one of these re-checks platform authority. A Server Action is reachable
 * by any client that knows its id: the layout guard is not enough, and the
 * function it calls checks a third time inside PostgreSQL (master section 45).
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { ConflictError, DatabaseError, NotFoundError } from "@/lib/errors";
import { getCurrentUser } from "@/lib/auth/session";
import { logger } from "@/lib/logger";
import { requirePlatformAdmin } from "@/lib/platform/access";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseOrThrow } from "@/lib/validation";

const RESERVED_SLUGS = new Set([
  "www",
  "api",
  "app",
  "admin",
  "dashboard",
  "auth",
  "login",
  "logout",
  "static",
  "assets",
  "cdn",
  "mail",
  "smtp",
  "ftp",
  "ns1",
  "ns2",
  "status",
  "support",
  "help",
  "docs",
  "blog",
  "clovercode",
  "superadmin",
  "system",
  "internal",
  "test",
  "staging",
  "preview",
]);

// Mirrors the CHECK constraints on `tenants`. Validating here too means the
// operator gets a field-level message instead of a raw constraint violation.
const createTenantSchema = z.object({
  name: z.string().trim().min(1, "El nombre es obligatorio.").max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, "El slug debe tener al menos 3 caracteres.")
    .max(63, "El slug no puede superar 63 caracteres.")
    .regex(
      /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/,
      "Solo minusculas, numeros y guiones, sin empezar ni terminar en guion.",
    )
    .refine((value) => !RESERVED_SLUGS.has(value), "Ese slug esta reservado."),
  ownerEmail: z.email("Correo invalido.").trim().toLowerCase(),
});

const setStatusSchema = z.object({
  tenantId: z.uuid(),
  status: z.enum(["active", "suspended", "archived"]),
});

export async function createTenantAction(formData: FormData): Promise<never> {
  await requirePlatformAdmin();

  const input = parseOrThrow(createTenantSchema, {
    name: formData.get("name"),
    slug: formData.get("slug"),
    ownerEmail: formData.get("ownerEmail"),
  });

  const operator = await getCurrentUser();
  const client = await createSupabaseServerClient();

  const { data, error } = await client.rpc("provision_tenant", {
    p_name: input.name,
    p_slug: input.slug,
    p_owner_email: input.ownerEmail,
  });

  if (error) {
    logger.error("platform.tenant.provision_failed", {
      slug: input.slug,
      operatorId: operator?.id ?? null,
      error,
    });

    // The function raises a specific SQLSTATE for the case an operator can
    // actually act on: the owner has no account yet.
    if (error.code === "P0002") {
      throw new NotFoundError("Cuenta del propietario");
    }
    if (error.code === "23505") {
      throw new ConflictError("El slug ya esta en uso.", {
        publicMessage: "Ese slug ya esta en uso.",
      });
    }
    throw new DatabaseError("Tenant provisioning failed.", { cause: error });
  }

  logger.info("platform.tenant.provisioned", {
    tenantId: data,
    slug: input.slug,
    operatorId: operator?.id ?? null,
  });

  revalidatePath("/super-admin/tenants");
  redirect(`/super-admin/tenants/${String(data)}`);
}

export async function setTenantStatusAction(formData: FormData): Promise<void> {
  await requirePlatformAdmin();

  const input = parseOrThrow(setStatusSchema, {
    tenantId: formData.get("tenantId"),
    status: formData.get("status"),
  });

  const operator = await getCurrentUser();
  const client = await createSupabaseServerClient();

  const { error } = await client
    .from("tenants")
    .update({ status: input.status })
    .eq("id", input.tenantId);

  if (error) {
    logger.error("platform.tenant.status_change_failed", {
      tenantId: input.tenantId,
      error,
    });
    throw new DatabaseError("Tenant status change failed.", { cause: error });
  }

  logger.info("platform.tenant.status_changed", {
    tenantId: input.tenantId,
    to: input.status,
    operatorId: operator?.id ?? null,
  });

  revalidatePath("/super-admin/tenants");
  revalidatePath(`/super-admin/tenants/${input.tenantId}`);
}
