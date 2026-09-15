/**
 * The contract between the upload control and the server that stores files.
 *
 * Client-safe on purpose: the picker is a client component and imports these
 * shapes, so nothing here may reach for `server-only` code.
 *
 * EVERY RESULT IS A DISCRIMINATED UNION, NEVER A THROW. A rejected upload is
 * an ordinary outcome - the file was a PDF, or eight megabytes, or the person
 * lost the permission between opening the page and dropping the file - and an
 * exception crossing the Server Action boundary reaches the browser as a
 * digest with no message in it. The person deserves the actual sentence.
 */

import type { AssetFolder } from "@/lib/storage/asset-folders";

export interface StoredAsset {
  /** What gets saved in a row: `tenants/{id}/{folder}/{name}.{ext}`. */
  readonly path: string;
  /** Signed, and therefore temporary. Never store this. */
  readonly url: string;
  /** The file name, for a list somebody reads. */
  readonly name: string;
  readonly bytes: number;
  readonly folder: AssetFolder;
}

export type AssetUploadResult =
  | { readonly ok: true; readonly asset: StoredAsset }
  | { readonly ok: false; readonly error: string };

export type AssetListResult =
  | { readonly ok: true; readonly assets: readonly StoredAsset[] }
  | { readonly ok: false; readonly error: string };

export type AssetDeleteResult =
  { readonly ok: true } | { readonly ok: false; readonly error: string };

/** Signed URLs for paths that are already stored, keyed by path. */
export type AssetResolveResult =
  | { readonly ok: true; readonly urls: Readonly<Record<string, string>> }
  | { readonly ok: false; readonly error: string };
