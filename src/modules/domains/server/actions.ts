"use server";

/**
 * Domain Server Actions.
 *
 * Every one of these ends in a SECURITY DEFINER function that re-checks the
 * permission against the tenant that OWNS the row - not the tenant the form
 * said. The guard here exists so the user gets a 404 instead of a database
 * error, not because the database trusts it.
 *
 * The action that is deliberately missing is "activate". Publishing a domain is
 * an operator decision, and there is no code path from a tenant session to
 * `verification_status = 'active'`. See the header of
 * `supabase/migrations/20260825190200_create_domain_functions.sql`.
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
import { normalizeHostname } from "@/lib/tenant/hostname";
import { SYSTEM_DOMAIN } from "@/config/app";
import { checkDomainOwnership, nodeTxtResolver } from "../dns";
import { getTenantDomain } from "./queries";

function readText(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

async function requireDomainAccess(formData: FormData) {
  const tenant = await requireActiveTenant(readText(formData, "tenantSlug"));
  await requirePermission(tenant.id, PERMISSIONS.DOMAINS_MANAGE);
  return tenant;
}

const domainIdSchema = z.uuid();

/**
 * Validated in the application so the message is readable, and again in
 * `claim_domain` because the function does not trust its caller.
 */
const domainSchema = z
  .string()
  .trim()
  .min(4, "Escribe un dominio, por ejemplo sugurolls.com.")
  .max(253)
  .transform((value) => normalizeHostname(value))
  .refine((value): value is string => value !== null, "Ese no es un dominio valido.")
  .refine(
    (value) => /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(value),
    "Ese no es un dominio valido.",
  )
  .refine(
    (value) => value !== SYSTEM_DOMAIN && !value.endsWith(`.${SYSTEM_DOMAIN}`),
    "Ese dominio pertenece a la plataforma. Tu empresa ya tiene el suyo.",
  );

export async function addDomainAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireDomainAccess(formData);

  const parsed = domainSchema.safeParse(readText(formData, "domain"));
  if (!parsed.success) {
    return {
      status: "error",
      fieldErrors: { domain: parsed.error.issues.map((issue) => issue.message) },
    };
  }

  const client = await createSupabaseServerClient();
  const { error } = await client.rpc("claim_domain", {
    p_tenant_id: tenant.id,
    p_domain: parsed.data,
  });

  if (error) {
    /*
     * One message for every rejection, whatever the reason.
     *
     * The interesting case is a domain another business already runs. Saying
     * "already connected to another account" would turn this form into a way to
     * ask which of your competitors uses CloverCode - a paying customer list,
     * queryable one name at a time. The detail goes to the log, where the
     * operator can see it and the caller cannot.
     */
    logger.warn("domain.claim_rejected", {
      tenantId: tenant.id,
      domain: parsed.data,
      code: error.code,
    });
    return {
      status: "error",
      fieldErrors: {
        domain: ["No se pudo conectar ese dominio. Comprueba que esta bien escrito."],
      },
    };
  }

  logger.info("domain.claimed", { tenantId: tenant.id, domain: parsed.data });
  revalidatePath(`/dashboard/${tenant.slug}/configuracion/dominios`);

  return {
    status: "success",
    message: "Dominio anadido. Ahora crea los registros DNS que aparecen abajo.",
  };
}

/**
 * Performs the DNS lookup and records what it saw.
 *
 * The lookup runs HERE, on the server, and its result goes to a function that
 * can move the domain to `verifying` at best. A caller who skipped this action
 * and hit the RPC directly with a forged pass would gain nothing: `verifying`
 * serves no traffic and lands in front of an operator.
 */
export async function checkDomainDnsAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireDomainAccess(formData);

  const parsedId = domainIdSchema.safeParse(readText(formData, "domainId"));
  if (!parsedId.success) {
    return { status: "error", message: "Dominio no encontrado." };
  }

  // Read through the tenant filter: the id comes from a form, so it is client
  // input, and this is what stops it addressing another company's row.
  const domain = await getTenantDomain(tenant.id, parsedId.data);
  if (domain === null || domain.verificationToken === null) {
    return { status: "error", message: "Dominio no encontrado." };
  }

  const result = await checkDomainOwnership(
    domain.domain,
    domain.verificationToken,
    nodeTxtResolver,
  );

  const client = await createSupabaseServerClient();
  const { error } = await client.rpc("record_domain_ownership_check", {
    p_domain_id: domain.id,
    p_ok: result.ok,
    p_error: result.reason ?? null,
  });

  if (error) {
    logger.error("domain.check_write_failed", { tenantId: tenant.id, domainId: domain.id, error });
    throw new DatabaseError("Domain check could not be recorded.", { cause: error });
  }

  revalidatePath(`/dashboard/${tenant.slug}/configuracion/dominios`);

  if (result.ok) {
    logger.info("domain.check.passed", { tenantId: tenant.id, domainId: domain.id });
    return {
      status: "success",
      message:
        "DNS verificado. Falta que el equipo de CloverCode publique el dominio; te avisaremos.",
    };
  }

  logger.info("domain.check.failed", { tenantId: tenant.id, domainId: domain.id });
  return { status: "error", message: result.reason ?? "No se pudo comprobar el DNS." };
}

export async function setPrimaryDomainAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireDomainAccess(formData);

  const parsedId = domainIdSchema.safeParse(readText(formData, "domainId"));
  if (!parsedId.success) return { status: "error", message: "Dominio no encontrado." };

  const client = await createSupabaseServerClient();
  const { error } = await client.rpc("set_primary_domain", { p_domain_id: parsedId.data });

  if (error) {
    logger.warn("domain.primary_rejected", {
      tenantId: tenant.id,
      domainId: parsedId.data,
      code: error.code,
    });
    return {
      status: "error",
      message: "Solo un dominio verificado y publicado puede ser el principal.",
    };
  }

  logger.info("domain.primary_changed", { tenantId: tenant.id, domainId: parsedId.data });
  revalidatePath(`/dashboard/${tenant.slug}/configuracion/dominios`);
  // The canonical URL of the public site is built from the primary domain.
  revalidatePath("/sitio", "layout");

  return { status: "success", message: "Dominio principal actualizado." };
}

export async function deleteDomainAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireDomainAccess(formData);

  const parsedId = domainIdSchema.safeParse(readText(formData, "domainId"));
  if (!parsedId.success) return { status: "error", message: "Dominio no encontrado." };

  const client = await createSupabaseServerClient();
  // The DELETE policy refuses a system domain and a primary one. Filtering by
  // tenant as well means a wrong id is a no-op rather than somebody else's row.
  const { error } = await client
    .from("tenant_domains")
    .delete()
    .eq("tenant_id", tenant.id)
    .eq("id", parsedId.data);

  if (error) {
    logger.warn("domain.delete_rejected", {
      tenantId: tenant.id,
      domainId: parsedId.data,
      code: error.code,
    });
    return {
      status: "error",
      message: "No se pudo quitar ese dominio. El principal y el del sistema no se pueden quitar.",
    };
  }

  logger.info("domain.deleted", { tenantId: tenant.id, domainId: parsedId.data });
  revalidatePath(`/dashboard/${tenant.slug}/configuracion/dominios`);

  return { status: "success", message: "Dominio quitado." };
}
