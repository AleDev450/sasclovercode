import "server-only";

/**
 * Read side of promotions and points.
 *
 * One audience: members of the business holding `promotions.view` /
 * `loyalty.view`. Every query filters by `tenant_id` on top of RLS - defence
 * in depth, the same posture every module since Phase 11 takes.
 *
 * A balance is NEVER summed here: it is read from `loyalty_accounts`, which a
 * trigger keeps in step with the ledger (ADR-024 decision 2). The reason is the
 * till: a customer with three years of history has to cost the same to look up
 * as one with two entries.
 */

import { DatabaseError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { LoyaltyTransactionType, OrderPromotionSource } from "@/types/database";
import type { LoyaltyProgramme } from "../points";
import type { PromotionRule } from "../promotions";
import { LIST_CAP } from "@/config/app";

export interface Promotion extends PromotionRule {
  readonly description: string | null;
}

const PROMOTION_COLUMNS =
  "id, name, description, type, percent_off, amount_off_cents, min_order_cents, starts_at, ends_at, max_redemptions, times_redeemed, is_active";

interface PromotionRow {
  id: string;
  name: string;
  description: string | null;
  type: PromotionRule["type"];
  percent_off: number | null;
  amount_off_cents: number | null;
  min_order_cents: number;
  starts_at: string | null;
  ends_at: string | null;
  max_redemptions: number | null;
  times_redeemed: number;
  is_active: boolean;
}

function toPromotion(row: PromotionRow): Promotion {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    type: row.type,
    percentOff: row.percent_off,
    amountOffCents: row.amount_off_cents,
    minOrderCents: row.min_order_cents,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    maxRedemptions: row.max_redemptions,
    timesRedeemed: row.times_redeemed,
    isActive: row.is_active,
  };
}

export async function listPromotions(
  tenantId: string,
  options: { activeOnly?: boolean } = {},
): Promise<readonly Promotion[]> {
  const client = await createSupabaseServerClient();
  let query = client.from("promotions").select(PROMOTION_COLUMNS).eq("tenant_id", tenantId);
  if (options.activeOnly === true) query = query.eq("is_active", true);

  const { data, error } = await query.order("name").limit(LIST_CAP);
  if (error) {
    logger.error("loyalty.list_promotions_failed", { tenantId, error });
    throw new DatabaseError("Promotion listing failed.", { cause: error });
  }

  return (data ?? []).map((row) => toPromotion(row as unknown as PromotionRow));
}

export interface Coupon {
  readonly id: string;
  readonly promotionId: string;
  readonly code: string;
  readonly maxRedemptions: number | null;
  readonly timesRedeemed: number;
  readonly expiresAt: string | null;
  readonly isActive: boolean;
}

export async function listCoupons(tenantId: string): Promise<readonly Coupon[]> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .from("coupons")
    .select("id, promotion_id, code, max_redemptions, times_redeemed, expires_at, is_active")
    .eq("tenant_id", tenantId)
    .order("code")
    .limit(LIST_CAP);

  if (error) {
    logger.error("loyalty.list_coupons_failed", { tenantId, error });
    throw new DatabaseError("Coupon listing failed.", { cause: error });
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    promotionId: row.promotion_id,
    code: row.code,
    maxRedemptions: row.max_redemptions,
    timesRedeemed: row.times_redeemed,
    expiresAt: row.expires_at,
    isActive: row.is_active,
  }));
}

export interface AppliedDiscount {
  readonly id: string;
  readonly source: OrderPromotionSource;
  readonly label: string;
  readonly discountCents: number;
  readonly createdAt: string;
}

/** The discounts posted against one order. */
export async function listOrderDiscounts(
  tenantId: string,
  orderId: string,
): Promise<readonly AppliedDiscount[]> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .from("order_promotions")
    .select("id, source, label_snapshot, discount_cents, created_at")
    .eq("tenant_id", tenantId)
    .eq("order_id", orderId)
    .order("created_at")
    .limit(LIST_CAP);

  if (error) {
    logger.error("loyalty.list_order_discounts_failed", { tenantId, orderId, error });
    throw new DatabaseError("Order discount listing failed.", { cause: error });
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    source: row.source,
    label: row.label_snapshot,
    discountCents: row.discount_cents,
    createdAt: row.created_at,
  }));
}

export interface LoyaltyAccountSummary {
  readonly id: string;
  readonly customerId: string;
  readonly customerName: string;
  readonly pointsBalance: number;
  readonly enrolledAt: string;
}

export async function listLoyaltyAccounts(
  tenantId: string,
): Promise<readonly LoyaltyAccountSummary[]> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .from("loyalty_accounts")
    .select("id, customer_id, points_balance, enrolled_at, customers(name)")
    .eq("tenant_id", tenantId)
    .order("points_balance", { ascending: false })
    .limit(LIST_CAP);

  if (error) {
    logger.error("loyalty.list_accounts_failed", { tenantId, error });
    throw new DatabaseError("Loyalty account listing failed.", { cause: error });
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    customerId: row.customer_id,
    customerName: (row.customers as unknown as { name: string } | null)?.name ?? "—",
    pointsBalance: row.points_balance,
    enrolledAt: row.enrolled_at,
  }));
}

/** The account of one customer, or `null` when they have never been enrolled. */
export async function getAccountForCustomer(
  tenantId: string,
  customerId: string,
): Promise<LoyaltyAccountSummary | null> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .from("loyalty_accounts")
    .select("id, customer_id, points_balance, enrolled_at, customers(name)")
    .eq("tenant_id", tenantId)
    .eq("customer_id", customerId)
    .maybeSingle();

  if (error) {
    logger.error("loyalty.get_account_failed", { tenantId, error });
    throw new DatabaseError("Loyalty account lookup failed.", { cause: error });
  }
  if (data === null) return null;

  return {
    id: data.id,
    customerId: data.customer_id,
    customerName: (data.customers as unknown as { name: string } | null)?.name ?? "—",
    pointsBalance: data.points_balance,
    enrolledAt: data.enrolled_at,
  };
}

export interface LoyaltyLedgerEntry {
  readonly id: string;
  readonly type: LoyaltyTransactionType;
  readonly points: number;
  readonly reason: string | null;
  readonly orderId: string | null;
  readonly createdAt: string;
}

/**
 * One account's ledger, most recent first.
 *
 * Capped rather than paginated: this is the "de donde salio cada punto" view,
 * and a hundred entries is more history than anybody reads in one sitting.
 * The balance does not come from here (ADR-024), so a cap cannot make it wrong.
 */
export async function listLedger(
  tenantId: string,
  accountId: string,
  limit = 100,
): Promise<readonly LoyaltyLedgerEntry[]> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .from("loyalty_transactions")
    .select("id, type, points, reason, order_id, created_at")
    .eq("tenant_id", tenantId)
    .eq("account_id", accountId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    logger.error("loyalty.list_ledger_failed", { tenantId, error });
    throw new DatabaseError("Loyalty ledger listing failed.", { cause: error });
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    type: row.type,
    points: row.points,
    reason: row.reason,
    orderId: row.order_id,
    createdAt: row.created_at,
  }));
}

/** The programme's configuration, from `tenant_settings`. */
export async function getLoyaltyProgramme(tenantId: string): Promise<LoyaltyProgramme> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .from("tenant_settings")
    .select("loyalty_enabled, loyalty_points_per_sol, loyalty_point_value_cents")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) {
    logger.error("loyalty.get_programme_failed", { tenantId, error });
    throw new DatabaseError("Loyalty programme lookup failed.", { cause: error });
  }

  // Every tenant is provisioned a settings row, so this only happens if one was
  // deleted by hand. The column defaults are the honest answer.
  return {
    enabled: data?.loyalty_enabled ?? false,
    pointsPerSol: data?.loyalty_points_per_sol ?? 1,
    pointValueCents: data?.loyalty_point_value_cents ?? 10,
  };
}
