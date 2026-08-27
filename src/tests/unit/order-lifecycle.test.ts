import { describe, expect, it } from "vitest";
import {
  ORDER_SOURCES,
  ORDER_STATUSES,
  allTransitionPairs,
  canTransition,
  isTerminal,
  lineTotalCents,
  nextForwardStatus,
  nextStatuses,
} from "@/modules/orders/lifecycle";

/**
 * Phase 13 - the lifecycle as pure logic.
 *
 * The TypeScript machine is a MIRROR of `public.order_transitions`. That is
 * only safe because `src/tests/database/orders.test.ts` compares the two row
 * for row (TEST-1301); these tests cover what the mirror is FOR - answering
 * "what can this order do next" for the UI.
 */

describe("the machine (TEST-1302)", () => {
  it("moves forward one step at a time", () => {
    expect(nextStatuses("pending")).toContain("confirmed");
    expect(nextStatuses("confirmed")).toContain("preparing");
    expect(nextStatuses("preparing")).toContain("ready");
    expect(nextStatuses("ready")).toContain("completed");
  });

  it("never skips a step", () => {
    expect(canTransition("pending", "ready")).toBe(false);
    expect(canTransition("pending", "completed")).toBe(false);
    expect(canTransition("confirmed", "completed")).toBe(false);
  });

  it("never goes backwards", () => {
    expect(canTransition("confirmed", "pending")).toBe(false);
    expect(canTransition("ready", "preparing")).toBe(false);
  });

  it("cancels from anywhere that is still live", () => {
    for (const status of ["pending", "confirmed", "preparing", "ready"] as const) {
      expect(canTransition(status, "cancelled"), status).toBe(true);
    }
  });

  it("treats completed and cancelled as terminal (TEST-1302)", () => {
    expect(isTerminal("completed")).toBe(true);
    expect(isTerminal("cancelled")).toBe(true);
    expect(nextStatuses("completed")).toHaveLength(0);
    expect(nextStatuses("cancelled")).toHaveLength(0);
  });

  it("has no self-transition", () => {
    for (const status of ORDER_STATUSES) {
      expect(canTransition(status, status), status).toBe(false);
    }
  });

  it("separates the forward move from cancelling", () => {
    // The dashboard draws these as two different buttons under two different
    // permissions, so the helper must not offer `cancelled` as "next".
    expect(nextForwardStatus("pending")).toBe("confirmed");
    expect(nextForwardStatus("ready")).toBe("completed");
    expect(nextForwardStatus("completed")).toBeNull();
    expect(nextForwardStatus("cancelled")).toBeNull();
  });

  it("declares exactly eight pairs, matching the SQL seed", () => {
    expect(allTransitionPairs()).toHaveLength(8);
  });
});

describe("the vocabulary of master section 33", () => {
  it("has the six states, in order", () => {
    expect(ORDER_STATUSES).toEqual([
      "pending",
      "confirmed",
      "preparing",
      "ready",
      "completed",
      "cancelled",
    ]);
  });

  it("has the five sources", () => {
    expect(ORDER_SOURCES).toEqual(["web", "pos", "manual", "whatsapp", "delivery"]);
  });
});

describe("lineTotalCents (TEST-1303, TEST-1304)", () => {
  it("is price times quantity, less discount, plus tax (TEST-1303)", () => {
    expect(lineTotalCents({ unitPriceCents: 2490, quantity: 2 })).toBe(4980);
    expect(lineTotalCents({ unitPriceCents: 2490, quantity: 2, discountCents: 500 })).toBe(4480);
    expect(lineTotalCents({ unitPriceCents: 1000, quantity: 1, taxCents: 180 })).toBe(1180);
  });

  /*
   * The preview a cashier sees while typing must equal the number the database
   * stores, or the form lies. `snapshot_order_item()` uses SQL round(), which
   * rounds half away from zero; Math.round matches it for the positive amounts
   * this function ever sees.
   */
  it("rounds a fractional quantity the same way SQL does (TEST-1304)", () => {
    // 3333 * 0.75 = 2499.75
    expect(lineTotalCents({ unitPriceCents: 3333, quantity: 0.75 })).toBe(2500);
    // 1000 * 0.335 = 335 exactly
    expect(lineTotalCents({ unitPriceCents: 1000, quantity: 0.335 })).toBe(335);
    // 999 * 1.5 = 1498.5 -> 1499
    expect(lineTotalCents({ unitPriceCents: 999, quantity: 1.5 })).toBe(1499);
  });

  it("returns an integer for every input", () => {
    for (const quantity of [0.001, 0.333, 1.7, 12.125]) {
      expect(Number.isInteger(lineTotalCents({ unitPriceCents: 1234, quantity }))).toBe(true);
    }
  });

  it("can reach zero when the discount covers the line", () => {
    expect(lineTotalCents({ unitPriceCents: 2490, quantity: 1, discountCents: 2490 })).toBe(0);
  });
});
