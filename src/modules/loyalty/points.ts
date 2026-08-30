/**
 * How points are earned and what they are worth.
 *
 * A MIRROR of what `earn_loyalty_points_on_completion()` and
 * `redeem_loyalty_points()` do in SQL - the database is the authority, because
 * it is what every writer goes through and the accrual happens inside a
 * trigger no application code is involved in. What this adds is a screen that
 * can show "ganara 24 puntos" before the order is completed, and a redemption
 * form that can show the discount before it is committed.
 *
 * TEST-2004 and TEST-2005 pin the arithmetic; the database tests prove the SQL
 * agrees with it.
 */

import type { LoyaltyTransactionType } from "@/types/database";

/** The programme's configuration, as `tenant_settings` holds it. */
export interface LoyaltyProgramme {
  readonly enabled: boolean;
  /** Points credited per whole unit of currency spent on goods. */
  readonly pointsPerSol: number;
  /** What one point is worth in minor units when redeemed. */
  readonly pointValueCents: number;
}

/**
 * Points an order of this size earns.
 *
 * Truncating, exactly as the SQL does: S/ 24.90 at one point per sol is 24
 * points, not 25. Rounding up would let a business advertise a rate it does not
 * actually pay, and the difference compounds over thousands of tickets.
 *
 * Measured on GOODS, not on the total - nobody should earn loyalty on the
 * delivery fee.
 */
export function pointsForOrder(programme: LoyaltyProgramme, goodsCents: number): number {
  if (!programme.enabled) return 0;
  if (programme.pointsPerSol <= 0) return 0;
  if (goodsCents <= 0) return 0;

  return Math.floor(goodsCents / 100) * programme.pointsPerSol;
}

/** What redeeming this many points is worth, in cents. */
export function redemptionValueCents(programme: LoyaltyProgramme, points: number): number {
  if (points <= 0) return 0;
  return points * programme.pointValueCents;
}

/**
 * The most points that may usefully be spent on an order.
 *
 * Bounded by three things at once: the balance, what is left to pay, and the
 * fact that points are whole - spending 7 points on a bill with 3 points'
 * worth left would burn four of them for nothing.
 */
export function maxRedeemablePoints(
  programme: LoyaltyProgramme,
  input: { balance: number; payableCents: number },
): number {
  if (!programme.enabled) return 0;
  if (programme.pointValueCents <= 0) return 0;
  if (input.payableCents <= 0) return 0;

  return Math.min(input.balance, Math.floor(input.payableCents / programme.pointValueCents));
}

export const LOYALTY_TRANSACTION_LABELS: Readonly<Record<LoyaltyTransactionType, string>> = {
  earn: "Acumulado",
  redeem: "Canjeado",
  campaign: "Campana",
  adjustment: "Ajuste",
  expiry: "Caducado",
};

/** The types a person may write by hand. `earn` and `redeem` are automatic. */
export const MANUAL_LOYALTY_TYPES = ["campaign", "adjustment", "expiry"] as const;

export type ManualLoyaltyType = (typeof MANUAL_LOYALTY_TYPES)[number];
