import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestDatabase,
  insertAuthUser,
  insertTenant,
  type TestDatabase,
} from "../helpers/database";

/**
 * Phase 31 at the database level (ADR-034).
 *
 * - Only a platform admin configures a gateway; the tenant's own owner cannot.
 * - The secret is readable by `service_role` alone.
 * - The website offers online payment only with the module AND an enabled
 *   gateway.
 * - A payment is recorded only by `record_online_payment` (service_role),
 *   idempotently, and capped at what the order owes.
 */

/**
 * Just enough of Supabase Vault for the functions to run.
 *
 * The real Vault encrypts; this stores plain text. What is under test is who may
 * CALL the functions that touch it, which the shim does not change.
 */
const VAULT_SHIM = `
  create schema if not exists vault;
  create table vault.secrets (
    id uuid primary key default gen_random_uuid(),
    secret text not null,
    name text,
    description text
  );
  create view vault.decrypted_secrets as
    select id, name, description, secret as decrypted_secret from vault.secrets;
  create function vault.create_secret(new_secret text, new_name text default null, new_description text default '')
  returns uuid language sql as $$
    insert into vault.secrets (secret, name, description) values (new_secret, new_name, new_description) returning id;
  $$;
  create function vault.update_secret(secret_id uuid, new_secret text)
  returns void language sql as $$
    update vault.secrets set secret = new_secret where id = secret_id;
  $$;
`;

let db: TestDatabase;
let tenant: string;
let starter: string;
let operator: string;
let owner: string;
let maki: string;

const CREDENTIALS = JSON.stringify({ accessToken: "APP_USR-secreto" });

async function configure(asUserId: string, tenantId: string, enabled = true) {
  return db.asUser(asUserId, () =>
    db.query(`select public.set_payment_gateway($1, 'mercadopago', 'test', null, $2, $3)`, [
      tenantId,
      CREDENTIALS,
      enabled,
    ]),
  );
}

async function placeOrder(tenantId: string, extra: Record<string, unknown>) {
  return db.asRole("anon", () =>
    db.query<{ order_id: string; access_token: string; total_cents: string }>(
      "select * from public.place_web_order($1, $2::jsonb)",
      [
        tenantId,
        JSON.stringify({
          contact: { name: "Rosa", phone: "999888777" },
          fulfillment: "pickup",
          items: [{ productId: maki, quantity: 2 }],
          ...extra,
        }),
      ],
    ),
  );
}

async function refusal(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

beforeAll(async () => {
  db = await createTestDatabase();
  await db.exec(VAULT_SHIM);

  tenant = await insertTenant(db, { slug: "pagos-online" });
  starter = await insertTenant(db, { slug: "pagos-starter" });
  await db.query("update public.subscriptions set plan_code = 'starter' where tenant_id = $1", [
    starter,
  ]);
  await db.query("update public.tenant_storefronts set mode = 'open' where tenant_id in ($1, $2)", [
    tenant,
    starter,
  ]);

  operator = await insertAuthUser(db, { email: "operador@clovercode.test" });
  owner = await insertAuthUser(db, { email: "duena@pagos.test" });
  await db.query("insert into public.platform_admins (user_id) values ($1)", [operator]);
  await db.query(
    "insert into public.tenant_members (tenant_id, user_id, role) values ($1, $2, 'owner')",
    [tenant, owner],
  );

  const product = await db.query<{ id: string }>(
    `insert into public.products (tenant_id, name, slug, base_price_cents, status)
     values ($1, 'Maki', 'maki', 2500, 'active') returning id`,
    [tenant],
  );
  maki = product[0]!.id;
});

afterAll(async () => {
  await db.close();
});

describe("the module and the plans", () => {
  it("is part of Professional and Enterprise, not Starter", async () => {
    const rows = await db.query<{ plan_code: string }>(
      "select plan_code from public.plan_modules where module_code = 'online_payments' order by plan_code",
    );
    expect(rows.map((row) => row.plan_code)).toEqual(["enterprise", "professional"]);
  });
});

describe("configuring a gateway", () => {
  it("refuses the business's own owner", async () => {
    expect(await refusal(configure(owner, tenant))).toMatch(/platform admin/);
  });

  it("lets a platform admin configure it, creating the payment method it records under", async () => {
    await configure(operator, tenant);

    const methods = await db.query<{ name: string; type: string; show_on_website: boolean }>(
      "select name, type, show_on_website from public.payment_methods where tenant_id = $1",
      [tenant],
    );
    expect(methods).toEqual([
      { name: "Pago online - Mercado Pago", type: "card", show_on_website: false },
    ]);

    // Configuring again does not duplicate the method.
    await configure(operator, tenant);
    const again = await db.query("select 1 from public.payment_methods where tenant_id = $1", [
      tenant,
    ]);
    expect(again).toHaveLength(1);
  });

  it("reveals the secret to service_role and to nobody else", async () => {
    const service = await db.asRole("service_role", () =>
      db.query<{ credentials: string; provider: string }>(
        "select provider, credentials from public.get_payment_gateway_credentials($1)",
        [tenant],
      ),
    );
    expect(service).toEqual([{ provider: "mercadopago", credentials: CREDENTIALS }]);

    expect(
      await refusal(
        db.asUser(operator, () =>
          db.query("select * from public.get_payment_gateway_credentials($1)", [tenant]),
        ),
      ),
    ).toMatch(/permission denied/);
    expect(
      await refusal(
        db.asRole("anon", () =>
          db.query("select * from public.get_payment_gateway_credentials($1)", [tenant]),
        ),
      ),
    ).toMatch(/permission denied/);
  });

  it("refuses switching provider without that provider's credentials", async () => {
    expect(
      await refusal(
        db.asUser(operator, () =>
          db.query(
            `select public.set_payment_gateway($1, 'culqi', 'test', 'pk_test_12345678', null, true)`,
            [tenant],
          ),
        ),
      ),
    ).toMatch(/Switching provider/);
  });
});

describe("offering it on the website", () => {
  it("is available with the module and an enabled gateway only", async () => {
    const available = (tenantId: string) =>
      db.asRole("anon", () =>
        db.query<{ ok: boolean }>("select public.online_payments_available($1) as ok", [tenantId]),
      );

    expect((await available(tenant))[0]!.ok).toBe(true);

    await configure(operator, starter);
    expect((await available(starter))[0]!.ok).toBe(false);

    await configure(operator, tenant, false);
    expect((await available(tenant))[0]!.ok).toBe(false);
    await configure(operator, tenant, true);
  });

  it("places an order to be paid online, and refuses where it is not available", async () => {
    const placed = await placeOrder(tenant, { payOnline: true });
    const web = await db.query<{ pay_online: boolean; online_payment_status: string }>(
      "select pay_online, online_payment_status from public.web_orders where order_id = $1",
      [placed[0]!.order_id],
    );
    expect(web[0]).toEqual({ pay_online: true, online_payment_status: "pending" });

    expect(await refusal(placeOrder(starter, { payOnline: true }))).toBe(
      "ONLINE_PAYMENT_UNAVAILABLE",
    );
    // With online payment on offer, choosing nothing at all is not a choice.
    expect(await refusal(placeOrder(tenant, {}))).toBe("INVALID_PAYMENT_METHOD");
  });
});

describe("recording what the provider confirmed", () => {
  it("records an approval once, capped at the balance, and only for service_role", async () => {
    const placed = await placeOrder(tenant, { payOnline: true });
    const orderId = placed[0]!.order_id;

    expect(
      await refusal(
        db.asRole("anon", () =>
          db.query("select public.record_online_payment($1, $2, 'mp:1', 5000, true)", [
            tenant,
            orderId,
          ]),
        ),
      ),
    ).toMatch(/permission denied/);

    const record = (reference: string, amount: number) =>
      db.asRole("service_role", () =>
        db.query<{ result: string }>(
          "select public.record_online_payment($1, $2, $3, $4, true) as result",
          [tenant, orderId, reference, amount],
        ),
      );

    expect((await record("mp:123", 9999))[0]!.result).toBe("recorded");
    expect((await record("mp:123", 9999))[0]!.result).toBe("already_recorded");

    const order = await db.query<{ paid_cents: string; total_cents: string }>(
      "select paid_cents, total_cents from public.orders where id = $1",
      [orderId],
    );
    expect(order[0]!.paid_cents).toBe(order[0]!.total_cents);

    const payments = await db.query("select 1 from public.payments where order_id = $1", [orderId]);
    expect(payments).toHaveLength(1);

    const tracking = await db.asRole("anon", () =>
      db.query<{ pay_online: boolean; online_payment_status: string }>(
        "select pay_online, online_payment_status from public.get_public_web_order($1, $2)",
        [tenant, placed[0]!.access_token],
      ),
    );
    expect(tracking[0]).toEqual({ pay_online: true, online_payment_status: "approved" });
  });

  it("records a rejection without a payment, and ignores an order of another business", async () => {
    const placed = await placeOrder(tenant, { payOnline: true });
    const orderId = placed[0]!.order_id;

    const rejected = await db.asRole("service_role", () =>
      db.query<{ result: string }>(
        "select public.record_online_payment($1, $2, 'mp:9', 5000, false) as result",
        [tenant, orderId],
      ),
    );
    expect(rejected[0]!.result).toBe("rejected");

    const elsewhere = await db.asRole("service_role", () =>
      db.query<{ result: string }>(
        "select public.record_online_payment($1, $2, 'mp:9', 5000, true) as result",
        [starter, orderId],
      ),
    );
    expect(elsewhere[0]!.result).toBe("unknown_order");

    const forPayment = await db.asRole("anon", () =>
      db.query<{ balance_cents: number; online_payment_status: string }>(
        "select balance_cents, online_payment_status from public.get_web_order_for_payment($1, $2)",
        [tenant, placed[0]!.access_token],
      ),
    );
    expect(forPayment[0]).toEqual({ balance_cents: 5000, online_payment_status: "rejected" });
  });
});
