/**
 * Request correlation identifier.
 *
 * CLOVERCODE_MASTER.md section 16 requires `request_id` in the structured log
 * record. The same value is returned to the caller in error responses so a
 * support report can be tied to a specific server log line.
 */

/** Header used by most edge proxies, including Vercel. */
export const REQUEST_ID_HEADER = "x-request-id";

/** UUID v4, or a timestamp-based fallback where crypto is unavailable. */
export function generateRequestId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Character set accepted from an inbound request id.
 *
 * This value is client-controlled: anyone can set `x-request-id`. It is echoed
 * back in the `X-Request-Id` response header and written to every log line for
 * the request, so it is validated rather than merely length-checked.
 *
 * Scope note: CR/LF cannot reach here through `request.headers` - Node's HTTP
 * parser and the `Headers` constructor both reject them - so this is not
 * guarding against header injection. It bounds what a client can inject into
 * the logs, and it keeps the value safe for callers that build a requestId
 * themselves (middleware, tests), where `Response` would otherwise throw on a
 * malformed value from inside the error path.
 */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_.:@-]{1,200}$/;

/**
 * Reuses an inbound request id when the proxy supplied a well-formed one, so a
 * single trace spans the edge and the application. Generates one otherwise.
 */
export function getRequestId(headers: Headers): string {
  const inbound = headers.get(REQUEST_ID_HEADER)?.trim();
  if (inbound !== undefined && REQUEST_ID_PATTERN.test(inbound)) {
    return inbound;
  }
  return generateRequestId();
}
