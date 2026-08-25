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
 */

import { ValidationError } from "@/lib/errors";

export const TENANT_ASSETS_BUCKET = "tenant-assets";

/** Folders a tenant may write into, from master section 32. */
export const ASSET_FOLDERS = ["branding", "products", "banners", "documents"] as const;
export type AssetFolder = (typeof ASSET_FOLDERS)[number];

/**
 * MIME allow-list per folder, with the extension we will actually use.
 *
 * An allow-list and not a deny-list: a deny-list is a promise to have thought
 * of every dangerous type, which nobody can keep. `image/svg+xml` is absent
 * from branding on purpose - an SVG is a document that can carry script, and
 * serving one from the tenant's own origin would be stored XSS.
 */
const ALLOWED: Record<AssetFolder, Readonly<Record<string, string>>> = {
  branding: {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/x-icon": "ico",
  },
  products: {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
  },
  banners: {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
  },
  documents: {
    "application/pdf": "pdf",
  },
};

/** Per-folder size ceilings, all below the bucket's own limit. */
const MAX_BYTES: Record<AssetFolder, number> = {
  branding: 2 * 1024 * 1024,
  products: 3 * 1024 * 1024,
  banners: 4 * 1024 * 1024,
  documents: 5 * 1024 * 1024,
};

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

  const allowed = ALLOWED[folder];
  const extension = allowed[file.type];

  if (extension === undefined) {
    throw new ValidationError("Tipo de archivo no permitido.", {
      file: [`Formatos aceptados: ${Object.values(allowed).join(", ")}.`],
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
