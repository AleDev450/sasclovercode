import { describe, expect, it } from "vitest";
import {
  LOYALTY_TRANSACTION_LABELS,
  maxRedeemablePoints,
  pointsForOrder,
  redemptionValueCents,
  type LoyaltyProgramme,
} from "@/modules/loyalty/points";
import {
  describePromotion,
  discountFor,
  ineligibilityReason,
  isRedeemable,
  PROMOTION_TYPE_LABELS,
  type PromotionRule,
} from "@/modules/loyalty/promotions";

function promotion(overrides: Partial<PromotionRule> = {}): PromotionRule {
  return {
    id: "p1",
    name: "Verano",
    type: "percentage",
    percentOff: 10,
    amountOffCents: null,
    minOrderCents: 0,
    startsAt: null,
    endsAt: null,
    maxRedemptions: null,
    timesRedeemed: 0,
    isActive: true,
    ...overrides,
  };
}

const NOW = new Date("2026-08-30T12:00:00Z");

describe("discountFor (TEST-2001, TEST-2002)", () => {
  it("takes a percentage off the goods", () => {
    expect(discountFor(promotion({ percentOff: 10 }), { goodsCents: 2000, shippingCents: 0 })).toBe(
      200,
    );
  });

  it("rounds a percentage to the nearest cent", () => {
    // 33% of S/ 24.90 is 821.7 cents.
    expect(discountFor(promotion({ percentOff: 33 }), { goodsCents: 2490, shippingCents: 0 })).toBe(
      822,
    );
  });

  it("never takes more than the goods, even at 100%", () => {
    expect(
      discountFor(promotion({ percentOff: 100 }), { goodsCents: 2000, shippingCents: 0 }),
    ).toBe(2000);
  });

  it("takes a fixed amount off", () => {
    const rule = promotion({ type: "fixed_amount", percentOff: null, amountOffCents: 500 });
    expect(discountFor(rule, { goodsCents: 2000, shippingCents: 0 })).toBe(500);
  });

  it("caps a fixed amount at the goods rather than putting the order in credit (TEST-2002)", () => {
    const rule = promotion({ type: "fixed_amount", percentOff: null, amountOffCents: 5000 });
    expect(discountFor(rule, { goodsCents: 2000, shippingCents: 0 })).toBe(2000);
  });

  it("measures free delivery against the shipping, not the goods", () => {
    const rule = promotion({ type: "free_delivery", percentOff: null });
    expect(discountFor(rule, { goodsCents: 9900, shippingCents: 800 })).toBe(800);
  });

  it("gives free delivery nothing to take on an order with no delivery", () => {
    const rule = promotion({ type: "free_delivery", percentOff: null });
    expect(discountFor(rule, { goodsCents: 9900, shippingCents: 0 })).toBe(0);
  });

  it("returns whole cents in every branch", () => {
    for (const percent of [1, 7, 33, 50, 99, 100]) {
      const result = discountFor(promotion({ percentOff: percent }), {
        goodsCents: 2490,
        shippingCents: 0,
      });
      expect(Number.isInteger(result)).toBe(true);
    }
  });
});

describe("ineligibilityReason (TEST-2003)", () => {
  const basis = { goodsCents: 2000, shippingCents: 0 };

  it("accepts a live promotion", () => {
    expect(ineligibilityReason(promotion(), basis, NOW)).toBeNull();
    expect(isRedeemable(promotion(), basis, NOW)).toBe(true);
  });

  it("refuses an inactive one", () => {
    expect(ineligibilityReason(promotion({ isActive: false }), basis, NOW)).toBe("inactive");
  });

  it("refuses one that has not started", () => {
    const rule = promotion({ startsAt: "2026-09-01T00:00:00Z" });
    expect(ineligibilityReason(rule, basis, NOW)).toBe("not_started");
  });

  it("refuses one that ended", () => {
    const rule = promotion({ endsAt: "2026-08-01T00:00:00Z" });
    expect(ineligibilityReason(rule, basis, NOW)).toBe("ended");
  });

  it("treats the end instant as already over", () => {
    const rule = promotion({ endsAt: NOW.toISOString() });
    expect(ineligibilityReason(rule, basis, NOW)).toBe("ended");
  });

  it("accepts one that started exactly now", () => {
    const rule = promotion({ startsAt: NOW.toISOString() });
    expect(ineligibilityReason(rule, basis, NOW)).toBeNull();
  });

  it("refuses one that ran out", () => {
    const rule = promotion({ maxRedemptions: 5, timesRedeemed: 5 });
    expect(ineligibilityReason(rule, basis, NOW)).toBe("exhausted");
  });

  it("accepts one with redemptions left", () => {
    const rule = promotion({ maxRedemptions: 5, timesRedeemed: 4 });
    expect(ineligibilityReason(rule, basis, NOW)).toBeNull();
  });

  it("refuses an order below the minimum", () => {
    const rule = promotion({ minOrderCents: 5000 });
    expect(ineligibilityReason(rule, basis, NOW)).toBe("below_minimum");
  });

  it("accepts an order exactly at the minimum", () => {
    const rule = promotion({ minOrderCents: 2000 });
    expect(ineligibilityReason(rule, basis, NOW)).toBeNull();
  });

  it("measures the minimum on goods, ignoring the delivery fee", () => {
    // "Desde S/ 50 en consumo" must not be reachable by paying for delivery.
    const rule = promotion({ minOrderCents: 5000 });
    expect(ineligibilityReason(rule, { goodsCents: 4500, shippingCents: 900 }, NOW)).toBe(
      "below_minimum",
    );
  });

  it("refuses a promotion that would discount nothing", () => {
    const rule = promotion({ type: "free_delivery", percentOff: null });
    expect(ineligibilityReason(rule, { goodsCents: 2000, shippingCents: 0 }, NOW)).toBe(
      "nothing_to_discount",
    );
  });
});

describe("pointsForOrder (TEST-2004)", () => {
  const programme: LoyaltyProgramme = { enabled: true, pointsPerSol: 1, pointValueCents: 10 };

  it("credits one point per whole sol", () => {
    expect(pointsForOrder(programme, 2000)).toBe(20);
  });

  it("truncates rather than rounding up", () => {
    // S/ 24.90 is 24 points, not 25: a business must not pay a rate it did not
    // advertise.
    expect(pointsForOrder(programme, 2490)).toBe(24);
    expect(pointsForOrder(programme, 2499)).toBe(24);
  });

  it("multiplies by the rate", () => {
    expect(pointsForOrder({ ...programme, pointsPerSol: 3 }, 2000)).toBe(60);
  });

  it("credits nothing when the programme is off", () => {
    expect(pointsForOrder({ ...programme, enabled: false }, 9900)).toBe(0);
  });

  it("credits nothing at a rate of zero", () => {
    expect(pointsForOrder({ ...programme, pointsPerSol: 0 }, 9900)).toBe(0);
  });

  it("credits nothing below one sol", () => {
    expect(pointsForOrder(programme, 99)).toBe(0);
  });

  it("credits nothing for an empty or negative order", () => {
    expect(pointsForOrder(programme, 0)).toBe(0);
    expect(pointsForOrder(programme, -100)).toBe(0);
  });
});

describe("redemptionValueCents and maxRedeemablePoints (TEST-2005)", () => {
  const programme: LoyaltyProgramme = { enabled: true, pointsPerSol: 1, pointValueCents: 10 };

  it("converts points to cents", () => {
    expect(redemptionValueCents(programme, 50)).toBe(500);
  });

  it("values nothing at zero or below", () => {
    expect(redemptionValueCents(programme, 0)).toBe(0);
    expect(redemptionValueCents(programme, -5)).toBe(0);
  });

  it("is bounded by the balance", () => {
    expect(maxRedeemablePoints(programme, { balance: 30, payableCents: 100_000 })).toBe(30);
  });

  it("is bounded by what is left to pay", () => {
    expect(maxRedeemablePoints(programme, { balance: 1000, payableCents: 500 })).toBe(50);
  });

  it("never offers a point that would buy nothing", () => {
    // 7 points at 10 cents is 70; a bill with 35 cents left takes 3.
    expect(maxRedeemablePoints(programme, { balance: 7, payableCents: 35 })).toBe(3);
  });

  it("offers nothing when the bill is already settled", () => {
    expect(maxRedeemablePoints(programme, { balance: 100, payableCents: 0 })).toBe(0);
    expect(maxRedeemablePoints(programme, { balance: 100, payableCents: -50 })).toBe(0);
  });

  it("offers nothing when the programme is off", () => {
    expect(
      maxRedeemablePoints({ ...programme, enabled: false }, { balance: 100, payableCents: 5000 }),
    ).toBe(0);
  });
});

describe("labels", () => {
  it("names every promotion type", () => {
    for (const type of ["percentage", "fixed_amount", "free_delivery"] as const) {
      expect(PROMOTION_TYPE_LABELS[type].length).toBeGreaterThan(0);
      expect(describePromotion(promotion({ type })).length).toBeGreaterThan(0);
    }
  });

  it("names every ledger movement", () => {
    for (const type of ["earn", "redeem", "campaign", "adjustment", "expiry"] as const) {
      expect(LOYALTY_TRANSACTION_LABELS[type].length).toBeGreaterThan(0);
    }
  });
});
