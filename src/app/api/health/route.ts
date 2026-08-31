import { toErrorResponse } from "@/lib/errors";
import { getRequestId, logger } from "@/lib/logger";
import { checkDatabase } from "@/lib/observability/checks";
import { healthStatusCode, overallHealth } from "@/lib/observability/health";
import packageJson from "../../../../package.json";

/**
 * Health check.
 *
 * Phase 00 built the liveness half and left this note in place of the rest:
 *
 *   "Dependency checks belong to Phase 24 (Observability), where a degraded
 *   dependency must also be expressible in the response."
 *
 * This is that phase. The endpoint now says whether the process can actually do
 * its job, not merely whether it is running - and answers 503 when it cannot,
 * because the status code is the only part a load balancer reads (ADR-028
 * decision 6).
 */

// Never cached: a health check served from a build-time snapshot is worthless.
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const requestId = getRequestId(request.headers);
  const startedAt = performance.now();

  try {
    // One dependency today. An array rather than a field because the second one
    // - storage, a mail provider - must not change the response shape when it
    // arrives; whatever reads this endpoint would break on that.
    const checks = [await checkDatabase()];

    const status = overallHealth(checks);
    const statusCode = healthStatusCode(status);

    const body = {
      status,
      service: "clovercode",
      version: packageJson.version,
      environment: process.env.NODE_ENV,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      checks,
      requestId,
    };

    const durationMs = Math.round(performance.now() - startedAt);

    if (status === "degraded") {
      logger.warn("health.degraded", {
        requestId,
        route: "/api/health",
        durationMs,
        failed: checks.filter((check) => check.status === "degraded").map((check) => check.name),
      });
    } else {
      logger.info("app.request.completed", {
        requestId,
        route: "/api/health",
        status: statusCode,
        durationMs,
      });
    }

    return Response.json(body, {
      status: statusCode,
      headers: {
        "Cache-Control": "no-store",
        "X-Request-Id": requestId,
      },
    });
  } catch (error) {
    // `checkDatabase` never throws, so reaching here means the handler itself
    // broke. Kept for exactly that: a health endpoint that can 500 silently is
    // the worst possible endpoint to have a silent failure in.
    return toErrorResponse(error, {
      requestId,
      context: { route: "/api/health" },
    });
  }
}
