/**
 * Which rate applies, and what it charges.
 *
 * Pure and free of I/O, so the rule can be asserted directly - and, more to the
 * point, so it can be READ. ADR-023 decision 3 explains why this lives here
 * rather than inside a trigger: choosing a rate depends on two inputs (the
 * order's branch, and the subtotal against the free-delivery threshold), and
 * that is a business rule with alternatives. Burying it in SQL would hide it
 * exactly where nobody looks when asking why a delivery came out free.
 *
 * What the database DOES enforce is what this cannot: that the zone belongs to
 * the same business as the order.
 */

/** A rate as the resolver needs it, independent of how it was fetched. */
export interface RateCandidate {
  readonly id: string;
  readonly zoneId: string;
  /** `null` is the zone's default, applying to every branch. */
  readonly locationId: string | null;
  readonly feeCents: number;
  readonly minOrderFreeCents: number | null;
  readonly estimatedMinutes: number | null;
  readonly isActive: boolean;
}

/**
 * The rate that applies to a zone from a branch.
 *
 * The branch-specific rate wins over the zone default (FR-1907). Inactive rates
 * are never chosen: deactivating the override for one branch falls back to the
 * default, which is the useful behaviour and the reason this filters before it
 * picks rather than after.
 *
 * Returns `null` when the zone has no usable rate at all - a real state, and
 * the reason the attach form refuses to submit rather than charging zero.
 */
export function resolveRate(
  rates: readonly RateCandidate[],
  input: { zoneId: string; locationId: string },
): RateCandidate | null {
  const usable = rates.filter((rate) => rate.isActive && rate.zoneId === input.zoneId);

  return (
    usable.find((rate) => rate.locationId === input.locationId) ??
    usable.find((rate) => rate.locationId === null) ??
    null
  );
}

/**
 * What a rate actually charges for an order of this size.
 *
 * The threshold is inclusive: "envio gratis desde S/ 50" means an order of
 * exactly S/ 50 ships free. Stating it the other way would make the promise on
 * the menu false for the one order that matches it exactly.
 */
export function feeForSubtotal(rate: RateCandidate, subtotalCents: number): number {
  if (rate.minOrderFreeCents !== null && subtotalCents >= rate.minOrderFreeCents) {
    return 0;
  }
  return rate.feeCents;
}

/** Whether this rate would ship an order of this size for free. */
export function isFreeForSubtotal(rate: RateCandidate, subtotalCents: number): boolean {
  return feeForSubtotal(rate, subtotalCents) === 0 && rate.feeCents > 0;
}
