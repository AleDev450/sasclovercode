import { describe, expect, it } from "vitest";
import {
  BOARD_STATUSES,
  BOARD_STATUS_LABELS,
  KITCHEN_STATIONS,
  KITCHEN_STATION_LABELS,
} from "@/modules/kitchen/constants";

/**
 * Phase 16 - master section 33 gives two closed lists, verbatim:
 * "new / preparing / ready" and "kitchen, bar, sushi, desserts". These
 * tests pin both, the same way order-lifecycle.test.ts (Phase 13) pins the
 * state machine's own shape.
 */

describe("KITCHEN_STATIONS", () => {
  it("is exactly the four stations from master section 33", () => {
    expect([...KITCHEN_STATIONS].sort()).toEqual(["bar", "desserts", "kitchen", "sushi"]);
  });

  it("has a label for every station and nothing extra", () => {
    expect(Object.keys(KITCHEN_STATION_LABELS).sort()).toEqual([...KITCHEN_STATIONS].sort());
  });
});

describe("BOARD_STATUSES", () => {
  it("is the three-status slice of Phase 13's order_status - not a new state machine", () => {
    expect(BOARD_STATUSES).toEqual(["confirmed", "preparing", "ready"]);
  });

  it("does not include pending, completed or cancelled", () => {
    for (const status of ["pending", "completed", "cancelled"]) {
      expect(BOARD_STATUSES as readonly string[]).not.toContain(status);
    }
  });

  it("has a board label for every status it shows and nothing extra", () => {
    expect(Object.keys(BOARD_STATUS_LABELS).sort()).toEqual([...BOARD_STATUSES].sort());
  });
});
