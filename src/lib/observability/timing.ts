import "server-only";

/**
 * How long a database read took.
 *
 * CLOVERCODE_MASTER.md section 33, Phase 26 asks for "database latency" among
 * the things to analyse. Real latency needs a deployed environment and real
 * traffic; what this phase can leave behind is the instrumentation that makes
 * the number exist when there is somewhere to read it from.
 *
 * Deliberately NOT a wrapper around the Supabase client. Wrapping it would mean
 * every query in the product going through one more layer that can break, for a
 * measurement that is only interesting on the slow ones. This is opt-in and
 * costs a `Date.now()` on either side.
 *
 * What is recorded: the OPERATION NAME and the duration. Never the arguments.
 * A query's parameters are customer names, phone numbers and document numbers -
 * exactly the personal data ADR-016 minimised and section 16 keeps out of logs.
 */

import { logger } from "@/lib/logger";

/**
 * Above this, a read is worth someone's attention.
 *
 * A warning threshold, not an objective. A real p95 target needs traffic to
 * measure against, and inventing one here would be a decorative number
 * (docs/performance-budgets.md says the same).
 */
export const SLOW_QUERY_MS = 200;

/**
 * Times an async read and records how long it took.
 *
 * Returns whatever the operation returned, so it can be wrapped around an
 * existing call without changing the shape of the code around it. A failure is
 * timed too and then rethrown: a query that takes four seconds and then fails
 * is the most interesting one there is, and swallowing the timing would lose
 * exactly that case.
 */
export async function timed<T>(operation: string, run: () => Promise<T>): Promise<T> {
  const started = Date.now();

  try {
    const result = await run();
    record(operation, Date.now() - started, true);
    return result;
  } catch (error) {
    record(operation, Date.now() - started, false);
    throw error;
  }
}

function record(operation: string, durationMs: number, ok: boolean): void {
  if (durationMs >= SLOW_QUERY_MS) {
    logger.warn("db.query.slow", { operation, durationMs, ok });
    return;
  }
  logger.debug("db.query.timing", { operation, durationMs, ok });
}
