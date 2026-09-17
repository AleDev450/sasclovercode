/**
 * Opening hours as a website footer says them.
 *
 * `locations/schedule.ts` answers "what are the shifts of each day", seven rows,
 * which is right for a branch page and too long for a footer. A restaurant's
 * site says "Lunes a viernes: 12:00 - 22:00" - consecutive days with the same
 * shifts, folded into one line.
 */

import { formatShifts, type Shift } from "@/modules/locations/schedule";

/** With accents: this is read by a restaurant's customers, not by its staff. */
const DAY_NAMES = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

/** Monday first, the way a Peruvian business reads its own week. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

export interface HoursLine {
  readonly days: string;
  readonly hours: string;
}

function rangeLabel(first: number, last: number, length: number): string {
  const from = DAY_NAMES[first]!;
  const to = DAY_NAMES[last]!.toLowerCase();
  if (length === 1) return from;
  if (length === 2) return `${from} y ${to}`;
  return `${from} a ${to}`;
}

/**
 * Consecutive days with identical shifts, folded.
 *
 * Empty when there are no shifts at all: "Consultar horario" is the caller's
 * call, and inventing a closed week would say the restaurant never opens.
 */
export function summarizeWeek(shifts: readonly Shift[]): HoursLine[] {
  if (shifts.length === 0) return [];

  const perDay = WEEK_ORDER.map((day) => {
    const own = shifts
      .filter((shift) => shift.dayOfWeek === day)
      .slice()
      .sort((a, b) => a.opensAt.localeCompare(b.opensAt));
    return { day, text: own.length === 0 ? "Cerrado" : formatShifts(own) };
  });

  if (perDay.every((entry) => entry.text === perDay[0]!.text)) {
    return [{ days: "Todos los días", hours: perDay[0]!.text }];
  }

  const lines: HoursLine[] = [];
  let start = 0;

  for (let index = 1; index <= perDay.length; index += 1) {
    const current = perDay[index];
    const previous = perDay[index - 1]!;
    if (current !== undefined && current.text === previous.text) continue;

    const first = perDay[start]!;
    lines.push({
      days: rangeLabel(first.day, previous.day, index - start),
      hours: previous.text,
    });
    start = index;
  }

  return lines;
}
