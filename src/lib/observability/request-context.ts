import "server-only";

/**
 * The visitor's context, forwarded to PostgreSQL so a trigger can audit it.
 *
 * CLOVERCODE_MASTER.md section 17 asks `audit_logs` for `ip_address` and
 * `user_agent`. PostgreSQL knows neither: they are HTTP facts, and the audit is
 * written by a trigger - deliberately, because a log that depends on every
 * caller remembering to write it is a log with holes (ADR-028 decision 1).
 *
 * So the context travels. `createSupabaseServerClient()` attaches these three
 * headers to every request the application makes to Supabase, PostgREST puts
 * all request headers into the `request.headers` GUC, and `audit_row_change()`
 * reads them back out.
 *
 * OWN header names rather than passing `x-forwarded-for` through: the browser
 * never talks to PostgREST, it talks to Next.js, so nothing here was set by the
 * client. The prefix says in the name that this application chose to send it.
 *
 * NOTHING HERE THROWS. `headers()` throws outside a request scope, a malformed
 * value would make `fetch` reject the whole Supabase call, and neither may ever
 * be the reason a price update fails. The worst case of this module is an audit
 * row without an IP.
 */

import { cache } from "react";
import { headers } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { getRequestId } from "@/lib/logger";

export const AUDIT_IP_HEADER = "x-clovercode-ip";
export const AUDIT_USER_AGENT_HEADER = "x-clovercode-user-agent";
export const AUDIT_REQUEST_ID_HEADER = "x-clovercode-request-id";

/** Matches `audit_logs.user_agent`'s CHECK, so a value can never be refused. */
const MAX_USER_AGENT = 500;
/** Matches `audit_logs.request_id`'s CHECK and REQUEST_ID_PATTERN's own bound. */
const MAX_REQUEST_ID = 200;
/** Longer than any IPv6 address with a zone; anything longer is not an address. */
const MAX_IP = 100;

export interface RequestContext {
  readonly ip: string | null;
  readonly userAgent: string | null;
  readonly requestId: string | null;
}

/**
 * Makes a value safe to put in an HTTP header.
 *
 * `Headers` rejects control characters and non-Latin-1 bytes outright, and a
 * rejected header does not degrade - it throws, and takes the Supabase request
 * with it. A user agent is attacker-influenced text, so it is filtered down to
 * printable ASCII rather than trusted.
 */
export function sanitiseHeaderValue(
  value: string | null | undefined,
  maxLength: number,
): string | null {
  if (typeof value !== "string") return null;

  // Everything outside printable ASCII goes, control characters included.
  const cleaned = value.replace(/[^ -~]/g, "").trim();
  if (cleaned.length === 0) return null;

  return cleaned.slice(0, maxLength);
}

/**
 * The client's address out of a proxy chain.
 *
 * `x-forwarded-for` is a list, and the FIRST entry is the client - everything
 * after it is a proxy that added itself. Taking the last would record our own
 * infrastructure on every row.
 */
export function firstForwardedIp(value: string | null | undefined): string | null {
  const cleaned = sanitiseHeaderValue(value, MAX_IP * 4);
  if (cleaned === null) return null;

  const first = cleaned.split(",")[0]?.trim() ?? "";
  // IPv6 arrives bracketed and sometimes with a port; the database wants
  // neither, and stores NULL rather than raising if we get this wrong.
  const unbracketed = first.startsWith("[") ? first.slice(1, first.indexOf("]")) : first;

  return unbracketed.length === 0 ? null : unbracketed.slice(0, MAX_IP);
}

/**
 * Turns a context into the headers to forward. Pure, so it is tested directly.
 *
 * Absent values are omitted rather than sent empty: PostgREST would expose an
 * empty string, and `''` is not the same answer as "we do not know".
 */
export function buildAuditHeaders(context: RequestContext): Record<string, string> {
  const result: Record<string, string> = {};

  if (context.ip !== null) result[AUDIT_IP_HEADER] = context.ip;
  if (context.userAgent !== null) result[AUDIT_USER_AGENT_HEADER] = context.userAgent;
  if (context.requestId !== null) result[AUDIT_REQUEST_ID_HEADER] = context.requestId;

  return result;
}

/**
 * Reads the incoming request's context, or all nulls where there is no request.
 *
 * Memoised per request so the `request_id` is STABLE: `getRequestId` mints a new
 * one when the proxy sent none, and a fresh id per Supabase client would defeat
 * the entire point of the column - the audit row and the log line would carry
 * different ids for the same request.
 */
export const getRequestContext = cache(async (): Promise<RequestContext> => {
  try {
    const headerList = await headers();

    return {
      ip:
        firstForwardedIp(headerList.get("x-forwarded-for")) ??
        sanitiseHeaderValue(headerList.get("x-real-ip"), MAX_IP),
      userAgent: sanitiseHeaderValue(headerList.get("user-agent"), MAX_USER_AGENT),
      requestId: sanitiseHeaderValue(getRequestId(headerList), MAX_REQUEST_ID),
    };
  } catch (error) {
    // Framework signals first: `headers()` throws one during static
    // prerendering to tell Next.js the route is dynamic, and swallowing it
    // would let a route be prerendered that must not be. Only genuinely
    // "there is no request here" gets past this line.
    unstable_rethrow(error);

    // No request scope: middleware, a background job, a test. Every one of
    // those is a legitimate caller, and none of them has an IP to report.
    return { ip: null, userAgent: null, requestId: null };
  }
});

/** What `createSupabaseServerClient()` attaches. Never throws, never rejects. */
export async function getAuditHeaders(): Promise<Record<string, string>> {
  return buildAuditHeaders(await getRequestContext());
}
