import "server-only";

/**
 * The feature layer.
 *
 * CLOVERCODE_MASTER.md section 33 (Phase 21) asks for this by name:
 *
 *   "Features deben evaluarse centralmente."
 *   "No llenar la aplicacion de condiciones dispersas."
 *   "Crear: hasFeature(), requireFeature() o equivalente."
 *
 * Every one of these calls resolves in PostgreSQL, through `has_module()`, so
 * the answer cannot be influenced by anything the client sends - and so a
 * trigger and a page asking the same question get the same answer, because it
 * is literally the same function (ADR-025 decision 1).
 *
 * Deliberately the same shape as `src/lib/permissions/check.ts`, down to the
 * names: a module and a permission are two different questions asked the same
 * way, and a reader who has seen one has seen both.
 *
 * The tenant is ALWAYS an explicit argument. A feature check whose tenant is
 * implicit is a check that will one day look at the wrong tenant.
 */

import { cache } from "react";
import { AuthorizationError, DatabaseError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { CloverCodeSupabaseClient } from "@/lib/supabase/types";
import { isModule, type Module } from "./modules";

export interface FeatureOptions {
  /** Injected by tests; production always builds a request-scoped client. */
  readonly client?: CloverCodeSupabaseClient;
}

/**
 * True when the tenant's plan (or an override) includes `module`.
 *
 * Never true by default: a tenant with no subscription has no modules
 * (ADR-025 decision 4). Fail-open would make the paywall decorative.
 */
export async function hasFeature(
  tenantId: string,
  module: Module,
  options: FeatureOptions = {},
): Promise<boolean> {
  const client = options.client ?? (await createSupabaseServerClient());

  const { data, error } = await client.rpc("has_module", {
    p_tenant_id: tenantId,
    p_module: module,
  });

  if (error) {
    logger.error("feature.check_failed", { tenantId, module, error });
    throw new DatabaseError("Module check failed.", {
      cause: error,
      context: { tenantId, module },
    });
  }

  return data === true;
}

/**
 * Continues when the module is available, throws `AuthorizationError` otherwise.
 *
 * This is what a Server Action calls, alongside `requirePermission`. Holding
 * the permission is not enough: a cashier of a `starter` business genuinely has
 * `orders.create`, and that business still has no POS.
 *
 * `AuthorizationError` rather than a new error type, for the reason ADR-025
 * decision 6 gives about permissions: the caller is not authorised to use this
 * capability here, which is what that error means. Adding a code would widen
 * the Phase 00 error contract for a distinction no caller acts on differently.
 */
export async function requireFeature(
  tenantId: string,
  module: Module,
  options: FeatureOptions = {},
): Promise<void> {
  const available = await hasFeature(tenantId, module, options);

  if (!available) {
    logger.warn("feature.denied", { tenantId, module });
    throw new AuthorizationError(`Module ${module} is not available for tenant ${tenantId}.`);
  }
}

/**
 * Every module the tenant has.
 *
 * For RENDERING only - deciding which menu entries to draw. Never as the check
 * itself: master section 45, and every page re-checks its own. Returned as a
 * Set so the layout can filter twenty nav entries in memory instead of asking
 * the database twenty times.
 *
 * Memoised per request, exactly as `getMyPermissions` is.
 */
export const getMyModules = cache(async (tenantId: string): Promise<ReadonlySet<Module>> => {
  return loadMyModules(tenantId);
});

/** Uncached form, so tests can inject a client. */
export async function loadMyModules(
  tenantId: string,
  options: FeatureOptions = {},
): Promise<ReadonlySet<Module>> {
  const client = options.client ?? (await createSupabaseServerClient());

  const { data, error } = await client.rpc("my_modules", { p_tenant_id: tenantId });

  if (error) {
    logger.error("feature.load_failed", { tenantId, error });
    throw new DatabaseError("Module lookup failed.", { cause: error, context: { tenantId } });
  }

  const result = new Set<Module>();
  for (const row of data ?? []) {
    // The database is the source of truth, but a code TypeScript does not know
    // about would silently widen the type. Drop it and say so instead - the
    // same posture `loadMyPermissions` takes.
    if (isModule(row.module)) {
      result.add(row.module);
    } else {
      logger.warn("feature.unknown_module", { tenantId, code: row.module });
    }
  }

  return result;
}
