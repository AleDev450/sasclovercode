/**
 * What each asset folder accepts, and how big.
 *
 * WHY THIS IS A FILE OF ITS OWN. `assets.ts` is `server-only` - correctly, it
 * builds storage paths and reads permissions - but the UPLOAD CONTROL is a
 * client component, and it needs the same three facts the server validates
 * with: which types are allowed, how large a file may be, and what to put in
 * the `accept` attribute so the file picker does not offer a PDF for a photo.
 *
 * Duplicating them in the component is how the two drift, and the drift is
 * always in the direction that hurts: the browser offers something the server
 * then rejects, and the person finds out after the upload. One declaration,
 * imported by both sides, makes that impossible.
 *
 * Nothing here is a security control. The server re-derives every one of these
 * from this same file before it writes, and the bucket enforces its own ceiling
 * underneath that; this is the copy that makes the FORM honest.
 */

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
export const ALLOWED_TYPES: Record<AssetFolder, Readonly<Record<string, string>>> = {
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
export const MAX_BYTES: Record<AssetFolder, number> = {
  branding: 2 * 1024 * 1024,
  products: 3 * 1024 * 1024,
  banners: 4 * 1024 * 1024,
  documents: 5 * 1024 * 1024,
};

export function isAssetFolder(value: string): value is AssetFolder {
  return (ASSET_FOLDERS as readonly string[]).includes(value);
}

/** The `accept` attribute for a file input pointed at this folder. */
export function acceptAttribute(folder: AssetFolder): string {
  return Object.keys(ALLOWED_TYPES[folder]).join(",");
}

/** `PNG, JPG, WEBP` - the extensions, upper-cased, for a hint under the field. */
export function acceptedExtensions(folder: AssetFolder): string {
  return [...new Set(Object.values(ALLOWED_TYPES[folder]))].join(", ").toUpperCase();
}

/** The per-folder ceiling in whole megabytes, for the same hint. */
export function maxMegabytes(folder: AssetFolder): number {
  return Math.floor(MAX_BYTES[folder] / (1024 * 1024));
}

/** `1.4 MB`. For naming a file's weight in a list the person is looking at. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
