"use server";

/**
 * Uploading, listing and deleting the files a business owns.
 *
 * WHY THESE RETURN VALUES INSTEAD OF DRIVING A FORM. Every other action in this
 * codebase is a `useActionState` reducer, and that is right for a form that is
 * submitted once. An upload control is not that shape: the person drops a file
 * and must see the thumbnail immediately, while the surrounding form - the
 * product, the page section - has not been submitted and must not be. So these
 * are called imperatively from the client and hand back the stored path, which
 * the control puts into a hidden input for the real form to submit later.
 *
 * It is still a Server Action, so it is still a POST to this origin with the
 * framework's own protections, and it still re-derives everything:
 *
 *   1. `requireActiveTenant` turns the slug into a tenant this caller belongs
 *      to, or 404s.
 *   2. `requirePermission` asks for the permission the FOLDER demands, not a
 *      blanket one (`ASSET_FOLDER_PERMISSION`).
 *   3. `validateAsset` builds the path from the tenant the SERVER resolved and
 *      the extension from the VALIDATED MIME type.
 *   4. The Storage policy re-reads the tenant and the folder out of the path
 *      and checks the permission again. That is the layer that cannot be
 *      bypassed; the three above exist so a refusal is legible.
 */

import { AuthorizationError, ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { requirePermission } from "@/lib/permissions/check";
import {
  ASSET_FOLDER_PERMISSION,
  TENANT_ASSETS_BUCKET,
  assetFolderFromPath,
  isOwnAssetPath,
  tenantFolderPrefix,
  uniqueBasename,
  validateAsset,
} from "@/lib/storage/assets";
import { isAssetFolder, type AssetFolder } from "@/lib/storage/asset-folders";
import { signAssetPaths } from "@/lib/storage/sign";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireActiveTenant } from "@/lib/tenant/active";
import type {
  AssetDeleteResult,
  AssetListResult,
  AssetResolveResult,
  AssetUploadResult,
  StoredAsset,
} from "../types";

/** How many files the library panel shows. It is a picker, not an archive. */
const LIBRARY_LIMIT = 60;

/**
 * The tenant an asset call was authorised against.
 *
 * A named type and not an inline `Promise<{ id: string; slug: string }>`,
 * because TEST-2507 reads this file with brace matching to prove every Server
 * Action reaches a gate - and an object literal in a return type is the first
 * `{` it finds, so the helper body it went on to search was the type, not the
 * function. The test was right and unreadable; this is the cheaper half of the
 * fix.
 */
interface AssetTenant {
  readonly id: string;
  readonly slug: string;
}

function readText(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

/**
 * Resolves the tenant and asserts the permission THIS FOLDER demands.
 *
 * Returns the tenant rather than throwing to the caller's caller: every export
 * below turns a refusal into `{ ok: false }` with a sentence in it.
 */
async function requireFolderAccess(tenantSlug: string, folder: AssetFolder): Promise<AssetTenant> {
  const tenant = await requireActiveTenant(tenantSlug);
  await requirePermission(tenant.id, ASSET_FOLDER_PERMISSION[folder]);
  return { id: tenant.id, slug: tenant.slug };
}

/** The last path segment: `foto-a1b2c3d4.jpg`. */
function fileNameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export async function uploadTenantAssetAction(formData: FormData): Promise<AssetUploadResult> {
  const folderValue = readText(formData, "folder");
  if (!isAssetFolder(folderValue)) {
    return { ok: false, error: "Carpeta de archivos invalida." };
  }
  const folder = folderValue;

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return { ok: false, error: "Selecciona un archivo." };
  }

  let tenant;
  try {
    tenant = await requireFolderAccess(readText(formData, "tenantSlug"), folder);
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return { ok: false, error: "No tienes permiso para subir archivos aqui." };
    }
    throw error;
  }

  /*
   * A fixed basename REPLACES, a generated one COLLECTS.
   *
   * The logo is one thing that changes; a product photo is one of many. Letting
   * the caller choose which it is - rather than always generating - is what
   * keeps `logo.png` from turning into eleven orphaned logos, and it is safe
   * because `validateAsset` strips the value to `[a-z0-9-]` and the path is
   * still built around the tenant the server resolved.
   */
  const fixedBasename = readText(formData, "basename").trim();
  const replaces = fixedBasename.length > 0;
  const basename = replaces ? fixedBasename : uniqueBasename(file.name);

  let asset;
  try {
    asset = validateAsset({
      tenantId: tenant.id,
      folder,
      basename,
      file: { size: file.size, type: file.type },
    });
  } catch (error) {
    if (error instanceof ValidationError) {
      logger.warn("asset.rejected", { tenantId: tenant.id, folder, reason: error.message });
      // The field messages carry the useful sentence ("El maximo es 3 MB.");
      // the title is the category. The control shows one line, so prefer the
      // specific one.
      const detail = Object.values(error.fieldErrors ?? {})[0]?.[0];
      return { ok: false, error: detail ?? error.message };
    }
    throw error;
  }

  const client = await createSupabaseServerClient();
  const { error: uploadError } = await client.storage
    .from(TENANT_ASSETS_BUCKET)
    .upload(asset.path, file, { contentType: asset.contentType, upsert: replaces });

  if (uploadError) {
    logger.error("asset.upload_failed", { tenantId: tenant.id, folder, error: uploadError });
    return { ok: false, error: "No se pudo subir el archivo. Intenta de nuevo." };
  }

  const signed = await signAssetPaths([asset.path]);
  const url = signed.get(asset.path);

  if (url === undefined) {
    // Stored but not displayable. Say so rather than handing back a card with
    // a broken image in it.
    logger.error("asset.sign_after_upload_failed", { tenantId: tenant.id, path: asset.path });
    return { ok: false, error: "El archivo se subio pero no se pudo mostrar. Recarga la pagina." };
  }

  logger.info("asset.uploaded", { tenantId: tenant.id, folder, bytes: asset.bytes });

  return {
    ok: true,
    asset: {
      path: asset.path,
      url,
      name: fileNameOf(asset.path),
      bytes: asset.bytes,
      folder,
    },
  };
}

/**
 * What this business already has in a folder.
 *
 * The point of the library panel: a business that photographed its ten dishes
 * once should not have to find the files again to put one on a page. Sorted
 * newest first, because the thing somebody wants is almost always the thing
 * they just uploaded.
 */
export async function listTenantAssetsAction(formData: FormData): Promise<AssetListResult> {
  const folderValue = readText(formData, "folder");
  if (!isAssetFolder(folderValue)) {
    return { ok: false, error: "Carpeta de archivos invalida." };
  }
  const folder = folderValue;

  let tenant;
  try {
    tenant = await requireFolderAccess(readText(formData, "tenantSlug"), folder);
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return { ok: false, error: "No tienes permiso para ver estos archivos." };
    }
    throw error;
  }

  const prefix = tenantFolderPrefix(tenant.id, folder);
  const client = await createSupabaseServerClient();

  const { data, error } = await client.storage.from(TENANT_ASSETS_BUCKET).list(prefix, {
    limit: LIBRARY_LIMIT,
    sortBy: { column: "created_at", order: "desc" },
  });

  if (error) {
    logger.error("asset.list_failed", { tenantId: tenant.id, folder, error });
    return { ok: false, error: "No se pudo cargar la galeria." };
  }

  // `list` returns a placeholder row for the folder itself in some backends;
  // anything without an id is not an object.
  const objects = (data ?? []).filter((entry) => entry.id !== null && entry.name.includes("."));
  const paths = objects.map((entry) => `${prefix}/${entry.name}`);
  const signed = await signAssetPaths(paths);

  const assets: StoredAsset[] = [];
  for (const entry of objects) {
    const path = `${prefix}/${entry.name}`;
    const url = signed.get(path);
    if (url === undefined) continue;

    assets.push({
      path,
      url,
      name: entry.name,
      bytes: typeof entry.metadata?.size === "number" ? entry.metadata.size : 0,
      folder,
    });
  }

  return { ok: true, assets };
}

/**
 * Signed URLs for paths that are already stored.
 *
 * The control needs this on mount: a product being edited already has a photo,
 * and its row holds a PATH. Without this the field would come up empty and
 * invite somebody to re-upload what is already there.
 *
 * WHY IT TAKES A FOLDER AND CHECKS ITS PERMISSION. The Storage read policy is
 * `is_tenant_member`, so membership is genuinely enough for the database to
 * hand these over - which was the first implementation, and TEST-2507 was right
 * to reject it. An action that signs URLs is worth holding to the same standard
 * as the one that writes them, and the caller always knows which folder it is
 * asking about: the control is configured with one. Paths outside that folder,
 * or outside this tenant, are dropped rather than refused, so a stale path in a
 * row degrades to an empty thumbnail instead of an error.
 */
export async function resolveTenantAssetsAction(formData: FormData): Promise<AssetResolveResult> {
  const folderValue = readText(formData, "folder");
  if (!isAssetFolder(folderValue)) {
    return { ok: false, error: "Carpeta de archivos invalida." };
  }
  const folder = folderValue;

  let raw: unknown;
  try {
    raw = JSON.parse(readText(formData, "paths") || "[]");
  } catch {
    return { ok: false, error: "Peticion invalida." };
  }
  if (!Array.isArray(raw)) return { ok: false, error: "Peticion invalida." };

  const requested = raw.filter((value): value is string => typeof value === "string").slice(0, 60);
  if (requested.length === 0) return { ok: true, urls: {} };

  let tenant;
  try {
    tenant = await requireFolderAccess(readText(formData, "tenantSlug"), folder);
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return { ok: false, error: "No tienes permiso para ver estos archivos." };
    }
    throw error;
  }

  // Filtered BEFORE the signing call, not after: Storage would refuse a foreign
  // path under the caller's own policies anyway, and we should never ask on
  // behalf of somebody who should not be asking.
  const allowed = requested.filter(
    (path) => isOwnAssetPath(tenant.id, path) && assetFolderFromPath(path) === folder,
  );

  const signed = await signAssetPaths(allowed);
  return { ok: true, urls: Object.fromEntries(signed) };
}

/**
 * Removes a file from storage.
 *
 * It does NOT remove references to it. A path can be stored in a product image
 * row, in a page section, and in the theme at the same time, and this action
 * cannot know which; the screens that own those rows delete their own. What
 * this prevents is the other failure - a business that replaced its menu photos
 * five times and pays for thirty files it cannot see.
 */
export async function deleteTenantAssetAction(formData: FormData): Promise<AssetDeleteResult> {
  const path = readText(formData, "path");
  const folder = assetFolderFromPath(path);

  if (folder === null) {
    return { ok: false, error: "Ese archivo no existe." };
  }

  let tenant;
  try {
    tenant = await requireFolderAccess(readText(formData, "tenantSlug"), folder);
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return { ok: false, error: "No tienes permiso para borrar este archivo." };
    }
    throw error;
  }

  // The path names a tenant; the caller named a tenant. They must be the same
  // one, or this is a request to delete out of somebody else's folder.
  if (!isOwnAssetPath(tenant.id, path)) {
    logger.warn("asset.delete_foreign_path", { tenantId: tenant.id });
    return { ok: false, error: "Ese archivo no es de esta empresa." };
  }

  const client = await createSupabaseServerClient();
  const { error } = await client.storage.from(TENANT_ASSETS_BUCKET).remove([path]);

  if (error) {
    logger.error("asset.delete_failed", { tenantId: tenant.id, folder, error });
    return { ok: false, error: "No se pudo borrar el archivo." };
  }

  logger.info("asset.deleted", { tenantId: tenant.id, folder });
  return { ok: true };
}
