import "server-only";

/**
 * Read side of CloverCode's own billing.
 *
 * Two audiences, served by the same functions and told apart by RLS: a platform
 * admin looking at anybody, and a business looking at itself. `saas_payments`
 * and `subscription_events` are readable by members of the tenant OR by a
 * platform admin, so nothing here branches on who is asking.
 *
 * MASTER SECTION 22: none of this touches `payments` (Phase 14) or
 * `billing_documents` (Phase 17). Those are the restaurant's money; this is
 * CloverCode's.
 */

import { DatabaseError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { SaasPaymentStatus, SubscriptionEventType } from "@/types/database";

export interface SaasCharge {
  readonly id: string;
  readonly tenantId: string;
  readonly subscriptionId: string;
  readonly planCode: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly amountCents: number;
  readonly currency: string;
  readonly status: SaasPaymentStatus;
  readonly dueAt: string;
  readonly paidAt: string | null;
  readonly method: string | null;
  readonly reference: string | null;
  readonly notes: string | null;
}

const CHARGE_COLUMNS =
  "id, tenant_id, subscription_id, plan_code_snapshot, period_start, period_end, amount_cents, currency, status, due_at, paid_at, method, reference, notes";

interface ChargeRow {
  id: string;
  tenant_id: string;
  subscription_id: string;
  plan_code_snapshot: string;
  period_start: string;
  period_end: string;
  amount_cents: number;
  currency: string;
  status: SaasPaymentStatus;
  due_at: string;
  paid_at: string | null;
  method: string | null;
  reference: string | null;
  notes: string | null;
}

function toCharge(row: ChargeRow): SaasCharge {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    subscriptionId: row.subscription_id,
    planCode: row.plan_code_snapshot,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    amountCents: row.amount_cents,
    currency: row.currency,
    status: row.status,
    dueAt: row.due_at,
    paidAt: row.paid_at,
    method: row.method,
    reference: row.reference,
    notes: row.notes,
  };
}

/** One business's charges, most recent first. */
export async function listTenantCharges(
  tenantId: string,
  limit = 50,
): Promise<readonly SaasCharge[]> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .from("saas_payments")
    .select(CHARGE_COLUMNS)
    .eq("tenant_id", tenantId)
    .order("period_start", { ascending: false })
    .limit(limit);

  if (error) {
    logger.error("saas.charges.list_failed", { tenantId, error });
    throw new DatabaseError("Charge listing failed.", { cause: error });
  }

  return (data ?? []).map((row) => toCharge(row as unknown as ChargeRow));
}

export interface SaasChargeWithTenant extends SaasCharge {
  readonly tenantName: string;
  readonly tenantSlug: string;
}

/**
 * Everything still owed, across every business.
 *
 * The collections board. Ordered by due date because the oldest debt is the one
 * that decides whether somebody gets suspended.
 */
export async function listOutstandingCharges(
  limit = 100,
): Promise<readonly SaasChargeWithTenant[]> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .from("saas_payments")
    .select(`${CHARGE_COLUMNS}, tenants(name, slug)`)
    .eq("status", "pending")
    .order("due_at", { ascending: true })
    .limit(limit);

  if (error) {
    logger.error("saas.charges.outstanding_failed", { error });
    throw new DatabaseError("Outstanding charge listing failed.", { cause: error });
  }

  return (data ?? []).map((row) => {
    const tenant = (row as { tenants?: unknown }).tenants as
      { name: string; slug: string } | null | undefined;
    return {
      ...toCharge(row as unknown as ChargeRow),
      tenantName: tenant?.name ?? "—",
      tenantSlug: tenant?.slug ?? "",
    };
  });
}

/** The most recent charges across every business, whatever their status. */
export async function listRecentCharges(limit = 50): Promise<readonly SaasChargeWithTenant[]> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .from("saas_payments")
    .select(`${CHARGE_COLUMNS}, tenants(name, slug)`)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    logger.error("saas.charges.recent_failed", { error });
    throw new DatabaseError("Charge listing failed.", { cause: error });
  }

  return (data ?? []).map((row) => {
    const tenant = (row as { tenants?: unknown }).tenants as
      { name: string; slug: string } | null | undefined;
    return {
      ...toCharge(row as unknown as ChargeRow),
      tenantName: tenant?.name ?? "—",
      tenantSlug: tenant?.slug ?? "",
    };
  });
}

export interface SubscriptionEvent {
  readonly id: string;
  readonly type: SubscriptionEventType;
  readonly fromStatus: string | null;
  readonly toStatus: string | null;
  readonly fromPlan: string | null;
  readonly toPlan: string | null;
  readonly detail: string | null;
  readonly createdAt: string;
}

/**
 * One business's subscription history, most recent first.
 *
 * This is what answers "why is this business suspended?" - the reason ADR-026
 * decision 4 made the table unwritable by anybody but a trigger.
 */
export async function listSubscriptionEvents(
  tenantId: string,
  limit = 50,
): Promise<readonly SubscriptionEvent[]> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .from("subscription_events")
    .select("id, type, from_status, to_status, from_plan, to_plan, detail, created_at")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    logger.error("saas.events.list_failed", { tenantId, error });
    throw new DatabaseError("Subscription event listing failed.", { cause: error });
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    type: row.type,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    fromPlan: row.from_plan,
    toPlan: row.to_plan,
    detail: row.detail,
    createdAt: row.created_at,
  }));
}
