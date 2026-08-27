import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, insertTenant, type TestDatabase } from "../helpers/database";
import { allTransitionPairs } from "@/modules/orders/lifecycle";

/**
 * Phase 13 at the database level.
 *
 * One test in this file matters more than the rest, and it is TEST-1307: change
 * a product's price after an order exists, and check the order does not move.
 *
 * That is master section 33's requirement, and its failure mode is silent. A
 * line that reads its price from `products` works perfectly until somebody
 * raises a price - and then every historical order reports a total that was
 * never charged. Nothing errors; the reports are simply wrong, retroactively.
 * A test that only checked "the total is right when I create it" would pass all
 * the way through that.
 */

let db: TestDatabase;

let tenantA: string;
let tenantB: string;

let ownerA: string;
let kitchenA: string;
let accountantA: string;
let ownerB: string;

let locationA: string;
let locationB: string;
let customerA: string;
let customerB: string;

let productA: string;
let productB: string;
let archivedProduct: string;

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

async function insertLocation(tenantId: string, name: string): Promise<string> {
  const rows = await db.query<{ id: string }>(
    "insert into public.locations (tenant_id, name) values ($1, $2) returning id",
    [tenantId, name],
  );
  return rows[0]!.id;
}

async function insertProduct(
  tenantId: string,
  slug: string,
  priceCents: number,
  status = "active",
): Promise<string> {
  const rows = await db.query<{ id: string }>(
    `insert into public.products (tenant_id, name, slug, base_price_cents, status)
     values ($1, $2, $2, $3, $4::public.product_status) returning id`,
    [tenantId, slug, priceCents, status],
  );
  return rows[0]!.id;
}

async function insertOrder(
  tenantId: string,
  locationId: string,
  options: { customerId?: string | null; source?: string } = {},
): Promise<string> {
  const rows = await db.query<{ id: string }>(
    `insert into public.orders (tenant_id, location_id, customer_id, source)
     values ($1, $2, $3, coalesce($4, 'manual')::public.order_source)
     returning id`,
    [tenantId, locationId, options.customerId ?? null, options.source ?? null],
  );
  return rows[0]!.id;
}

async function addItem(
  orderId: string,
  productId: string | null,
  quantity: number,
  options: { discount?: number; name?: string; price?: number } = {},
): Promise<string> {
  const rows = await db.query<{ id: string }>(
    `insert into public.order_items
       (order_id, tenant_id, product_id, quantity, discount_cents, name_snapshot, unit_price_cents)
     values ($1, '00000000-0000-0000-0000-000000000000', $2, $3, coalesce($4, 0),
             coalesce($5, 'placeholder'), coalesce($6, 0))
     returning id`,
    [
      orderId,
      productId,
      quantity,
      options.discount ?? null,
      options.name ?? null,
      options.price ?? null,
    ],
  );
  return rows[0]!.id;
}

async function orderTotals(
  orderId: string,
): Promise<{ subtotal: string; discount: string; total: string; number: number }> {
  const rows = await db.query<{
    subtotal_cents: string;
    discount_cents: string;
    total_cents: string;
    number: number;
  }>(
    `select subtotal_cents::text, discount_cents::text, total_cents::text, number
     from public.orders where id = $1`,
    [orderId],
  );
  const row = rows[0]!;
  return {
    subtotal: row.subtotal_cents,
    discount: row.discount_cents,
    total: row.total_cents,
    number: row.number,
  };
}

beforeAll(async () => {
  db = await createTestDatabase();

  tenantA = await insertTenant(db, { slug: "sugurolls", name: "Sugu Rolls" });
  tenantB = await insertTenant(db, { slug: "polleria-el-rey", name: "Pollería El Rey" });

  ownerA = await createUser("owner@sugurolls.com");
  kitchenA = await createUser("cocina@sugurolls.com");
  accountantA = await createUser("contador@sugurolls.com");
  ownerB = await createUser("owner@polleria.pe");

  await addMember(tenantA, ownerA, "owner");
  await addMember(tenantA, kitchenA, "kitchen");
  await addMember(tenantA, accountantA, "accountant");
  await addMember(tenantB, ownerB, "owner");

  locationA = await insertLocation(tenantA, "Miraflores");
  locationB = await insertLocation(tenantB, "Centro");

  const customerRows = await db.query<{ id: string }>(
    "insert into public.customers (tenant_id, name) values ($1, 'Ana Quispe') returning id",
    [tenantA],
  );
  customerA = customerRows[0]!.id;
  const customerRowsB = await db.query<{ id: string }>(
    "insert into public.customers (tenant_id, name) values ($1, 'Carlos Rojas') returning id",
    [tenantB],
  );
  customerB = customerRowsB[0]!.id;

  productA = await insertProduct(tenantA, "maki-acevichado", 2490);
  productB = await insertProduct(tenantB, "pollo-a-la-brasa", 4500);
  archivedProduct = await insertProduct(tenantA, "descontinuado", 1000, "archived");
});

afterAll(async () => {
  await db.close();
});

describe("the TypeScript mirror matches the SQL machine (TEST-1301)", () => {
  /*
   * The state machine is written twice: as rows in `order_transitions`, which
   * the trigger enforces, and as a map in `src/modules/orders/lifecycle.ts`,
   * which the dashboard reads to decide which buttons to draw.
   *
   * Two copies is a liability unless something compares them. Without this
   * test the failure is a button that exists for a transition the backend
   * refuses - the user clicks, nothing happens, and neither side looks wrong
   * on its own.
   */
  it("declares exactly the same pairs in both places (TEST-1301)", async () => {
    const rows = await db.query<{ from_status: string; to_status: string }>(
      "select from_status, to_status from public.order_transitions",
    );

    const fromSql = rows.map((r) => `${r.from_status}->${r.to_status}`).sort();
    const fromTs = allTransitionPairs()
      .map((pair) => `${pair.from}->${pair.to}`)
      .sort();

    expect(fromTs).toEqual(fromSql);
  });
});

describe("THE SNAPSHOT (TEST-1307, TEST-1308)", () => {
  /*
   * Master section 33, textual:
   *
   *   "Nunca depender del precio actual de products para calcular pedidos
   *    historicos."
   *
   * This is that sentence as an executable assertion.
   */
  it("does not move a historical order when the catalogue price changes (TEST-1307)", async () => {
    const order = await insertOrder(tenantA, locationA);
    await addItem(order, productA, 2);

    const before = await orderTotals(order);
    expect(before.subtotal).toBe("4980");
    expect(before.total).toBe("4980");

    // The restaurant raises its price by a sol.
    await db.query("update public.products set base_price_cents = 2590 where id = $1", [productA]);

    const after = await orderTotals(order);
    expect(after.subtotal).toBe("4980");
    expect(after.total).toBe("4980");

    const line = await db.query<{ unit_price_cents: string; name_snapshot: string }>(
      "select unit_price_cents::text, name_snapshot from public.order_items where order_id = $1",
      [order],
    );
    expect(line[0]?.unit_price_cents).toBe("2490");

    // Put it back for the tests that follow.
    await db.query("update public.products set base_price_cents = 2490 where id = $1", [productA]);
  });

  it("survives the product being deleted outright (TEST-1308)", async () => {
    const doomed = await insertProduct(tenantA, "efimero", 1500);
    const order = await insertOrder(tenantA, locationA);
    await addItem(order, doomed, 1);

    await db.query("delete from public.products where id = $1", [doomed]);

    const rows = await db.query<{
      name_snapshot: string;
      unit_price_cents: string;
      product_id: string | null;
    }>(
      "select name_snapshot, unit_price_cents::text, product_id from public.order_items where order_id = $1",
      [order],
    );
    expect(rows[0]?.name_snapshot).toBe("efimero");
    expect(rows[0]?.unit_price_cents).toBe("1500");
    // The pointer is gone; the line is not.
    expect(rows[0]?.product_id).toBeNull();
    expect((await orderTotals(order)).total).toBe("1500");
  });

  it("refuses to let an update rewrite the snapshot", async () => {
    const order = await insertOrder(tenantA, locationA);
    const item = await addItem(order, productA, 1);

    await db.query(
      "update public.order_items set unit_price_cents = 1, name_snapshot = 'Gratis' where id = $1",
      [item],
    );

    const rows = await db.query<{ unit_price_cents: string; name_snapshot: string }>(
      "select unit_price_cents::text, name_snapshot from public.order_items where id = $1",
      [item],
    );
    expect(rows[0]?.unit_price_cents).toBe("2490");
    expect(rows[0]?.name_snapshot).toBe("maki-acevichado");
  });

  it("takes the price from the variant when one is given", async () => {
    const variant = await db.query<{ id: string }>(
      `insert into public.product_variants (product_id, tenant_id, name, price_cents)
       values ($1, $2, 'Porcion doble', 3990) returning id`,
      [productA, tenantA],
    );
    const order = await insertOrder(tenantA, locationA);
    await db.query(
      `insert into public.order_items
         (order_id, tenant_id, product_id, variant_id, quantity, name_snapshot, unit_price_cents)
       values ($1, '00000000-0000-0000-0000-000000000000', $2, $3, 1, 'x', 0)`,
      [order, productA, variant[0]!.id],
    );

    const rows = await db.query<{ unit_price_cents: string; variant_snapshot: string }>(
      "select unit_price_cents::text, variant_snapshot from public.order_items where order_id = $1",
      [order],
    );
    expect(rows[0]?.unit_price_cents).toBe("3990");
    expect(rows[0]?.variant_snapshot).toBe("Porcion doble");
  });
});

describe("totals computed by the database (TEST-1309)", () => {
  it("recomputes on insert, update and delete (TEST-1309)", async () => {
    const order = await insertOrder(tenantA, locationA);

    const first = await addItem(order, productA, 1);
    expect((await orderTotals(order)).total).toBe("2490");

    const second = await addItem(order, productA, 2);
    expect((await orderTotals(order)).total).toBe("7470");

    await db.query("update public.order_items set quantity = 3 where id = $1", [second]);
    expect((await orderTotals(order)).total).toBe("9960");

    await db.query("delete from public.order_items where id = $1", [first]);
    expect((await orderTotals(order)).total).toBe("7470");
  });

  it("subtracts a discount and keeps it in its own column", async () => {
    const order = await insertOrder(tenantA, locationA);
    await addItem(order, productA, 2, { discount: 500 });

    const totals = await orderTotals(order);
    expect(totals.subtotal).toBe("4980");
    expect(totals.discount).toBe("500");
    expect(totals.total).toBe("4480");
  });

  it("adds shipping, which is the one amount the lines do not decide", async () => {
    const order = await insertOrder(tenantA, locationA);
    await db.query("update public.orders set shipping_cents = 800 where id = $1", [order]);
    await addItem(order, productA, 1);

    expect((await orderTotals(order)).total).toBe("3290");
  });

  it("rounds a fractional quantity to a whole cent (TEST-1304)", async () => {
    const byWeight = await insertProduct(tenantA, "torta-por-kilo", 3333);
    const order = await insertOrder(tenantA, locationA);
    await addItem(order, byWeight, 0.75);

    // 3333 * 0.75 = 2499.75 -> 2500
    expect((await orderTotals(order)).total).toBe("2500");
  });

  it("allows a discount that takes a line to zero, but not below", async () => {
    const order = await insertOrder(tenantA, locationA);
    await expect(addItem(order, productA, 1, { discount: 2490 })).resolves.toBeDefined();
    // Rejected by whichever CHECK PostgreSQL evaluates first: the line total
    // would be negative AND the discount exceeds the gross. Both are true.
    await expect(addItem(order, productA, 1, { discount: 2491 })).rejects.toThrow(
      /order_items_(discount_within_gross|amounts_range)/,
    );
  });

  /*
   * The case that proves `discount_within_gross` earns its place.
   *
   * With tax large enough to keep the total positive, `amounts_range` is
   * satisfied - so if the discount constraint did not exist, a line discounted
   * beyond its own value would be storable and the order would quietly
   * undercharge.
   */
  it("refuses a discount above the gross even when tax keeps the total positive", async () => {
    const order = await insertOrder(tenantA, locationA);
    await expect(
      db.query(
        `insert into public.order_items
           (order_id, tenant_id, product_id, quantity, discount_cents, tax_cents,
            name_snapshot, unit_price_cents)
         values ($1, '00000000-0000-0000-0000-000000000000', $2, 1, 2600, 500, 'x', 0)`,
        [order, productA],
      ),
    ).rejects.toThrow(/order_items_discount_within_gross/);
  });

  it("refuses a quantity of zero or less", async () => {
    const order = await insertOrder(tenantA, locationA);
    // A negative quantity also drives the line total negative, so the engine
    // may report either constraint; both are correct rejections.
    for (const quantity of [0, -1]) {
      await expect(addItem(order, productA, quantity)).rejects.toThrow(
        /order_items_(quantity_positive|amounts_range)/,
      );
    }
  });
});

describe("the per-tenant order number (TEST-1310, TEST-1311)", () => {
  it("counts from one within a tenant (TEST-1310)", async () => {
    const tenant = await insertTenant(db, { slug: "numeracion", name: "Numeración" });
    const location = await insertLocation(tenant, "Unica");

    const first = await insertOrder(tenant, location);
    const second = await insertOrder(tenant, location);

    expect((await orderTotals(first)).number).toBe(1);
    expect((await orderTotals(second)).number).toBe(2);
  });

  it("gives two different tenants their own number 1 (TEST-1311)", async () => {
    const t1 = await insertTenant(db, { slug: "uno", name: "Uno" });
    const t2 = await insertTenant(db, { slug: "dos", name: "Dos" });
    const l1 = await insertLocation(t1, "Sede");
    const l2 = await insertLocation(t2, "Sede");

    expect((await orderTotals(await insertOrder(t1, l1))).number).toBe(1);
    expect((await orderTotals(await insertOrder(t2, l2))).number).toBe(1);
  });

  it("refuses a duplicate number within a tenant", async () => {
    const tenant = await insertTenant(db, { slug: "choque", name: "Choque" });
    const location = await insertLocation(tenant, "Sede");
    await db.query(
      "insert into public.orders (tenant_id, location_id, number) values ($1, $2, 7)",
      [tenant, location],
    );
    await expect(
      db.query("insert into public.orders (tenant_id, location_id, number) values ($1, $2, 7)", [
        tenant,
        location,
      ]),
    ).rejects.toThrow(/orders_tenant_number_key/);
  });
});

describe("the state machine (TEST-1312 to TEST-1316)", () => {
  async function pendingOrderWithLine(): Promise<string> {
    const order = await insertOrder(tenantA, locationA);
    await addItem(order, productA, 1);
    return order;
  }

  async function setStatus(orderId: string, status: string, reason?: string): Promise<void> {
    await db.query(
      "update public.orders set status = $2::public.order_status, cancel_reason = $3 where id = $1",
      [orderId, status, reason ?? null],
    );
  }

  it("walks the happy path one step at a time", async () => {
    const order = await pendingOrderWithLine();
    for (const status of ["confirmed", "preparing", "ready", "completed"]) {
      await expect(setStatus(order, status)).resolves.not.toThrow();
    }

    const rows = await db.query<{ completed_at: string | null }>(
      "select completed_at from public.orders where id = $1",
      [order],
    );
    expect(rows[0]?.completed_at).not.toBeNull();
  });

  it("refuses a jump the machine does not declare (TEST-1312)", async () => {
    const order = await pendingOrderWithLine();
    await expect(setStatus(order, "ready")).rejects.toThrow(/cannot go from pending to ready/);
    await expect(setStatus(order, "completed")).rejects.toThrow(/cannot go from pending/);
  });

  it("does not let a completed order come back (TEST-1313)", async () => {
    const order = await pendingOrderWithLine();
    await setStatus(order, "confirmed");
    await setStatus(order, "preparing");
    await setStatus(order, "ready");
    await setStatus(order, "completed");

    await expect(setStatus(order, "pending")).rejects.toThrow(/cannot go from completed/);
    await expect(setStatus(order, "cancelled", "me arrepenti")).rejects.toThrow(
      /cannot go from completed/,
    );
  });

  it("does not let a cancelled order come back (TEST-1313)", async () => {
    const order = await pendingOrderWithLine();
    await setStatus(order, "cancelled", "el cliente se fue");
    await expect(setStatus(order, "confirmed")).rejects.toThrow(/cannot go from cancelled/);
  });

  it("declares completed and cancelled as terminal, by absence (TEST-1302)", async () => {
    const rows = await db.query<{ from_status: string }>(
      "select distinct from_status from public.order_transitions",
    );
    const origins = rows.map((r) => r.from_status);
    expect(origins).not.toContain("completed");
    expect(origins).not.toContain("cancelled");
  });

  it("cancels from anywhere that is not terminal", async () => {
    for (const upTo of [[], ["confirmed"], ["confirmed", "preparing"]]) {
      const order = await pendingOrderWithLine();
      for (const status of upTo) await setStatus(order, status);
      await expect(setStatus(order, "cancelled", "sin stock")).resolves.not.toThrow();
    }
  });

  it("requires a reason to cancel (TEST-1315)", async () => {
    const order = await pendingOrderWithLine();
    await expect(setStatus(order, "cancelled")).rejects.toThrow(/requires a reason/);
    await expect(setStatus(order, "cancelled", "   ")).rejects.toThrow(/requires a reason/);
  });

  it("does not let an empty order move forward (TEST-1316)", async () => {
    const empty = await insertOrder(tenantA, locationA);
    await expect(setStatus(empty, "confirmed")).rejects.toThrow(/no lines cannot move forward/);
    // But it can be cancelled: an order rung up by mistake has to go somewhere.
    await expect(setStatus(empty, "cancelled", "error de tipeo")).resolves.not.toThrow();
  });

  it("writes history on creation and on every change (TEST-1314)", async () => {
    const order = await pendingOrderWithLine();
    await setStatus(order, "confirmed");
    await setStatus(order, "cancelled", "el cliente cambio de idea");

    const rows = await db.query<{
      from_status: string | null;
      to_status: string;
      reason: string | null;
    }>(
      "select from_status, to_status, reason from public.order_status_history where order_id = $1 order by created_at",
      [order],
    );

    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ from_status: null, to_status: "pending" });
    expect(rows[1]).toMatchObject({ from_status: "pending", to_status: "confirmed" });
    expect(rows[2]).toMatchObject({
      from_status: "confirmed",
      to_status: "cancelled",
      reason: "el cliente cambio de idea",
    });
  });

  it("does not touch the lines once the order leaves pending (TEST-1321)", async () => {
    const order = await pendingOrderWithLine();
    const item = await db.query<{ id: string }>(
      "select id from public.order_items where order_id = $1",
      [order],
    );
    await setStatus(order, "confirmed");

    await expect(addItem(order, productA, 1)).rejects.toThrow(/no longer pending/);
    await expect(
      db.query("update public.order_items set quantity = 5 where id = $1", [item[0]!.id]),
    ).rejects.toThrow(/no longer pending/);
    await expect(
      db.query("delete from public.order_items where id = $1", [item[0]!.id]),
    ).rejects.toThrow(/no longer pending/);
  });
});

describe("cross-tenant guards (TEST-1317 to TEST-1320)", () => {
  it("refuses a product from another business (TEST-1317)", async () => {
    const order = await insertOrder(tenantA, locationA);
    await expect(addItem(order, productB, 1)).rejects.toThrow(/different business/);
  });

  it("refuses a location from another business (TEST-1318)", async () => {
    await expect(insertOrder(tenantA, locationB)).rejects.toThrow(
      /location belongs to a different/,
    );
  });

  it("refuses a customer from another business (TEST-1319)", async () => {
    await expect(insertOrder(tenantA, locationA, { customerId: customerB })).rejects.toThrow(
      /customer belongs to a different/,
    );
  });

  it("accepts its own customer", async () => {
    await expect(insertOrder(tenantA, locationA, { customerId: customerA })).resolves.toBeDefined();
  });

  it("refuses an archived product in a new order (TEST-1320)", async () => {
    const order = await insertOrder(tenantA, locationA);
    await expect(addItem(order, archivedProduct, 1)).rejects.toThrow(/archived/);
  });

  it("refuses an inactive location for a new order", async () => {
    const closed = await insertLocation(tenantA, "Cerrada");
    await db.query("update public.locations set is_active = false where id = $1", [closed]);
    await expect(insertOrder(tenantA, closed)).rejects.toThrow(/not active/);
  });

  it("derives the line's tenant from the order, ignoring what is sent", async () => {
    const order = await insertOrder(tenantA, locationA);
    const item = await addItem(order, productA, 1);
    const rows = await db.query<{ tenant_id: string }>(
      "select tenant_id from public.order_items where id = $1",
      [item],
    );
    expect(rows[0]?.tenant_id).toBe(tenantA);
  });
});

describe("row level security (TEST-1322 to TEST-1328)", () => {
  it("grants nothing to anon on any order table (TEST-1322)", async () => {
    const rows = await db.query<{ tablename: string; policyname: string; roles: string }>(
      `select tablename, policyname, roles::text as roles
       from pg_policies
       where schemaname = 'public'
         and tablename in ('orders', 'order_items', 'order_status_history',
                           'order_transitions')`,
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(
        row.roles.includes("anon"),
        `${row.tablename}.${row.policyname} grants anon: ${row.roles}`,
      ).toBe(false);
    }
  });

  it("has no DELETE policy on orders or on the history (TEST-1323)", async () => {
    const rows = await db.query<{ tablename: string }>(
      `select tablename from pg_policies
       where schemaname = 'public'
         and tablename in ('orders', 'order_status_history')
         and cmd = 'DELETE'`,
    );
    expect(rows).toHaveLength(0);
  });

  it("has no UPDATE policy on the history: an audit trail is append-only (TEST-1324)", async () => {
    const rows = await db.query<{ policyname: string }>(
      `select policyname from pg_policies
       where schemaname = 'public' and tablename = 'order_status_history' and cmd = 'UPDATE'`,
    );
    expect(rows).toHaveLength(0);
  });

  it("hides another business's orders (TEST-1325)", async () => {
    const mine = await insertOrder(tenantA, locationA);
    const theirs = await insertOrder(tenantB, locationB);

    const visible = await db.asUser(ownerA, async () =>
      db.query<{ id: string }>("select id from public.orders"),
    );
    const ids = visible.map((r) => r.id);
    expect(ids).toContain(mine);
    expect(ids).not.toContain(theirs);
  });

  it("lets kitchen move an order but not create one (TEST-1326)", async () => {
    const order = await insertOrder(tenantA, locationA);
    await addItem(order, productA, 1);

    const rows = await db.asUser(kitchenA, async () =>
      db.query<{ id: string }>(
        "update public.orders set status = 'confirmed' where id = $1 returning id",
        [order],
      ),
    );
    expect(rows).toHaveLength(1);

    await expect(
      db.asUser(kitchenA, async () =>
        db.query("insert into public.orders (tenant_id, location_id) values ($1, $2)", [
          tenantA,
          locationA,
        ]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("lets the accountant read and not write (TEST-1327)", async () => {
    const rows = await db.asUser(accountantA, async () => db.query("select id from public.orders"));
    expect(rows.length).toBeGreaterThan(0);

    await expect(
      db.asUser(accountantA, async () =>
        db.query("insert into public.orders (tenant_id, location_id) values ($1, $2)", [
          tenantA,
          locationA,
        ]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("makes the state machine readable and not writable (TEST-1328)", async () => {
    const rows = await db.asUser(ownerA, async () =>
      db.query("select from_status from public.order_transitions"),
    );
    expect(rows.length).toBe(8);

    await expect(
      db.asUser(ownerA, async () =>
        db.query(
          "insert into public.order_transitions (from_status, to_status) values ('completed', 'pending')",
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });
});
