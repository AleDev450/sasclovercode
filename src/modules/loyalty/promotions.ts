/**
 * What a promotion takes off, and whether it may be applied at all.
 *
 * Pure and free of I/O, so the rules can be asserted directly - and, more to
 * the point, so they can be READ. ADR-024 decision 5 explains why this lives
 * here rather than inside a trigger: the amount depends on the type, on the
 * goods subtotal and on the shipping, and somebody is going to want to know
 * why a discount came out the way it did.
 *
 * What the database enforces is everything this cannot guarantee - that the
 * promotion belongs to the same business, is in date, has redemptions left and
 * does not exceed the bill. Those are triggers, because the dashboard is not
 * the only possible writer.
 */

import type { PromotionType } from "@/types/database";

/** A promotion as the calculator needs it, independent of how it was fetched. */
export interface PromotionRule {
  readonly id: string;
  readonly name: string;
  readonly type: PromotionType;
  /** 1..100. Set only for `percentage`. */
  readonly percentOff: number | null;
  /** Minor units. Set only for `fixed_amount`. */
  readonly amountOffCents: number | null;
  readonly minOrderCents: number;
  readonly startsAt: string | null;
  readonly endsAt: string | null;
  readonly maxRedemptions: number | null;
  readonly timesRedeemed: number;
  readonly isActive: boolean;
}

/** The order the promotion is being measured against. */
export interface DiscountBasis {
  /** Sum of the lines, after their own per-line discounts. */
  readonly goodsCents: number;
  /** What delivery costs on this order. Zero when there is no delivery. */
  readonly shippingCents: number;
}

/**
 * What this promotion takes off, in cents.
 *
 * Never more than what it is measured against, in every branch: a 100%
 * promotion on a S/ 20 order takes off S/ 20, and a S/ 50 fixed discount on a
 * S/ 20 order takes off S/ 20 rather than putting the order in credit. The
 * database refuses an over-discount as well, but doing it here means the form
 * shows the real number before anybody submits.
 */
export function discountFor(promotion: PromotionRule, basis: DiscountBasis): number {
  switch (promotion.type) {
    case "percentage": {
      const percent = promotion.percentOff ?? 0;
      // round(), not floor(): matches how the rest of this project turns a
      // rate into money, and half a cent belongs to the customer.
      const off = Math.round((basis.goodsCents * percent) / 100);
      return Math.min(off, basis.goodsCents);
    }
    case "fixed_amount":
      return Math.min(promotion.amountOffCents ?? 0, basis.goodsCents);
    case "free_delivery":
      // Measured against the SHIPPING, which is a different number entirely
      // (Phase 19) and is zero on an order with no delivery attached.
      return basis.shippingCents;
  }
}

/** Why a promotion cannot be used right now, or `null` when it can. */
export type IneligibilityReason =
  "inactive" | "not_started" | "ended" | "exhausted" | "below_minimum" | "nothing_to_discount";

/**
 * Whether this promotion may be applied to this order, and why not.
 *
 * A mirror of the checks `guard_order_promotion()` performs, so the screen can
 * explain the refusal on the spot instead of round-tripping to a raised
 * exception. The trigger stays the authority: this can be out of date by the
 * length of a page render, and it is not the only writer.
 */
export function ineligibilityReason(
  promotion: PromotionRule,
  basis: DiscountBasis,
  now: Date = new Date(),
): IneligibilityReason | null {
  if (!promotion.isActive) return "inactive";

  if (promotion.startsAt !== null && new Date(promotion.startsAt) > now) return "not_started";
  if (promotion.endsAt !== null && new Date(promotion.endsAt) <= now) return "ended";

  if (promotion.maxRedemptions !== null && promotion.timesRedeemed >= promotion.maxRedemptions) {
    return "exhausted";
  }

  // Measured on goods, not on the total: the sign in the window says "desde
  // S/ 50 en consumo", and letting the delivery fee push an order over that
  // line is not what it means.
  if (basis.goodsCents < promotion.minOrderCents) return "below_minimum";

  // A free-delivery promotion on an order with no delivery would post a
  // discount of zero, which is a row that says nothing happened.
  if (discountFor(promotion, basis) <= 0) return "nothing_to_discount";

  return null;
}

/** Convenience for a screen that only needs the yes/no. */
export function isRedeemable(
  promotion: PromotionRule,
  basis: DiscountBasis,
  now: Date = new Date(),
): boolean {
  return ineligibilityReason(promotion, basis, now) === null;
}

export const INELIGIBILITY_LABELS: Readonly<Record<IneligibilityReason, string>> = {
  inactive: "Esta promocion esta desactivada.",
  not_started: "Esta promocion aun no empieza.",
  ended: "Esta promocion ya termino.",
  exhausted: "Esta promocion agoto sus canjes.",
  below_minimum: "Este pedido no alcanza el minimo de la promocion.",
  nothing_to_discount: "Esta promocion no descuenta nada en este pedido.",
};

export const PROMOTION_TYPE_LABELS: Readonly<Record<PromotionType, string>> = {
  percentage: "Porcentaje",
  fixed_amount: "Monto fijo",
  free_delivery: "Envio gratis",
};

/** How a promotion reads in a list, without needing an order to measure it. */
export function describePromotion(promotion: PromotionRule): string {
  switch (promotion.type) {
    case "percentage":
      return `${promotion.percentOff ?? 0}% de descuento`;
    case "fixed_amount":
      return `Descuento fijo`;
    case "free_delivery":
      return "Envio gratis";
  }
}
