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
import { DatabaseError } from "@/lib/errors";
import { getCurrentUser } from "@/lib/auth/session";
import type { FormState } from "@/lib/forms/state";
import { logger } from "@/lib/logger";
import { isModule } from "@/lib/features";
import { requirePlatformAdmin } from "@/lib/platform/access";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseOrThrow, toFieldErrors } from "@/lib/validation";

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

/**
 * Returns form state rather than throwing, matching the contract Phase 02
 * established for every form in the product.
 *
 * A thrown ValidationError would land on the error boundary and show a generic
 * failure page for something as ordinary as a mistyped slug. The audit that
 * found this also found the divergence: two modules were surfacing form errors
 * two different ways.
 */
export async function createTenantAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  await requirePlatformAdmin();

  const parsed = createTenantSchema.safeParse({
    name: formData.get("name"),
    slug: formData.get("slug"),
    ownerEmail: formData.get("ownerEmail"),
  });

  if (!parsed.success) {
    return { status: "error", fieldErrors: toFieldErrors(parsed.error) };
  }

  const input = parsed.data;
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

    // The function raises specific SQLSTATEs for the two cases an operator can
    // actually act on. Anything else is a fault, not a form problem.
    if (error.code === "P0002") {
      return {
        status: "error",
        fieldErrors: { ownerEmail: ["No existe una cuenta con ese correo."] },
      };
    }
    if (error.code === "23505") {
      return {
        status: "error",
        fieldErrors: { slug: ["Ese slug ya pertenece a otra empresa."] },
      };
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

// ---------------------------------------------------------------------------
// Domains (Phase 09)
// ---------------------------------------------------------------------------

const setDomainStatusSchema = z.object({
  tenantId: z.uuid(),
  domainId: z.uuid(),
  status: z.enum(["verifying", "active", "failed"]),
});

const setProviderStatusSchema = z.object({
  tenantId: z.uuid(),
  domainId: z.uuid(),
  providerStatus: z.enum(["unknown", "requested", "ready", "error"]),
});

/**
 * Publishes or retires a domain.
 *
 * This is the only place in the product that can write `active`, and that is
 * the point: `resolve_tenant_by_domain` serves only active domains, so an
 * operator - not a tenant - decides when a name starts carrying traffic. The
 * tenant-side functions in Phase 09 stop at `verifying` for exactly this
 * reason.
 *
 * `pending` is absent from the accepted values on purpose. Sending a domain
 * back to "we have not seen your TXT record" would be a lie the operator has no
 * way of knowing to be true; retiring one is `failed`.
 */
export async function setDomainStatusAction(formData: FormData): Promise<void> {
  await requirePlatformAdmin();

  const input = parseOrThrow(setDomainStatusSchema, {
    tenantId: formData.get("tenantId"),
    domainId: formData.get("domainId"),
    status: formData.get("status"),
  });

  const operator = await getCurrentUser();
  const client = await createSupabaseServerClient();

  // `verified_at` is not decoration: a CHECK on the table requires it to be
  // present exactly when the status is active, so the two move together or the
  // write is refused.
  const { error } = await client
    .from("tenant_domains")
    .update({
      verification_status: input.status,
      verified_at: input.status === "active" ? new Date().toISOString() : null,
      // Retiring a domain clears the primary flag with it. Leaving a retired
      // domain as primary would point the canonical URL of the public site
      // (Phase 08) at a name that no longer resolves.
      ...(input.status === "active" ? {} : { is_primary: false }),
    })
    .eq("id", input.domainId);

  if (error) {
    logger.error("platform.domain.status_change_failed", {
      domainId: input.domainId,
      error,
    });
    throw new DatabaseError("Domain status change failed.", { cause: error });
  }

  logger.info("platform.domain.status_changed", {
    tenantId: input.tenantId,
    domainId: input.domainId,
    to: input.status,
    operatorId: operator?.id ?? null,
  });

  revalidatePath(`/super-admin/tenants/${input.tenantId}`);
}

/**
 * Records what the hosting provider has for a domain.
 *
 * Written by hand because nothing else can know it. Master section 33:
 * "Nunca asumir que agregar un registro a nuestra BD configura Vercel
 * automaticamente." Until a provider integration exists (ADR-013), an operator
 * registers the domain there and then says so here - and `provider_synced_at`
 * records when that statement was last true.
 */
export async function setProviderStatusAction(formData: FormData): Promise<void> {
  await requirePlatformAdmin();

  const input = parseOrThrow(setProviderStatusSchema, {
    tenantId: formData.get("tenantId"),
    domainId: formData.get("domainId"),
    providerStatus: formData.get("providerStatus"),
  });

  const client = await createSupabaseServerClient();
  const { error } = await client
    .from("tenant_domains")
    .update({
      provider_status: input.providerStatus,
      provider_synced_at: new Date().toISOString(),
    })
    .eq("id", input.domainId);

  if (error) {
    logger.error("platform.domain.provider_change_failed", {
      domainId: input.domainId,
      error,
    });
    throw new DatabaseError("Provider status change failed.", { cause: error });
  }

  logger.info("platform.domain.provider_changed", {
    tenantId: input.tenantId,
    domainId: input.domainId,
    to: input.providerStatus,
  });

  revalidatePath(`/super-admin/tenants/${input.tenantId}`);
}

// ---------------------------------------------------------------------------
// Plans and modules (Phase 21)
// ---------------------------------------------------------------------------

/**
 * Governing what a business has contracted is a Super Admin job (master
 * section 29), not a tenant role - which is why these live here rather than in
 * a `subscriptions` module of their own, and why none of them takes a
 * permission. `requirePlatformAdmin()` is the whole authorization story, and
 * RLS refuses the write again underneath (ADR-025 decision 6).
 */

const setPlanSchema = z.object({
  tenantId: z.uuid(),
  planCode: z
    .string()
    .trim()
    .regex(/^[a-z_]+$/, "Plan invalido."),
});

const setSubscriptionStatusSchema = z.object({
  tenantId: z.uuid(),
  status: z.enum(["trialing", "active", "past_due", "suspended", "cancelled"]),
});

const setModuleSchema = z.object({
  tenantId: z.uuid(),
  /**
   * Narrowed against the catalogue mirror rather than a regex, so the value
   * that reaches the database is a `ModuleCode` and a typo in the form is a
   * validation error rather than a row pointing at a module that never existed.
   */
  moduleCode: z
    .string()
    .trim()
    .transform((value, ctx) => {
      if (!isModule(value)) {
        ctx.addIssue({ code: "custom", message: "Modulo invalido." });
        return z.NEVER;
      }
      return value;
    }),
  /** "inherit" removes the override and returns the tenant to its plan. */
  state: z.enum(["on", "off", "inherit"]),
});

export async function setTenantPlanAction(formData: FormData): Promise<void> {
  await requirePlatformAdmin();

  const input = parseOrThrow(setPlanSchema, {
    tenantId: formData.get("tenantId"),
    planCode: formData.get("planCode"),
  });

  const operator = await getCurrentUser();
  const client = await createSupabaseServerClient();

  const { error } = await client
    .from("subscriptions")
    .update({ plan_code: input.planCode })
    .eq("tenant_id", input.tenantId);

  if (error) {
    logger.error("platform.subscription.plan_change_failed", {
      tenantId: input.tenantId,
      error,
    });
    throw new DatabaseError("Plan change failed.", { cause: error });
  }

  logger.info("subscription.plan_changed", {
    tenantId: input.tenantId,
    to: input.planCode,
    operatorId: operator?.id ?? null,
  });

  revalidatePath(`/super-admin/tenants/${input.tenantId}`);
}

export async function setSubscriptionStatusAction(formData: FormData): Promise<void> {
  await requirePlatformAdmin();

  const input = parseOrThrow(setSubscriptionStatusSchema, {
    tenantId: formData.get("tenantId"),
    status: formData.get("status"),
  });

  const operator = await getCurrentUser();
  const client = await createSupabaseServerClient();

  // `cancelled_at` and the status are the same fact, and a CHECK says so. The
  // application supplies both rather than letting the constraint refuse a
  // half-written row.
  const { error } = await client
    .from("subscriptions")
    .update({
      status: input.status,
      cancelled_at: input.status === "cancelled" ? new Date().toISOString() : null,
    })
    .eq("tenant_id", input.tenantId);

  if (error) {
    logger.error("platform.subscription.status_change_failed", {
      tenantId: input.tenantId,
      error,
    });
    throw new DatabaseError("Subscription status change failed.", { cause: error });
  }

  logger.info("subscription.status_changed", {
    tenantId: input.tenantId,
    to: input.status,
    operatorId: operator?.id ?? null,
  });

  revalidatePath(`/super-admin/tenants/${input.tenantId}`);
}

export async function setTenantModuleAction(formData: FormData): Promise<void> {
  await requirePlatformAdmin();

  const input = parseOrThrow(setModuleSchema, {
    tenantId: formData.get("tenantId"),
    moduleCode: formData.get("moduleCode"),
    state: formData.get("state"),
  });

  const operator = await getCurrentUser();
  const client = await createSupabaseServerClient();

  if (input.state === "inherit") {
    // Removing the override is not the same as turning the module off: it
    // returns the tenant to whatever its plan says, which may be either
    // (ADR-025 decision 2).
    const { error } = await client
      .from("tenant_modules")
      .delete()
      .eq("tenant_id", input.tenantId)
      .eq("module_code", input.moduleCode);

    if (error) {
      logger.error("platform.module.clear_failed", { tenantId: input.tenantId, error });
      throw new DatabaseError("Module override removal failed.", { cause: error });
    }

    logger.info("tenant_module.cleared", {
      tenantId: input.tenantId,
      module: input.moduleCode,
      operatorId: operator?.id ?? null,
    });
  } else {
    const isEnabled = input.state === "on";

    // Upsert by primary key: an override is one row per (tenant, module), and
    // setting it twice is a correction rather than an error.
    const { error } = await client.from("tenant_modules").upsert(
      {
        tenant_id: input.tenantId,
        module_code: input.moduleCode,
        is_enabled: isEnabled,
      },
      { onConflict: "tenant_id,module_code" },
    );

    if (error) {
      logger.error("platform.module.set_failed", { tenantId: input.tenantId, error });
      throw new DatabaseError("Module override failed.", { cause: error });
    }

    logger.info(isEnabled ? "tenant_module.enabled" : "tenant_module.disabled", {
      tenantId: input.tenantId,
      module: input.moduleCode,
      operatorId: operator?.id ?? null,
    });
  }

  revalidatePath(`/super-admin/tenants/${input.tenantId}`);
}
