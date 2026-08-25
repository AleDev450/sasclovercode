"use server";

/**
 * CMS Server Actions.
 *
 * Same three-layer shape as Phase 06: resolve the tenant from the URL segment
 * that `requireActiveTenant` already verified, require `content.manage` in that
 * tenant, then write - at which point RLS checks the same permission again.
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
import { isSectionType, parseSectionContent } from "../sections";

function readText(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

async function requireContentAccess(formData: FormData) {
  const tenant = await requireActiveTenant(readText(formData, "tenantSlug"));
  await requirePermission(tenant.id, PERMISSIONS.CONTENT_MANAGE);
  return tenant;
}

const pageSchema = z.object({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "El enlace es obligatorio.")
    .max(80)
    .regex(
      /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/,
      "Solo minusculas, numeros y guiones, sin empezar ni terminar en guion.",
    ),
  title: z.string().trim().min(1, "El titulo es obligatorio.").max(200),
});

export async function createPageAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireContentAccess(formData);

  const parsed = pageSchema.safeParse({
    slug: readText(formData, "slug"),
    title: readText(formData, "title"),
  });
  if (!parsed.success) {
    return { status: "error", fieldErrors: toFieldErrors(parsed.error) };
  }

  const client = await createSupabaseServerClient();
  const { error } = await client.from("pages").insert({
    tenant_id: tenant.id,
    slug: parsed.data.slug,
    title: parsed.data.title,
  });

  if (error) {
    // 23505 is the tenant+slug unique constraint: an ordinary mistake, not a
    // fault, so it comes back as a field error rather than an error page.
    if (error.code === "23505") {
      return {
        status: "error",
        fieldErrors: { slug: ["Ese enlace ya existe en esta empresa."] },
      };
    }
    logger.error("cms.page.create_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Page creation failed.", { cause: error });
  }

  logger.info("cms.page.created", { tenantId: tenant.id, slug: parsed.data.slug });
  revalidatePath(`/dashboard/${tenant.slug}/contenido`);
  return { status: "success", message: "Pagina creada." };
}

export async function setPageStatusAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireContentAccess(formData);

  const parsed = z
    .object({ pageId: z.uuid(), status: z.enum(["draft", "published"]) })
    .safeParse({ pageId: readText(formData, "pageId"), status: readText(formData, "status") });

  if (!parsed.success) {
    return { status: "error", fieldErrors: toFieldErrors(parsed.error) };
  }

  const client = await createSupabaseServerClient();
  const { error } = await client
    .from("pages")
    .update({ status: parsed.data.status })
    .eq("id", parsed.data.pageId)
    // Redundant with RLS, and kept anyway: the filter states the intent at the
    // call site instead of relying on a policy the reader has to go and find.
    .eq("tenant_id", tenant.id);

  if (error) {
    logger.error("cms.page.status_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Page status change failed.", { cause: error });
  }

  logger.info("cms.page.published", {
    tenantId: tenant.id,
    pageId: parsed.data.pageId,
    status: parsed.data.status,
  });
  revalidatePath(`/dashboard/${tenant.slug}/contenido`);
  revalidatePath("/sitio", "layout");
  return { status: "success", message: "Estado actualizado." };
}

export async function upsertSectionAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireContentAccess(formData);

  const pageId = readText(formData, "pageId");
  const type = readText(formData, "type");
  const raw = readText(formData, "content");

  if (!isSectionType(type)) {
    return { status: "error", fieldErrors: { type: ["Tipo de seccion desconocido."] } };
  }

  let content: unknown;
  try {
    content = raw.trim().length === 0 ? {} : JSON.parse(raw);
  } catch {
    return { status: "error", fieldErrors: { content: ["El contenido no es JSON valido."] } };
  }

  // Validated against the schema of its OWN type. A section may not carry the
  // shape of a different one.
  const validated = parseSectionContent(type, content);
  if (!validated.ok) {
    return { status: "error", fieldErrors: validated.errors };
  }

  const sectionId = readText(formData, "sectionId");
  const client = await createSupabaseServerClient();

  const payload = {
    page_id: pageId,
    // Supplied because the column is NOT NULL. The trigger overwrites it with
    // the page's real tenant, so a wrong value here cannot take effect.
    tenant_id: tenant.id,
    type,
    content: validated.value as never,
    position: Number(readText(formData, "position") || 0),
  };

  const { error } =
    sectionId.length > 0
      ? await client.from("page_sections").update(payload).eq("id", sectionId)
      : await client.from("page_sections").insert(payload);

  if (error) {
    logger.error("cms.section.save_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Section save failed.", { cause: error });
  }

  logger.info("cms.section.saved", { tenantId: tenant.id, type });
  revalidatePath(`/dashboard/${tenant.slug}/contenido/${pageId}`);
  revalidatePath("/sitio", "layout");
  return { status: "success", message: "Seccion guardada." };
}

export async function deleteSectionAction(formData: FormData): Promise<void> {
  const tenant = await requireContentAccess(formData);
  const sectionId = readText(formData, "sectionId");
  const pageId = readText(formData, "pageId");

  const client = await createSupabaseServerClient();
  const { error } = await client.from("page_sections").delete().eq("id", sectionId);

  if (error) {
    logger.error("cms.section.delete_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Section delete failed.", { cause: error });
  }

  revalidatePath(`/dashboard/${tenant.slug}/contenido/${pageId}`);
  revalidatePath("/sitio", "layout");
}

const navSchema = z
  .object({
    label: z.string().trim().min(1, "La etiqueta es obligatoria.").max(60),
    linkType: z.enum(["page", "external"]),
    pageId: z.string().trim(),
    externalUrl: z.string().trim(),
    parentId: z.string().trim(),
    position: z.coerce.number().int().min(0).max(1000).default(0),
  })
  .refine((value) => (value.linkType === "page" ? value.pageId.length > 0 : true), {
    message: "Elige una pagina.",
    path: ["pageId"],
  })
  .refine(
    (value) => (value.linkType === "external" ? value.externalUrl.startsWith("https://") : true),
    { message: "El enlace debe empezar con https://", path: ["externalUrl"] },
  );

export async function upsertNavItemAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireContentAccess(formData);

  const parsed = navSchema.safeParse({
    label: readText(formData, "label"),
    linkType: readText(formData, "linkType"),
    pageId: readText(formData, "pageId"),
    externalUrl: readText(formData, "externalUrl"),
    parentId: readText(formData, "parentId"),
    position: readText(formData, "position") || 0,
  });

  if (!parsed.success) {
    return { status: "error", fieldErrors: toFieldErrors(parsed.error) };
  }

  const input = parsed.data;
  const client = await createSupabaseServerClient();

  const { error } = await client.from("navigation_items").insert({
    tenant_id: tenant.id,
    label: input.label,
    link_type: input.linkType,
    page_id: input.linkType === "page" ? input.pageId : null,
    external_url: input.linkType === "external" ? input.externalUrl : null,
    parent_id: input.parentId.length > 0 ? input.parentId : null,
    position: input.position,
  });

  if (error) {
    // The hierarchy trigger speaks in SQLSTATEs. Both of these are things the
    // person can fix, so they come back as field errors.
    if (error.code === "23514") {
      return { status: "error", fieldErrors: { parentId: ["Solo se permiten dos niveles."] } };
    }
    if (error.code === "42501") {
      return {
        status: "error",
        fieldErrors: { parentId: ["Ese elemento no es de esta empresa."] },
      };
    }
    logger.error("cms.nav.save_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Navigation save failed.", { cause: error });
  }

  logger.info("cms.nav.saved", { tenantId: tenant.id });
  revalidatePath(`/dashboard/${tenant.slug}/navegacion`);
  revalidatePath("/sitio", "layout");
  return { status: "success", message: "Elemento guardado." };
}

export async function toggleNavItemAction(formData: FormData): Promise<void> {
  const tenant = await requireContentAccess(formData);
  const itemId = readText(formData, "itemId");
  const isActive = readText(formData, "isActive") === "true";

  const client = await createSupabaseServerClient();
  const { error } = await client
    .from("navigation_items")
    .update({ is_active: !isActive })
    .eq("id", itemId);

  if (error) {
    logger.error("cms.nav.toggle_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Navigation toggle failed.", { cause: error });
  }

  revalidatePath(`/dashboard/${tenant.slug}/navegacion`);
  revalidatePath("/sitio", "layout");
}

export async function deleteNavItemAction(formData: FormData): Promise<void> {
  const tenant = await requireContentAccess(formData);
  const itemId = readText(formData, "itemId");

  const client = await createSupabaseServerClient();
  const { error } = await client.from("navigation_items").delete().eq("id", itemId);

  if (error) {
    logger.error("cms.nav.delete_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Navigation delete failed.", { cause: error });
  }

  revalidatePath(`/dashboard/${tenant.slug}/navegacion`);
  revalidatePath("/sitio", "layout");
}
