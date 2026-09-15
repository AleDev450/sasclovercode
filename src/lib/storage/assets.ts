import "server-only";

/**
 * File validation and path construction for tenant assets.
 *
 * CLOVERCODE_MASTER.md section 32: validate size, MIME, permissions and tenant.
 * Permissions and tenant are enforced by the Storage policies; this file covers
 * size, MIME and the shape of the path.
 *
 * The path is built HERE from a tenant id the server already resolved. It is
 * never assembled from anything the client sent - and even if it were, the
 * policy reads the tenant back out of the path and would refuse it.
 *
 * WHAT MOVED OUT. The allow-list and the size ceilings now live in
 * `asset-folders.ts`, which carries no `server-only` marker, because the upload
 * control in the browser needs exactly those three facts to build an honest
 * file picker. They are imported back here and this module remains the only
 * place that turns them into a decision.
 */

import { ValidationError } from "@/lib/errors";
import { PERMISSIONS, type Permission } from "@/lib/permissions";
import {
  ALLOWED_TYPES,
  ASSET_FOLDERS,
  MAX_BYTES,
  isAssetFolder,
  type AssetFolder,
} from "./asset-folders";

export const TENANT_ASSETS_BUCKET = "tenant-assets";

export { ASSET_FOLDERS, isAssetFolder };
export type { AssetFolder };

export interface ValidatedAsset {
  readonly path: string;
  readonly contentType: string;
  readonly bytes: number;
}

/** True when the value looks like a v4-ish UUID. Guards path construction. */
function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/**
 * Validates a file and returns the path it must be stored at.
 *
 * `basename` names the asset (`logo`, `favicon`); the extension comes from the
 * VALIDATED MIME type, never from the uploaded filename. A filename is
 * attacker-controlled and is the usual way a `.php` ends up in a bucket.
 */
export function validateAsset(params: {
  tenantId: string;
  folder: AssetFolder;
  basename: string;
  file: { size: number; type: string };
}): ValidatedAsset {
  const { tenantId, folder, basename, file } = params;

  if (!isUuid(tenantId)) {
    throw new ValidationError("Tenant invalido.", { file: ["No se pudo determinar la empresa."] });
  }

  const allowed = ALLOWED_TYPES[folder];
  const extension = allowed[file.type];

  if (extension === undefined) {
    throw new ValidationError("Tipo de archivo no permitido.", {
      file: [`Formatos aceptados: ${[...new Set(Object.values(allowed))].join(", ")}.`],
    });
  }

  const limit = MAX_BYTES[folder];
  if (file.size <= 0) {
    throw new ValidationError("Archivo vacio.", { file: ["El archivo esta vacio."] });
  }
  if (file.size > limit) {
    throw new ValidationError("Archivo demasiado grande.", {
      file: [`El maximo es ${Math.floor(limit / (1024 * 1024))} MB.`],
    });
  }

  // Only [a-z0-9-]. Anything that could act as a separator or a traversal is
  // gone before it can reach the path.
  const safeBase = basename
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 40);

  if (safeBase.length === 0) {
    throw new ValidationError("Nombre de archivo invalido.", {
      file: ["El nombre del archivo no es valido."],
    });
  }

  return {
    path: `tenants/${tenantId}/${folder}/${safeBase}.${extension}`,
    contentType: file.type,
    bytes: file.size,
  };
}

/**
 * Which permission a folder's WRITES require.
 *
 * WHY THIS IS NOT `settings.manage` EVERYWHERE. That is what the Phase 06
 * storage policies said, and it was right when branding was the only thing
 * anybody uploaded. It stopped being right the moment product photos and page
 * images existed: `manager` holds `products.update` and cannot hold
 * `settings.manage`, so the person whose job is the menu could not put a photo
 * on it. The editor whose job is the website was in the same position with
 * `content.manage`.
 *
 * The mapping is mirrored by the storage policies in
 * `20260914130000_storage_folder_permissions.sql`, which read the folder out of
 * the object path itself. This copy is the one the application checks BEFORE
 * uploading, so a refusal is a readable error rather than an opaque 403 from
 * Storage - but the policy is the layer that actually enforces it.
 */
export const ASSET_FOLDER_PERMISSION: Record<AssetFolder, Permission> = {
  branding: PERMISSIONS.SETTINGS_MANAGE,
  products: PERMISSIONS.PRODUCTS_UPDATE,
  banners: PERMISSIONS.CONTENT_MANAGE,
  documents: PERMISSIONS.SETTINGS_MANAGE,
};

/**
 * The folder an existing asset path belongs to, or null when the path is not
 * one of ours.
 *
 * Used to authorise a DELETE, which arrives as a path rather than as a folder
 * choice. Parsing the path is the only honest way to answer it: trusting a
 * folder the client sent alongside would let a caller name the cheap folder
 * while deleting out of the expensive one.
 */
export function assetFolderFromPath(path: string): AssetFolder | null {
  const parts = path.split("/");
  if (parts.length < 4) return null;
  if (parts[0] !== "tenants") return null;
  if (!isUuid(parts[1] ?? "")) return null;
  const folder = parts[2] ?? "";
  return isAssetFolder(folder) ? folder : null;
}

/** True when `path` is inside THIS tenant's own folder. */
export function isOwnAssetPath(tenantId: string, path: string): boolean {
  return isUuid(tenantId) && path.startsWith(`tenants/${tenantId}/`);
}

/** The folder prefix a tenant's objects live under. */
export function tenantFolderPrefix(tenantId: string, folder: AssetFolder): string {
  return `tenants/${tenantId}/${folder}`;
}

/**
 * A basename nothing else will collide with.
 *
 * `validateAsset` is deliberately deterministic - `logo` always lands on
 * `logo.png`, so replacing a logo replaces it rather than accumulating eleven -
 * and that is exactly wrong for a gallery, where two uploads called `foto.jpg`
 * are two different photos. Callers that collect rather than replace pass the
 * result of this as `basename`.
 *
 * `crypto.randomUUID` and not a timestamp: two photos chosen in the same file
 * picker are uploaded in the same millisecond.
 */
export function uniqueBasename(hint: string): string {
  const stem = hint
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, "")
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24);

  return `${stem.length > 0 ? stem : "img"}-${crypto.randomUUID().slice(0, 8)}`;
}
