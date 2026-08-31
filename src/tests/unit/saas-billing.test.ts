import { describe, expect, it } from "vitest";
import {
  EMPTY_CYCLE,
  graceEndsAt,
  isOverdue,
  isOwed,
  isPastGrace,
  nextPeriodEnd,
  SAAS_PAYMENT_STATUS_LABELS,
  SUBSCRIPTION_EVENT_LABELS,
  summariseCycle,
  type CycleSummary,
} from "@/modules/platform/billing";
import type { SaasPaymentStatus, SubscriptionEventType } from "@/types/database";

const ALL_STATUSES: readonly SaasPaymentStatus[] = [
  "pending",
  "paid",
  "failed",
  "refunded",
  "void",
];

const ALL_EVENTS: readonly SubscriptionEventType[] = [
  "created",
  "plan_changed",
  "status_changed",
  "period_advanced",
  "charge_issued",
  "payment_recorded",
  "payment_voided",
];

describe("vocabulary (TEST-2201)", () => {
  it("labels all five charge statuses", () => {
    for (const status of ALL_STATUSES) {
      expect(SAAS_PAYMENT_STATUS_LABELS[status].length).toBeGreaterThan(0);
    }
    expect(Object.keys(SAAS_PAYMENT_STATUS_LABELS).sort()).toEqual([...ALL_STATUSES].sort());
  });

  it("labels all seven event types", () => {
    for (const type of ALL_EVENTS) {
      expect(SUBSCRIPTION_EVENT_LABELS[type].length).toBeGreaterThan(0);
    }
    expect(Object.keys(SUBSCRIPTION_EVENT_LABELS).sort()).toEqual([...ALL_EVENTS].sort());
  });
});

describe("what counts as debt (TEST-2202)", () => {
  const NOW = new Date("2026-08-30T12:00:00Z");

  it("counts only a pending charge", () => {
    expect(isOwed({ status: "pending" })).toBe(true);

    // A voided or refunded charge is not debt, which is why the cycle's arrears
    // steps look only at `pending` - and why suspending over one would be wrong.
    for (const status of ["paid", "failed", "refunded", "void"] as const) {
      expect(isOwed({ status }), `${status} is not debt`).toBe(false);
    }
  });

  it("is overdue once the due date has passed", () => {
    expect(isOverdue({ status: "pending", dueAt: "2026-08-29T12:00:00Z" }, NOW)).toBe(true);
    expect(isOverdue({ status: "pending", dueAt: "2026-08-31T12:00:00Z" }, NOW)).toBe(false);
  });

  it("is overdue on the due instant itself", () => {
    // Billed in advance: the charge is due the moment the period opens.
    expect(isOverdue({ status: "pending", dueAt: NOW.toISOString() }, NOW)).toBe(true);
  });

  it("is never overdue when it is not owed", () => {
    expect(isOverdue({ status: "paid", dueAt: "2020-01-01T00:00:00Z" }, NOW)).toBe(false);
    expect(isOverdue({ status: "void", dueAt: "2020-01-01T00:00:00Z" }, NOW)).toBe(false);
  });

  it("puts the end of grace a plan's grace days after the due date", () => {
    expect(graceEndsAt("2026-08-01T00:00:00Z", 7).toISOString()).toBe("2026-08-08T00:00:00.000Z");
    // Zero grace is legal, and means due and suspendable the same instant.
    expect(graceEndsAt("2026-08-01T00:00:00Z", 0).toISOString()).toBe("2026-08-01T00:00:00.000Z");
  });

  it("crosses a month boundary when counting grace", () => {
    expect(graceEndsAt("2026-08-28T00:00:00Z", 7).toISOString()).toBe("2026-09-04T00:00:00.000Z");
  });

  it("reports past grace only once the whole window is gone", () => {
    const charge = { status: "pending" as const, dueAt: "2026-08-20T12:00:00Z" };
    expect(isPastGrace(charge, 7, NOW)).toBe(true);
    expect(isPastGrace(charge, 30, NOW)).toBe(false);
    // Not debt, not suspendable.
    expect(isPastGrace({ ...charge, status: "void" }, 7, NOW)).toBe(false);
  });
});

describe("nextPeriodEnd (TEST-2203)", () => {
  it("adds a month, keeping the day", () => {
    expect(nextPeriodEnd("2026-03-15T10:00:00Z", "monthly").toISOString()).toBe(
      "2026-04-15T10:00:00.000Z",
    );
  });

  it("adds a year", () => {
    expect(nextPeriodEnd("2026-03-15T10:00:00Z", "yearly").toISOString()).toBe(
      "2027-03-15T10:00:00.000Z",
    );
  });

  it("clamps 31 January to the end of February instead of overflowing", () => {
    // The case that matters: naive month arithmetic rolls 31 January into 3
    // March, which would bill somebody for a month they did not have. This is
    // what PostgreSQL's `+ interval '1 month'` does, and therefore what the
    // cycle does.
    expect(nextPeriodEnd("2026-01-31T00:00:00Z", "monthly").toISOString()).toBe(
      "2026-02-28T00:00:00.000Z",
    );
  });

  it("clamps into a leap February", () => {
    expect(nextPeriodEnd("2028-01-31T00:00:00Z", "monthly").toISOString()).toBe(
      "2028-02-29T00:00:00.000Z",
    );
  });

  it("clamps 31 May into June", () => {
    expect(nextPeriodEnd("2026-05-31T00:00:00Z", "monthly").toISOString()).toBe(
      "2026-06-30T00:00:00.000Z",
    );
  });

  it("crosses the year boundary", () => {
    expect(nextPeriodEnd("2026-12-15T00:00:00Z", "monthly").toISOString()).toBe(
      "2027-01-15T00:00:00.000Z",
    );
  });

  it("handles 29 February on a yearly plan", () => {
    expect(nextPeriodEnd("2028-02-29T00:00:00Z", "yearly").toISOString()).toBe(
      "2029-02-28T00:00:00.000Z",
    );
  });

  it("accepts a Date as well as a string, without mutating it", () => {
    const from = new Date("2026-03-15T10:00:00Z");
    const next = nextPeriodEnd(from, "monthly");
    expect(next.toISOString()).toBe("2026-04-15T10:00:00.000Z");
    expect(from.toISOString()).toBe("2026-03-15T10:00:00.000Z");
  });
});

describe("summariseCycle (TEST-2205)", () => {
  it("says plainly when a run did nothing", () => {
    // The normal case: the cycle is meant to be run often, so most runs find
    // nothing to do and deserve a sentence rather than five zeroes.
    expect(summariseCycle(EMPTY_CYCLE)).toBe("Nada que hacer: todo estaba al dia.");
  });

  it("names only what actually happened", () => {
    const summary: CycleSummary = { ...EMPTY_CYCLE, chargesIssued: 3 };
    const text = summariseCycle(summary);

    expect(text).toContain("3 cargo(s) emitido(s)");
    expect(text).not.toContain("suspendida");
    expect(text).not.toContain("mora");
  });

  it("lists every kind of work in one sentence", () => {
    const text = summariseCycle({
      subscriptionsAdvanced: 2,
      chargesIssued: 5,
      markedPastDue: 1,
      suspended: 1,
      cancelled: 1,
    });

    expect(text).toContain("5 cargo(s)");
    expect(text).toContain("2 periodo(s)");
    expect(text).toContain("1 en mora");
    expect(text).toContain("1 suspendida(s)");
    expect(text).toContain("1 cancelada(s)");
    expect(text.endsWith(".")).toBe(true);
  });
});
