import { toErrorResponse } from "@/lib/errors";
import { getRequestId, logger } from "@/lib/logger";
import packageJson from "../../../../package.json";

/**
 * Liveness probe.
 *
 * Phase 00 scope note: this endpoint reports that the process is up and can
 * serve a request. It deliberately does NOT check Supabase or storage - there
 * is no database yet. Dependency checks belong to Phase 24 (Observability),
 * where a degraded dependency must also be expressible in the response.
 */

// Never cached: a health check served from a build-time snapshot is worthless.
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const requestId = getRequestId(request.headers);
  const startedAt = performance.now();

  try {
    const body = {
      status: "ok" as const,
      service: "clovercode",
      version: packageJson.version,
      environment: process.env.NODE_ENV,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      requestId,
    };

    logger.info("app.request.completed", {
      requestId,
      route: "/api/health",
      status: 200,
      durationMs: Math.round(performance.now() - startedAt),
    });

    return Response.json(body, {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "X-Request-Id": requestId,
      },
    });
  } catch (error) {
    return toErrorResponse(error, {
      requestId,
      context: { route: "/api/health" },
    });
  }
}
