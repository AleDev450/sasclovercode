/**
 * Date ranges for a report, and the arithmetic a screen needs.
 *
 * Pure and free of I/O, so the rules can be asserted directly. The database
 * does every aggregation (ADR-027 decision 1); what lives here is the range a
 * person picked, normalised into something a query can trust.
 *
 * Every range is HALF-OPEN: `[from, to)`. A closed range forces the caller to
 * decide what "the end of the day" means and gets it wrong at 23:59:59.999 -
 * the classic off-by-a-millisecond that loses the last sale of the month.
 */

/** A half-open range, as ISO instants. */
export interface DateRange {
  readonly from: string;
  readonly to: string;
}

/** The shortcuts the screen offers. */
export const RANGE_PRESETS = ["today", "last7", "last30", "month"] as const;

export type RangePreset = (typeof RANGE_PRESETS)[number];

export const RANGE_PRESET_LABELS: Readonly<Record<RangePreset, string>> = {
  today: "Hoy",
  last7: "Ultimos 7 dias",
  last30: "Ultimos 30 dias",
  month: "Este mes",
};

/**
 * The longest range a report will run.
 *
 * A range is a query parameter, so it is typed into the address bar as easily
 * as it is picked from a menu - and "from 1970" is an expensive question asked
 * by accident. A business that genuinely needs five years asks for five ranges
 * (KL-2303).
 */
export const MAX_RANGE_DAYS = 366;

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0),
  );
}

/**
 * The range a preset means, relative to `now`.
 *
 * Computed on day boundaries in UTC, which is deliberately NOT the tenant's
 * timezone: this decides which INSTANTS to ask for, and the database is what
 * groups those instants into the business's own days (ADR-027 decision 5).
 * Doing the boundary twice would shift the range by the offset.
 */
export function rangeForPreset(preset: RangePreset, now: Date = new Date()): DateRange {
  const today = startOfUtcDay(now);
  const tomorrow = new Date(today.getTime() + DAY_MS);

  switch (preset) {
    case "today":
      return { from: today.toISOString(), to: tomorrow.toISOString() };

    case "last7":
      return {
        from: new Date(today.getTime() - 6 * DAY_MS).toISOString(),
        to: tomorrow.toISOString(),
      };

    case "last30":
      return {
        from: new Date(today.getTime() - 29 * DAY_MS).toISOString(),
        to: tomorrow.toISOString(),
      };

    case "month": {
      const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      return { from: first.toISOString(), to: tomorrow.toISOString() };
    }
  }
}

/** The default when nobody asked for anything. */
export function defaultRange(now: Date = new Date()): DateRange {
  return rangeForPreset("last7", now);
}

/**
 * Makes a range usable, whatever arrived.
 *
 * Three corrections, in this order:
 *
 *   - a missing or unparseable end becomes the default range entirely;
 *   - an inverted range is swapped rather than rejected, because somebody who
 *     typed the dates the wrong way round meant the range between them;
 *   - a range longer than the cap is trimmed from the START, keeping the end -
 *     "the last N days before this date" is what a too-wide range was reaching
 *     for.
 */
export function normaliseRange(
  input: { from?: string | null; to?: string | null },
  now: Date = new Date(),
): DateRange {
  const from = input.from == null ? null : new Date(input.from);
  const to = input.to == null ? null : new Date(input.to);

  const fromValid = from !== null && !Number.isNaN(from.getTime());
  const toValid = to !== null && !Number.isNaN(to.getTime());

  if (!fromValid || !toValid) return defaultRange(now);

  let start = from!;
  let end = to!;

  if (start.getTime() > end.getTime()) {
    [start, end] = [end, start];
  }

  if (start.getTime() === end.getTime()) {
    end = new Date(start.getTime() + DAY_MS);
  }

  if (end.getTime() - start.getTime() > MAX_RANGE_DAYS * DAY_MS) {
    start = new Date(end.getTime() - MAX_RANGE_DAYS * DAY_MS);
  }

  return { from: start.toISOString(), to: end.toISOString() };
}

/** How many whole days a range spans. For a screen that wants to say it. */
export function rangeDays(range: DateRange): number {
  const span = new Date(range.to).getTime() - new Date(range.from).getTime();
  return Math.max(1, Math.round(span / DAY_MS));
}

/**
 * The average ticket, in cents.
 *
 * Integer division, and zero rather than a division by zero. Mirrors what
 * `report_sales_summary` computes in SQL, so a screen can recompute a subtotal
 * without disagreeing with the row it came from.
 */
export function averageTicket(netCents: number, orderCount: number): number {
  if (orderCount <= 0) return 0;
  return Math.trunc(netCents / orderCount);
}

/** `14` becomes `14:00`. The hour report has 24 of these. */
export function formatHour(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

/** The `YYYY-MM-DD` a `<input type="date">` wants, from an ISO instant. */
export function toDateInput(iso: string): string {
  return iso.slice(0, 10);
}
