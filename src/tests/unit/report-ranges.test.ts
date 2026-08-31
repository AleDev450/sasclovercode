import { describe, expect, it } from "vitest";
import {
  averageTicket,
  defaultRange,
  formatHour,
  MAX_RANGE_DAYS,
  normaliseRange,
  RANGE_PRESETS,
  RANGE_PRESET_LABELS,
  rangeDays,
  rangeForPreset,
  toDateInput,
} from "@/modules/reports/ranges";
import { reportFiltersSchema } from "@/modules/reports/schemas";

/** A fixed clock: a test that depends on "now" is a test that fails at midnight. */
const NOW = new Date("2026-03-15T14:30:00Z");

describe("presets (TEST-2304)", () => {
  it("labels every preset", () => {
    for (const preset of RANGE_PRESETS) {
      expect(RANGE_PRESET_LABELS[preset].length).toBeGreaterThan(0);
    }
    expect(Object.keys(RANGE_PRESET_LABELS).sort()).toEqual([...RANGE_PRESETS].sort());
  });

  it("gives today as a half-open day", () => {
    // Half-open on purpose: a closed range forces somebody to decide what "the
    // end of the day" is, and 23:59:59.999 loses the last sale of the day.
    expect(rangeForPreset("today", NOW)).toEqual({
      from: "2026-03-15T00:00:00.000Z",
      to: "2026-03-16T00:00:00.000Z",
    });
  });

  it("gives the last seven days INCLUDING today", () => {
    const range = rangeForPreset("last7", NOW);
    expect(range.from).toBe("2026-03-09T00:00:00.000Z");
    expect(range.to).toBe("2026-03-16T00:00:00.000Z");
    expect(rangeDays(range)).toBe(7);
  });

  it("gives the last thirty days including today", () => {
    const range = rangeForPreset("last30", NOW);
    expect(rangeDays(range)).toBe(30);
    expect(range.to).toBe("2026-03-16T00:00:00.000Z");
  });

  it("gives this month from its first day", () => {
    expect(rangeForPreset("month", NOW)).toEqual({
      from: "2026-03-01T00:00:00.000Z",
      to: "2026-03-16T00:00:00.000Z",
    });
  });

  it("handles the first of the month, when 'this month' is one day", () => {
    const firstOfMonth = new Date("2026-03-01T09:00:00Z");
    const range = rangeForPreset("month", firstOfMonth);
    expect(range.from).toBe("2026-03-01T00:00:00.000Z");
    expect(rangeDays(range)).toBe(1);
  });

  it("defaults to the last seven days (TEST-2301)", () => {
    expect(defaultRange(NOW)).toEqual(rangeForPreset("last7", NOW));
  });
});

describe("normaliseRange (TEST-2301, TEST-2302, TEST-2303)", () => {
  it("falls back to the default when nothing was asked for", () => {
    expect(normaliseRange({}, NOW)).toEqual(defaultRange(NOW));
    expect(normaliseRange({ from: null, to: null }, NOW)).toEqual(defaultRange(NOW));
  });

  it("falls back when only one end was given", () => {
    expect(normaliseRange({ from: "2026-03-01" }, NOW)).toEqual(defaultRange(NOW));
    expect(normaliseRange({ to: "2026-03-10" }, NOW)).toEqual(defaultRange(NOW));
  });

  it("falls back on an unparseable date", () => {
    expect(normaliseRange({ from: "ayer", to: "2026-03-10" }, NOW)).toEqual(defaultRange(NOW));
  });

  it("swaps an inverted range rather than rejecting it (TEST-2302)", () => {
    // Somebody who typed the dates the wrong way round meant the range between
    // them; an error page would be a worse answer than the range.
    const range = normaliseRange({ from: "2026-03-20", to: "2026-03-10" }, NOW);
    expect(range.from).toBe("2026-03-10T00:00:00.000Z");
    expect(range.to).toBe("2026-03-20T00:00:00.000Z");
  });

  it("turns a single instant into a day", () => {
    const range = normaliseRange({ from: "2026-03-10", to: "2026-03-10" }, NOW);
    expect(range.from).toBe("2026-03-10T00:00:00.000Z");
    expect(range.to).toBe("2026-03-11T00:00:00.000Z");
  });

  it("keeps a range that is exactly the cap", () => {
    const range = normaliseRange({ from: "2025-01-01", to: "2026-01-02" }, NOW);
    expect(rangeDays(range)).toBe(MAX_RANGE_DAYS);
  });

  it("trims a range longer than the cap, keeping the END (TEST-2303)", () => {
    // "The last N days before this date" is what a too-wide range was reaching
    // for, so the start moves and the end stays.
    const range = normaliseRange({ from: "2010-01-01", to: "2026-03-10" }, NOW);
    expect(range.to).toBe("2026-03-10T00:00:00.000Z");
    expect(rangeDays(range)).toBe(MAX_RANGE_DAYS);
  });

  it("accepts a full ISO instant, not only a date", () => {
    const range = normaliseRange({ from: "2026-03-10T08:30:00Z", to: "2026-03-11T20:00:00Z" }, NOW);
    expect(range.from).toBe("2026-03-10T08:30:00.000Z");
    expect(range.to).toBe("2026-03-11T20:00:00.000Z");
  });
});

describe("averageTicket (TEST-2305)", () => {
  it("divides in whole cents", () => {
    expect(averageTicket(4000, 2)).toBe(2000);
  });

  it("truncates rather than rounding, matching the SQL", () => {
    // The function in the database casts the sum to bigint before dividing so
    // the division truncates; this mirrors it, or a screen could recompute a
    // subtotal and disagree with the row it came from.
    expect(averageTicket(4001, 3)).toBe(1333);
    expect(averageTicket(999, 2)).toBe(499);
  });

  it("returns zero rather than dividing by zero", () => {
    expect(averageTicket(0, 0)).toBe(0);
    expect(averageTicket(5000, 0)).toBe(0);
    expect(averageTicket(5000, -1)).toBe(0);
  });
});

describe("formatting (TEST-2306)", () => {
  it("names all 24 hours with two digits", () => {
    expect(formatHour(0)).toBe("00:00");
    expect(formatHour(9)).toBe("09:00");
    expect(formatHour(23)).toBe("23:00");

    for (let hour = 0; hour < 24; hour++) {
      expect(formatHour(hour)).toMatch(/^\d{2}:00$/);
    }
  });

  it("turns an ISO instant into what a date input wants", () => {
    expect(toDateInput("2026-03-10T08:30:00.000Z")).toBe("2026-03-10");
  });
});

describe("the filter schema (TEST-2307)", () => {
  const UUID = "11111111-1111-4111-8111-111111111111";

  it("accepts an empty query string", () => {
    const parsed = reportFiltersSchema.parse({});
    expect(parsed).toEqual({ from: null, to: null, preset: null, location: null });
  });

  it("treats blanks as absent", () => {
    const parsed = reportFiltersSchema.parse({ from: "  ", to: "", location: "" });
    expect(parsed.from).toBeNull();
    expect(parsed.to).toBeNull();
    expect(parsed.location).toBeNull();
  });

  it("keeps a valid branch", () => {
    expect(reportFiltersSchema.parse({ location: UUID }).location).toBe(UUID);
  });

  it("drops a branch that is not a uuid rather than failing", () => {
    // The report is still the right answer to a slightly wrong question, and a
    // URL is edited by hand more often than one would like.
    expect(reportFiltersSchema.parse({ location: "todas" }).location).toBeNull();
  });

  it("keeps a known preset and rejects an unknown one", () => {
    expect(reportFiltersSchema.parse({ preset: "month" }).preset).toBe("month");
    expect(reportFiltersSchema.safeParse({ preset: "siempre" }).success).toBe(false);
  });

  it("passes the dates through untouched, for normaliseRange to judge", () => {
    // The schema's job is shape, not meaning: an inverted range is valid input
    // and is corrected later.
    const parsed = reportFiltersSchema.parse({ from: "2026-03-20", to: "2026-03-10" });
    expect(parsed.from).toBe("2026-03-20");
    expect(parsed.to).toBe("2026-03-10");
  });
});
