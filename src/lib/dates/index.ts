/**
 * Date and time formatting for the interface.
 *
 * WHY THIS EXISTS. Half a dozen screens had grown their own
 * `new Intl.DateTimeFormat("es-PE", ...)` with their own options, so the same
 * timestamp appeared as `14/09/26`, `14 sept 2026` and `2026-09-14` on three
 * screens of one product. Section 34 asks for consistency; a shared formatter
 * is how a date gets it.
 *
 * TIMEZONE IS AN ARGUMENT, NEVER A DEFAULT READ FROM THE SERVER. A serverless
 * instance runs in UTC, and a Peruvian shop closing its till at 23:30 would see
 * the session dated to the following day. A tenant screen passes
 * `tenant_settings.timezone`; the platform console passes the constant below,
 * because CloverCode itself operates from one place.
 */

import { DEFAULT_TIMEZONE } from "@/config/app";

/** `14/09/2026` */
export function formatDate(iso: string, timeZone: string = DEFAULT_TIMEZONE): string {
  return new Intl.DateTimeFormat("es-PE", { dateStyle: "short", timeZone }).format(new Date(iso));
}

/** `14/09/2026, 18:40` */
export function formatDateTime(iso: string, timeZone: string = DEFAULT_TIMEZONE): string {
  return new Intl.DateTimeFormat("es-PE", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone,
  }).format(new Date(iso));
}

/** `14 de septiembre` - for a heading, where the year is noise. */
export function formatDayMonth(iso: string, timeZone: string = DEFAULT_TIMEZONE): string {
  return new Intl.DateTimeFormat("es-PE", { day: "numeric", month: "long", timeZone }).format(
    new Date(iso),
  );
}

/**
 * `hace 3 dias`, `en 2 semanas`.
 *
 * For an inbox, where "how long has this been sitting here" is the question
 * being asked and the exact timestamp is not. Pair it with a `<time dateTime>`
 * carrying the real value, so the precise moment is still available on hover
 * and to assistive technology.
 *
 * Computed from whole days rather than from milliseconds: a lead submitted at
 * 23:50 and read at 00:10 is "yesterday" to a person, not "hace 20 minutos"
 * rounded to zero days.
 */
export function formatRelative(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const diffMs = then.getTime() - now.getTime();
  const diffMinutes = Math.round(diffMs / 60_000);

  const formatter = new Intl.RelativeTimeFormat("es-PE", { numeric: "auto" });

  const absMinutes = Math.abs(diffMinutes);
  if (absMinutes < 60) return formatter.format(diffMinutes, "minute");

  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) return formatter.format(diffHours, "hour");

  const diffDays = Math.round(diffHours / 24);
  if (Math.abs(diffDays) < 30) return formatter.format(diffDays, "day");

  const diffMonths = Math.round(diffDays / 30);
  if (Math.abs(diffMonths) < 12) return formatter.format(diffMonths, "month");

  return formatter.format(Math.round(diffMonths / 12), "year");
}
