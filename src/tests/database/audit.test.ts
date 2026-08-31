import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isSensitiveKey } from "@/lib/logger";
import { AUDIT_ACTIONS } from "@/modules/audit/actions";
import { createTestDatabase, insertTenant, type TestDatabase } from "../helpers/database";

/**
 * Phase 24 at the database level.
 *
 * Five properties matter more than the rest, all from ADR-028:
 *
 * - NOBODY can write `audit_logs`. Not a member, not a platform admin. A record
 *   somebody can write is a record somebody can fabricate.
 * - The triggers cannot be forgotten, so they are exercised through ordinary
 *   business writes rather than by calling anything named "audit".
 * - No secret can get in, including from a column that does not exist yet -
 *   which is why the redaction is by pattern, and why TEST-2440 checks the SQL
 *   and the TypeScript agree instead of trusting that two copies match.
 * - The IP, the user agent and the request id arrive through
 *   `request.headers`, exactly as PostgREST would set it.
 * - A tenant can only ever see its own.
 */

let db: TestDatabase;

let tenantA: string;
let tenantB: string;

let ownerA: string;
let managerA: string;
let ownerB: string;
let operator: string;

let locationA: string;
let productA: string;
let registerA: string;
let methodA: string;

async function createUser(email: string): Promise<string> {
  const rows = await db.query<{ id: string }>(
    "insert into auth.users (email) values ($1) returning id",
    [email],
  );
  return rows[0]!.id;
}

async function addMember(tenantId: string, userId: string, role: string): Promise<void> {
  await db.query(
    `insert into public.tenant_members (tenant_id, user_id, role)
     values ($1, $2, $3::public.tenant_role)`,
    [tenantId, userId, role],
  );
}

interface AuditRow {
  action: string;
  entity_type: string;
  entity_id: string | null;
  user_id: string | null;
  user_email: string | null;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  request_id: string | null;
}

/** The newest audit row for an action, read with RLS out of the way. */
async function latest(tenantId: string, action: string): Promise<AuditRow | undefined> {
  const rows = await db.query<AuditRow>(
    `select action, entity_type, entity_id, user_id, user_email,
            old_values, new_values, host(ip_address) as ip_address, user_agent, request_id
     from public.audit_logs
     where tenant_id = $1 and action = $2
     order by created_at desc, id desc
     limit 1`,
    [tenantId, action],
  );
  return rows[0];
}

async function countFor(tenantId: string, action: string): Promise<number> {
  const rows = await db.query<{ c: string }>(
    "select count(*)::text c from public.audit_logs where tenant_id = $1 and action = $2",
    [tenantId, action],
  );
  return Number(rows[0]!.c);
}

/**
 * Sets the GUC PostgREST populates on a real request.
 *
 * This is the whole forwarding path under test: `createSupabaseServerClient()`
 * attaches these headers, PostgREST puts every request header into
 * `request.headers`, and `audit_request_header()` reads them back.
 */
async function withHeaders(headers: Record<string, string>): Promise<void> {
  await db.query("select set_config('request.headers', $1, false)", [JSON.stringify(headers)]);
}

async function clearHeaders(): Promise<void> {
  await db.query("select set_config('request.headers', '', false)");
}

beforeAll(async () => {
  db = await createTestDatabase();

  tenantA = await insertTenant(db, { slug: "audit-a", name: "Audit A" });
  tenantB = await insertTenant(db, { slug: "audit-b", name: "Audit B" });

  ownerA = await createUser("owner-a@audit.test");
  managerA = await createUser("manager-a@audit.test");
  ownerB = await createUser("owner-b@audit.test");
  operator = await createUser("operator@audit.test");

  await addMember(tenantA, ownerA, "owner");
  await addMember(tenantA, managerA, "manager");
  await addMember(tenantB, ownerB, "owner");

  await db.query("insert into public.platform_admins (user_id) values ($1)", [operator]);

  const locations = await db.query<{ id: string }>(
    "select id from public.locations where tenant_id = $1 limit 1",
    [tenantA],
  );
  locationA = locations[0]!.id;

  const products = await db.query<{ id: string }>(
    `insert into public.products (tenant_id, name, slug, base_price_cents, status)
     values ($1, 'Lomo saltado', 'lomo-saltado', 2490, 'active') returning id`,
    [tenantA],
  );
  productA = products[0]!.id;

  const registers = await db.query<{ id: string }>(
    `insert into public.cash_registers (tenant_id, location_id, name)
     values ($1, $2, 'Caja 1') returning id`,
    [tenantA, locationA],
  );
  registerA = registers[0]!.id;

  const methods = await db.query<{ id: string }>(
    `insert into public.payment_methods (tenant_id, type, name)
     values ($1, 'yape'::public.payment_method_type, 'Yape') returning id`,
    [tenantA],
  );
  methodA = methods[0]!.id;

  // A RUC, because Phase 17 refuses to issue a document without one. Set here
  // rather than inside the document test so that test exercises one trigger
  // instead of two.
  await db.query("update public.tenant_settings set tax_id = '20111111111' where tenant_id = $1", [
    tenantA,
  ]);
});

afterAll(async () => {
  await db.close();
});

describe("the table itself (TEST-2410, TEST-2411)", () => {
  it("has RLS enabled and exactly one policy, for select", async () => {
    const rls = await db.query<{ relrowsecurity: boolean }>(
      "select relrowsecurity from pg_class where relname = 'audit_logs'",
    );
    expect(rls[0]?.relrowsecurity).toBe(true);

    const policies = await db.query<{ cmd: string; policyname: string }>(
      "select cmd, policyname from pg_policies where tablename = 'audit_logs' order by policyname",
    );

    // No INSERT, no UPDATE, no DELETE - for anybody. That absence is the whole
    // reason a row here is worth something (ADR-028 decision 1).
    expect(policies.map((p) => p.cmd)).toEqual(["SELECT"]);
  });

  it("refuses a hand-written row, even from a platform admin", async () => {
    await expect(
      db.asUser(operator, () =>
        db.query(
          `insert into public.audit_logs (tenant_id, action, entity_type, new_values)
           values ($1, 'product.price_changed', 'products', '{"base_price_cents": 1}'::jsonb)`,
          [tenantA],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("refuses a hand-written row from an owner", async () => {
    await expect(
      db.asUser(ownerA, () =>
        db.query(
          `insert into public.audit_logs (tenant_id, action, entity_type, new_values)
           values ($1, 'order.cancelled', 'orders', '{}'::jsonb)`,
          [tenantA],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("refuses to delete or amend an existing row", async () => {
    await db.query("update public.products set base_price_cents = 2500 where id = $1", [productA]);

    const before = await countFor(tenantA, "product.price_changed");
    expect(before).toBeGreaterThan(0);

    // No policy for either verb, so RLS filters instead of raising: the row is
    // invisible to the statement, and nothing changes.
    await db.asUser(operator, () => db.query("delete from public.audit_logs"));
    await db.asUser(ownerA, () =>
      db.query("update public.audit_logs set action = 'product.created'"),
    );

    expect(await countFor(tenantA, "product.price_changed")).toBe(before);
  });

  it("rejects an action that is not domain.action shaped", async () => {
    // Not reachable through a trigger - TG_ARGV is ours - but the constraint is
    // what keeps it that way.
    await expect(
      db.query(
        `insert into public.audit_logs (tenant_id, action, entity_type, new_values)
         values ($1, 'Something Happened', 'products', '{}'::jsonb)`,
        [tenantA],
      ),
    ).rejects.toThrow(/audit_logs_action_format/);
  });

  it("rejects a row that records no change at all", async () => {
    await expect(
      db.query(
        `insert into public.audit_logs (tenant_id, action, entity_type)
         values ($1, 'product.created', 'products')`,
        [tenantA],
      ),
    ).rejects.toThrow(/audit_logs_has_payload/);
  });
});

describe("redaction (TEST-2412, TEST-2413, TEST-2414, TEST-2440)", () => {
  async function redact(value: unknown): Promise<Record<string, unknown>> {
    const rows = await db.query<{ out: Record<string, unknown> }>(
      "select public.audit_redact($1::jsonb) as out",
      [JSON.stringify(value)],
    );
    return rows[0]!.out;
  }

  it("hides every kind of credential, including one no table has", async () => {
    const out = await redact({
      password: "hunter2",
      access_token: "eyJ...",
      api_key: "sk_live_1",
      // A column that exists in no migration anywhere. It is here precisely to
      // prove the rule covers what has not been written yet - which a list of
      // forbidden column names could not do (ADR-028 decision 4).
      stripe_api_key: "sk_live_2",
      credentials_secret_id: "6f1b...",
      refreshToken: "rt_1",
      "X-API-KEY": "k",
      name: "Lomo saltado",
    });

    expect(out.password).toBe("[REDACTED]");
    expect(out.access_token).toBe("[REDACTED]");
    expect(out.api_key).toBe("[REDACTED]");
    expect(out.stripe_api_key).toBe("[REDACTED]");
    expect(out.credentials_secret_id).toBe("[REDACTED]");
    expect(out.refreshToken).toBe("[REDACTED]");
    expect(out["X-API-KEY"]).toBe("[REDACTED]");
    expect(out.name).toBe("Lomo saltado");
  });

  it("keeps the key and replaces only the value", async () => {
    const out = await redact({ password: "hunter2" });
    // Removing the key would make "did not change" and "changed, not shown"
    // indistinguishable, and the second is what an auditor wants to know.
    expect(Object.keys(out)).toEqual(["password"]);
  });

  it("reaches into nested objects and arrays", async () => {
    const out = await redact({
      provider: { name: "sunat", secret: "s3cr3t", series: "F001" },
      items: [{ token: "t1" }, { label: "ok" }],
    });

    const provider = out.provider as Record<string, unknown>;
    expect(provider.secret).toBe("[REDACTED]");
    expect(provider.series).toBe("F001");

    const items = out.items as Record<string, unknown>[];
    expect(items[0]!.token).toBe("[REDACTED]");
    expect(items[1]!.label).toBe("ok");
  });

  it("leaves innocent data alone, types included", async () => {
    const out = await redact({ base_price_cents: 2490, is_available: true, notes: null });
    expect(out).toEqual({ base_price_cents: 2490, is_available: true, notes: null });
  });

  it("survives a null", async () => {
    const rows = await db.query<{ out: unknown }>("select public.audit_redact(null::jsonb) as out");
    expect(rows[0]!.out).toBeNull();
  });

  it("agrees with isSensitiveKey, name for name (TEST-2440)", async () => {
    // Two copies of a policy nobody compares are two policies. This is the
    // comparison: `src/lib/logger/redact.ts` (Phase 00) and
    // `audit_is_sensitive_key` must classify every one of these the same way.
    const sensitive = [
      "password",
      "passwd",
      "passphrase",
      "pwd",
      "user_password",
      "secret",
      "client_secret",
      "token",
      "access_token",
      "refreshToken",
      "api_key",
      "apiKey",
      "X-API-KEY",
      "stripe_api_key",
      "authorization",
      "auth",
      "cookie",
      "set-cookie",
      "service_role",
      "credentials_secret_id",
      "private_key",
      "signature",
      "otp",
      "pin",
      "cvv",
      "cvc",
      "jwt",
      "bearer",
    ];

    const innocent = [
      "id",
      "tenant_id",
      "name",
      "base_price_cents",
      "status",
      "created_at",
      "email",
      "role",
      "quantity",
      "reason",
      "series_boleta",
      "closing_cents",
    ];

    for (const key of sensitive) {
      const rows = await db.query<{ hit: boolean }>(
        "select public.audit_is_sensitive_key($1) as hit",
        [key],
      );
      expect(`${key}:${rows[0]!.hit}`).toBe(`${key}:true`);
      expect(`${key}:${isSensitiveKey(key)}`).toBe(`${key}:true`);
    }

    for (const key of innocent) {
      const rows = await db.query<{ hit: boolean }>(
        "select public.audit_is_sensitive_key($1) as hit",
        [key],
      );
      expect(`${key}:${rows[0]!.hit}`).toBe(`${key}:false`);
      expect(`${key}:${isSensitiveKey(key)}`).toBe(`${key}:false`);
    }
  });
});

describe("products (TEST-2415, TEST-2416, TEST-2417, TEST-2418)", () => {
  it("records a price change with both prices", async () => {
    await db.query("update public.products set base_price_cents = 3000 where id = $1", [productA]);

    const row = await latest(tenantA, "product.price_changed");
    expect(row?.entity_type).toBe("products");
    expect(row?.entity_id).toBe(productA);
    expect(row?.old_values?.base_price_cents).toBe(2500);
    expect(row?.new_values?.base_price_cents).toBe(3000);
  });

  it("ignores a write that does not touch the price", async () => {
    const before = await countFor(tenantA, "product.price_changed");
    await db.query("update public.products set is_available = false where id = $1", [productA]);
    expect(await countFor(tenantA, "product.price_changed")).toBe(before);
  });

  it("ignores a write that sets the same price again", async () => {
    // `update OF` fires on the column being MENTIONED; the WHEN is what stops
    // a form re-submitting an unchanged price from filling the log.
    const before = await countFor(tenantA, "product.price_changed");
    await db.query("update public.products set base_price_cents = 3000 where id = $1", [productA]);
    expect(await countFor(tenantA, "product.price_changed")).toBe(before);
  });

  it("records a creation with no before", async () => {
    await db.query(
      `insert into public.products (tenant_id, name, slug, base_price_cents)
       values ($1, 'Ceviche', 'ceviche', 3500)`,
      [tenantA],
    );

    const row = await latest(tenantA, "product.created");
    expect(row?.old_values).toBeNull();
    expect(row?.new_values?.name).toBe("Ceviche");
  });

  it("records a deletion with no after", async () => {
    const rows = await db.query<{ id: string }>(
      `insert into public.products (tenant_id, name, slug, base_price_cents)
       values ($1, 'Anticucho', 'anticucho', 1800) returning id`,
      [tenantA],
    );
    await db.query("delete from public.products where id = $1", [rows[0]!.id]);

    const row = await latest(tenantA, "product.deleted");
    expect(row?.new_values).toBeNull();
    expect(row?.old_values?.name).toBe("Anticucho");
  });
});

describe("orders (TEST-2419, TEST-2420)", () => {
  /** With a line, because Phase 13 refuses to move an empty order forward. */
  async function newOrder(): Promise<string> {
    const rows = await db.query<{ id: string }>(
      "insert into public.orders (tenant_id, location_id) values ($1, $2) returning id",
      [tenantA, locationA],
    );
    await db.query(
      `insert into public.order_items (order_id, name_snapshot, unit_price_cents, quantity)
       values ($1, 'Menu del dia', 1500, 1)`,
      [rows[0]!.id],
    );
    return rows[0]!.id;
  }

  it("records a cancellation", async () => {
    const orderId = await newOrder();
    await db.query(
      `update public.orders
       set status = 'cancelled', cancelled_at = now(), cancel_reason = 'El cliente se arrepintio'
       where id = $1`,
      [orderId],
    );

    const row = await latest(tenantA, "order.cancelled");
    expect(row?.entity_id).toBe(orderId);
    expect(row?.new_values?.cancel_reason).toBe("El cliente se arrepintio");
    expect(row?.old_values?.status).toBe("pending");
  });

  it("ignores an ordinary transition", async () => {
    const before = await countFor(tenantA, "order.cancelled");
    const orderId = await newOrder();
    await db.query("update public.orders set status = 'confirmed' where id = $1", [orderId]);
    await db.query("update public.orders set status = 'preparing' where id = $1", [orderId]);
    expect(await countFor(tenantA, "order.cancelled")).toBe(before);
  });
});

describe("access (TEST-2421, TEST-2422, TEST-2423)", () => {
  it("records a member being added, with their role", async () => {
    const newcomer = await createUser("newcomer@audit.test");
    await addMember(tenantA, newcomer, "cashier");

    const row = await latest(tenantA, "member.added");
    expect(row?.new_values?.role).toBe("cashier");
    expect(row?.new_values?.user_id).toBe(newcomer);
  });

  it("records a role change with both roles", async () => {
    const promoted = await createUser("promoted@audit.test");
    await addMember(tenantA, promoted, "waiter");
    await db.query(
      `update public.tenant_members set role = 'manager'::public.tenant_role
       where tenant_id = $1 and user_id = $2`,
      [tenantA, promoted],
    );

    const row = await latest(tenantA, "member.role_changed");
    expect(row?.old_values?.role).toBe("waiter");
    expect(row?.new_values?.role).toBe("manager");
  });

  it("records a suspension, which changes no role", async () => {
    const suspended = await createUser("suspended@audit.test");
    await addMember(tenantA, suspended, "waiter");
    await db.query(
      `update public.tenant_members set status = 'suspended'::public.membership_status
       where tenant_id = $1 and user_id = $2`,
      [tenantA, suspended],
    );

    const row = await latest(tenantA, "member.status_changed");
    expect(row?.old_values?.status).toBe("active");
    expect(row?.new_values?.status).toBe("suspended");
  });

  it("records a member being removed", async () => {
    const leaver = await createUser("leaver@audit.test");
    await addMember(tenantA, leaver, "kitchen");
    await db.query("delete from public.tenant_members where tenant_id = $1 and user_id = $2", [
      tenantA,
      leaver,
    ]);

    const row = await latest(tenantA, "member.removed");
    expect(row?.old_values?.user_id).toBe(leaver);
    expect(row?.new_values).toBeNull();
  });
});

describe("money and documents (TEST-2424, TEST-2425, TEST-2426, TEST-2427)", () => {
  it("records a till being closed, with its difference", async () => {
    const sessions = await db.query<{ id: string }>(
      `insert into public.cash_sessions (tenant_id, cash_register_id, opening_cents)
       values ($1, $2, 10000) returning id`,
      [tenantA, registerA],
    );
    const sessionId = sessions[0]!.id;

    await db.query(
      `update public.cash_sessions
       set closed_at = now(), closing_cents = 12000, expected_cents = 12500,
           difference_cents = -500
       where id = $1`,
      [sessionId],
    );

    // Phase 14 derives `expected_cents` and `difference_cents` from the till's
    // movements, so the values written here are not the values that land. What
    // this test is about is that the audit row carries whatever DID land - so
    // it is compared against the row itself rather than against a guess.
    const session = await db.query<{ closing_cents: number; difference_cents: number }>(
      "select closing_cents, difference_cents from public.cash_sessions where id = $1",
      [sessionId],
    );

    const row = await latest(tenantA, "cash_session.closed");
    expect(row?.entity_id).toBe(sessionId);
    expect(row?.new_values?.closing_cents).toBe(session[0]!.closing_cents);
    expect(row?.new_values?.difference_cents).toBe(session[0]!.difference_cents);
    expect(row?.old_values?.closed_at).toBeNull();
  });

  it("records a payment being voided, with the reason", async () => {
    const orders = await db.query<{ id: string }>(
      "insert into public.orders (tenant_id, location_id) values ($1, $2) returning id",
      [tenantA, locationA],
    );

    // A line, because Phase 14 refuses a payment that would overpay the order -
    // and an order with no lines is owed nothing.
    await db.query(
      `insert into public.order_items (order_id, name_snapshot, unit_price_cents, quantity)
       values ($1, 'Menu del dia', 5000, 1)`,
      [orders[0]!.id],
    );

    const payments = await db.query<{ id: string }>(
      `insert into public.payments (tenant_id, order_id, payment_method_id, amount_cents)
       values ($1, $2, $3, 5000) returning id`,
      [tenantA, orders[0]!.id, methodA],
    );

    await db.query(
      `update public.payments set voided_at = now(), void_reason = 'Cobrado dos veces'
       where id = $1`,
      [payments[0]!.id],
    );

    const row = await latest(tenantA, "payment.voided");
    expect(row?.new_values?.void_reason).toBe("Cobrado dos veces");
    expect(row?.new_values?.amount_cents).toBe(5000);
  });

  it("records a billing configuration change WITHOUT the credential reference", async () => {
    await db.query(
      `update public.billing_provider_configs
       set series_factura = 'F002', credentials_secret_id = gen_random_uuid()
       where tenant_id = $1`,
      [tenantA],
    );

    const row = await latest(tenantA, "billing_config.changed");
    expect(row?.new_values?.series_factura).toBe("F002");

    // The credential itself lives in Vault (ADR-021); this column is only a
    // reference to it, and it is still redacted - because the rule is about the
    // NAME of the key, and this name contains "credential".
    expect(row?.new_values?.credentials_secret_id).toBe("[REDACTED]");
    expect(row?.old_values?.credentials_secret_id).toBe("[REDACTED]");
  });

  it("records a document being cancelled", async () => {
    const orders = await db.query<{ id: string }>(
      "insert into public.orders (tenant_id, location_id) values ($1, $2) returning id",
      [tenantA, locationA],
    );
    await db.query(
      `insert into public.order_items (order_id, name_snapshot, unit_price_cents, quantity)
       values ($1, 'Menu del dia', 2000, 1)`,
      [orders[0]!.id],
    );

    const docs = await db.query<{ id: string }>(
      `insert into public.billing_documents
         (tenant_id, order_id, type, series, number, issuer_ruc_snapshot, status, sent_at, accepted_at)
       values ($1, $2, 'boleta'::public.billing_document_type, 'B001', 1,
               '20111111111', 'accepted'::public.billing_document_status, now(), now())
       returning id`,
      [tenantA, orders[0]!.id],
    );

    await db.query(
      `update public.billing_documents
       set status = 'cancelled'::public.billing_document_status,
           cancelled_at = now(), cancel_reason = 'Emitido por error'
       where id = $1`,
      [docs[0]!.id],
    );

    const row = await latest(tenantA, "billing_document.cancelled");
    expect(row?.old_values?.status).toBe("accepted");
    expect(row?.new_values?.cancel_reason).toBe("Emitido por error");
  });
});

describe("inventory and points (TEST-2428)", () => {
  it("records a return, and not an ordinary sale movement", async () => {
    const units = await db.query<{ id: string }>("select id from public.units limit 1");
    const items = await db.query<{ id: string }>(
      `insert into public.inventory_items (tenant_id, name, unit_id)
       values ($1, 'Papa amarilla', $2) returning id`,
      [tenantA, units[0]!.id],
    );

    await db.query(
      `insert into public.stock_movements
         (tenant_id, inventory_item_id, location_id, type, quantity, reason)
       values ($1, $2, $3, 'return'::public.stock_movement_type, 2.5, 'Devuelto por el cliente')`,
      [tenantA, items[0]!.id, locationA],
    );

    const row = await latest(tenantA, "stock.returned");
    expect(row?.new_values?.reason).toBe("Devuelto por el cliente");

    // An `adjustment` is a different action and must not land under this one.
    const before = await countFor(tenantA, "stock.returned");
    await db.query(
      `insert into public.stock_movements
         (tenant_id, inventory_item_id, location_id, type, quantity, reason)
       values ($1, $2, $3, 'adjustment'::public.stock_movement_type, -1, 'Conteo')`,
      [tenantA, items[0]!.id, locationA],
    );
    expect(await countFor(tenantA, "stock.returned")).toBe(before);
  });

  it("records a manual points adjustment and not an ordinary earn", async () => {
    const customers = await db.query<{ id: string }>(
      "insert into public.customers (tenant_id, name) values ($1, 'Ana') returning id",
      [tenantA],
    );
    const accounts = await db.query<{ id: string }>(
      "insert into public.loyalty_accounts (tenant_id, customer_id) values ($1, $2) returning id",
      [tenantA, customers[0]!.id],
    );

    await db.query(
      `insert into public.loyalty_transactions (tenant_id, account_id, type, points, reason)
       values ($1, $2, 'adjustment'::public.loyalty_transaction_type, 50, 'Disculpa por la demora')`,
      [tenantA, accounts[0]!.id],
    );

    const row = await latest(tenantA, "loyalty.adjusted");
    expect(row?.new_values?.points).toBe(50);

    const before = await countFor(tenantA, "loyalty.adjusted");
    await db.query(
      `insert into public.loyalty_transactions (tenant_id, account_id, type, points)
       values ($1, $2, 'earn'::public.loyalty_transaction_type, 10)`,
      [tenantA, accounts[0]!.id],
    );
    expect(await countFor(tenantA, "loyalty.adjusted")).toBe(before);
  });

  it("records a change to the business's own details", async () => {
    await db.query(
      "update public.tenant_settings set tax_id = '20123456789' where tenant_id = $1",
      [tenantA],
    );

    const row = await latest(tenantA, "settings.changed");
    expect(row?.new_values?.tax_id).toBe("20123456789");
    // The singleton tables key on tenant_id, and the writer falls back to it.
    expect(row?.entity_id).toBe(tenantA);
  });
});

describe("the actor and the request (TEST-2429, TEST-2430, TEST-2431, TEST-2432, TEST-2433, TEST-2442)", () => {
  it("records who did it, by id and by email", async () => {
    await db.asUser(ownerA, () =>
      db.query("update public.products set base_price_cents = 4100 where id = $1", [productA]),
    );

    const row = await latest(tenantA, "product.price_changed");
    expect(row?.user_id).toBe(ownerA);
    // A SNAPSHOT, so the row still names somebody when the account is gone.
    expect(row?.user_email).toBe("owner-a@audit.test");
  });

  it("leaves the actor null when nobody is signed in", async () => {
    await db.query("update public.products set base_price_cents = 4200 where id = $1", [productA]);

    const row = await latest(tenantA, "product.price_changed");
    expect(row?.user_id).toBeNull();
    expect(row?.user_email).toBeNull();
  });

  it("leaves ip, user agent and request id null without an HTTP request", async () => {
    await clearHeaders();
    await db.query("update public.products set base_price_cents = 4300 where id = $1", [productA]);

    const row = await latest(tenantA, "product.price_changed");
    expect(row?.ip_address).toBeNull();
    expect(row?.user_agent).toBeNull();
    expect(row?.request_id).toBeNull();
  });

  it("records them when the request carries them", async () => {
    await withHeaders({
      "x-clovercode-ip": "190.12.44.7",
      "x-clovercode-user-agent": "Mozilla/5.0 (CloverCode test)",
      "x-clovercode-request-id": "req-abc-123",
    });

    await db.query("update public.products set base_price_cents = 4400 where id = $1", [productA]);
    await clearHeaders();

    const row = await latest(tenantA, "product.price_changed");
    expect(row?.ip_address).toBe("190.12.44.7");
    expect(row?.user_agent).toBe("Mozilla/5.0 (CloverCode test)");
    expect(row?.request_id).toBe("req-abc-123");
  });

  it("takes the first address of a proxy chain", async () => {
    await withHeaders({ "x-clovercode-ip": "190.12.44.8, 10.0.0.1, 10.0.0.2" });
    await db.query("update public.products set base_price_cents = 4500 where id = $1", [productA]);
    await clearHeaders();

    // The first entry is the client; everything after it is our own
    // infrastructure adding itself.
    expect((await latest(tenantA, "product.price_changed"))?.ip_address).toBe("190.12.44.8");
  });

  it("stores null rather than failing on a malformed address", async () => {
    await withHeaders({ "x-clovercode-ip": "unknown" });

    // The important half of this assertion is that the UPDATE succeeds at all:
    // the audit may never be the reason a price change fails.
    await db.query("update public.products set base_price_cents = 4600 where id = $1", [productA]);
    await clearHeaders();

    expect((await latest(tenantA, "product.price_changed"))?.ip_address).toBeNull();
  });

  it("survives a request.headers that is not JSON", async () => {
    await db.query("select set_config('request.headers', 'not json at all', false)");
    await db.query("update public.products set base_price_cents = 4700 where id = $1", [productA]);
    await clearHeaders();

    const row = await latest(tenantA, "product.price_changed");
    expect(row?.ip_address).toBeNull();
    expect(row?.user_agent).toBeNull();
  });

  it("truncates a user agent rather than refusing the write", async () => {
    await withHeaders({ "x-clovercode-user-agent": "U".repeat(900) });
    await db.query("update public.products set base_price_cents = 4800 where id = $1", [productA]);
    await clearHeaders();

    const row = await latest(tenantA, "product.price_changed");
    expect(row?.user_agent).toHaveLength(500);
  });

  it("keeps naming the actor after their account is deleted (TEST-2442)", async () => {
    const doomed = await createUser("doomed@audit.test");
    await addMember(tenantA, doomed, "admin");

    await db.asUser(doomed, () =>
      db.query("update public.products set base_price_cents = 4900 where id = $1", [productA]),
    );

    await db.query("delete from auth.users where id = $1", [doomed]);

    const row = await latest(tenantA, "product.price_changed");
    // No foreign key, so neither CASCADE nor SET NULL can erase the evidence.
    expect(row?.user_id).toBe(doomed);
    expect(row?.user_email).toBe("doomed@audit.test");
  });
});

describe("reading it (TEST-2434, TEST-2435, TEST-2436, TEST-2439)", () => {
  it("lets an owner read their own", async () => {
    const rows = await db.asUser(ownerA, () =>
      db.query<{ c: string }>("select count(*)::text c from public.audit_logs"),
    );
    expect(Number(rows[0]!.c)).toBeGreaterThan(0);
  });

  it("shows nothing to a manager, who is a subject of it", async () => {
    // `manager` holds products.update and orders.cancel, so they appear IN this
    // log. Auditing is a control function, and whoever operates does not
    // control their own operation (ADR-028 decision 7).
    const rows = await db.asUser(managerA, () =>
      db.query<{ c: string }>("select count(*)::text c from public.audit_logs"),
    );
    expect(Number(rows[0]!.c)).toBe(0);
  });

  it("shows nothing of tenant A to the owner of tenant B", async () => {
    const rows = await db.asUser(ownerB, () =>
      db.query<{ c: string }>(
        "select count(*)::text c from public.audit_logs where tenant_id = $1",
        [tenantA],
      ),
    );
    expect(Number(rows[0]!.c)).toBe(0);
  });

  it("lets a platform admin read anybody's", async () => {
    const rows = await db.asUser(operator, () =>
      db.query<{ c: string }>(
        "select count(*)::text c from public.audit_logs where tenant_id = $1",
        [tenantA],
      ),
    );
    expect(Number(rows[0]!.c)).toBeGreaterThan(0);
  });

  it("grants audit.view to owner, admin and accountant only", async () => {
    const rows = await db.query<{ role: string }>(
      "select role from public.role_permissions where permission = 'audit.view' order by role",
    );
    expect(rows.map((r) => r.role).sort()).toEqual(["accountant", "admin", "owner"]);
  });
});

describe("the trigger catalogue", () => {
  it("writes exactly the actions TypeScript declares", async () => {
    // The mirror check: `AUDIT_ACTIONS` is what the screen filters by, and the
    // triggers are what actually produce rows. A code on one side only would be
    // either a filter that matches nothing or a row nobody can label.
    const rows = await db.query<{ action: string }>(
      `select distinct tgargv_action as action
       from (
         select encode(tgargs, 'escape') as tgargv_action
         from pg_trigger
         where not tgisinternal
           and tgfoid = 'public.audit_row_change'::regproc
       ) as t`,
    );

    const declared = [...AUDIT_ACTIONS].sort();
    const actual = rows
      // `tgargs` is a NUL-terminated blob; the escape encoding leaves the marker.
      .map((r) => r.action.replace(/\\000$/, "").replace(/\0$/, ""))
      .sort();

    expect(actual).toEqual(declared);
  });

  it("attaches every trigger to a table that has tenant_id", async () => {
    // The writer resolves the tenant from the changed row; a table without the
    // column would silently write nothing.
    const rows = await db.query<{ relname: string }>(
      `select distinct c.relname
       from pg_trigger as t
       join pg_class as c on c.oid = t.tgrelid
       where not t.tgisinternal and t.tgfoid = 'public.audit_row_change'::regproc
         and not exists (
           select 1 from information_schema.columns as col
           where col.table_schema = 'public' and col.table_name = c.relname
             and col.column_name = 'tenant_id'
         )`,
    );
    expect(rows).toEqual([]);
  });
});

describe("deleting a tenant (TEST-2441)", () => {
  it("does not fail because of the audit, and takes the audit with it", async () => {
    const doomed = await insertTenant(db, { slug: "audit-doomed", name: "Doomed" });

    await db.query(
      `insert into public.products (tenant_id, name, slug, base_price_cents)
       values ($1, 'Temporal', 'temporal', 1000)`,
      [doomed],
    );
    expect(await countFor(doomed, "product.created")).toBe(1);

    // PostgreSQL removes the parent BEFORE cascading to children, so without
    // the writer's existence guard this DELETE would fail on the audit's own
    // foreign key - the audit becoming the reason a legitimate delete breaks.
    await db.query("delete from public.tenants where id = $1", [doomed]);

    const rows = await db.query<{ c: string }>(
      "select count(*)::text c from public.audit_logs where tenant_id = $1",
      [doomed],
    );
    expect(Number(rows[0]!.c)).toBe(0);
  });
});

describe("platform_diagnostics (TEST-2437, TEST-2438)", () => {
  it("returns nothing to somebody who is not a platform admin", async () => {
    const rows = await db.asUser(ownerA, () =>
      db.query("select * from public.platform_diagnostics()"),
    );
    expect(rows).toEqual([]);
  });

  it("returns nothing to an anonymous caller", async () => {
    const rows = await db.asUser(null, () =>
      db.query("select * from public.platform_diagnostics()"),
    );
    expect(rows).toEqual([]);
  });

  it("counts what it says it counts", async () => {
    const rows = await db.asUser(operator, () =>
      db.query<Record<string, string | null>>("select * from public.platform_diagnostics()"),
    );

    const row = rows[0]!;
    const tenantCount = await db.query<{ c: string }>(
      "select count(*)::text c from public.tenants",
    );
    const auditCount = await db.query<{ c: string }>(
      "select count(*)::text c from public.audit_logs",
    );

    expect(Number(row.tenants_total)).toBe(Number(tenantCount[0]!.c));
    expect(Number(row.audit_rows_total)).toBe(Number(auditCount[0]!.c));
    expect(Number(row.audit_rows_total)).toBeGreaterThan(0);
    expect(Number(row.tenants_suspended)).toBe(0);
  });
});
