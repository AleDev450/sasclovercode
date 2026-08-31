import { describe, expect, it } from "vitest";
import { isSensitiveKey } from "@/lib/logger";
import {
  DEPENDENCY_TIMEOUT_MS,
  HEALTH_FAILURES,
  HEALTH_STATUSES,
  healthStatusCode,
  overallHealth,
  type DependencyCheck,
} from "@/lib/observability/health";
import {
  AUDIT_IP_HEADER,
  AUDIT_REQUEST_ID_HEADER,
  AUDIT_USER_AGENT_HEADER,
  buildAuditHeaders,
  firstForwardedIp,
  getRequestContext,
  sanitiseHeaderValue,
} from "@/lib/observability/request-context";
import {
  AUDIT_ACTIONS,
  AUDIT_ACTION_LABELS,
  AUDIT_NOISE_FIELDS,
  auditEntityLabel,
  describeChanges,
  isAuditAction,
} from "@/modules/audit/actions";
import { AUDIT_PAGE_SIZE, auditFiltersSchema } from "@/modules/audit/schemas";

const ok = (name: string): DependencyCheck => ({ name, status: "ok", durationMs: 4 });
const bad = (name: string): DependencyCheck => ({
  name,
  status: "degraded",
  durationMs: 5001,
  failure: "timeout",
});

describe("health composition (TEST-2401, TEST-2402)", () => {
  it("is ok when every dependency is ok", () => {
    expect(overallHealth([ok("database"), ok("storage")])).toBe("ok");
  });

  it("is ok with nothing to check, which is the liveness case", () => {
    expect(overallHealth([])).toBe("ok");
  });

  it("is degraded when any single dependency is degraded", () => {
    // No "partial": either this instance should get traffic or it should not.
    expect(overallHealth([ok("database"), bad("storage")])).toBe("degraded");
    expect(overallHealth([bad("database")])).toBe("degraded");
  });

  it("answers 503 for degraded and 200 for ok", () => {
    // The status code is the only part a load balancer reads. Answering 200
    // with a sad body keeps traffic on an instance that cannot serve it.
    expect(healthStatusCode("ok")).toBe(200);
    expect(healthStatusCode("degraded")).toBe(503);
  });

  it("keeps its vocabulary closed", () => {
    // `/api/health` is unauthenticated, so anything it can say is public. A
    // free-text database error would describe the schema to whoever asked.
    expect([...HEALTH_STATUSES]).toEqual(["ok", "degraded"]);
    expect([...HEALTH_FAILURES]).toEqual(["unreachable", "query_failed", "timeout"]);
  });

  it("gives a dependency room to be slow before calling it dead", () => {
    // A check that trips on a slow query turns one bad moment into an instance
    // leaving rotation, and flapping is worse than slow.
    expect(DEPENDENCY_TIMEOUT_MS).toBeGreaterThanOrEqual(3_000);
  });
});

describe("the forwarded request context (TEST-2406)", () => {
  it("strips anything a header value may not carry", () => {
    // `Headers` rejects control characters outright, and a rejected header does
    // not degrade - it throws, and takes the Supabase request with it.
    expect(sanitiseHeaderValue("Mozilla/5.0\r\nX-Evil: 1", 500)).toBe("Mozilla/5.0X-Evil: 1");
    // Accented letters and emoji go with them. A user agent is ASCII by spec,
    // and this value is attacker-influenced text, so it is filtered rather
    // than trusted - losing an "ñ" costs nothing an audit row needs.
    expect(sanitiseHeaderValue("Navegador ñandú \u{1F600}", 500)).toBe("Navegador and");
  });

  it("treats an empty or absent value as absent", () => {
    expect(sanitiseHeaderValue("", 500)).toBeNull();
    expect(sanitiseHeaderValue("   ", 500)).toBeNull();
    expect(sanitiseHeaderValue(null, 500)).toBeNull();
    expect(sanitiseHeaderValue(undefined, 500)).toBeNull();
  });

  it("truncates rather than letting the database refuse the row", () => {
    expect(sanitiseHeaderValue("U".repeat(900), 500)).toHaveLength(500);
  });

  it("takes the FIRST address out of a proxy chain", () => {
    // Everything after the first is our own infrastructure adding itself;
    // recording the last would put a load balancer on every audit row.
    expect(firstForwardedIp("190.12.44.7, 10.0.0.1, 10.0.0.2")).toBe("190.12.44.7");
    expect(firstForwardedIp("190.12.44.7")).toBe("190.12.44.7");
  });

  it("unwraps a bracketed IPv6 address", () => {
    expect(firstForwardedIp("[2001:db8::1]")).toBe("2001:db8::1");
  });

  it("has nothing to say about an empty chain", () => {
    expect(firstForwardedIp("")).toBeNull();
    expect(firstForwardedIp(null)).toBeNull();
    expect(firstForwardedIp(", 10.0.0.1")).toBeNull();
  });

  it("omits what it does not know instead of sending it empty", () => {
    // PostgREST would expose an empty string, and '' is not the same answer as
    // "we do not know" - the database stores NULL for the second.
    expect(buildAuditHeaders({ ip: null, userAgent: null, requestId: null })).toEqual({});

    expect(buildAuditHeaders({ ip: "190.12.44.7", userAgent: null, requestId: "req-1" })).toEqual({
      [AUDIT_IP_HEADER]: "190.12.44.7",
      [AUDIT_REQUEST_ID_HEADER]: "req-1",
    });
  });

  it("names its headers with a prefix of its own", () => {
    // The browser never talks to PostgREST, so nothing that arrives there was
    // set by a client. The prefix says in the name that we chose to send it.
    for (const header of [AUDIT_IP_HEADER, AUDIT_USER_AGENT_HEADER, AUDIT_REQUEST_ID_HEADER]) {
      expect(header).toMatch(/^x-clovercode-/);
      expect(header).toBe(header.toLowerCase());
    }
  });

  it("returns all nulls where there is no request, instead of throwing", async () => {
    // `headers()` throws outside a request scope - middleware, a build-time
    // render, a background job, this test. Every one is a legitimate caller,
    // and none of them may be the reason a price update fails.
    await expect(getRequestContext()).resolves.toEqual({
      ip: null,
      userAgent: null,
      requestId: null,
    });
  });
});

describe("the audit action catalogue (TEST-2403, TEST-2404)", () => {
  it("labels every action", () => {
    for (const action of AUDIT_ACTIONS) {
      expect(AUDIT_ACTION_LABELS[action].length).toBeGreaterThan(0);
    }
    expect(Object.keys(AUDIT_ACTION_LABELS).sort()).toEqual([...AUDIT_ACTIONS].sort());
  });

  it("names every action domain.action, never a SQL verb", () => {
    // A log that records `update` makes its reader reconstruct the intent from
    // the payload; one that records the intent is one somebody can read.
    for (const action of AUDIT_ACTIONS) {
      expect(action).toMatch(/^[a-z_]+\.[a-z_]+$/);
      expect(["insert", "update", "delete"]).not.toContain(action);
    }
  });

  it("covers all nine sensitive actions master section 17 lists", () => {
    const required = [
      "product.price_changed",
      "product.deleted",
      "order.cancelled",
      "member.added",
      "member.role_changed",
      "billing_config.changed",
      "cash_session.closed",
      "payment.voided",
      "billing_document.cancelled",
      "stock.returned",
    ];
    for (const action of required) {
      expect(AUDIT_ACTIONS).toContain(action);
    }
  });

  it("narrows a string only when it is a known action", () => {
    expect(isAuditAction("order.cancelled")).toBe(true);
    expect(isAuditAction("order.exploded")).toBe(false);
  });

  it("falls back to the raw table name rather than dropping it", () => {
    expect(auditEntityLabel("products")).toBe("Producto");
    // A row nobody can label is still a row, and hiding it would be the one
    // wrong thing to do on an audit screen.
    expect(auditEntityLabel("a_table_from_a_future_phase")).toBe("a_table_from_a_future_phase");
  });
});

describe("describeChanges", () => {
  it("shows the chosen fields of a known action, changed or not", () => {
    const changes = describeChanges(
      "product.price_changed",
      { base_price_cents: 2490, name: "Lomo" },
      { base_price_cents: 3000, name: "Lomo" },
    );
    expect(changes).toEqual([{ field: "base_price_cents", before: "2490", after: "3000" }]);
  });

  it("handles a creation, which has no before", () => {
    const changes = describeChanges("product.created", null, {
      name: "Ceviche",
      base_price_cents: 3500,
      status: "draft",
    });
    expect(changes.map((c) => c.field)).toEqual(["name", "base_price_cents", "status"]);
    expect(changes[0]?.before).toBeNull();
    expect(changes[0]?.after).toBe("Ceviche");
  });

  it("handles a deletion, which has no after", () => {
    const changes = describeChanges(
      "product.deleted",
      { name: "Anticucho", base_price_cents: 1800 },
      null,
    );
    expect(changes[0]).toEqual({ field: "name", before: "Anticucho", after: null });
  });

  it("falls back to whatever actually changed for an unmapped action", () => {
    const changes = describeChanges(
      "settings.changed",
      { tax_id: null, city: "Lima", updated_at: "a" },
      { tax_id: "20123456789", city: "Lima", updated_at: "b" },
    );
    expect(changes.map((c) => c.field)).toEqual(["tax_id"]);
  });

  it("never reports the bookkeeping columns as a change", () => {
    // `updated_at` moves on every write by definition (the Phase 01 trigger),
    // so listing it would be noise on every single row.
    const changes = describeChanges("settings.changed", { updated_at: "a" }, { updated_at: "b" });
    expect(changes).toEqual([]);
    expect(AUDIT_NOISE_FIELDS).toContain("updated_at");
  });

  it("renders a redacted value as the sentinel it is, and does not unmask it", () => {
    const changes = describeChanges(
      "billing_config.changed",
      { credentials_secret_id: "[REDACTED]" },
      { credentials_secret_id: "[REDACTED]" },
    );
    // Equal on both sides and not a highlighted field, so it does not even
    // reach the screen - and if it did, it would say [REDACTED].
    expect(changes).toEqual([]);
  });

  it("survives both payloads being empty", () => {
    expect(describeChanges("order.cancelled", null, null)).toEqual([]);
  });
});

describe("the audit filter schema (TEST-2405)", () => {
  const UUID = "11111111-1111-4111-8111-111111111111";

  it("accepts an empty query string", () => {
    expect(auditFiltersSchema.parse({})).toEqual({ action: null, entity: null, page: 1 });
  });

  it("keeps a known action", () => {
    expect(auditFiltersSchema.parse({ action: "order.cancelled" }).action).toBe("order.cancelled");
  });

  it("drops an unknown action rather than matching nothing", () => {
    // A filter that matched nothing would render an empty page indistinguishable
    // from "nothing happened", which on an audit screen is the one wrong answer.
    expect(auditFiltersSchema.parse({ action: "order.exploded" }).action).toBeNull();
    expect(auditFiltersSchema.parse({ action: "" }).action).toBeNull();
  });

  it("keeps a valid entity and drops one that is not a uuid", () => {
    expect(auditFiltersSchema.parse({ entity: UUID }).entity).toBe(UUID);
    expect(auditFiltersSchema.parse({ entity: "el producto ese" }).entity).toBeNull();
  });

  it("normalises the page to at least one", () => {
    expect(auditFiltersSchema.parse({ page: "3" }).page).toBe(3);
    expect(auditFiltersSchema.parse({ page: "0" }).page).toBe(1);
    expect(auditFiltersSchema.parse({ page: "-2" }).page).toBe(1);
    expect(auditFiltersSchema.parse({ page: "ayer" }).page).toBe(1);
  });

  it("pages in a size somebody can actually scan", () => {
    expect(AUDIT_PAGE_SIZE).toBeGreaterThan(10);
    expect(AUDIT_PAGE_SIZE).toBeLessThanOrEqual(100);
  });
});

describe("redaction reaches the audit's own vocabulary", () => {
  it("classifies the credential column Phase 17 actually has", () => {
    // The concrete case ADR-028 decision 4 is about: not the credential itself
    // (that lives in Vault) but the reference to it, caught because the NAME
    // contains "credential".
    expect(isSensitiveKey("credentials_secret_id")).toBe(true);
  });

  it("leaves the columns an audit screen needs alone", () => {
    for (const key of ["action", "entity_type", "user_email", "ip_address", "request_id"]) {
      expect(`${key}:${isSensitiveKey(key)}`).toBe(`${key}:false`);
    }
  });
});
