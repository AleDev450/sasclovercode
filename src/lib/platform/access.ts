import "server-only";

/**
 * Platform operator access.
 *
 * Master section 29: `SUPER_ADMIN` of CloverCode is never `OWNER` of a tenant.
 * Nothing in this file reads a tenant role, and nothing in the authorization
 * layer reads platform status. Keeping the two apart in code mirrors keeping
 * them apart in the schema.
 */

import { notFound } from "next/navigation";
import { cache } from "react";
import { logger } from "@/lib/logger";
import { getCurrentUser } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { CloverCodeSupabaseClient } from "@/lib/supabase/types";
import { DatabaseError } from "@/lib/errors";

export interface PlatformOptions {
  readonly client?: CloverCodeSupabaseClient;
}

/** True when the signed-in user is an ACTIVE CloverCode operator. */
export async function isPlatformAdmin(options: PlatformOptions = {}): Promise<boolean> {
  const client = options.client ?? (await createSupabaseServerClient());

  const { data, error } = await client.rpc("is_platform_admin");

  if (error) {
    logger.error("platform.access.check_failed", { error });
    throw new DatabaseError("Platform access check failed.", { cause: error });
  }

  return data === true;
}

/** Memoised per request, so a layout and its pages share one round trip. */
export const getIsPlatformAdmin = cache(async (): Promise<boolean> => isPlatformAdmin());

/**
 * Guards the platform area.
 *
 * 404, not 403, on purpose: a 403 would confirm to a signed-in stranger that
 * `/super-admin` exists and that they merely lack the key (SPEC AB-403).
 *
 * Uses Next's `notFound()` rather than our own `NotFoundError` - see the note
 * on `requireActiveTenant`: producing a 404 from a Server Component is
 * `notFound()`'s job, and inferring it from a custom class is undocumented.
 */
export async function requirePlatformAdmin(): Promise<void> {
  const user = await getCurrentUser();

  if (user === null || !(await getIsPlatformAdmin())) {
    logger.warn("platform.access.denied", { userId: user?.id ?? null });
    notFound();
  }
}
