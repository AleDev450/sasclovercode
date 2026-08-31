/**
 * The shape of a health report, and the rules for composing one.
 *
 * Pure on purpose - no `server-only`, no Supabase, no `next/headers` - so the
 * composition rules are unit-tested directly rather than through a route.
 *
 * CLOVERCODE_MASTER.md section 33 (Phase 24) asks for health checks, and the
 * Phase 00 route said in its own comment that this was the phase where "a
 * degraded dependency must also be expressible in the response".
 */

export const HEALTH_STATUSES = ["ok", "degraded"] as const;
export type HealthStatus = (typeof HEALTH_STATUSES)[number];

/**
 * Why a dependency was reported unhealthy.
 *
 * A CLOSED set, and no free text. `/api/health` is unauthenticated, so anything
 * it returns is public; a database error message would describe the schema to
 * whoever asked (master section 9). The full error goes to the logger, where an
 * operator can read it and a visitor cannot.
 */
export const HEALTH_FAILURES = ["unreachable", "query_failed", "timeout"] as const;
export type HealthFailure = (typeof HEALTH_FAILURES)[number];

export interface DependencyCheck {
  readonly name: string;
  readonly status: HealthStatus;
  readonly durationMs: number;
  /** Present only when the check failed. */
  readonly failure?: HealthFailure;
}

/**
 * How long a dependency may take before it counts as down.
 *
 * Generous on purpose. A health check that trips on a slow query turns one bad
 * moment into an instance leaving rotation, and flapping instances are worse
 * than slow ones.
 */
export const DEPENDENCY_TIMEOUT_MS = 5_000;

/**
 * One bad dependency makes the whole report degraded.
 *
 * There is no "partial" status, because there is no partial answer a load
 * balancer can act on: either this instance should receive traffic or it should
 * not. Which dependency failed is in `checks`, for a human.
 */
export function overallHealth(checks: readonly DependencyCheck[]): HealthStatus {
  return checks.some((check) => check.status === "degraded") ? "degraded" : "ok";
}

/**
 * 503 for a degraded report, not 200 with a sad body.
 *
 * The status code is the only part a load balancer reads. A process that is
 * alive but cannot reach its database serves errors to everybody it is given,
 * so answering 200 keeps the traffic exactly where it cannot be served - which
 * is what the Phase 00 endpoint would have done.
 */
export function healthStatusCode(status: HealthStatus): 200 | 503 {
  return status === "ok" ? 200 : 503;
}
