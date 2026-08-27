import { describe, expect, it } from "vitest";
import {
  buildWeek,
  formatShifts,
  formatTime,
  isWeekday,
  shiftsOverlap,
  toMinutes,
  WEEKDAY_NAMES,
  type Shift,
} from "@/modules/locations/schedule";

/**
 * Opening hours as a customer reads them.
 *
 * The stored model is deliberately simple - a shift never crosses midnight -
 * and these tests hold the two consequences of that decision: an overnight bar
 * is two rows, and every reader can compare times without a special case.
 */

const shift = (dayOfWeek: number, opensAt: string, closesAt: string): Shift => ({
  dayOfWeek,
  opensAt,
  closesAt,
});

describe("toMinutes", () => {
  it.each([
    ["09:00", 540],
    ["09:00:00", 540],
    ["00:00", 0],
    ["23:59", 1439],
    // Legal in PostgreSQL's `time`, and how "open until midnight" is written
    // without pretending the shift ends at 23:59.
    ["24:00", 1440],
    ["24:00:00", 1440],
  ])("reads %s", (value, expected) => {
    expect(toMinutes(value)).toBe(expected);
  });

  it.each(["", "9", "9:5", "25:00", "24:01", "12:60", "abc", "12-00"])("refuses %s", (value) => {
    expect(toMinutes(value)).toBeNull();
  });

  it("tolerates surrounding whitespace", () => {
    expect(toMinutes("  09:30  ")).toBe(570);
  });
});

describe("formatTime", () => {
  it("drops the seconds PostgreSQL returns", () => {
    expect(formatTime("09:00:00")).toBe("09:00");
  });

  it("pads a single-digit hour", () => {
    expect(formatTime("9:05")).toBe("09:05");
  });

  it("returns an unparseable value untouched rather than inventing one", () => {
    expect(formatTime("no es una hora")).toBe("no es una hora");
  });
});

describe("formatShifts", () => {
  it("joins a split shift with a comma", () => {
    expect(formatShifts([shift(1, "12:00:00", "15:00:00"), shift(1, "19:00:00", "23:00:00")])).toBe(
      "12:00 - 15:00, 19:00 - 23:00",
    );
  });
});

describe("isWeekday", () => {
  it.each([0, 1, 6])("accepts %i", (day) => {
    expect(isWeekday(day)).toBe(true);
  });

  it.each([-1, 7, 1.5, Number.NaN])("refuses %s", (day) => {
    expect(isWeekday(day)).toBe(false);
  });
});

describe("buildWeek", () => {
  it("always returns seven days, starting on Monday", () => {
    const week = buildWeek([]);
    expect(week).toHaveLength(7);
    expect(week.map((day) => day.label)).toEqual([
      "Lunes",
      "Martes",
      "Miercoles",
      "Jueves",
      "Viernes",
      "Sabado",
      "Domingo",
    ]);
  });

  /*
   * The seven entries are the point.
   *
   * A schedule that silently omitted the closed days would read as "we have no
   * information" rather than "we are closed on Sundays", and those are very
   * different things to a customer standing outside a shut door.
   */
  it("marks a day with no shifts as closed, rather than omitting it", () => {
    const week = buildWeek([shift(1, "09:00:00", "18:00:00")]);
    const sunday = week.find((day) => day.dayOfWeek === 0);
    expect(sunday?.closed).toBe(true);
    expect(sunday?.shifts).toEqual([]);
  });

  it("keeps the storage numbering while displaying Monday first", () => {
    const week = buildWeek([]);
    // Sunday-first is the storage convention because it matches getDay() and
    // PostgreSQL's dow; nothing converts at the database boundary.
    expect(week[6]?.dayOfWeek).toBe(0);
    expect(WEEKDAY_NAMES[0]).toBe("Domingo");
  });

  it("sorts the shifts of a day by opening time", () => {
    const week = buildWeek([shift(1, "19:00:00", "23:00:00"), shift(1, "12:00:00", "15:00:00")]);
    const monday = week.find((day) => day.dayOfWeek === 1);
    expect(monday?.shifts.map((s) => s.opensAt)).toEqual(["12:00:00", "19:00:00"]);
  });

  it("does not mutate the array it was given", () => {
    const shifts = [shift(1, "19:00:00", "23:00:00"), shift(1, "12:00:00", "15:00:00")];
    buildWeek(shifts);
    expect(shifts[0]?.opensAt).toBe("19:00:00");
  });

  it("carries extra fields through, so a caller keeps its ids", () => {
    const week = buildWeek([{ ...shift(1, "09:00:00", "18:00:00"), id: "abc" }]);
    const monday = week.find((day) => day.dayOfWeek === 1);
    expect(monday?.shifts[0]?.id).toBe("abc");
  });

  it("represents an overnight bar as two days", () => {
    // 18:00 Friday to 02:00 Saturday, which is two rows by design.
    const week = buildWeek([shift(5, "18:00:00", "24:00:00"), shift(6, "00:00:00", "02:00:00")]);
    const friday = week.find((day) => day.dayOfWeek === 5);
    const saturday = week.find((day) => day.dayOfWeek === 6);
    expect(friday?.closed).toBe(false);
    expect(saturday?.closed).toBe(false);
  });
});

/**
 * Mirrors the trigger in
 * `supabase/migrations/20260825200200_create_location_hours.sql`. The database
 * is the guarantee; this exists so the form can name the problem instead of
 * surfacing a constraint.
 */
describe("shiftsOverlap", () => {
  it("finds a partial overlap", () => {
    expect(shiftsOverlap(shift(1, "12:00", "15:00"), shift(1, "14:00", "20:00"))).toBe(true);
  });

  it("finds a shift fully inside another", () => {
    expect(shiftsOverlap(shift(1, "12:00", "20:00"), shift(1, "14:00", "15:00"))).toBe(true);
  });

  it("is symmetric", () => {
    const a = shift(1, "12:00", "15:00");
    const b = shift(1, "14:00", "20:00");
    expect(shiftsOverlap(a, b)).toBe(shiftsOverlap(b, a));
  });

  /*
   * Touching is not overlapping. A business that resumes exactly when the
   * previous shift ended should not have to invent a one-minute gap - and the
   * trigger agrees, so these two layers cannot disagree about a real schedule.
   */
  it("allows shifts that touch at the boundary", () => {
    expect(shiftsOverlap(shift(1, "10:00", "12:00"), shift(1, "12:00", "14:00"))).toBe(false);
  });

  it("never compares across days", () => {
    expect(shiftsOverlap(shift(1, "12:00", "15:00"), shift(2, "12:00", "15:00"))).toBe(false);
  });

  it("treats an unparseable time as not overlapping rather than throwing", () => {
    expect(shiftsOverlap(shift(1, "no", "15:00"), shift(1, "12:00", "20:00"))).toBe(false);
  });
});
