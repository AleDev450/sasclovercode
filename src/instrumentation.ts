import type { Instrumentation } from "next";
import { logger, REQUEST_ID_HEADER } from "@/lib/logger";

/**
 * Error tracking.
 *
 * CLOVERCODE_MASTER.md section 33 (Phase 24) asks for "error tracking" as part
 * of completing observability.
 *
 * `onRequestError` is Next.js's own hook: it fires for every uncaught server
 * error - Server Components, Route Handlers, Server Actions and the proxy -
 * with the route, the method, the router kind and the digest. Nothing has to be
 * wrapped in a try/catch, and there is therefore nowhere an error can escape
 * through by omission. That property is the whole reason to use the native hook
 * rather than a helper each call site remembers to call, and it is the same
 * argument ADR-028 makes for auditing with triggers.
 *
 * NO EXTERNAL PROVIDER. This writes to the structured logger Phase 00 built.
 * Integrating Sentry without credentials to test against would leave an adapter
 * nobody has ever executed - the mistake ADR-021 already declined to make once
 * with `BillingProvider`, and master section 44 asks for adapters precisely so
 * that this stays a one-file change. This function is that one file
 * (KL-2404).
 */

/**
 * Errors React re-throws carry a `digest` instead of the original message. The
 * digest is what a user sees on the error page, so it is the handle a support
 * report actually arrives with.
 */
function readDigest(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "digest" in error) {
    const digest = (error as { digest?: unknown }).digest;
    if (typeof digest === "string" && digest.length > 0) return digest;
  }
  return undefined;
}

/**
 * The request id of the failed request, so the log line, the error page and any
 * audit row written by the same request all carry the same value.
 *
 * Read rather than generated: a value invented here would correlate with
 * nothing. When the proxy sent none, there is nothing to correlate and the
 * field is simply absent.
 */
function readRequestId(
  headerBag: Readonly<Record<string, string | string[] | undefined>>,
): string | undefined {
  const raw = headerBag[REQUEST_ID_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export const onRequestError: Instrumentation.onRequestError = (error, request, context) => {
  // `redact` runs inside the logger over everything below, so a header or a
  // message that happens to carry a token never reaches a transport. The header
  // BAG is deliberately not logged wholesale: it holds the session cookie.
  logger.error("app.request.failed", {
    requestId: readRequestId(request.headers),
    // `path` includes the query string, which can carry a search term or a
    // date range - useful, and never a credential on any route in this app.
    path: request.path,
    method: request.method,
    routerKind: context.routerKind,
    routePath: context.routePath,
    // 'render' | 'route' | 'action' | 'proxy' - which half of the application
    // failed, which is the first thing anybody asks.
    routeType: context.routeType,
    renderSource: context.renderSource,
    revalidateReason: context.revalidateReason,
    digest: readDigest(error),
    error,
  });
};
