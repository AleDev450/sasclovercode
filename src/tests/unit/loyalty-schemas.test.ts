import { describe, expect, it } from "vitest";
import {
  applyCouponSchema,
  createCouponSchema,
  createPromotionSchema,
  loyaltySettingsSchema,
  recordLoyaltyAdjustmentSchema,
  redeemLoyaltyPointsSchema,
} from "@/modules/loyalty/schemas";

const UUID = "11111111-1111-4111-8111-111111111111";

/** The fields the promotion form always sends, so a case can override one. */
function promotionInput(overrides: Record<string, string> = {}) {
  return {
    name: "Verano",
    description: "",
    type: "percentage",
    percentOff: "10",
    amountOffCents: "",
    minOrderCents: "",
    startsAt: "",
    endsAt: "",
    maxRedemptions: "",
    ...overrides,
  };
}

describe("promotion schema (TEST-2006)", () => {
  it("accepts a percentage promotion with nothing else set", () => {
    const parsed = createPromotionSchema.safeParse(promotionInput());
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.percentOff).toBe(10);
      expect(parsed.data.amountOffCents).toBeNull();
      // A blank minimum is no minimum, which the column stores as zero.
      expect(parsed.data.minOrderCents).toBe(0);
      expect(parsed.data.maxRedemptions).toBeNull();
    }
  });

  it("rejects a percentage outside 1..100", () => {
    for (const percent of ["0", "101", "-5", "10.5"]) {
      expect(
        createPromotionSchema.safeParse(promotionInput({ percentOff: percent })).success,
        `percent ${percent} should be rejected`,
      ).toBe(false);
    }
  });

  it("rejects a percentage promotion with no percentage", () => {
    const parsed = createPromotionSchema.safeParse(promotionInput({ percentOff: "" }));
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.path).toEqual(["percentOff"]);
    }
  });

  it("rejects a percentage promotion that also carries an amount", () => {
    const parsed = createPromotionSchema.safeParse(
      promotionInput({ percentOff: "10", amountOffCents: "5.00" }),
    );
    expect(parsed.success).toBe(false);
  });

  it("accepts a fixed amount and reads it as cents", () => {
    const parsed = createPromotionSchema.safeParse(
      promotionInput({ type: "fixed_amount", percentOff: "", amountOffCents: "5.50" }),
    );
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.amountOffCents).toBe(550);
      expect(parsed.data.percentOff).toBeNull();
    }
  });

  it("rejects a fixed amount of zero", () => {
    const parsed = createPromotionSchema.safeParse(
      promotionInput({ type: "fixed_amount", percentOff: "", amountOffCents: "0" }),
    );
    expect(parsed.success).toBe(false);
  });

  it("accepts free delivery with neither value", () => {
    const parsed = createPromotionSchema.safeParse(
      promotionInput({ type: "free_delivery", percentOff: "", amountOffCents: "" }),
    );
    expect(parsed.success).toBe(true);
  });

  it("rejects a window that ends before it starts", () => {
    const parsed = createPromotionSchema.safeParse(
      promotionInput({ startsAt: "2026-09-10T10:00", endsAt: "2026-09-01T10:00" }),
    );
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((issue) => issue.path[0] === "endsAt")).toBe(true);
    }
  });

  it("accepts an open-ended window", () => {
    expect(
      createPromotionSchema.safeParse(promotionInput({ startsAt: "2026-09-01T10:00" })).success,
    ).toBe(true);
    expect(
      createPromotionSchema.safeParse(promotionInput({ endsAt: "2026-09-30T23:59" })).success,
    ).toBe(true);
  });

  it("rejects a blank name and one over the column limit", () => {
    expect(createPromotionSchema.safeParse(promotionInput({ name: "  " })).success).toBe(false);
    expect(createPromotionSchema.safeParse(promotionInput({ name: "x".repeat(121) })).success).toBe(
      false,
    );
  });

  it("has no field for times_redeemed", () => {
    const parsed = createPromotionSchema.safeParse({
      ...promotionInput(),
      timesRedeemed: "999",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(Object.keys(parsed.data)).not.toContain("timesRedeemed");
    }
  });
});

describe("coupon schema (TEST-2006)", () => {
  it("upper-cases the code", () => {
    const parsed = createCouponSchema.safeParse({
      promotionId: UUID,
      code: "verano10",
      maxRedemptions: "",
      expiresAt: "",
    });
    expect(parsed.success && parsed.data.code).toBe("VERANO10");
  });

  it("rejects a code that is too short", () => {
    expect(
      createCouponSchema.safeParse({
        promotionId: UUID,
        code: "ab",
        maxRedemptions: "",
        expiresAt: "",
      }).success,
    ).toBe(false);
  });

  it("rejects a code with characters a till cannot type easily", () => {
    for (const code of ["CON ESPACIO", "ACENTÚA", "SIGNO!"]) {
      expect(
        createCouponSchema.safeParse({
          promotionId: UUID,
          code,
          maxRedemptions: "",
          expiresAt: "",
        }).success,
        `code ${code} should be rejected`,
      ).toBe(false);
    }
  });

  it("normalises the code on the apply form too, so case never matters", () => {
    const parsed = applyCouponSchema.safeParse({ orderId: UUID, code: " verano10 " });
    expect(parsed.success && parsed.data.code).toBe("VERANO10");
  });
});

describe("points schemas (TEST-2006)", () => {
  it("accepts a signed adjustment", () => {
    const positive = recordLoyaltyAdjustmentSchema.safeParse({
      accountId: UUID,
      type: "campaign",
      points: "20",
      reason: "Aniversario",
    });
    expect(positive.success && positive.data.points).toBe(20);

    const negative = recordLoyaltyAdjustmentSchema.safeParse({
      accountId: UUID,
      type: "adjustment",
      points: "-20",
      reason: "Correccion",
    });
    expect(negative.success && negative.data.points).toBe(-20);
  });

  it("rejects a movement of zero", () => {
    expect(
      recordLoyaltyAdjustmentSchema.safeParse({
        accountId: UUID,
        type: "adjustment",
        points: "0",
        reason: "Nada",
      }).success,
    ).toBe(false);
  });

  it("requires a reason", () => {
    expect(
      recordLoyaltyAdjustmentSchema.safeParse({
        accountId: UUID,
        type: "campaign",
        points: "20",
        reason: "   ",
      }).success,
    ).toBe(false);
  });

  it("refuses the automatic types on the manual form", () => {
    for (const type of ["earn", "redeem"]) {
      expect(
        recordLoyaltyAdjustmentSchema.safeParse({
          accountId: UUID,
          type,
          points: "20",
          reason: "x",
        }).success,
        `${type} should not be writable by hand`,
      ).toBe(false);
    }
  });

  it("only redeems a positive whole number of points", () => {
    expect(
      redeemLoyaltyPointsSchema.safeParse({ orderId: UUID, accountId: UUID, points: "50" }).success,
    ).toBe(true);

    for (const points of ["0", "-5", "5.5", ""]) {
      expect(
        redeemLoyaltyPointsSchema.safeParse({ orderId: UUID, accountId: UUID, points }).success,
        `points ${JSON.stringify(points)} should be rejected`,
      ).toBe(false);
    }
  });
});

describe("programme settings schema", () => {
  it("accepts a rate of zero, which simply accrues nothing", () => {
    const parsed = loyaltySettingsSchema.safeParse({
      loyaltyEnabled: "true",
      pointsPerSol: "0",
      pointValueCents: "10",
    });
    expect(parsed.success && parsed.data.pointsPerSol).toBe(0);
  });

  it("refuses a point worth nothing", () => {
    // A zero-value point would spend a customer's balance for no discount.
    expect(
      loyaltySettingsSchema.safeParse({
        loyaltyEnabled: "true",
        pointsPerSol: "1",
        pointValueCents: "0",
      }).success,
    ).toBe(false);
  });

  it("reads the checkbox as a boolean", () => {
    const on = loyaltySettingsSchema.safeParse({
      loyaltyEnabled: "true",
      pointsPerSol: "1",
      pointValueCents: "10",
    });
    expect(on.success && on.data.loyaltyEnabled).toBe(true);

    const off = loyaltySettingsSchema.safeParse({
      loyaltyEnabled: "false",
      pointsPerSol: "1",
      pointValueCents: "10",
    });
    expect(off.success && off.data.loyaltyEnabled).toBe(false);
  });
});
