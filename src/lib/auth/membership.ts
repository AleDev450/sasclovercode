import "server-only";

/**
 * Which tenants the current user belongs to.
 *
 * The single place that answers that question. Master section 42: a `tenant_id`
 * arriving from the client is never trusted, so nothing here takes a user id -
 * the identity comes from the session, and the database function resolves the
 * rest.
 */

import { cache } from "react";
import { AuthorizationError, DatabaseError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { CloverCodeSupabaseClient } from "@/lib/supabase/types";
import { isActiveMembership, type Membership } from "./types";

export interface MembershipOptions {
  /** Injected by tests; production always builds a request-scoped client. */
  readonly client?: CloverCodeSupabaseClient;
}

/**
 * Every membership of the current user, active ones and not.
 *
 * Returns the full set rather than filtering here, so a caller can tell "you
 * are not a member" apart from "your access was suspended" and show the right
 * message. Callers that only care about access use `getActiveMemberships()`.
 */
export const getMyMemberships = cache(async (): Promise<readonly Membership[]> => {
  return loadMyMemberships();
});

/** Uncached form. `getMyMemberships()` is what application code should call. */
export async function loadMyMemberships(
  options: MembershipOptions = {},
): Promise<readonly Membership[]> {
  const client = options.client ?? (await createSupabaseServerClient());

  const { data, error } = await client.rpc("get_my_memberships");

  if (error) {
    logger.error("auth.memberships.failed", { error });
    throw new DatabaseError("Membership lookup failed.", { cause: error });
  }

  return (data ?? []).map((row) => ({
    id: row.membership_id,
    tenantId: row.tenant_id,
    tenantSlug: row.tenant_slug,
    tenantName: row.tenant_name,
    tenantStatus: row.tenant_status,
    role: row.role,
    status: row.status,
  }));
}

/** Only the memberships that currently grant access. */
export async function getActiveMemberships(): Promise<readonly Membership[]> {
  const memberships = await getMyMemberships();
  return memberships.filter(isActiveMembership);
}

/**
 * The current user's membership of `tenantId`, or `null`.
 *
 * Reads from the cached full list, so checking membership of several tenants in
 * one render costs one query rather than one per tenant.
 */
export async function getMembershipForTenant(tenantId: string): Promise<Membership | null> {
  const memberships = await getMyMemberships();
  return memberships.find((membership) => membership.tenantId === tenantId) ?? null;
}

/**
 * Asserts that the current user is an ACTIVE member of `tenantId`.
 *
 * Throws `AuthorizationError` for both "not a member" and "membership not
 * active", and never says which. Distinguishing them would confirm to an
 * outsider that a given account exists inside a given business.
 *
 * This asserts membership only. What a member is ALLOWED to do is a permission
 * question, and permissions arrive in Phase 03.
 */
export async function requireMembership(tenantId: string): Promise<Membership> {
  const membership = await getMembershipForTenant(tenantId);

  if (membership === null || !isActiveMembership(membership)) {
    logger.warn("auth.membership.denied", {
      tenantId,
      reason: membership === null ? "not_a_member" : membership.status,
    });
    throw new AuthorizationError("User is not an active member of this tenant.");
  }

  return membership;
}
