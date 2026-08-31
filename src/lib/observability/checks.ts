import "server-only";

/**
 * The actual dependency probes behind `/api/health`.
 *
 * Separated from `health.ts` so the composition rules stay pure and testable;
 * this half is the part that talks to something.
 */

import { unstable_rethrow } from "next/navigation";
import { logger } from "@/lib/logger";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DEPENDENCY_TIMEOUT_MS, type DependencyCheck } from "./health";

/**
 * Is the database reachable, and how fast.
 *
 * The probe is `resolve_tenant_by_domain`, and it is chosen rather than
 * invented: it is the exact call the proxy makes on every unauthenticated
 * request, it is executable by `anon` (Phase 01), and a hostname that resolves
 * to nothing returns an empty set from an indexed lookup. So a green check here
 * means the path the public site depends on actually works - not merely that a
 * TCP port is open.
 *
 * NEVER THROWS. A health check that can fail with an exception is a health
 * check that reports nothing at the moment it is most needed.
 */
export async function checkDatabase(): Promise<DependencyCheck> {
  const startedAt = performance.now();
  const elapsed = (): number => Math.round(performance.now() - startedAt);

  try {
    const client = await createSupabaseServerClient();

    const { error } = await client
      .rpc("resolve_tenant_by_domain", { p_hostname: "health-check.invalid" })
      .abortSignal(AbortSignal.timeout(DEPENDENCY_TIMEOUT_MS));

    if (error) {
      // PostgREST answered, and said no. The full error is logged here and
      // deliberately not returned: the endpoint is public.
      logger.error("health.dependency_failed", {
        dependency: "database",
        failure: "query_failed",
        error,
      });
      return {
        name: "database",
        status: "degraded",
        durationMs: elapsed(),
        failure: "query_failed",
      };
    }

    return { name: "database", status: "ok", durationMs: elapsed() };
  } catch (error) {
    // FIRST, before anything else looks at the error.
    //
    // `cookies()` throws a framework signal during static prerendering - it is
    // how Next.js learns a route is dynamic - and catching it here would both
    // hide that signal and report a perfectly healthy database as unreachable.
    // The build says so out loud: "Route couldn't be rendered statically
    // because it used `cookies`" arriving as a `health.dependency_failed` log
    // line. `redirect()` and `notFound()` travel the same way.
    unstable_rethrow(error);

    // `AbortSignal.timeout` rejects with a `TimeoutError`; anything else here is
    // DNS, TLS, a dead socket, or missing configuration. The distinction is
    // worth keeping: a timeout means overloaded, the rest means unreachable.
    const failure =
      error instanceof Error && error.name === "TimeoutError" ? "timeout" : "unreachable";

    logger.error("health.dependency_failed", { dependency: "database", failure, error });

    return { name: "database", status: "degraded", durationMs: elapsed(), failure };
  }
}
