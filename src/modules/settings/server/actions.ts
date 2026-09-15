"use server";

/**
 * Business settings Server Actions.
 *
 * Each one resolves the tenant from the URL segment (already verified by
 * `requireActiveTenant`), then requires `settings.manage` in THAT tenant, and
 * then writes - at which point RLS checks the same permission again.
 *
 * Three layers for one write is deliberate: a Server Action is reachable
 * directly, so the page guard is not enough, and the database is the only layer
 * that cannot be bypassed.
 */

import { revalidatePath } from "next/cache";
import { DatabaseError } from "@/lib/errors";
import type { FormState } from "@/lib/forms/state";
import { logger } from "@/lib/logger";
import { PERMISSIONS } from "@/lib/permissions";
import { requirePermission } from "@/lib/permissions/check";
import { assetFolderFromPath, isOwnAssetPath } from "@/lib/storage/assets";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireActiveTenant } from "@/lib/tenant/active";
import { toFieldErrors } from "@/lib/validation";
import { businessSettingsSchema, socialLinkSchema, themeSchema } from "../schemas";
import { findPreset } from "../theme-presets";

function readText(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

/** Resolves the tenant and asserts the permission. Every action starts here. */
async function requireSettingsAccess(formData: FormData) {
  const tenant = await requireActiveTenant(readText(formData, "tenantSlug"));
  await requirePermission(tenant.id, PERMISSIONS.SETTINGS_MANAGE);
  return tenant;
}

export async function updateBusinessSettingsAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireSettingsAccess(formData);

  const parsed = businessSettingsSchema.safeParse({
    legalName: readText(formData, "legalName"),
    tradeName: readText(formData, "tradeName"),
    taxId: readText(formData, "taxId"),
    contactEmail: readText(formData, "contactEmail"),
    phone: readText(formData, "phone"),
    whatsapp: readText(formData, "whatsapp"),
    addressLine: readText(formData, "addressLine"),
    district: readText(formData, "district"),
    city: readText(formData, "city"),
    currency: readText(formData, "currency"),
    timezone: readText(formData, "timezone"),
  });

  if (!parsed.success) {
    return { status: "error", fieldErrors: toFieldErrors(parsed.error) };
  }

  const input = parsed.data;
  const client = await createSupabaseServerClient();

  const { error } = await client
    .from("tenant_settings")
    .update({
      legal_name: input.legalName,
      trade_name: input.tradeName,
      tax_id: input.taxId,
      contact_email: input.contactEmail,
      phone: input.phone,
      whatsapp: input.whatsapp,
      address_line: input.addressLine,
      district: input.district,
      city: input.city,
      currency: input.currency,
      timezone: input.timezone,
    })
    .eq("tenant_id", tenant.id);

  if (error) {
    logger.error("settings.update_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Settings update failed.", { cause: error });
  }

  logger.info("settings.updated", { tenantId: tenant.id });
  revalidatePath(`/dashboard/${tenant.slug}/configuracion`);

  return { status: "success", message: "Configuracion guardada." };
}

/**
 * Applies one of the offered themes.
 *
 * WHY THIS IS NOT `updateThemeAction` WITH FIVE HIDDEN FIELDS. A form that
 * posts the colours would let a caller send any five values under the name of a
 * preset, so the "preset" would be a label on arbitrary input rather than a
 * choice from a list. Sending the ID and resolving it on the server means the
 * set of reachable outcomes is exactly the set in `theme-presets.ts`.
 *
 * It still writes through the same five columns and the same schema as the
 * custom editor: a preset is a starting point, not a mode, and nothing
 * downstream can tell which path wrote the row.
 */
export async function applyThemePresetAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireSettingsAccess(formData);

  const preset = findPreset(readText(formData, "presetId"));
  if (preset === undefined) {
    return { status: "error", message: "Ese tema no existe." };
  }

  // Through the schema, not straight to the update. The presets are literals in
  // this repository and should always pass - which is exactly why running them
  // through the same validation costs nothing and catches the day somebody adds
  // a ninth preset with a typo in a hex value.
  const parsed = themeSchema.safeParse({
    primaryColor: preset.primaryColor,
    accentColor: preset.accentColor,
    backgroundColor: preset.backgroundColor,
    fontFamily: preset.fontFamily,
    borderRadius: preset.borderRadius,
  });

  if (!parsed.success) {
    logger.error("theme.preset_invalid", { presetId: preset.id });
    return { status: "error", message: "Ese tema no se pudo aplicar." };
  }

  const input = parsed.data;
  const client = await createSupabaseServerClient();

  const { error } = await client
    .from("tenant_themes")
    .update({
      primary_color: input.primaryColor,
      accent_color: input.accentColor,
      background_color: input.backgroundColor,
      font_family: input.fontFamily,
      border_radius: input.borderRadius,
    })
    .eq("tenant_id", tenant.id);

  if (error) {
    logger.error("theme.preset_apply_failed", { tenantId: tenant.id, presetId: preset.id, error });
    throw new DatabaseError("Theme preset update failed.", { cause: error });
  }

  logger.info("theme.preset_applied", { tenantId: tenant.id, presetId: preset.id });
  revalidatePath(`/dashboard/${tenant.slug}/configuracion/tema`);
  // The public site renders the theme, so its cache is stale the moment this
  // succeeds.
  revalidatePath("/sitio", "layout");

  return { status: "success", message: `Tema "${preset.name}" aplicado.` };
}

export async function updateThemeAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireSettingsAccess(formData);

  const parsed = themeSchema.safeParse({
    primaryColor: readText(formData, "primaryColor"),
    accentColor: readText(formData, "accentColor"),
    backgroundColor: readText(formData, "backgroundColor"),
    fontFamily: readText(formData, "fontFamily"),
    borderRadius: readText(formData, "borderRadius"),
  });

  if (!parsed.success) {
    return { status: "error", fieldErrors: toFieldErrors(parsed.error) };
  }

  const input = parsed.data;
  const client = await createSupabaseServerClient();

  const { error } = await client
    .from("tenant_themes")
    .update({
      primary_color: input.primaryColor,
      accent_color: input.accentColor,
      background_color: input.backgroundColor,
      font_family: input.fontFamily,
      border_radius: input.borderRadius,
    })
    .eq("tenant_id", tenant.id);

  if (error) {
    logger.error("theme.update_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Theme update failed.", { cause: error });
  }

  logger.info("theme.updated", { tenantId: tenant.id });
  revalidatePath(`/dashboard/${tenant.slug}/configuracion/tema`);
  revalidatePath("/sitio", "layout");

  return { status: "success", message: "Tema guardado." };
}

export async function upsertSocialLinkAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireSettingsAccess(formData);

  const parsed = socialLinkSchema.safeParse({
    platform: readText(formData, "platform"),
    url: readText(formData, "url"),
    position: readText(formData, "position") || 0,
  });

  if (!parsed.success) {
    return { status: "error", fieldErrors: toFieldErrors(parsed.error) };
  }

  const input = parsed.data;
  const client = await createSupabaseServerClient();

  const { error } = await client.from("tenant_social_links").upsert(
    {
      tenant_id: tenant.id,
      platform: input.platform,
      url: input.url,
      position: input.position,
    },
    { onConflict: "tenant_id,platform" },
  );

  if (error) {
    logger.error("settings.social_link_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Social link save failed.", { cause: error });
  }

  revalidatePath(`/dashboard/${tenant.slug}/configuracion`);
  return { status: "success", message: "Enlace guardado." };
}

/**
 * Saves which stored files are this business's logo and favicon.
 *
 * WHAT THIS REPLACES. `uploadBrandingAssetAction` - a single action that both
 * uploaded the file AND wrote the column, and which no component in the
 * repository ever called. It had existed since Phase 06, so for six phases a
 * business could not put its own logo on its own website, and the theme screen
 * did not mention that a logo was a thing it could have.
 *
 * Splitting it in two is what made the control possible. The upload happens the
 * moment a file is dropped (`modules/assets`), because a person needs to see
 * the thumbnail to know it worked; THIS runs when they press save, because
 * which file is the logo is a decision, not a side effect of choosing a file.
 * Uploading and then changing your mind now costs nothing.
 *
 * The paths are re-checked against this tenant's own folder. They arrive from
 * the browser, and a path is the one part of an upload that a caller could
 * retype - `isOwnAssetPath` is why pointing at another business's file is not
 * storable, on top of the CHECK the column would fail anyway.
 */
export async function updateBrandingAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireSettingsAccess(formData);

  const logoPath = readText(formData, "logoPath").trim();
  const faviconPath = readText(formData, "faviconPath").trim();

  const invalid = [logoPath, faviconPath].some(
    (path) =>
      path.length > 0 &&
      (!isOwnAssetPath(tenant.id, path) || assetFolderFromPath(path) !== "branding"),
  );

  if (invalid) {
    logger.warn("branding.foreign_path", { tenantId: tenant.id });
    return { status: "error", message: "Ese archivo no es de esta empresa." };
  }

  const client = await createSupabaseServerClient();
  const { error } = await client
    .from("tenant_themes")
    .update({
      logo_path: logoPath.length > 0 ? logoPath : null,
      favicon_path: faviconPath.length > 0 ? faviconPath : null,
    })
    .eq("tenant_id", tenant.id);

  if (error) {
    logger.error("branding.save_failed", { tenantId: tenant.id, error });
    throw new DatabaseError("Branding save failed.", { cause: error });
  }

  logger.info("branding.saved", { tenantId: tenant.id });
  revalidatePath(`/dashboard/${tenant.slug}/configuracion/tema`);
  // The public site paints the logo and serves the favicon, so its cache is
  // stale the moment this succeeds.
  revalidatePath("/sitio", "layout");

  return { status: "success", message: "Marca guardada." };
}
