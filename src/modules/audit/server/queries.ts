import "server-only";

/**
 * Read side of the audit log - and there is no other side.
 *
 * This module has no Server Action, and that absence is the design: the fifteen
 * triggers of Phase 24 are the only writers, and `audit_logs` has no INSERT,
 * UPDATE or DELETE policy for anybody (ADR-028 decision 1). A write function
 * here would be a function that cannot work, which is worse than no function.
 *
 * Authorization is RLS, not a gate in this file: the SELECT policy is
 * `has_permission(tenant_id, 'audit.view') or is_platform_admin()`, so a caller
 * without it gets zero rows from the database itself. The page checks the same
 * permission before rendering, for the reason master section 45 gives - hiding
 * a screen is not security, and showing an empty one is not an answer.
 */

import { DatabaseError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { AuditFilters } from "../schemas";
import { AUDIT_DEFAULT_DAYS, AUDIT_PAGE_SIZE } from "../schemas";

export interface AuditEntry {
  readonly id: string;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string | null;
  readonly userId: string | null;
  readonly userEmail: string | null;
  readonly oldValues: Record<string, unknown> | null;
  readonly newValues: Record<string, unknown> | null;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly requestId: string | null;
  readonly createdAt: string;
}

export interface AuditPage {
  readonly entries: readonly AuditEntry[];
  /** True when there is at least one more page after this one. */
  readonly hasMore: boolean;
  readonly page: number;
}

/** `old_values` and `new_values` arrive as `Json`; only an object is useful. */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * One page of a tenant's audit log, newest first.
 *
 * Asks for one row more than it shows, so "is there another page" costs nothing
 * extra - a `count` over a table that only grows would get slower every month
 * for a boolean.
 */
export async function listAuditEntries(
  tenantId: string,
  filters: AuditFilters,
): Promise<AuditPage> {
  const client = await createSupabaseServerClient();

  const from = (filters.page - 1) * AUDIT_PAGE_SIZE;
  const since = new Date(Date.now() - AUDIT_DEFAULT_DAYS * 24 * 60 * 60 * 1000).toISOString();

  let query = client
    .from("audit_logs")
    .select(
      "id, action, entity_type, entity_id, user_id, user_email, old_values, new_values, ip_address, user_agent, request_id, created_at",
    )
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .range(from, from + AUDIT_PAGE_SIZE);

  if (filters.action !== null) {
    query = query.eq("action", filters.action);
  }

  if (filters.entity !== null) {
    // Asking about ONE row: the default window would hide the answer, since the
    // change somebody is asking about is usually the old one.
    query = query.eq("entity_id", filters.entity);
  } else {
    query = query.gte("created_at", since);
  }

  const { data, error } = await query;

  if (error) {
    logger.error("audit.list_failed", { tenantId, error });
    throw new DatabaseError("Audit log lookup failed.", { cause: error, context: { tenantId } });
  }

  const rows = data ?? [];
  const hasMore = rows.length > AUDIT_PAGE_SIZE;

  return {
    page: filters.page,
    hasMore,
    entries: rows.slice(0, AUDIT_PAGE_SIZE).map((row) => ({
      id: row.id,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      userId: row.user_id,
      userEmail: row.user_email,
      oldValues: asRecord(row.old_values),
      newValues: asRecord(row.new_values),
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
      requestId: row.request_id,
      createdAt: row.created_at,
    })),
  };
}
