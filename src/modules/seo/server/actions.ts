"use server";

/**
 * SEO Server Actions.
 *
 * Same three layers as every other write in the system: the page guard, the
 * explicit `requirePermission` here, and RLS underneath. A Server Action is
 * reachable directly - it is an HTTP endpoint - so the page guard is never the
 * check that matters.
 *
 * `content.manage` and not `settings.manage`: SEO is what a page says about
 * itself, so whoever may publish the page may write it. Splitting them would
 * mean a content editor could publish a page they cannot title.
 */

import { revalidatePath } from "next/cache";
import { DatabaseError } from "@/lib/errors";
import type { FormState } from "@/lib/forms/state";
import { logger } from "@/lib/logger";
import { PERMISSIONS } from "@/lib/permissions";
import { requirePermission } from "@/lib/permissions/check";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireActiveTenant } from "@/lib/tenant/active";
import { toFieldErrors } from "@/lib/validation";
import { pageSeoSchema, tenantSeoSchema } from "../schemas";

function readText(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

async function requireSeoAccess(formData: FormData) {
  const tenant = await requireActiveTenant(readText(formData, "tenantSlug"));
  await requirePermission(tenant.id, PERMISSIONS.CONTENT_MANAGE);
  return tenant;
}

export async function updateTenantSeoAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireSeoAccess(formData);

  const parsed = tenantSeoSchema.safeParse({
    siteTitle: readText(formData, "siteTitle"),
    siteDescription: readText(formData, "siteDescription"),
    ogTitle: readText(formData, "ogTitle"),
    ogDescription: readText(formData, "ogDescription"),
    ogImagePath: readText(formData, "ogImagePath"),
    twitterImagePath: readText(formData, "twitterImagePath"),
    robotsIndex: readText(formData, "robotsIndex"),
    googleVerification: readText(formData, "googleVerification"),
  });

  if (!parsed.success) {
    return { status: "error", fieldErrors: toFieldErrors(parsed.error) };
  }

  const input = parsed.data;
  const client = await createSupabaseServerClient();

  // UPDATE, never UPSERT. The row is created by the tenant trigger and the
  // table has no INSERT policy (Phase 06 A6-1), so an upsert would fail on the
  // one path it exists to cover.
  const { error } = await client
    .from("tenant_seo")
    .update({
      site_title: input.siteTitle,
      site_description: input.siteDescription,
      og_title: input.ogTitle,
      og_description: input.ogDescription,
      og_image_path: input.ogImagePath,
      twitter_image_path: input.twitterImagePath,
      robots_index: input.robotsIndex,
      google_verification: input.googleVerification,
    })
    .eq("tenant_id", tenant.id);

  if (error) {
    logger.error("seo.tenant.update_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("SEO update failed.", { cause: error });
  }

  logger.info("seo.tenant.updated", { tenantId: tenant.id });
  revalidatePath(`/dashboard/${tenant.slug}/contenido/seo`);
  // The public site renders from these values, so its cache is stale too.
  revalidatePath("/sitio", "layout");

  return { status: "success", message: "SEO del sitio guardado." };
}

export async function updatePageSeoAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireSeoAccess(formData);
  const pageId = readText(formData, "pageId");

  const parsed = pageSeoSchema.safeParse({
    seoTitle: readText(formData, "seoTitle"),
    seoDescription: readText(formData, "seoDescription"),
    ogImagePath: readText(formData, "ogImagePath"),
  });

  if (!parsed.success) {
    return { status: "error", fieldErrors: toFieldErrors(parsed.error) };
  }

  const input = parsed.data;
  const client = await createSupabaseServerClient();

  // Filtered by tenant AND by id. The id comes from the form, so it is a
  // client-supplied value: without the tenant filter this would write another
  // company's page whenever RLS was not the last line of defence.
  const { error } = await client
    .from("pages")
    .update({
      seo_title: input.seoTitle,
      seo_description: input.seoDescription,
      og_image_path: input.ogImagePath,
    })
    .eq("tenant_id", tenant.id)
    .eq("id", pageId);

  if (error) {
    logger.error("seo.page.update_failed", { tenantId: tenant.id, pageId, error });
    throw new DatabaseError("Page SEO update failed.", { cause: error });
  }

  logger.info("seo.page.updated", { tenantId: tenant.id, pageId });
  revalidatePath(`/dashboard/${tenant.slug}/contenido/${pageId}`);
  revalidatePath("/sitio", "layout");

  return { status: "success", message: "SEO de la pagina guardado." };
}
