import "server-only";

/**
 * The numbers behind the Super Admin diagnostics screen.
 *
 * CLOVERCODE_MASTER.md section 33 (Phase 24): "preparar herramientas de
 * diagnostico para Super Admin".
 *
 * One RPC for twelve counters. `platform_diagnostics()` is SECURITY DEFINER
 * with an explicit `is_platform_admin()` gate, so a caller who is not one gets
 * zero rows rather than an error - the pattern `get_tenant_members` established
 * in Phase 03.
 */

import { DatabaseError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { checkDatabase } from "@/lib/observability/checks";
import { overallHealth, type DependencyCheck, type HealthStatus } from "@/lib/observability/health";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface PlatformDiagnostics {
  readonly tenantsTotal: number;
  readonly tenantsActive: number;
  readonly tenantsSuspended: number;
  readonly subscriptionsTrialing: number;
  readonly subscriptionsActive: number;
  readonly subscriptionsPastDue: number;
  readonly subscriptionsSuspended: number;
  readonly ordersLast24h: number;
  readonly auditRowsLast24h: number;
  readonly auditRowsTotal: number;
  readonly overdueCharges: number;
  readonly oldestOverdueDueAt: string | null;
}

/** What a caller who is not a platform admin sees, and a brand new install. */
export const EMPTY_DIAGNOSTICS: PlatformDiagnostics = {
  tenantsTotal: 0,
  tenantsActive: 0,
  tenantsSuspended: 0,
  subscriptionsTrialing: 0,
  subscriptionsActive: 0,
  subscriptionsPastDue: 0,
  subscriptionsSuspended: 0,
  ordersLast24h: 0,
  auditRowsLast24h: 0,
  auditRowsTotal: 0,
  overdueCharges: 0,
  oldestOverdueDueAt: null,
};

export async function getPlatformDiagnostics(): Promise<PlatformDiagnostics> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client.rpc("platform_diagnostics");

  if (error) {
    logger.error("diagnostics.load_failed", { error });
    throw new DatabaseError("Platform diagnostics failed.", { cause: error });
  }

  const row = data?.[0];
  if (row === undefined) return EMPTY_DIAGNOSTICS;

  return {
    tenantsTotal: Number(row.tenants_total),
    tenantsActive: Number(row.tenants_active),
    tenantsSuspended: Number(row.tenants_suspended),
    subscriptionsTrialing: Number(row.subscriptions_trialing),
    subscriptionsActive: Number(row.subscriptions_active),
    subscriptionsPastDue: Number(row.subscriptions_past_due),
    subscriptionsSuspended: Number(row.subscriptions_suspended),
    ordersLast24h: Number(row.orders_last_24h),
    auditRowsLast24h: Number(row.audit_rows_last_24h),
    auditRowsTotal: Number(row.audit_rows_total),
    overdueCharges: Number(row.overdue_charges),
    oldestOverdueDueAt: row.oldest_overdue_due_at,
  };
}

export interface SystemHealth {
  readonly status: HealthStatus;
  readonly checks: readonly DependencyCheck[];
}

/**
 * The same probe `/api/health` runs, for a human instead of a load balancer.
 *
 * Reusing it rather than writing a second one is the point: two health checks
 * that can disagree are two health checks nobody trusts.
 */
export async function getSystemHealth(): Promise<SystemHealth> {
  const checks = [await checkDatabase()];
  return { status: overallHealth(checks), checks };
}
