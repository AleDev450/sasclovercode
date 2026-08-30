import { describe, expect, it } from "vitest";
import {
  ACCESS_GRANTING_STATUSES,
  ALL_MODULES,
  MODULES,
  MODULE_LABELS,
  PLAN_CODES,
  SUBSCRIPTION_STATUS_LABELS,
  isModule,
} from "@/lib/features";

/**
 * The TypeScript mirror of the module catalogue.
 *
 * TEST-2112 (the row-for-row comparison against the real table) lives in
 * `src/tests/database/modules.test.ts`, where a database is available. What is
 * asserted here is the shape the application depends on.
 */
describe("module catalogue (TEST-2101)", () => {
  it("declares exactly the ten modules master section 33 enumerates", () => {
    expect(ALL_MODULES).toEqual([
      "website",
      "catalog",
      "orders",
      "pos",
      "inventory",
      "billing",
      "delivery",
      "loyalty",
      "multi_location",
      "reports",
    ]);
  });

  it("labels every module in Spanish", () => {
    for (const code of ALL_MODULES) {
      expect(MODULE_LABELS[code].length).toBeGreaterThan(0);
    }
  });

  it("has no label for a module that does not exist", () => {
    expect(Object.keys(MODULE_LABELS).sort()).toEqual([...ALL_MODULES].sort());
  });

  it("exposes the same set through MODULES and ALL_MODULES", () => {
    expect(Object.values(MODULES).sort()).toEqual([...ALL_MODULES].sort());
  });

  it("narrows a known code and rejects an unknown one", () => {
    expect(isModule("pos")).toBe(true);
    expect(isModule("inventory")).toBe(true);

    expect(isModule("posx")).toBe(false);
    expect(isModule("")).toBe(false);
    expect(isModule("POS")).toBe(false);
    // A permission is not a module, however much they rhyme.
    expect(isModule("orders.view")).toBe(false);
  });
});

describe("subscription statuses", () => {
  it("labels all five", () => {
    for (const status of ["trialing", "active", "past_due", "suspended", "cancelled"] as const) {
      expect(SUBSCRIPTION_STATUS_LABELS[status].length).toBeGreaterThan(0);
    }
  });

  it("grants access while trialing, active and past due", () => {
    // `past_due` is here deliberately (ADR-025 decision 3): a failed card must
    // not cut a restaurant's till off mid-service.
    expect([...ACCESS_GRANTING_STATUSES].sort()).toEqual(["active", "past_due", "trialing"]);
  });

  it("does not grant access while suspended or cancelled", () => {
    const granting: readonly string[] = ACCESS_GRANTING_STATUSES;
    expect(granting).not.toContain("suspended");
    expect(granting).not.toContain("cancelled");
  });
});

describe("plan catalogue", () => {
  it("declares the three shipped plans", () => {
    expect(PLAN_CODES).toEqual(["starter", "professional", "enterprise"]);
  });
});
