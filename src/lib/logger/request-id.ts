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
 * Reuses an inbound request id when the proxy supplied one, so a single trace
 * spans the edge and the application. Generates one otherwise.
 */
export function getRequestId(headers: Headers): string {
  const inbound = headers.get(REQUEST_ID_HEADER)?.trim();
  // Bound the length: this value is echoed back and written to logs.
  if (inbound && inbound.length > 0 && inbound.length <= 200) {
    return inbound;
  }
  return generateRequestId();
}
