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

/**
 * Moves a section one place up or down.
 *
 * WHY NOT A NUMBER FIELD. `position` used to be an input the person typed into,
 * which meant reordering a five-section page was arithmetic: to put the banner
 * above the hero you had to know what number the hero held and pick a smaller
 * one, then discover that two sections now shared a position and the order was
 * decided by whichever id sorted first.
 *
 * The whole page is renumbered on every move rather than only the two rows that
 * swapped. That is a few more writes and one fewer thing that can be wrong: any
 * page with duplicate or sparse positions - and every page seeded before this
 * existed has them - comes out consecutive from 0 the first time anybody
 * touches it.
 */
export async function moveSectionAction(formData: FormData): Promise<void> {
  const tenant = await requireContentAccess(formData);

  const pageId = readText(formData, "pageId");
  const sectionId = readText(formData, "sectionId");
  const direction = readText(formData, "direction") === "up" ? -1 : 1;

  const client = await createSupabaseServerClient();

  const { data, error } = await client
    .from("page_sections")
    .select("id, position")
    .eq("page_id", pageId)
    .eq("tenant_id", tenant.id)
    .order("position")
    .order("id");

  if (error) {
    logger.error("cms.section.move_read_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Section read failed.", { cause: error });
  }

  const ordered = data ?? [];
  const from = ordered.findIndex((section) => section.id === sectionId);
  const to = from + direction;

  // Off either end is a no-op, not an error: the button is disabled there, and
  // a request that arrives anyway should do nothing rather than fail loudly.
  if (from === -1 || to < 0 || to >= ordered.length) return;

  const moved = [...ordered];
  const [section] = moved.splice(from, 1);
  if (section === undefined) return;
  moved.splice(to, 0, section);

  for (const [index, row] of moved.entries()) {
    if (row.position === index) continue;
    const { error: writeError } = await client
      .from("page_sections")
      .update({ position: index })
      .eq("id", row.id)
      .eq("tenant_id", tenant.id);

    if (writeError) {
      logger.error("cms.section.move_failed", { tenantId: tenant.id, error: writeError });
      throw new DatabaseError("Section move failed.", { cause: writeError });
    }
  }

  logger.info("cms.section.moved", { tenantId: tenant.id, pageId });
  revalidatePath(`/dashboard/${tenant.slug}/contenido/${pageId}`);
  revalidatePath("/sitio", "layout");
}

/**
 * Hides a section without deleting it.
 *
 * `is_visible` has been in the schema and honoured by the public query since
 * Phase 07, with nothing anywhere able to set it. It is the answer to "we do
 * not do delivery in January": the section comes back in February with its
 * content intact, which deleting and retyping does not give you.
 */
export async function toggleSectionVisibilityAction(formData: FormData): Promise<void> {
  const tenant = await requireContentAccess(formData);

  const pageId = readText(formData, "pageId");
  const sectionId = readText(formData, "sectionId");
  const isVisible = readText(formData, "isVisible") === "true";

  const client = await createSupabaseServerClient();
  const { error } = await client
    .from("page_sections")
    .update({ is_visible: !isVisible })
    .eq("id", sectionId)
    .eq("tenant_id", tenant.id);

  if (error) {
    logger.error("cms.section.visibility_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Section visibility change failed.", { cause: error });
  }

  revalidatePath(`/dashboard/${tenant.slug}/contenido/${pageId}`);
  revalidatePath("/sitio", "layout");
}

/**
 * Deletes a page and everything on it.
 *
 * `page_sections` cascades, so this is one statement. A page could be created
 * and published from the first commit of Phase 07 and never removed, which
 * meant a typo in a slug was permanent.
 */
export async function deletePageAction(formData: FormData): Promise<void> {
  const tenant = await requireContentAccess(formData);
  const pageId = readText(formData, "pageId");

  const client = await createSupabaseServerClient();
  const { error } = await client.from("pages").delete().eq("id", pageId).eq("tenant_id", tenant.id);

  if (error) {
    logger.error("cms.page.delete_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Page delete failed.", { cause: error });
  }

  logger.info("cms.page.deleted", { tenantId: tenant.id, pageId });
  revalidatePath(`/dashboard/${tenant.slug}/contenido`);
  revalidatePath("/sitio", "layout");
}
