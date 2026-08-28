import { describe, expect, it } from "vitest";
import {
  BILLING_DOCUMENT_STATUSES,
  BILLING_DOCUMENT_STATUS_LABELS,
  BILLING_DOCUMENT_TYPES,
  BILLING_DOCUMENT_TYPE_LABELS,
  allTransitionPairs,
  canTransition,
  isTerminal,
  nextStatuses,
} from "@/modules/billing/lifecycle";

/**
 * Phase 17 - the lifecycle as pure logic.
 *
 * The TypeScript machine is a MIRROR of `public.billing_document_transitions`.
 * That is only safe because `src/tests/database/billing.test.ts` compares the
 * two row for row; these tests cover what the mirror is FOR - answering
 * "what can this document do next" for the UI, the same role
 * `order-lifecycle.test.ts` covers for orders.
 */

describe("the machine", () => {
  it("moves pending -> sent -> accepted", () => {
    expect(nextStatuses("pending")).toContain("sent");
    expect(nextStatuses("sent")).toContain("accepted");
  });

  it("moves sent -> rejected", () => {
    expect(nextStatuses("sent")).toContain("rejected");
  });

  it("cancels from pending directly, and from accepted", () => {
    expect(canTransition("pending", "cancelled")).toBe(true);
    expect(canTransition("accepted", "cancelled")).toBe(true);
  });

  it("never skips a step", () => {
    expect(canTransition("pending", "accepted")).toBe(false);
    expect(canTransition("pending", "rejected")).toBe(false);
  });

  it("never goes backwards", () => {
    expect(canTransition("sent", "pending")).toBe(false);
    expect(canTransition("accepted", "sent")).toBe(false);
  });

  it("treats rejected and cancelled as terminal: no outgoing edge", () => {
    expect(isTerminal("rejected")).toBe(true);
    expect(isTerminal("cancelled")).toBe(true);
    expect(nextStatuses("rejected")).toHaveLength(0);
    expect(nextStatuses("cancelled")).toHaveLength(0);
  });

  it("has no self-transition", () => {
    for (const status of BILLING_DOCUMENT_STATUSES) {
      expect(canTransition(status, status), status).toBe(false);
    }
  });

  it("declares exactly five pairs, matching the SQL seed", () => {
    expect(allTransitionPairs()).toHaveLength(5);
  });
});

describe("the vocabulary of master section 33 (Phase 17)", () => {
  it("has the five states, in order", () => {
    expect(BILLING_DOCUMENT_STATUSES).toEqual([
      "pending",
      "sent",
      "accepted",
      "rejected",
      "cancelled",
    ]);
  });

  it("has the four document types", () => {
    expect(BILLING_DOCUMENT_TYPES).toEqual(["boleta", "factura", "nota_credito", "nota_debito"]);
  });

  it("labels every status and every type - nothing renders as undefined", () => {
    for (const status of BILLING_DOCUMENT_STATUSES) {
      expect(BILLING_DOCUMENT_STATUS_LABELS[status], status).toBeTruthy();
    }
    for (const type of BILLING_DOCUMENT_TYPES) {
      expect(BILLING_DOCUMENT_TYPE_LABELS[type], type).toBeTruthy();
    }
  });
});
