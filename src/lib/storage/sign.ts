import "server-only";

/**
 * Turning stored paths into URLs a browser can fetch.
 *
 * The bucket is private (Phase 06), so `getPublicUrl` returns a URL nobody can
 * fetch - including the legitimate visitor. Signing is the only way a private
 * object reaches a browser, and it is asynchronous, which is why every caller
 * resolves the whole set first and renders second.
 *
 * WHY IT LIVES IN `lib` NOW. It was a function inside the CMS site context,
 * which was right while the public website was the only thing that displayed an
 * image. The admin side displays them too from the moment there is an upload
 * control, and a second copy of "sign a batch of paths" is a second place for
 * the expiry to be chosen differently. `modules/cms/server/site-context.ts`
 * re-exports this one so its existing callers are untouched.
 */

import { logger } from "@/lib/logger";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { TENANT_ASSETS_BUCKET } from "./assets";

/**
 * One hour: long enough for a page view and the images on it, short enough that
 * a leaked URL stops working.
 */
export const DEFAULT_SIGNED_URL_TTL_SECONDS = 60 * 60;

/**
 * Signs the asset paths a page needs, in one round trip.
 *
 * Returned as a Map rather than a function because signing is asynchronous and
 * a renderer needs the value synchronously. A path that fails to sign is simply
 * absent from the map, and every renderer treats absence as "skip this image"
 * rather than emitting a broken one.
 */
export async function signAssetPaths(
  paths: readonly string[],
  expiresIn: number = DEFAULT_SIGNED_URL_TTL_SECONDS,
): Promise<Map<string, string>> {
  const unique = [...new Set(paths)];
  const signed = new Map<string, string>();
  if (unique.length === 0) return signed;

  const client = await createSupabaseServerClient();
  const { data, error } = await client.storage
    .from(TENANT_ASSETS_BUCKET)
    .createSignedUrls(unique, expiresIn);

  if (error) {
    logger.error("storage.sign_failed", { count: unique.length, error });
    return signed;
  }

  for (const entry of data ?? []) {
    if (entry.signedUrl !== null && entry.path !== null) {
      signed.set(entry.path, entry.signedUrl);
    }
  }
  return signed;
}
