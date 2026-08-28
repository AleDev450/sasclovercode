import { describe, expect, it } from "vitest";
import {
  allTransitionPairs,
  canTransition,
  DELIVERY_STATUSES,
  DELIVERY_STATUS_LABELS,
  isOpen,
  isTerminal,
  nextForwardStatus,
  nextStatuses,
  requiresReason,
} from "@/modules/delivery/lifecycle";

/**
 * The TypeScript mirror of `public.delivery_transitions`.
 *
 * TEST-1901 (the row-for-row comparison against the real table) lives in
 * `src/tests/database/delivery.test.ts`, where a database is available. What
 * is asserted here is the behaviour the board depends on.
 */
describe("delivery lifecycle (TEST-1902)", () => {
  it("declares the six statuses master section 33 implies, in order", () => {
    expect(DELIVERY_STATUSES).toEqual([
      "pending",
      "assigned",
      "in_transit",
      "delivered",
      "failed",
      "cancelled",
    ]);
  });

  it("labels every status in Spanish", () => {
    for (const status of DELIVERY_STATUSES) {
      expect(DELIVERY_STATUS_LABELS[status].length).toBeGreaterThan(0);
    }
  });

  it("allows the happy path one step at a time", () => {
    expect(canTransition("pending", "assigned")).toBe(true);
    expect(canTransition("assigned", "in_transit")).toBe(true);
    expect(canTransition("in_transit", "delivered")).toBe(true);
  });

  it("refuses to skip a step", () => {
    expect(canTransition("pending", "in_transit")).toBe(false);
    expect(canTransition("pending", "delivered")).toBe(false);
    expect(canTransition("assigned", "delivered")).toBe(false);
  });

  it("treats delivered and cancelled as terminal, and nothing else", () => {
    expect(isTerminal("delivered")).toBe(true);
    expect(isTerminal("cancelled")).toBe(true);

    expect(isTerminal("pending")).toBe(false);
    expect(isTerminal("assigned")).toBe(false);
    expect(isTerminal("in_transit")).toBe(false);
    // The whole point of ADR-023 decision 5: a retry is the same delivery.
    expect(isTerminal("failed")).toBe(false);
  });

  it("lets a failed delivery be attempted again", () => {
    expect(canTransition("failed", "assigned")).toBe(true);
  });

  it("lets an assignment be undone when the rider falls through", () => {
    expect(canTransition("assigned", "pending")).toBe(true);
  });

  it("allows cancelling from every non-terminal state", () => {
    for (const status of DELIVERY_STATUSES) {
      expect(canTransition(status, "cancelled")).toBe(!isTerminal(status));
    }
  });

  it("never allows a transition out of a terminal state", () => {
    expect(nextStatuses("delivered")).toEqual([]);
    expect(nextStatuses("cancelled")).toEqual([]);
  });

  it("never declares a self-transition", () => {
    for (const pair of allTransitionPairs()) {
      expect(pair.from).not.toBe(pair.to);
    }
  });

  it("offers a forward move that is neither an ending nor an undo", () => {
    expect(nextForwardStatus("pending")).toBe("assigned");
    expect(nextForwardStatus("assigned")).toBe("in_transit");
    expect(nextForwardStatus("in_transit")).toBe("delivered");
    // From `failed`, the only way on is a reassignment, which is not "forward".
    expect(nextForwardStatus("failed")).toBe("assigned");
    expect(nextForwardStatus("delivered")).toBeNull();
    expect(nextForwardStatus("cancelled")).toBeNull();
  });

  it("treats open as the complement of terminal", () => {
    for (const status of DELIVERY_STATUSES) {
      expect(isOpen(status)).toBe(!isTerminal(status));
    }
  });

  it("requires a reason exactly for the two bad endings", () => {
    expect(requiresReason("failed")).toBe(true);
    expect(requiresReason("cancelled")).toBe(true);
    expect(requiresReason("delivered")).toBe(false);
    expect(requiresReason("pending")).toBe(false);
    expect(requiresReason("assigned")).toBe(false);
    expect(requiresReason("in_transit")).toBe(false);
  });

  it("declares exactly ten transitions", () => {
    expect(allTransitionPairs()).toHaveLength(10);
  });
});
