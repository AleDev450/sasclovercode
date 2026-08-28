import { describe, expect, it } from "vitest";
import {
  feeForSubtotal,
  isFreeForSubtotal,
  resolveRate,
  type RateCandidate,
} from "@/modules/delivery/rates";

const ZONE = "11111111-1111-4111-8111-111111111111";
const OTHER_ZONE = "22222222-2222-4222-8222-222222222222";
const BRANCH_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BRANCH_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function rate(overrides: Partial<RateCandidate> = {}): RateCandidate {
  return {
    id: "rate",
    zoneId: ZONE,
    locationId: null,
    feeCents: 800,
    minOrderFreeCents: null,
    estimatedMinutes: 40,
    isActive: true,
    ...overrides,
  };
}

describe("resolveRate (TEST-1904)", () => {
  it("uses the zone default when there is no branch rate", () => {
    const rates = [rate({ id: "default" })];
    expect(resolveRate(rates, { zoneId: ZONE, locationId: BRANCH_A })?.id).toBe("default");
  });

  it("prefers the branch rate over the zone default", () => {
    const rates = [
      rate({ id: "default", locationId: null, feeCents: 800 }),
      rate({ id: "branch-a", locationId: BRANCH_A, feeCents: 500 }),
    ];
    const resolved = resolveRate(rates, { zoneId: ZONE, locationId: BRANCH_A });
    expect(resolved?.id).toBe("branch-a");
    expect(resolved?.feeCents).toBe(500);
  });

  it("falls back to the default for a branch with no override", () => {
    const rates = [
      rate({ id: "default", locationId: null }),
      rate({ id: "branch-a", locationId: BRANCH_A }),
    ];
    expect(resolveRate(rates, { zoneId: ZONE, locationId: BRANCH_B })?.id).toBe("default");
  });

  it("ignores an inactive branch rate and falls back to the default", () => {
    // Deactivating one branch's override is how a business says "charge the
    // normal price here again" - so the fallback has to happen after filtering.
    const rates = [
      rate({ id: "default", locationId: null }),
      rate({ id: "branch-a", locationId: BRANCH_A, isActive: false }),
    ];
    expect(resolveRate(rates, { zoneId: ZONE, locationId: BRANCH_A })?.id).toBe("default");
  });

  it("ignores an inactive default", () => {
    const rates = [rate({ id: "default", isActive: false })];
    expect(resolveRate(rates, { zoneId: ZONE, locationId: BRANCH_A })).toBeNull();
  });

  it("never returns a rate belonging to another zone", () => {
    const rates = [rate({ id: "other", zoneId: OTHER_ZONE })];
    expect(resolveRate(rates, { zoneId: ZONE, locationId: BRANCH_A })).toBeNull();
  });

  it("returns null when the zone has no rate at all", () => {
    expect(resolveRate([], { zoneId: ZONE, locationId: BRANCH_A })).toBeNull();
  });
});

describe("feeForSubtotal (TEST-1905)", () => {
  it("charges the fee when no free threshold is set", () => {
    expect(feeForSubtotal(rate({ minOrderFreeCents: null }), 100_000)).toBe(800);
  });

  it("charges the fee below the threshold", () => {
    expect(feeForSubtotal(rate({ minOrderFreeCents: 5000 }), 4999)).toBe(800);
  });

  it("ships free exactly AT the threshold", () => {
    // "Gratis desde S/ 50" has to be true for an order of exactly S/ 50, or the
    // promise on the menu is false for the one order that matches it.
    expect(feeForSubtotal(rate({ minOrderFreeCents: 5000 }), 5000)).toBe(0);
  });

  it("ships free above the threshold", () => {
    expect(feeForSubtotal(rate({ minOrderFreeCents: 5000 }), 9900)).toBe(0);
  });

  it("reports free delivery only when something was actually waived", () => {
    expect(isFreeForSubtotal(rate({ minOrderFreeCents: 5000 }), 5000)).toBe(true);
    expect(isFreeForSubtotal(rate({ minOrderFreeCents: 5000 }), 4999)).toBe(false);
    // A zone that is always free did not waive anything for this order.
    expect(isFreeForSubtotal(rate({ feeCents: 0, minOrderFreeCents: 5000 }), 9900)).toBe(false);
  });

  it("returns an integer number of cents in every case", () => {
    for (const subtotal of [0, 1, 4999, 5000, 123_456]) {
      const result = feeForSubtotal(rate({ minOrderFreeCents: 5000 }), subtotal);
      expect(Number.isInteger(result)).toBe(true);
    }
  });
});
