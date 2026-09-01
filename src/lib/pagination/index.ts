/**
 * Bounded reads.
 *
 * CLOVERCODE_MASTER.md section 18 forbids "consultas sin límite" and requires
 * paginated listings. Both constants below have existed since Phase 00 and were
 * used by nothing for twenty-six phases, which is how the measurement that
 * opened Phase 26 found 53 of 57 list queries returning whole tables.
 *
 * The reason this is the one performance problem worth fixing before any other:
 * every other kind of slowness degrades, and an unbounded query BREAKS. It is
 * correct in development, correct in staging with fifty rows, and an outage on
 * the day a busy restaurant has forty thousand orders. `audit_logs`, `orders`
 * and `stock_movements` grow without a ceiling by design.
 *
 * The rule this file exists to enforce: **an absent limit means the default, not
 * "no limit"**. A reader that forgets to pass one gets twenty-five rows, not the
 * table.
 */

import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "@/config/app";

export interface PageOptions {
  /** Rows to return. Absent means `DEFAULT_PAGE_SIZE`; never means "all". */
  readonly limit?: number;
  /** Rows to skip. Absent means 0. */
  readonly offset?: number;
}

export interface ResolvedPage {
  readonly limit: number;
  readonly offset: number;
  /** Inclusive bounds for PostgREST's `.range()`. */
  readonly from: number;
  readonly to: number;
}

/**
 * Turns whatever a caller passed into bounds the database can be given.
 *
 * Every input is clamped rather than rejected. A limit of zero, a negative
 * offset or a `NaN` from a query string are not worth an error page: they are
 * someone typing in a URL, and the useful answer is the first page.
 *
 * `MAX_PAGE_SIZE` is applied HERE, on the server. A client may ask for less than
 * the maximum and never for more, which is what stops `?limit=1000000` from
 * being a denial of service with a query parameter (SPEC AB-2602).
 */
export function resolvePage(options: PageOptions = {}): ResolvedPage {
  const requested = options.limit;
  const limit =
    typeof requested === "number" && Number.isFinite(requested) && requested >= 1
      ? Math.min(Math.floor(requested), MAX_PAGE_SIZE)
      : DEFAULT_PAGE_SIZE;

  const requestedOffset = options.offset;
  const offset =
    typeof requestedOffset === "number" && Number.isFinite(requestedOffset) && requestedOffset > 0
      ? Math.floor(requestedOffset)
      : 0;

  return { limit, offset, from: offset, to: offset + limit - 1 };
}

/**
 * Reads a page number from a URL search param.
 *
 * Pages are 1-based for a person and 0-based for the database, and this is the
 * single place that conversion happens.
 */
export function pageFromParam(value: string | undefined, limit: number): number {
  const page = Number(value);
  if (!Number.isFinite(page) || page < 2) return 0;
  return (Math.floor(page) - 1) * limit;
}

export interface PageInfo {
  readonly page: number;
  readonly limit: number;
  readonly hasPrevious: boolean;
  readonly hasNext: boolean;
}

/**
 * What a paginator needs to render, without a `COUNT(*)`.
 *
 * Deliberately no total. Counting every matching row on every page view is a
 * second full scan of exactly the data the limit exists to avoid reading, and
 * it buys a number nobody acts on. Asking for one row more than the page and
 * checking whether it arrived answers "is there a next page", which is the only
 * question the UI actually has.
 */
export function pageInfo(rowsReturned: number, resolved: ResolvedPage): PageInfo {
  return {
    page: Math.floor(resolved.offset / resolved.limit) + 1,
    limit: resolved.limit,
    hasPrevious: resolved.offset > 0,
    hasNext: rowsReturned > resolved.limit,
  };
}

/**
 * Trims the probe row off a result fetched with `limit + 1`.
 *
 * Paired with `pageInfo`: fetch one extra, ask whether it came back, then drop
 * it before rendering.
 */
export function trimProbe<T>(rows: readonly T[], resolved: ResolvedPage): T[] {
  return rows.slice(0, resolved.limit);
}

/** Bounds for a `limit + 1` probe fetch. */
export function probeRange(resolved: ResolvedPage): { from: number; to: number } {
  return { from: resolved.from, to: resolved.to + 1 };
}
