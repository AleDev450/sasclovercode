/**
 * Opening hours, as pure logic.
 *
 * No I/O and no database. Everything here is "given these shifts, what does a
 * human read" - which is the part that shows up on a public website and is
 * therefore the part worth testing exhaustively.
 *
 * The stored model is deliberately simple: a shift never crosses midnight, so a
 * bar open 18:00-02:00 is two rows. That keeps overlap detection decidable in a
 * trigger and keeps every reader here from carrying a special case. See the
 * header of `supabase/migrations/20260825200200_create_location_hours.sql`.
 */

/** 0 = Sunday, matching `Date#getDay()` and PostgreSQL's `dow`. */
export const WEEKDAY_NAMES = [
  "Domingo",
  "Lunes",
  "Martes",
  "Miercoles",
  "Jueves",
  "Viernes",
  "Sabado",
] as const;

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface Shift {
  readonly dayOfWeek: number;
  /** `HH:MM:SS` as PostgreSQL returns a `time`. */
  readonly opensAt: string;
  readonly closesAt: string;
}

/** True when the value is a weekday PostgreSQL would accept. */
export function isWeekday(value: number): value is Weekday {
  return Number.isInteger(value) && value >= 0 && value <= 6;
}

/**
 * `HH:MM:SS` (or `HH:MM`) to minutes since midnight, or null.
 *
 * `24:00` is legal and means end of day: PostgreSQL's `time` accepts it, and it
 * is how "open until midnight" is written without pretending the shift ends at
 * 23:59.
 */
export function toMinutes(value: string): number | null {
  const match = /^([0-9]{1,2}):([0-9]{2})(?::([0-9]{2}))?$/.exec(value.trim());
  if (match === null) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (minutes > 59) return null;
  if (hours > 24) return null;
  // 24:00 exactly, and nothing past it.
  if (hours === 24 && minutes !== 0) return null;

  return hours * 60 + minutes;
}

/** `HH:MM` for display. Seconds are never meaningful in an opening time. */
export function formatTime(value: string): string {
  const minutes = toMinutes(value);
  if (minutes === null) return value;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

/** `12:00 - 15:00`, or several shifts joined by a comma. */
export function formatShifts(shifts: readonly Shift[]): string {
  return shifts
    .map((shift) => `${formatTime(shift.opensAt)} - ${formatTime(shift.closesAt)}`)
    .join(", ");
}

export interface DaySchedule<T extends Shift = Shift> {
  readonly dayOfWeek: Weekday;
  readonly label: string;
  readonly shifts: readonly T[];
  /** True when the branch does not open at all that day. */
  readonly closed: boolean;
}

/**
 * The full week, always seven entries, starting on Monday.
 *
 * Seven entries even when most are empty, because a schedule that silently
 * omitted the closed days would read as "we have no information" rather than
 * "we are closed on Sundays" - and those are very different things to a
 * customer standing outside.
 *
 * Monday first: Sunday-first is the storage convention (it matches `getDay()`
 * and `dow`, so no conversion happens at the boundary) and Monday-first is how
 * a Peruvian business reads its own week. Converting once, here, is cheaper
 * than converting in the schema and confusing every future query.
 *
 * Generic over the shift so a caller that has ids keeps them: the editor needs
 * to render a "remove" button next to each shift, and matching rows back up by
 * their times afterwards would break the moment two shifts looked alike.
 */
export function buildWeek<T extends Shift>(shifts: readonly T[]): DaySchedule<T>[] {
  const order: Weekday[] = [1, 2, 3, 4, 5, 6, 0];

  return order.map((day) => {
    const forDay = shifts
      .filter((shift) => shift.dayOfWeek === day)
      .slice()
      .sort((a, b) => (toMinutes(a.opensAt) ?? 0) - (toMinutes(b.opensAt) ?? 0));

    return {
      dayOfWeek: day,
      label: WEEKDAY_NAMES[day],
      shifts: forDay,
      closed: forDay.length === 0,
    };
  });
}

/**
 * True when `a` and `b` overlap on the same day.
 *
 * Mirrors the trigger exactly, including that touching ends do NOT overlap:
 * 10:00-12:00 and 12:00-14:00 are a normal split shift, and refusing them
 * would force a business to invent a one-minute gap.
 *
 * Duplicated from the database on purpose. The trigger is the guarantee; this
 * is so the form can say "that overlaps the shift you already have" instead of
 * surfacing a constraint name.
 */
export function shiftsOverlap(a: Shift, b: Shift): boolean {
  if (a.dayOfWeek !== b.dayOfWeek) return false;

  const aStart = toMinutes(a.opensAt);
  const aEnd = toMinutes(a.closesAt);
  const bStart = toMinutes(b.opensAt);
  const bEnd = toMinutes(b.closesAt);
  if (aStart === null || aEnd === null || bStart === null || bEnd === null) return false;

  return aStart < bEnd && bStart < aEnd;
}
