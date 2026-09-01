import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * TEST-2620 to TEST-2622 — the latency instrumentation.
 *
 * Master section 33, Phase 26 lists "database latency" among the things to
 * analyse. Real numbers need a deployed environment and traffic; what this
 * phase can leave behind is the thing that produces them, and a guarantee about
 * what it does NOT record.
 */

const logged = vi.hoisted(() => ({
  warn: [] as { event: string; context: unknown }[],
  debug: [] as { event: string; context: unknown }[],
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    warn: (event: string, context: unknown) => logged.warn.push({ event, context }),
    debug: (event: string, context: unknown) => logged.debug.push({ event, context }),
    info: () => undefined,
    error: () => undefined,
  },
}));

afterEach(() => {
  logged.warn = [];
  logged.debug = [];
});

describe("timed (TEST-2620 to TEST-2622)", () => {
  it("returns what the operation returned (TEST-2620)", async () => {
    const { timed } = await import("@/lib/observability/timing");
    await expect(timed("catalog.list", async () => 42)).resolves.toBe(42);
    expect(logged.debug).toHaveLength(1);
    expect(logged.debug[0]?.event).toBe("db.query.timing");
  });

  it("records a duration", async () => {
    const { timed } = await import("@/lib/observability/timing");
    await timed("catalog.list", async () => "x");
    const context = logged.debug[0]?.context as { durationMs: number; operation: string };
    expect(typeof context.durationMs).toBe("number");
    expect(context.durationMs).toBeGreaterThanOrEqual(0);
    expect(context.operation).toBe("catalog.list");
  });

  it("warns when a read crosses the slow threshold (TEST-2621)", async () => {
    const { timed, SLOW_QUERY_MS } = await import("@/lib/observability/timing");

    // Advancing the clock rather than sleeping: a test that waits 200 ms to
    // prove a threshold is a test that costs 200 ms forever.
    const now = vi.spyOn(Date, "now");
    now.mockReturnValueOnce(0).mockReturnValueOnce(SLOW_QUERY_MS + 5);

    await timed("orders.list", async () => "x");

    expect(logged.warn).toHaveLength(1);
    expect(logged.warn[0]?.event).toBe("db.query.slow");
    now.mockRestore();
  });

  /*
   * TEST-2622 - the guarantee that matters more than the measurement.
   *
   * A query's parameters are customer names, phone numbers and document
   * numbers: exactly the personal data ADR-016 minimised and section 16 keeps
   * out of logs. Timing must never become the back door that puts them there.
   */
  it("records the operation name and the duration, and nothing else (TEST-2622)", async () => {
    const { timed } = await import("@/lib/observability/timing");

    await timed("customers.search", async () => ["Ana Gómez", "999888777"]);

    const context = logged.debug[0]?.context as Record<string, unknown>;
    expect(Object.keys(context).sort()).toEqual(["durationMs", "ok", "operation"]);

    const serialised = JSON.stringify(logged.debug);
    expect(serialised).not.toContain("Ana");
    expect(serialised).not.toContain("999888777");
  });

  it("times a failing read and still rethrows (TEST-2620b)", async () => {
    const { timed } = await import("@/lib/observability/timing");

    // The most interesting query there is: four seconds, then an error.
    // Swallowing the timing would lose exactly that case.
    await expect(timed("orders.list", () => Promise.reject(new Error("boom")))).rejects.toThrow(
      "boom",
    );

    expect(logged.debug).toHaveLength(1);
    expect((logged.debug[0]?.context as { ok: boolean }).ok).toBe(false);
  });
});
