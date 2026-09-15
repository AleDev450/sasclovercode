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
import { DatabaseError, ExternalServiceError, ValidationError } from "@/lib/errors";
import type { FormState } from "@/lib/forms/state";
import { logger } from "@/lib/logger";
import { PERMISSIONS } from "@/lib/permissions";
import { requirePermission } from "@/lib/permissions/check";
import { validateAsset } from "@/lib/storage/assets";
import { TENANT_ASSETS_BUCKET } from "@/lib/storage/assets";
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
 * Uploads a branding asset.
 *
 * The path is built from the tenant the SERVER resolved, and the extension from
 * the VALIDATED MIME type - never from the uploaded filename, which is
 * attacker-controlled and is the usual way a wrong file type ends up stored.
 */
export async function uploadBrandingAssetAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tenant = await requireSettingsAccess(formData);

  const file = formData.get("file");
  const kind = readText(formData, "kind");

  if (!(file instanceof File)) {
    return { status: "error", fieldErrors: { file: ["Selecciona un archivo."] } };
  }
  if (kind !== "logo" && kind !== "favicon") {
    return { status: "error", fieldErrors: { file: ["Tipo de recurso invalido."] } };
  }

  let asset;
  try {
    asset = validateAsset({
      tenantId: tenant.id,
      folder: "branding",
      basename: kind,
      file: { size: file.size, type: file.type },
    });
  } catch (error) {
    if (error instanceof ValidationError) {
      logger.warn("asset.rejected", { tenantId: tenant.id, reason: error.message });
      return { status: "error", fieldErrors: error.fieldErrors };
    }
    throw error;
  }

  const client = await createSupabaseServerClient();

  const { error: uploadError } = await client.storage
    .from(TENANT_ASSETS_BUCKET)
    .upload(asset.path, file, { contentType: asset.contentType, upsert: true });

  if (uploadError) {
    logger.error("asset.upload_failed", { tenantId: tenant.id, error: uploadError });
    throw new ExternalServiceError("Storage", "Asset upload failed.", { cause: uploadError });
  }

  const { error: themeError } = await client
    .from("tenant_themes")
    .update(kind === "logo" ? { logo_path: asset.path } : { favicon_path: asset.path })
    .eq("tenant_id", tenant.id);

  if (themeError) {
    logger.error("asset.path_save_failed", { tenantId: tenant.id, error: themeError });
    throw new DatabaseError("Asset path save failed.", { cause: themeError });
  }

  logger.info("asset.uploaded", { tenantId: tenant.id, folder: "branding", bytes: asset.bytes });
  revalidatePath(`/dashboard/${tenant.slug}/configuracion/tema`);

  return { status: "success", message: "Archivo subido." };
}
