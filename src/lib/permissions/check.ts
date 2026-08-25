import "server-only";

/**
 * The authorization layer.
 *
 * CLOVERCODE_MASTER.md section 12 asks for one reusable layer instead of role
 * comparisons scattered through the codebase, and section 45 is blunt about
 * why: hiding a button is not security. Every one of these calls resolves in
 * PostgreSQL, under the caller's own identity, so the answer cannot be
 * influenced by anything the client sends.
 *
 * The tenant is ALWAYS an explicit argument. A permission check whose tenant is
 * implicit is a check that will one day look at the wrong tenant.
 */

import { cache } from "react";
import { AuthorizationError, DatabaseError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { CloverCodeSupabaseClient } from "@/lib/supabase/types";
import { isPermission, type Permission } from "./permissions";

export interface AuthorizationOptions {
  /** Injected by tests; production always builds a request-scoped client. */
  readonly client?: CloverCodeSupabaseClient;
}

/** True when the current user has an ACTIVE membership in the tenant. */
export async function isTenantMember(
  tenantId: string,
  options: AuthorizationOptions = {},
): Promise<boolean> {
  const client = options.client ?? (await createSupabaseServerClient());

  const { data, error } = await client.rpc("is_tenant_member", { p_tenant_id: tenantId });

  if (error) {
    logger.error("authz.membership.check_failed", { tenantId, error });
    throw new DatabaseError("Membership check failed.", { cause: error, context: { tenantId } });
  }

  return data === true;
}

/**
 * True when the current user holds `permission` IN THAT TENANT.
 *
 * A permission is never global: holding `members.manage` in tenant A grants
 * nothing whatsoever in tenant B.
 */
export async function hasPermission(
  tenantId: string,
  permission: Permission,
  options: AuthorizationOptions = {},
): Promise<boolean> {
  const client = options.client ?? (await createSupabaseServerClient());

  const { data, error } = await client.rpc("has_permission", {
    p_tenant_id: tenantId,
    p_permission: permission,
  });

  if (error) {
    logger.error("authz.permission.check_failed", { tenantId, permission, error });
    throw new DatabaseError("Permission check failed.", {
      cause: error,
      context: { tenantId, permission },
    });
  }

  return data === true;
}

/**
 * Continues when the permission is held, throws `AuthorizationError` otherwise.
 *
 * This is what a Server Action calls first. A Server Action is reachable
 * directly by any client, so the check cannot live in the page that renders the
 * button.
 */
export async function requirePermission(
  tenantId: string,
  permission: Permission,
  options: AuthorizationOptions = {},
): Promise<void> {
  const allowed = await hasPermission(tenantId, permission, options);

  if (!allowed) {
    logger.warn("authz.permission.denied", { tenantId, permission });
    throw new AuthorizationError(`Permission ${permission} denied for tenant ${tenantId}.`);
  }
}

/**
 * Every permission the current user holds in the tenant.
 *
 * For RENDERING only - deciding which menu entries to draw. Never as the check
 * itself: master section 45. Returned as a Set so a screen can filter a list in
 * memory instead of asking the database once per item.
 *
 * Memoised per request: one round trip however many components ask.
 */
export const getMyPermissions = cache(
  async (tenantId: string): Promise<ReadonlySet<Permission>> => {
    return loadMyPermissions(tenantId);
  },
);

/** Uncached form, so tests can inject a client. */
export async function loadMyPermissions(
  tenantId: string,
  options: AuthorizationOptions = {},
): Promise<ReadonlySet<Permission>> {
  const client = options.client ?? (await createSupabaseServerClient());

  const { data, error } = await client.rpc("my_permissions", { p_tenant_id: tenantId });

  if (error) {
    logger.error("authz.permissions.load_failed", { tenantId, error });
    throw new DatabaseError("Permission lookup failed.", { cause: error, context: { tenantId } });
  }

  const result = new Set<Permission>();
  for (const row of data ?? []) {
    // The database is the source of truth, but a code that TypeScript does not
    // know about would silently widen the type. Drop it and say so instead.
    if (isPermission(row.permission)) {
      result.add(row.permission);
    } else {
      logger.warn("authz.permissions.unknown_code", { tenantId, code: row.permission });
    }
  }
  return result;
}
