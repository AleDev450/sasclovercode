import { describe, expect, it } from "vitest";
import {
  REDACTED,
  createLogger,
  generateRequestId,
  getRequestId,
  isSensitiveKey,
  redact,
  resolveLogLevel,
  type LogRecord,
} from "@/lib/logger";

function collector() {
  const records: LogRecord[] = [];
  return { records, transport: (record: LogRecord) => records.push(record) };
}

describe("redaction (TEST-008)", () => {
  it.each([
    "password",
    "Password",
    "user_password",
    "passwd",
    "accessToken",
    "refresh_token",
    "apiKey",
    "API_KEY",
    "authorization",
    "Cookie",
    "set-cookie",
    "service_role",
    "SUPABASE_SERVICE_ROLE_KEY",
    "clientSecret",
    "privateKey",
    "signature",
    "cvv",
  ])("treats %s as sensitive", (key) => {
    expect(isSensitiveKey(key)).toBe(true);
  });

  it.each(["tenantId", "tenant_id", "userId", "email", "slug", "orderId", "keyword", "status"])(
    "leaves %s alone",
    (key) => {
      expect(isSensitiveKey(key)).toBe(false);
    },
  );

  it("redacts sensitive values in an emitted record", () => {
    const { records, transport } = collector();
    const log = createLogger({ level: "debug", transport });

    log.info("auth.signin.attempted", {
      email: "owner@sugurolls.com",
      password: "hunter2",
      accessToken: "eyJhbGciOi...",
    });

    const record = records[0];
    expect(record?.email).toBe("owner@sugurolls.com");
    expect(record?.password).toBe(REDACTED);
    expect(record?.accessToken).toBe(REDACTED);
    expect(JSON.stringify(record)).not.toContain("hunter2");
  });
});

describe("redaction depth (TEST-009)", () => {
  it("descends into nested objects and arrays", () => {
    const result = redact({
      tenant: { name: "Sugu Rolls", credentials: { sunatPassword: "secreto" } },
      users: [{ email: "a@b.c", token: "abc123" }],
    }) as Record<string, never>;

    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain("secreto");
    expect(serialised).not.toContain("abc123");
    expect(serialised).toContain("Sugu Rolls");
    expect(serialised).toContain("a@b.c");
  });

  it("serialises Error values with name, message and stack", () => {
    const result = redact({ error: new Error("boom") }) as { error: { name: string } };
    expect(result.error.name).toBe("Error");
    expect(JSON.stringify(result)).toContain("boom");
  });
});

describe("child loggers (TEST-010)", () => {
  it("merges parent context into every record", () => {
    const { records, transport } = collector();
    const base = createLogger({ level: "debug", transport, context: { service: "clovercode" } });
    const scoped = base.child({ requestId: "req-1", tenantId: "tenant-a" });

    scoped.info("order.created", { orderId: "o-1" });

    expect(records[0]).toMatchObject({
      service: "clovercode",
      requestId: "req-1",
      tenantId: "tenant-a",
      orderId: "o-1",
      event: "order.created",
    });
  });

  it("lets the call site override inherited context", () => {
    const { records, transport } = collector();
    const scoped = createLogger({ level: "debug", transport }).child({ tenantId: "tenant-a" });
    scoped.info("tenant.switched", { tenantId: "tenant-b" });
    expect(records[0]?.tenantId).toBe("tenant-b");
  });
});

describe("level filtering (TEST-011)", () => {
  it("drops records below the configured level", () => {
    const { records, transport } = collector();
    const log = createLogger({ level: "warn", transport });

    log.debug("a");
    log.info("b");
    log.warn("c");
    log.error("d");

    expect(records.map((record) => record.event)).toEqual(["c", "d"]);
  });

  it("resolves the level from LOG_LEVEL, then NODE_ENV", () => {
    expect(resolveLogLevel({ LOG_LEVEL: "error" })).toBe("error");
    expect(resolveLogLevel({ LOG_LEVEL: " WARN " })).toBe("warn");
    expect(resolveLogLevel({ LOG_LEVEL: "nonsense", NODE_ENV: "production" })).toBe("info");
    expect(resolveLogLevel({ NODE_ENV: "production" })).toBe("info");
    expect(resolveLogLevel({ NODE_ENV: "test" })).toBe("warn");
    expect(resolveLogLevel({})).toBe("debug");
  });
});

describe("robustness (TEST-012)", () => {
  it("does not throw on a circular context", () => {
    const { records, transport } = collector();
    const log = createLogger({ level: "debug", transport });

    const circular: Record<string, unknown> = { name: "loop" };
    circular.self = circular;

    expect(() => log.info("weird.context", { circular })).not.toThrow();
    expect(JSON.stringify(records[0])).toContain("[Circular]");
  });

  it("does not throw on BigInt values", () => {
    const { records, transport } = collector();
    const log = createLogger({ level: "debug", transport });

    expect(() => log.info("bigint.context", { amount: 10n })).not.toThrow();
    expect(records[0]?.amount).toBe("10n");
  });

  it("does not propagate a transport failure to the caller", () => {
    const log = createLogger({
      level: "debug",
      transport: () => {
        throw new Error("transport is down");
      },
    });

    expect(() => log.error("app.error.unhandled", { requestId: "x" })).not.toThrow();
  });

  it("always stamps level, event and an ISO timestamp", () => {
    const { records, transport } = collector();
    createLogger({ level: "debug", transport }).info("app.request.completed");

    expect(records[0]?.level).toBe("info");
    expect(records[0]?.event).toBe("app.request.completed");
    expect(new Date(String(records[0]?.timestamp)).toISOString()).toBe(records[0]?.timestamp);
  });
});

describe("request id (TEST-013, TEST-014)", () => {
  it("reuses an inbound x-request-id", () => {
    const headers = new Headers({ "x-request-id": "edge-abc-123" });
    expect(getRequestId(headers)).toBe("edge-abc-123");
  });

  it("generates one when the header is absent, blank or oversized", () => {
    expect(getRequestId(new Headers())).toMatch(/.+/);
    expect(getRequestId(new Headers({ "x-request-id": "   " }))).not.toBe("   ");

    const oversized = "x".repeat(500);
    expect(getRequestId(new Headers({ "x-request-id": oversized }))).not.toBe(oversized);
  });

  it("generates distinct identifiers", () => {
    const ids = new Set(Array.from({ length: 50 }, () => generateRequestId()));
    expect(ids.size).toBe(50);
  });
});

/**
 * Regression suite for two defects found in the Phase 00 audit.
 */
describe("redaction of repeated references (audit regression)", () => {
  it("does not report a repeated but acyclic reference as circular", () => {
    // The same tenant object attached to two orders is ordinary in a log
    // record. Tracking every visited object - rather than only the current
    // path - used to flag the second occurrence as "[Circular]" and silently
    // drop it, losing the tenant from the audit trail.
    const tenant = { id: "t-1", name: "Sugu Rolls" };
    const result = redact({
      orders: [
        { id: "o-1", tenant },
        { id: "o-2", tenant },
      ],
    }) as { orders: { id: string; tenant: unknown }[] };

    expect(result.orders[0]?.tenant).toEqual({ id: "t-1", name: "Sugu Rolls" });
    expect(result.orders[1]?.tenant).toEqual({ id: "t-1", name: "Sugu Rolls" });
    expect(JSON.stringify(result)).not.toContain("[Circular]");
  });

  it("still detects a genuine cycle", () => {
    const node: Record<string, unknown> = { id: "n-1" };
    node.self = node;
    expect(JSON.stringify(redact(node))).toContain("[Circular]");
  });

  it("detects a cycle that closes through several levels", () => {
    const a: Record<string, unknown> = { name: "a" };
    const b: Record<string, unknown> = { name: "b", a };
    a.b = b;
    expect(JSON.stringify(redact(a))).toContain("[Circular]");
  });

  it("handles a diamond-shaped object graph without data loss", () => {
    const shared = { value: 42 };
    const result = redact({ left: shared, right: shared }) as Record<string, unknown>;
    expect(result.left).toEqual({ value: 42 });
    expect(result.right).toEqual({ value: 42 });
  });
});

describe("request id validation (audit regression)", () => {
  /*
   * Scope note from the audit: CR/LF cannot actually reach us through
   * `request.headers` - both Node's HTTP parser and the `Headers` constructor
   * reject those characters, so this is NOT a remotely triggerable crash. What
   * a client CAN do is send any header-legal string, which is then echoed into
   * the response header and into every log line for that request.
   *
   * Validating at the boundary keeps that under control and makes the value
   * safe for any caller that builds a requestId itself (middleware, tests).
   */

  it.each([
    ["a space", "has space"],
    ["a tab", "has	tab"],
    ["a quote", 'quote"inside'],
    ["a semicolon", "semi;colon"],
    ["an empty value", ""],
    ["only whitespace", "   "],
  ])("rejects %s and generates a fresh id", (_label, value) => {
    const id = getRequestId(new Headers([["x-request-id", value]]));
    expect(id).not.toBe(value);
    expect(id).toMatch(/^[A-Za-z0-9_.:@-]+$/);
  });

  it("rejects an oversized id", () => {
    const oversized = "a".repeat(201);
    expect(getRequestId(new Headers([["x-request-id", oversized]]))).not.toBe(oversized);
  });

  it.each([
    "0bafc224-60b2-4be2-8092-d1baf4454d63",
    "edge-abc-123",
    "trace:1234@vercel",
    "req_abc.def",
  ])("accepts the well-formed id %j", (value) => {
    expect(getRequestId(new Headers([["x-request-id", value]]))).toBe(value);
  });

  it("always returns a value usable as an HTTP header", () => {
    const candidates = ["a b", " ", "ok-123", "", "x".repeat(300)];
    for (const candidate of candidates) {
      const headers = new Headers();
      // Some candidates are not valid header values; feed those directly to
      // the validator instead of through Headers.
      try {
        headers.set("x-request-id", candidate);
      } catch {
        continue;
      }
      const id = getRequestId(headers);
      expect(() => new Headers({ "X-Request-Id": id })).not.toThrow();
      expect(id).toMatch(/^[A-Za-z0-9_.:@-]{1,200}$/);
    }
  });
});
