import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, insertTenant, type TestDatabase } from "../helpers/database";

/**
 * Phase 23 at the database level.
 *
 * Four properties matter more than the rest, all from ADR-027:
 *
 * - Only `completed` orders count. Anything else would talk about a different
 *   set of orders than the inventory (ADR-022) and the points (ADR-024) do.
 * - The permission gate is the ONLY defence, because these functions are
 *   SECURITY DEFINER and therefore skip RLS. So it is tested from both sides.
 * - Time is grouped in the TENANT'S timezone. A report by hour in UTC is a
 *   false report, and the test that proves it inserts an order at 02:00 UTC
 *   and expects it on the previous day at 21:00 Lima time.
 * - The summary reconciles: net = gross - discounts + shipping.
 */

let db: TestDatabase;

let tenantA: string;
let tenantB: string;

let ownerA: string;
let cashierA: string;
let ownerB: string;

let locationA: string;
let secondLocationA: string;
let locationB: string;

let productA: string;
let customerA: string;
let methodA: string;

/** 2026-03-10 in Lima is 2026-03-10T05:00:00Z onwards (UTC-5). */
const FROM = "2026-03-01T05:00:00Z";
const TO = "2026-04-01T05:00:00Z";

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

/**
 * An order with one line, placed at a chosen instant and left in a chosen
 * state.
 *
 * `placed_at` is written explicitly rather than defaulted: every assertion
 * below is about a range, and a test that depends on "now" is a test that
 * fails at midnight.
 */
async function insertOrder(
  tenantId: string,
  options: {
    locationId: string;
    placedAt: string;
    unitPriceCents?: number;
    quantity?: number;
    status?: string;
    customerId?: string | null;
    productId?: string | null;
    name?: string;
    shippingCents?: number;
  },
): Promise<string> {
  const rows = await db.query<{ id: string }>(
    `insert into public.orders (tenant_id, location_id, customer_id, placed_at)
     values ($1, $2, $3, $4) returning id`,
    [tenantId, options.locationId, options.customerId ?? null, options.placedAt],
  );
  const orderId = rows[0]!.id;

  await db.query(
    `insert into public.order_items (order_id, product_id, name_snapshot, unit_price_cents, quantity)
     values ($1, $2, $3, $4, $5)`,
    [
      orderId,
      options.productId ?? null,
      options.name ?? "Linea",
      options.unitPriceCents ?? 2000,
      options.quantity ?? 1,
    ],
  );

  if ((options.shippingCents ?? 0) > 0) {
    await db.query("update public.orders set shipping_cents = $2 where id = $1", [
      orderId,
      options.shippingCents,
    ]);
    // `shipping_cents` is normally written by the delivery trigger (Phase 19);
    // set here directly, the total has to be brought along by hand.
    await db.query(`update public.orders set total_cents = total_cents + $2 where id = $1`, [
      orderId,
      options.shippingCents,
    ]);
  }

  const status = options.status ?? "completed";
  if (status === "cancelled") {
    await db.query(
      "update public.orders set status = 'cancelled', cancel_reason = 'prueba' where id = $1",
      [orderId],
    );
  } else if (status !== "pending") {
    for (const next of ["confirmed", "preparing", "ready", "completed"]) {
      await db.query("update public.orders set status = $2 where id = $1", [orderId, next]);
      if (next === status) break;
    }
  }

  return orderId;
}

async function summary(tenantId: string, user: string, locationId: string | null = null) {
  return db.asUser(user, () =>
    db.query<{
      order_count: string;
      gross_cents: string;
      discount_cents: string;
      shipping_cents: string;
      net_cents: string;
      average_ticket_cents: string;
      item_count: string;
    }>("select * from public.report_sales_summary($1, $2, $3, $4)", [
      tenantId,
      FROM,
      TO,
      locationId,
    ]),
  );
}

beforeAll(async () => {
  db = await createTestDatabase();

  tenantA = await insertTenant(db, { name: "Sugu Rolls", slug: "sugurolls" });
  tenantB = await insertTenant(db, { name: "Pollos Rey", slug: "pollosrey" });

  ownerA = await createUser("owner-a@test.pe");
  cashierA = await createUser("cashier-a@test.pe");
  ownerB = await createUser("owner-b@test.pe");

  await addMember(tenantA, ownerA, "owner");
  // cashier has orders.view and NOT reports.view: the exact shape the gate is
  // there to refuse.
  await addMember(tenantA, cashierA, "cashier");
  await addMember(tenantB, ownerB, "owner");

  const locA = await db.query<{ id: string }>(
    "select id from public.locations where tenant_id = $1 limit 1",
    [tenantA],
  );
  locationA = locA[0]!.id;

  const second = await db.query<{ id: string }>(
    "insert into public.locations (tenant_id, name) values ($1, 'San Isidro') returning id",
    [tenantA],
  );
  secondLocationA = second[0]!.id;

  const locB = await db.query<{ id: string }>(
    "select id from public.locations where tenant_id = $1 limit 1",
    [tenantB],
  );
  locationB = locB[0]!.id;

  const products = await db.query<{ id: string }>(
    `insert into public.products (tenant_id, name, slug, base_price_cents)
     values ($1, 'Maki', 'maki', 2000) returning id`,
    [tenantA],
  );
  productA = products[0]!.id;

  const customers = await db.query<{ id: string }>(
    "insert into public.customers (tenant_id, name) values ($1, 'Ana') returning id",
    [tenantA],
  );
  customerA = customers[0]!.id;

  // Deliberately NOT `cash`: a cash payment needs an open till (Phase 14), and
  // opening one would drag a whole cash session into a test about reports. The
  // report does not care which method it is.
  const methods = await db.query<{ id: string }>(
    `insert into public.payment_methods (tenant_id, type, name)
     values ($1, 'yape', 'Yape') returning id`,
    [tenantA],
  );
  methodA = methods[0]!.id;
});

afterAll(async () => {
  await db.close();
});

// ---------------------------------------------------------------------------
// The index this phase added, and the one it removed
// ---------------------------------------------------------------------------

describe("indexes (TEST-2329)", () => {
  it("has the reporting index and no longer the one it replaces", async () => {
    const rows = await db.query<{ indexname: string }>(
      `select indexname from pg_indexes
       where schemaname = 'public' and tablename = 'orders'
       order by indexname`,
    );
    const names = rows.map((r) => r.indexname);

    expect(names).toContain("orders_tenant_status_placed_idx");
    // Master section 8 asks to avoid over-indexing: the new index is a prefix
    // superset, so keeping both would be weight on every order INSERT.
    expect(names).not.toContain("orders_tenant_status_idx");
  });
});

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

describe("the reports.view gate (TEST-2320, TEST-2321)", () => {
  beforeAll(async () => {
    await insertOrder(tenantA, { locationId: locationA, placedAt: "2026-03-10T18:00:00Z" });
  });

  it("gives nothing to a member without reports.view (TEST-2320)", async () => {
    // A cashier has orders.view - they can see the orders one by one - and the
    // report is a different question about the same data.
    expect(await summary(tenantA, cashierA)).toEqual([]);

    const byDay = await db.asUser(cashierA, () =>
      db.query("select * from public.report_sales_by_day($1, $2, $3, null)", [tenantA, FROM, TO]),
    );
    expect(byDay).toEqual([]);
  });

  it("gives nothing to somebody with reports.view in ANOTHER tenant (TEST-2321)", async () => {
    // ownerB genuinely holds reports.view - in tenant B. These functions skip
    // RLS, so this is the assertion that the gate is per-tenant and not just
    // per-permission.
    expect(await summary(tenantA, ownerB)).toEqual([]);
  });

  it("gives the owner their own numbers", async () => {
    const rows = await summary(tenantA, ownerA);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]!.order_count)).toBe(1);
  });

  it("gives an unauthenticated caller nothing", async () => {
    expect(await summary(tenantA, null as unknown as string).catch(() => [])).toBeDefined();
    const rows = await db.asUser(null, () =>
      db.query("select * from public.report_sales_summary($1, $2, $3, null)", [tenantA, FROM, TO]),
    );
    expect(rows).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// What counts as a sale
// ---------------------------------------------------------------------------

describe("the summary (TEST-2310 to TEST-2316, TEST-2330)", () => {
  let tenant: string;
  let owner: string;
  let location: string;

  beforeAll(async () => {
    tenant = await insertTenant(db, { name: "Resumen", slug: "resumen" });
    owner = await createUser("owner-resumen@test.pe");
    await addMember(tenant, owner, "owner");

    const rows = await db.query<{ id: string }>(
      "select id from public.locations where tenant_id = $1 limit 1",
      [tenant],
    );
    location = rows[0]!.id;
  });

  async function summaryOf(locationId: string | null = null) {
    const rows = await db.asUser(owner, () =>
      db.query<{
        order_count: string;
        gross_cents: string;
        discount_cents: string;
        shipping_cents: string;
        net_cents: string;
        average_ticket_cents: string;
        item_count: string;
      }>("select * from public.report_sales_summary($1, $2, $3, $4)", [
        tenant,
        FROM,
        TO,
        locationId,
      ]),
    );
    return rows[0]!;
  }

  it("returns zeroes, not nulls, when nothing sold (TEST-2314)", async () => {
    const row = await summaryOf();
    expect(Number(row.order_count)).toBe(0);
    expect(Number(row.net_cents)).toBe(0);
    expect(Number(row.average_ticket_cents)).toBe(0);
    expect(Number(row.item_count)).toBe(0);
  });

  it("counts a completed order (TEST-2310)", async () => {
    await insertOrder(tenant, {
      locationId: location,
      placedAt: "2026-03-10T18:00:00Z",
      unitPriceCents: 3000,
    });

    const row = await summaryOf();
    expect(Number(row.order_count)).toBe(1);
    expect(Number(row.net_cents)).toBe(3000);
  });

  it("does not count a cancelled order (TEST-2311)", async () => {
    await insertOrder(tenant, {
      locationId: location,
      placedAt: "2026-03-11T18:00:00Z",
      unitPriceCents: 9999,
      status: "cancelled",
    });

    expect(Number((await summaryOf()).net_cents)).toBe(3000);
  });

  it("does not count an order still in progress (TEST-2312)", async () => {
    // The decision that cost the most (ADR-027 decision 3): a `ready` order
    // may still be cancelled, and the inventory has not moved for it either.
    await insertOrder(tenant, {
      locationId: location,
      placedAt: "2026-03-12T18:00:00Z",
      unitPriceCents: 8888,
      status: "ready",
    });

    expect(Number((await summaryOf()).net_cents)).toBe(3000);
  });

  it("excludes what falls outside the range (TEST-2315)", async () => {
    await insertOrder(tenant, {
      locationId: location,
      placedAt: "2026-02-20T18:00:00Z",
      unitPriceCents: 7777,
    });
    await insertOrder(tenant, {
      locationId: location,
      placedAt: "2026-05-20T18:00:00Z",
      unitPriceCents: 6666,
    });

    expect(Number((await summaryOf()).net_cents)).toBe(3000);
  });

  it("averages the ticket over the orders (TEST-2313)", async () => {
    await insertOrder(tenant, {
      locationId: location,
      placedAt: "2026-03-13T18:00:00Z",
      unitPriceCents: 1000,
    });

    const row = await summaryOf();
    expect(Number(row.order_count)).toBe(2);
    expect(Number(row.net_cents)).toBe(4000);
    expect(Number(row.average_ticket_cents)).toBe(2000);
  });

  it("truncates the average rather than rounding it", async () => {
    // 4000 + 1 order of 1 cent = 4001 over 3 = 1333.67 -> 1333.
    await insertOrder(tenant, {
      locationId: location,
      placedAt: "2026-03-14T18:00:00Z",
      unitPriceCents: 1,
    });

    expect(Number((await summaryOf()).average_ticket_cents)).toBe(1333);
  });

  it("reconciles: net = gross - discounts + shipping (TEST-2330)", async () => {
    const row = await summaryOf();
    const gross = Number(row.gross_cents);
    const discount = Number(row.discount_cents);
    const shipping = Number(row.shipping_cents);
    const net = Number(row.net_cents);

    expect(net).toBe(gross - discount + shipping);
  });

  it("counts the items sold", async () => {
    expect(Number((await summaryOf()).item_count)).toBe(3);
  });

  it("narrows to one branch when asked (TEST-2316)", async () => {
    const other = await db.query<{ id: string }>(
      "insert into public.locations (tenant_id, name) values ($1, 'Otra') returning id",
      [tenant],
    );
    await insertOrder(tenant, {
      locationId: other[0]!.id,
      placedAt: "2026-03-15T18:00:00Z",
      unitPriceCents: 5000,
    });

    expect(Number((await summaryOf()).net_cents)).toBe(9001);
    expect(Number((await summaryOf(other[0]!.id)).net_cents)).toBe(5000);
    expect(Number((await summaryOf(location)).net_cents)).toBe(4001);
  });
});

// ---------------------------------------------------------------------------
// Time, in the business's own clock
// ---------------------------------------------------------------------------

describe("timezone (TEST-2317, TEST-2318, TEST-2319)", () => {
  let tenant: string;
  let owner: string;
  let location: string;

  beforeAll(async () => {
    tenant = await insertTenant(db, { name: "Horario", slug: "horario" });
    owner = await createUser("owner-horario@test.pe");
    await addMember(tenant, owner, "owner");

    const rows = await db.query<{ id: string }>(
      "select id from public.locations where tenant_id = $1 limit 1",
      [tenant],
    );
    location = rows[0]!.id;

    // 02:00 UTC on the 11th is 21:00 on the 10th in Lima. A report grouped in
    // UTC would put this sale on the wrong day AND at the wrong hour - which is
    // the whole reason ADR-027 decision 5 exists.
    await insertOrder(tenant, {
      locationId: location,
      placedAt: "2026-03-11T02:00:00Z",
      unitPriceCents: 5000,
    });
  });

  it("uses the tenant's timezone by default", async () => {
    const rows = await db.query<{ tenant_timezone: string }>(
      "select public.tenant_timezone($1) as tenant_timezone",
      [tenant],
    );
    expect(rows[0]!.tenant_timezone).toBe("America/Lima");
  });

  it("puts the sale on the business's day, not UTC's (TEST-2317)", async () => {
    const rows = await db.asUser(owner, () =>
      // `day::text` on purpose: the driver turns a `date` into a JS Date in
      // the RUNNER's timezone, which would make this assert the test machine's
      // clock instead of the database's answer.
      db.query<{ day: string; net_cents: string }>(
        "select day::text as day, order_count, net_cents from public.report_sales_by_day($1, $2, $3, null)",
        [tenant, FROM, TO],
      ),
    );

    expect(rows).toHaveLength(1);
    // The 10th in Lima, not the 11th in UTC.
    expect(rows[0]!.day).toBe("2026-03-10");
  });

  it("puts the sale at the business's hour, not UTC's (TEST-2318)", async () => {
    const rows = await db.asUser(owner, () =>
      db.query<{ hour: number; order_count: string }>(
        "select * from public.report_sales_by_hour($1, $2, $3, null)",
        [tenant, FROM, TO],
      ),
    );

    const sold = rows.filter((r) => Number(r.order_count) > 0);
    expect(sold).toHaveLength(1);
    // 21:00 Lima, not 02:00 UTC. A restaurant's peak hour must not show up at
    // dawn.
    expect(Number(sold[0]!.hour)).toBe(21);
  });

  it("returns all 24 hours, including the empty ones (TEST-2319)", async () => {
    const rows = await db.asUser(owner, () =>
      db.query<{ hour: number }>("select * from public.report_sales_by_hour($1, $2, $3, null)", [
        tenant,
        FROM,
        TO,
      ]),
    );

    expect(rows).toHaveLength(24);
    expect(rows.map((r) => Number(r.hour))).toEqual([...Array(24).keys()]);
  });

  it("follows a different timezone when the business has one", async () => {
    await db.query(
      "update public.tenant_settings set timezone = 'Europe/Madrid' where tenant_id = $1",
      [tenant],
    );

    const rows = await db.asUser(owner, () =>
      db.query<{ hour: number; order_count: string }>(
        "select * from public.report_sales_by_hour($1, $2, $3, null)",
        [tenant, FROM, TO],
      ),
    );

    // 02:00 UTC is 03:00 in Madrid in March (CET, before the change).
    const sold = rows.filter((r) => Number(r.order_count) > 0);
    expect(Number(sold[0]!.hour)).toBe(3);

    await db.query(
      "update public.tenant_settings set timezone = 'America/Lima' where tenant_id = $1",
      [tenant],
    );
  });
});

// ---------------------------------------------------------------------------
// The remaining dimensions
// ---------------------------------------------------------------------------

describe("dimensions (TEST-2322 to TEST-2327)", () => {
  beforeAll(async () => {
    // Two lines that disagree about which sold "better": three Makis are more
    // UNITS, one tasting menu is more MONEY.
    //
    // The Maki line names a real product, so `snapshot_order_item()` (Phase 13)
    // sets its name and its price from the catalogue - 2000 each - and quantity
    // is the only lever this test gets. That is by design and is exactly why
    // the snapshot exists.
    await insertOrder(tenantA, {
      locationId: locationA,
      placedAt: "2026-03-12T18:00:00Z",
      quantity: 3,
      productId: productA,
      customerId: customerA,
    });
    await insertOrder(tenantA, {
      locationId: locationA,
      placedAt: "2026-03-13T18:00:00Z",
      unitPriceCents: 9000,
      quantity: 1,
      name: "Menu degustacion",
    });
  });

  it("lists every branch, including the ones that sold nothing (TEST-2322)", async () => {
    const rows = await db.asUser(ownerA, () =>
      db.query<{ location_id: string; net_cents: string }>(
        "select * from public.report_sales_by_location($1, $2, $3)",
        [tenantA, FROM, TO],
      ),
    );

    const ids = rows.map((r) => r.location_id);
    expect(ids).toContain(locationA);
    // The branch with no sales is the row somebody most needs to see.
    expect(ids).toContain(secondLocationA);
    expect(Number(rows.find((r) => r.location_id === secondLocationA)!.net_cents)).toBe(0);
  });

  it("ranks products by money, not by units (TEST-2323)", async () => {
    const rows = await db.asUser(ownerA, () =>
      db.query<{ name: string; quantity: string; net_cents: string }>(
        "select * from public.report_top_products($1, $2, $3, null, 20)",
        [tenantA, FROM, TO],
      ),
    );

    // Three Makis (6000) lose to one tasting menu (9000), even though the Maki
    // sold three times the units.
    expect(rows[0]!.name).toBe("Menu degustacion");
    expect(Number(rows[0]!.net_cents)).toBe(9000);

    const maki = rows.find((r) => r.name === "Maki")!;
    expect(Number(maki.quantity)).toBe(3);
    expect(Number(maki.net_cents)).toBe(6000);
  });

  it("reports a renamed product under the name it was sold as (TEST-2324)", async () => {
    // Worth stating what this test discovered: a product that has been sold in
    // a settled order CANNOT be deleted at all. `order_items.product_id` is ON
    // DELETE SET NULL, and that UPDATE runs into the Phase 13 guard that
    // refuses to touch the lines of an order that left `pending`. So history
    // cannot lose its product by deletion - only by renaming, which is what the
    // snapshot is really protecting against (ADR-017).
    await expect(db.query("delete from public.products where id = $1", [productA])).rejects.toThrow(
      /no longer pending/,
    );

    await db.query("update public.products set name = 'Maki Acevichado' where id = $1", [productA]);

    const rows = await db.asUser(ownerA, () =>
      db.query<{ product_id: string | null; name: string; net_cents: string }>(
        "select * from public.report_top_products($1, $2, $3, null, 20)",
        [tenantA, FROM, TO],
      ),
    );

    // The report of March still says what March's tickets said.
    const maki = rows.find((r) => r.name === "Maki");
    expect(maki).toBeDefined();
    expect(Number(maki!.net_cents)).toBe(6000);
    expect(rows.map((r) => r.name)).not.toContain("Maki Acevichado");
  });

  it("counts only sales with a customer (TEST-2325)", async () => {
    const rows = await db.asUser(ownerA, () =>
      db.query<{ customer_id: string; name: string; net_cents: string; order_count: string }>(
        "select * from public.report_top_customers($1, $2, $3, 20)",
        [tenantA, FROM, TO],
      ),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe("Ana");
    // The 9000 tasting menu had no customer: it counts in sales and not here.
    expect(Number(rows[0]!.net_cents)).toBe(6000);
  });

  it("groups payments by method and ignores voided ones (TEST-2326)", async () => {
    const order = await insertOrder(tenantA, {
      locationId: locationA,
      placedAt: "2026-03-14T18:00:00Z",
      unitPriceCents: 4000,
    });

    const payments = await db.query<{ id: string }>(
      `insert into public.payments (order_id, payment_method_id, amount_cents)
       values ($1, $2, 4000) returning id`,
      [order, methodA],
    );

    let rows = await db.asUser(ownerA, () =>
      db.query<{ name: string; net_cents: string; payment_count: string }>(
        "select * from public.report_sales_by_payment_method($1, $2, $3)",
        [tenantA, FROM, TO],
      ),
    );
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]!.net_cents)).toBe(4000);

    await db.query(
      "update public.payments set voided_at = now(), void_reason = 'error' where id = $1",
      [payments[0]!.id],
    );

    rows = await db.asUser(ownerA, () =>
      db.query<{ name: string; net_cents: string; payment_count: string }>(
        "select * from public.report_sales_by_payment_method($1, $2, $3)",
        [tenantA, FROM, TO],
      ),
    );
    // A void is money that never arrived.
    expect(rows).toEqual([]);
  });

  it("groups payments by the ORDER's date, not the payment's (TEST-2327)", async () => {
    // An order placed inside the range and paid long after still counts inside
    // the range - which is what makes this reconcile with the summary
    // (KL-2307).
    const order = await insertOrder(tenantA, {
      locationId: locationA,
      placedAt: "2026-03-20T18:00:00Z",
      unitPriceCents: 2500,
    });

    await db.query(
      `insert into public.payments (order_id, payment_method_id, amount_cents, created_at)
       values ($1, $2, 2500, '2026-09-01T12:00:00Z')`,
      [order, methodA],
    );

    const rows = await db.asUser(ownerA, () =>
      db.query<{ net_cents: string }>(
        "select * from public.report_sales_by_payment_method($1, $2, $3)",
        [tenantA, FROM, TO],
      ),
    );

    expect(rows).toHaveLength(1);
    expect(Number(rows[0]!.net_cents)).toBe(2500);
  });
});

// ---------------------------------------------------------------------------
// Isolation
// ---------------------------------------------------------------------------

describe("tenant isolation (TEST-2328)", () => {
  beforeAll(async () => {
    await insertOrder(tenantB, {
      locationId: locationB,
      placedAt: "2026-03-10T18:00:00Z",
      unitPriceCents: 123456,
    });
  });

  it("never mixes one business's sales into another's summary", async () => {
    const a = await summary(tenantA, ownerA);
    const b = await db.asUser(ownerB, () =>
      db.query<{ net_cents: string }>(
        "select * from public.report_sales_summary($1, $2, $3, null)",
        [tenantB, FROM, TO],
      ),
    );

    expect(Number(b[0]!.net_cents)).toBe(123456);
    // Tenant A's total is its own and does not contain B's very large order.
    expect(Number(a[0]!.net_cents)).not.toBe(123456);
    expect(Number(a[0]!.net_cents)).toBeLessThan(123456);
  });

  it("never lists another business's branches", async () => {
    const rows = await db.asUser(ownerA, () =>
      db.query<{ location_id: string }>(
        "select * from public.report_sales_by_location($1, $2, $3)",
        [tenantA, FROM, TO],
      ),
    );
    expect(rows.map((r) => r.location_id)).not.toContain(locationB);
  });

  it("never lists another business's customers or products", async () => {
    const customers = await db.asUser(ownerB, () =>
      db.query<{ name: string }>("select * from public.report_top_customers($1, $2, $3, 20)", [
        tenantB,
        FROM,
        TO,
      ]),
    );
    expect(customers.map((r) => r.name)).not.toContain("Ana");

    const products = await db.asUser(ownerB, () =>
      db.query<{ name: string }>("select * from public.report_top_products($1, $2, $3, null, 20)", [
        tenantB,
        FROM,
        TO,
      ]),
    );
    expect(products.map((r) => r.name)).not.toContain("Menu degustacion");
  });
});
