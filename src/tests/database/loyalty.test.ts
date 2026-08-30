import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, insertTenant, type TestDatabase } from "../helpers/database";

/**
 * Phase 20 at the database level.
 *
 * Four invariants matter more than the rest, all from ADR-024:
 *
 * - A discount is a POSTING. `orders.promotion_discount_cents` is the sum of
 *   `order_promotions`, and the three functions that compute `total_cents`
 *   (Phase 13, Phase 19, and this one) all subtract it identically.
 * - The points ledger is append-only: no UPDATE policy, no DELETE policy, and
 *   `points_balance` is exactly its sum, recomputed from zero in TEST-2030.
 * - Completing an order credits points once, and only once.
 * - Redeeming is atomic: the ledger entry and the discount both happen, or
 *   neither does.
 */

let db: TestDatabase;

let tenantA: string;
let tenantB: string;

let ownerA: string;
let cashierA: string;
let kitchenA: string;
let ownerB: string;

let locationA: string;

let customerA: string;
let customerB: string;

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

async function insertPromotion(
  tenantId: string,
  name: string,
  overrides: {
    type?: string;
    percentOff?: number | null;
    amountOffCents?: number | null;
    minOrderCents?: number;
    startsAt?: string | null;
    endsAt?: string | null;
    maxRedemptions?: number | null;
  } = {},
): Promise<string> {
  const type = overrides.type ?? "percentage";
  const rows = await db.query<{ id: string }>(
    `insert into public.promotions
       (tenant_id, name, type, percent_off, amount_off_cents, min_order_cents,
        starts_at, ends_at, max_redemptions)
     values ($1, $2, $3::public.promotion_type, $4, $5, $6, $7, $8, $9) returning id`,
    [
      tenantId,
      name,
      type,
      "percentOff" in overrides ? overrides.percentOff : type === "percentage" ? 10 : null,
      "amountOffCents" in overrides
        ? overrides.amountOffCents
        : type === "fixed_amount"
          ? 500
          : null,
      overrides.minOrderCents ?? 0,
      overrides.startsAt ?? null,
      overrides.endsAt ?? null,
      overrides.maxRedemptions ?? null,
    ],
  );
  return rows[0]!.id;
}

/** An order with one line, so it can legally move past `pending`. */
async function insertOrder(
  tenantId: string,
  locationId: string,
  unitPriceCents = 2000,
  customerId: string | null = null,
): Promise<string> {
  const rows = await db.query<{ id: string }>(
    "insert into public.orders (tenant_id, location_id, customer_id) values ($1, $2, $3) returning id",
    [tenantId, locationId, customerId],
  );
  const orderId = rows[0]!.id;

  // Deliberately no product_id: snapshot_order_item() (Phase 13) takes the
  // price FROM the product when there is one, so naming a product here would
  // silently ignore `unitPriceCents` and make every arithmetic assertion below
  // about a number this helper did not choose.
  await db.query(
    `insert into public.order_items (order_id, name_snapshot, unit_price_cents, quantity)
     values ($1, 'Linea', $2, 1)`,
    [orderId, unitPriceCents],
  );

  return orderId;
}

async function applyPromotion(
  orderId: string,
  promotionId: string,
  discountCents: number,
  label = "Promo",
): Promise<string> {
  const rows = await db.query<{ id: string }>(
    `insert into public.order_promotions
       (order_id, promotion_id, source, label_snapshot, discount_cents)
     values ($1, $2, 'promotion', $3, $4) returning id`,
    [orderId, promotionId, label, discountCents],
  );
  return rows[0]!.id;
}

async function orderTotals(
  orderId: string,
): Promise<{ discount: number; shipping: number; total: number }> {
  const rows = await db.query<{
    promotion_discount_cents: string;
    shipping_cents: string;
    total_cents: string;
  }>(
    "select promotion_discount_cents, shipping_cents, total_cents from public.orders where id = $1",
    [orderId],
  );
  return {
    discount: Number(rows[0]!.promotion_discount_cents),
    shipping: Number(rows[0]!.shipping_cents),
    total: Number(rows[0]!.total_cents),
  };
}

async function enableProgramme(tenantId: string, pointsPerSol = 1): Promise<void> {
  await db.query(
    `update public.tenant_settings
     set loyalty_enabled = true, loyalty_points_per_sol = $2
     where tenant_id = $1`,
    [tenantId, pointsPerSol],
  );
}

async function accountFor(customerId: string): Promise<{ id: string; balance: number } | null> {
  const rows = await db.query<{ id: string; points_balance: number }>(
    "select id, points_balance from public.loyalty_accounts where customer_id = $1",
    [customerId],
  );
  const row = rows[0];
  return row === undefined ? null : { id: row.id, balance: row.points_balance };
}

async function insertCustomer(tenantId: string, name: string): Promise<string> {
  const rows = await db.query<{ id: string }>(
    "insert into public.customers (tenant_id, name) values ($1, $2) returning id",
    [tenantId, name],
  );
  return rows[0]!.id;
}

beforeAll(async () => {
  db = await createTestDatabase();

  tenantA = await insertTenant(db, { name: "Sugu Rolls", slug: "sugurolls" });
  tenantB = await insertTenant(db, { name: "Pollos Rey", slug: "pollosrey" });

  ownerA = await createUser("owner-a@test.pe");
  cashierA = await createUser("cashier-a@test.pe");
  kitchenA = await createUser("kitchen-a@test.pe");
  ownerB = await createUser("owner-b@test.pe");

  await addMember(tenantA, ownerA, "owner");
  await addMember(tenantA, cashierA, "cashier");
  await addMember(tenantA, kitchenA, "kitchen");
  await addMember(tenantB, ownerB, "owner");

  const locA = await db.query<{ id: string }>(
    "select id from public.locations where tenant_id = $1 limit 1",
    [tenantA],
  );
  locationA = locA[0]!.id;

  customerA = await insertCustomer(tenantA, "Ana");
  customerB = await insertCustomer(tenantB, "Beto");
});

afterAll(async () => {
  await db.close();
});

// ---------------------------------------------------------------------------
// Schema posture
// ---------------------------------------------------------------------------

describe("schema posture (TEST-2010, TEST-2011)", () => {
  it("has row level security on every table of this phase", async () => {
    const rows = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `select relname, relrowsecurity from pg_class
       where relname in ('promotions','coupons','order_promotions',
                         'loyalty_accounts','loyalty_transactions')`,
    );
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => r.relrowsecurity)).toBe(true);
  });

  it("grants nothing to anon on any of the new tables (TEST-2011)", async () => {
    const rows = await db.query<{ tablename: string }>(
      `select tablename from pg_policies
       where schemaname = 'public' and tablename = any($1) and 'anon' = any(roles)`,
      [["promotions", "coupons", "order_promotions", "loyalty_accounts", "loyalty_transactions"]],
    );
    expect(rows).toEqual([]);
  });

  it("never lets anybody change a ledger entry (TEST-2033)", async () => {
    const rows = await db.query<{ cmd: string }>(
      `select cmd from pg_policies
       where schemaname = 'public' and tablename = 'loyalty_transactions'
       order by cmd`,
    );
    expect(rows.map((r) => r.cmd).sort()).toEqual(["INSERT", "SELECT"]);
  });

  it("has no UPDATE policy on order_promotions", async () => {
    const rows = await db.query<{ cmd: string }>(
      `select cmd from pg_policies
       where schemaname = 'public' and tablename = 'order_promotions' and cmd = 'UPDATE'`,
    );
    expect(rows).toEqual([]);
  });

  it("has no DELETE policy on loyalty_accounts", async () => {
    const rows = await db.query<{ cmd: string }>(
      `select cmd from pg_policies
       where schemaname = 'public' and tablename = 'loyalty_accounts' and cmd = 'DELETE'`,
    );
    expect(rows).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Promotions and coupons
// ---------------------------------------------------------------------------

describe("promotions and coupons", () => {
  it("refuses two promotions with the same name in one tenant (TEST-2013)", async () => {
    await insertPromotion(tenantA, "Verano");
    await expect(insertPromotion(tenantA, "VERANO")).rejects.toThrow();
  });

  it("accepts the same name in another tenant (TEST-2013)", async () => {
    await expect(insertPromotion(tenantB, "Verano")).resolves.toBeTruthy();
  });

  it("refuses a percentage with no percent, and an amount on it (TEST-2016)", async () => {
    await expect(
      insertPromotion(tenantA, "Sin porcentaje", { type: "percentage", percentOff: null }),
    ).rejects.toThrow();

    await expect(
      db.query(
        `insert into public.promotions (tenant_id, name, type, percent_off, amount_off_cents)
         values ($1, 'Mixta', 'percentage', 10, 500)`,
        [tenantA],
      ),
    ).rejects.toThrow();
  });

  it("refuses a fixed amount with no amount (TEST-2016)", async () => {
    await expect(
      insertPromotion(tenantA, "Sin monto", { type: "fixed_amount", amountOffCents: null }),
    ).rejects.toThrow();
  });

  it("accepts free_delivery with neither value", async () => {
    await expect(
      insertPromotion(tenantA, "Envio libre", {
        type: "free_delivery",
        percentOff: null,
        amountOffCents: null,
      }),
    ).resolves.toBeTruthy();
  });

  it("refuses a window that ends before it starts (TEST-2017)", async () => {
    await expect(
      insertPromotion(tenantA, "Ventana rota", {
        startsAt: "2026-09-10T00:00:00Z",
        endsAt: "2026-09-01T00:00:00Z",
      }),
    ).rejects.toThrow();
  });

  it("refuses a percentage outside 1..100", async () => {
    await expect(insertPromotion(tenantA, "Cero", { percentOff: 0 })).rejects.toThrow();
    await expect(insertPromotion(tenantA, "Ciento uno", { percentOff: 101 })).rejects.toThrow();
  });

  it("derives coupons.tenant_id from the promotion (TEST-2015)", async () => {
    const promotion = await insertPromotion(tenantA, "Con cupon");
    const rows = await db.query<{ tenant_id: string }>(
      `insert into public.coupons (tenant_id, promotion_id, code)
       values ($1, $2, 'ABC123') returning tenant_id`,
      [tenantB, promotion],
    );
    expect(rows[0]!.tenant_id).toBe(tenantA);
  });

  it("refuses two coupons with the same code, ignoring case (TEST-2014)", async () => {
    const promotion = await insertPromotion(tenantA, "Codigos");
    await db.query("insert into public.coupons (promotion_id, code) values ($1, 'VERANO')", [
      promotion,
    ]);
    await expect(
      db.query("insert into public.coupons (promotion_id, code) values ($1, 'verano')", [
        promotion,
      ]),
    ).rejects.toThrow();
  });

  it("refuses a code with a space in it", async () => {
    const promotion = await insertPromotion(tenantA, "Codigo raro");
    await expect(
      db.query("insert into public.coupons (promotion_id, code) values ($1, 'CON ESPACIO')", [
        promotion,
      ]),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Applying a discount
// ---------------------------------------------------------------------------

describe("applying a discount", () => {
  it("writes promotion_discount_cents and recomputes total_cents (TEST-2018)", async () => {
    const promotion = await insertPromotion(tenantA, "Aplica");
    const order = await insertOrder(tenantA, locationA, 2000);

    expect(await orderTotals(order)).toEqual({ discount: 0, shipping: 0, total: 2000 });

    await applyPromotion(order, promotion, 200);

    expect(await orderTotals(order)).toEqual({ discount: 200, shipping: 0, total: 1800 });
  });

  it("gives the total back when the discount is removed (TEST-2019)", async () => {
    const promotion = await insertPromotion(tenantA, "Se retira");
    const order = await insertOrder(tenantA, locationA, 2000);
    const posting = await applyPromotion(order, promotion, 200);

    await db.query("delete from public.order_promotions where id = $1", [posting]);

    expect(await orderTotals(order)).toEqual({ discount: 0, shipping: 0, total: 2000 });
  });

  it("refuses the same promotion twice on one order (TEST-2020)", async () => {
    const promotion = await insertPromotion(tenantA, "Una vez");
    const order = await insertOrder(tenantA, locationA, 2000);
    await applyPromotion(order, promotion, 100);

    await expect(applyPromotion(order, promotion, 100)).rejects.toThrow();
  });

  it("refuses a promotion that ran out of redemptions (TEST-2021)", async () => {
    const promotion = await insertPromotion(tenantA, "Agotable", { maxRedemptions: 1 });
    const first = await insertOrder(tenantA, locationA, 2000);
    await applyPromotion(first, promotion, 100);

    const second = await insertOrder(tenantA, locationA, 2000);
    await expect(applyPromotion(second, promotion, 100)).rejects.toThrow(/no redemptions left/);
  });

  it("refuses a promotion that has not started, and one that ended (TEST-2022)", async () => {
    const future = await insertPromotion(tenantA, "Futura", {
      startsAt: "2099-01-01T00:00:00Z",
    });
    const past = await insertPromotion(tenantA, "Pasada", { endsAt: "2020-01-01T00:00:00Z" });

    const order = await insertOrder(tenantA, locationA, 2000);
    await expect(applyPromotion(order, future, 100)).rejects.toThrow(/not started/);
    await expect(applyPromotion(order, past, 100)).rejects.toThrow(/has ended/);
  });

  it("refuses an inactive promotion", async () => {
    const promotion = await insertPromotion(tenantA, "Apagada");
    await db.query("update public.promotions set is_active = false where id = $1", [promotion]);

    const order = await insertOrder(tenantA, locationA, 2000);
    await expect(applyPromotion(order, promotion, 100)).rejects.toThrow(/not active/);
  });

  it("refuses an order below the minimum (TEST-2023)", async () => {
    const promotion = await insertPromotion(tenantA, "Minimo alto", { minOrderCents: 5000 });
    const order = await insertOrder(tenantA, locationA, 2000);

    await expect(applyPromotion(order, promotion, 100)).rejects.toThrow(/minimum/);
  });

  it("refuses a promotion from another business (TEST-2024)", async () => {
    const foreign = await insertPromotion(tenantB, "Ajena");
    const order = await insertOrder(tenantA, locationA, 2000);

    await expect(applyPromotion(order, foreign, 100)).rejects.toThrow(/different business/);
  });

  it("refuses a discount larger than the order (TEST-2025)", async () => {
    const promotion = await insertPromotion(tenantA, "Excesiva");
    const order = await insertOrder(tenantA, locationA, 2000);

    await expect(applyPromotion(order, promotion, 2001)).rejects.toThrow(/larger than the order/);
  });

  it("counts discounts together against the order (TEST-2025)", async () => {
    const first = await insertPromotion(tenantA, "Suma uno");
    const second = await insertPromotion(tenantA, "Suma dos");
    const order = await insertOrder(tenantA, locationA, 2000);

    await applyPromotion(order, first, 1500);
    await expect(applyPromotion(order, second, 600)).rejects.toThrow(/larger than the order/);
  });

  it("allows a discount equal to the order, leaving zero", async () => {
    const promotion = await insertPromotion(tenantA, "Todo gratis");
    const order = await insertOrder(tenantA, locationA, 2000);

    await applyPromotion(order, promotion, 2000);
    expect((await orderTotals(order)).total).toBe(0);
  });

  it("refuses a discount on an order that left pending (TEST-2026)", async () => {
    const promotion = await insertPromotion(tenantA, "Tarde");
    const order = await insertOrder(tenantA, locationA, 2000);
    await db.query("update public.orders set status = 'confirmed' where id = $1", [order]);

    await expect(applyPromotion(order, promotion, 100)).rejects.toThrow(/no longer pending/);
  });

  it("refuses to remove a discount once the order left pending (TEST-2026)", async () => {
    const promotion = await insertPromotion(tenantA, "No se quita");
    const order = await insertOrder(tenantA, locationA, 2000);
    const posting = await applyPromotion(order, promotion, 100);
    await db.query("update public.orders set status = 'confirmed' where id = $1", [order]);

    await expect(
      db.query("delete from public.order_promotions where id = $1", [posting]),
    ).rejects.toThrow(/no longer pending/);
  });

  it("counts redemptions up and back down (TEST-2027)", async () => {
    const promotion = await insertPromotion(tenantA, "Contador");
    const order = await insertOrder(tenantA, locationA, 2000);

    const posting = await applyPromotion(order, promotion, 100);

    let rows = await db.query<{ times_redeemed: number }>(
      "select times_redeemed from public.promotions where id = $1",
      [promotion],
    );
    expect(rows[0]!.times_redeemed).toBe(1);

    await db.query("delete from public.order_promotions where id = $1", [posting]);

    rows = await db.query<{ times_redeemed: number }>(
      "select times_redeemed from public.promotions where id = $1",
      [promotion],
    );
    expect(rows[0]!.times_redeemed).toBe(0);
  });

  it("refuses a coupon that does not belong to the promotion it is applied with", async () => {
    const promotionOne = await insertPromotion(tenantA, "Cupon uno");
    const promotionTwo = await insertPromotion(tenantA, "Cupon dos");
    const coupons = await db.query<{ id: string }>(
      "insert into public.coupons (promotion_id, code) values ($1, 'CRUZADO') returning id",
      [promotionOne],
    );
    const order = await insertOrder(tenantA, locationA, 2000);

    await expect(
      db.query(
        `insert into public.order_promotions
           (order_id, promotion_id, coupon_id, source, label_snapshot, discount_cents)
         values ($1, $2, $3, 'coupon', 'Cruzado', 100)`,
        [order, promotionTwo, coupons[0]!.id],
      ),
    ).rejects.toThrow(/does not belong to that promotion/);
  });

  it("refuses an expired coupon", async () => {
    const promotion = await insertPromotion(tenantA, "Cupon caduco");
    const coupons = await db.query<{ id: string }>(
      `insert into public.coupons (promotion_id, code, expires_at)
       values ($1, 'CADUCO', '2020-01-01T00:00:00Z') returning id`,
      [promotion],
    );
    const order = await insertOrder(tenantA, locationA, 2000);

    await expect(
      db.query(
        `insert into public.order_promotions
           (order_id, promotion_id, coupon_id, source, label_snapshot, discount_cents)
         values ($1, $2, $3, 'coupon', 'Caduco', 100)`,
        [order, promotion, coupons[0]!.id],
      ),
    ).rejects.toThrow(/expired/);
  });
});

// ---------------------------------------------------------------------------
// The three total writers agree
// ---------------------------------------------------------------------------

describe("totals (TEST-2028)", () => {
  it("combines lines, shipping and a discount on one order", async () => {
    const promotion = await insertPromotion(tenantA, "Combinada");
    const order = await insertOrder(tenantA, locationA, 2000);

    // A delivery, which is the Phase 19 writer.
    const zones = await db.query<{ id: string }>(
      "insert into public.delivery_zones (tenant_id, name) values ($1, 'Zona total') returning id",
      [tenantA],
    );
    await db.query(
      `insert into public.order_deliveries
         (order_id, zone_id, zone_name_snapshot, fee_cents, address_line)
       values ($1, $2, 'Zona total', 800, 'Av. Larco 1')`,
      [order, zones[0]!.id],
    );

    expect(await orderTotals(order)).toEqual({ discount: 0, shipping: 800, total: 2800 });

    // The Phase 20 writer.
    await applyPromotion(order, promotion, 200);
    expect(await orderTotals(order)).toEqual({ discount: 200, shipping: 800, total: 2600 });

    // The Phase 13 writer: another line. All three formulas have to agree.
    await db.query(
      `insert into public.order_items (order_id, name_snapshot, unit_price_cents, quantity)
       values ($1, 'Otra', 1000, 1)`,
      [order],
    );
    expect(await orderTotals(order)).toEqual({ discount: 200, shipping: 800, total: 3600 });

    // And the Phase 19 writer again: the fee changes.
    await db.query("update public.order_deliveries set fee_cents = 500 where order_id = $1", [
      order,
    ]);
    expect(await orderTotals(order)).toEqual({ discount: 200, shipping: 500, total: 3300 });
  });

  it("never lets the total go negative when lines are removed after a discount", async () => {
    const promotion = await insertPromotion(tenantA, "Clamp");
    const order = await insertOrder(tenantA, locationA, 2000);
    await applyPromotion(order, promotion, 2000);

    await db.query("delete from public.order_items where order_id = $1", [order]);

    expect((await orderTotals(order)).total).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Points
// ---------------------------------------------------------------------------

describe("points ledger", () => {
  it("refuses a movement of zero points (TEST-2034)", async () => {
    const customer = await insertCustomer(tenantA, "Cero");
    const accounts = await db.query<{ id: string }>(
      "insert into public.loyalty_accounts (customer_id) values ($1) returning id",
      [customer],
    );
    await expect(
      db.query(
        `insert into public.loyalty_transactions (account_id, type, points, reason)
         values ($1, 'adjustment', 0, 'nada')`,
        [accounts[0]!.id],
      ),
    ).rejects.toThrow();
  });

  it("refuses an earn that subtracts and a redeem that adds (TEST-2035)", async () => {
    const customer = await insertCustomer(tenantA, "Signos");
    const accounts = await db.query<{ id: string }>(
      "insert into public.loyalty_accounts (customer_id) values ($1) returning id",
      [customer],
    );
    const account = accounts[0]!.id;

    await expect(
      db.query(
        "insert into public.loyalty_transactions (account_id, type, points) values ($1, 'earn', -5)",
        [account],
      ),
    ).rejects.toThrow();

    await expect(
      db.query(
        "insert into public.loyalty_transactions (account_id, type, points) values ($1, 'redeem', 5)",
        [account],
      ),
    ).rejects.toThrow();
  });

  it("requires a reason on a manual movement", async () => {
    const customer = await insertCustomer(tenantA, "Sin motivo");
    const accounts = await db.query<{ id: string }>(
      "insert into public.loyalty_accounts (customer_id) values ($1) returning id",
      [customer],
    );
    await expect(
      db.query(
        `insert into public.loyalty_transactions (account_id, type, points)
         values ($1, 'campaign', 10)`,
        [accounts[0]!.id],
      ),
    ).rejects.toThrow();
  });

  it("never lets a balance go negative (TEST-2036)", async () => {
    const customer = await insertCustomer(tenantA, "Sobregiro");
    const accounts = await db.query<{ id: string }>(
      "insert into public.loyalty_accounts (customer_id) values ($1) returning id",
      [customer],
    );
    await expect(
      db.query(
        `insert into public.loyalty_transactions (account_id, type, points, reason)
         values ($1, 'adjustment', -10, 'de mas')`,
        [accounts[0]!.id],
      ),
    ).rejects.toThrow();
  });

  it("refuses a second account for one customer (TEST-2039)", async () => {
    const customer = await insertCustomer(tenantA, "Duplicado");
    await db.query("insert into public.loyalty_accounts (customer_id) values ($1)", [customer]);
    await expect(
      db.query("insert into public.loyalty_accounts (customer_id) values ($1)", [customer]),
    ).rejects.toThrow();
  });

  it("keeps the balance exactly equal to the ledger (TEST-2030)", async () => {
    const customer = await insertCustomer(tenantA, "Reconciliado");
    const accounts = await db.query<{ id: string }>(
      "insert into public.loyalty_accounts (customer_id) values ($1) returning id",
      [customer],
    );
    const account = accounts[0]!.id;

    for (const [type, points, reason] of [
      ["campaign", 100, "bienvenida"],
      ["adjustment", 25, "correccion"],
      ["adjustment", -40, "correccion"],
      ["campaign", 15, "aniversario"],
    ] as const) {
      await db.query(
        `insert into public.loyalty_transactions (account_id, type, points, reason)
         values ($1, $2::public.loyalty_transaction_type, $3, $4)`,
        [account, type, points, reason],
      );
    }

    // Recomputed from zero, not read from the column - the whole point.
    const rows = await db.query<{ balance: number; ledger: string }>(
      `select a.points_balance as balance,
              coalesce((select sum(t.points) from public.loyalty_transactions as t
                        where t.account_id = a.id), 0) as ledger
       from public.loyalty_accounts as a where a.id = $1`,
      [account],
    );
    expect(rows[0]!.balance).toBe(100);
    expect(Number(rows[0]!.ledger)).toBe(rows[0]!.balance);
  });
});

// ---------------------------------------------------------------------------
// Earning
// ---------------------------------------------------------------------------

describe("earning on completion", () => {
  async function completeOrder(orderId: string): Promise<void> {
    for (const status of ["confirmed", "preparing", "ready", "completed"]) {
      await db.query("update public.orders set status = $2 where id = $1", [orderId, status]);
    }
  }

  it("credits points once, and enrols the customer (TEST-2029)", async () => {
    await enableProgramme(tenantA, 1);
    const customer = await insertCustomer(tenantA, "Acumula");
    const order = await insertOrder(tenantA, locationA, 2490, customer);

    expect(await accountFor(customer)).toBeNull();

    await completeOrder(order);

    // Truncating: S/ 24.90 at one point per sol is 24, not 25.
    expect(await accountFor(customer)).toEqual({ id: expect.any(String), balance: 24 });

    const rows = await db.query<{ count: string }>(
      "select count(*) as count from public.loyalty_transactions where order_id = $1 and type = 'earn'",
      [order],
    );
    expect(Number(rows[0]!.count)).toBe(1);
  });

  it("refuses a second earn for the same order (TEST-2029)", async () => {
    await enableProgramme(tenantA, 1);
    const customer = await insertCustomer(tenantA, "Idempotente");
    const order = await insertOrder(tenantA, locationA, 3000, customer);
    await completeOrder(order);

    const account = await accountFor(customer);
    await expect(
      db.query(
        `insert into public.loyalty_transactions (account_id, type, points, order_id)
         values ($1, 'earn', 30, $2)`,
        [account!.id, order],
      ),
    ).rejects.toThrow();
  });

  it("credits nothing for an order with no customer (TEST-2031)", async () => {
    await enableProgramme(tenantA, 1);
    const order = await insertOrder(tenantA, locationA, 5000, null);
    await completeOrder(order);

    const rows = await db.query<{ count: string }>(
      "select count(*) as count from public.loyalty_transactions where order_id = $1",
      [order],
    );
    expect(Number(rows[0]!.count)).toBe(0);
  });

  it("credits nothing when the programme is off (TEST-2032)", async () => {
    await db.query(
      "update public.tenant_settings set loyalty_enabled = false where tenant_id = $1",
      [tenantA],
    );
    const customer = await insertCustomer(tenantA, "Apagado");
    const order = await insertOrder(tenantA, locationA, 5000, customer);
    await completeOrder(order);

    expect(await accountFor(customer)).toBeNull();
    await enableProgramme(tenantA, 1);
  });

  it("credits nothing when a cancelled order never reaches completed", async () => {
    await enableProgramme(tenantA, 1);
    const customer = await insertCustomer(tenantA, "Anulado");
    const order = await insertOrder(tenantA, locationA, 5000, customer);
    await db.query(
      "update public.orders set status = 'cancelled', cancel_reason = 'no vino' where id = $1",
      [order],
    );

    expect(await accountFor(customer)).toBeNull();
  });

  it("earns on goods, not on the delivery fee", async () => {
    await enableProgramme(tenantA, 1);
    const customer = await insertCustomer(tenantA, "Sin envio");
    const order = await insertOrder(tenantA, locationA, 2000, customer);

    const zones = await db.query<{ id: string }>(
      "insert into public.delivery_zones (tenant_id, name) values ($1, 'Zona puntos') returning id",
      [tenantA],
    );
    await db.query(
      `insert into public.order_deliveries
         (order_id, zone_id, zone_name_snapshot, fee_cents, address_line)
       values ($1, $2, 'Zona puntos', 900, 'Av. Larco 2')`,
      [order, zones[0]!.id],
    );

    await completeOrder(order);

    // 20 soles of goods, not 29 with the delivery.
    expect((await accountFor(customer))!.balance).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// Redeeming
// ---------------------------------------------------------------------------

describe("redeem_loyalty_points (TEST-2037, TEST-2038)", () => {
  async function seedAccount(name: string, points: number): Promise<string> {
    const customer = await insertCustomer(tenantA, name);
    const accounts = await db.query<{ id: string }>(
      "insert into public.loyalty_accounts (customer_id) values ($1) returning id",
      [customer],
    );
    await db.query(
      `insert into public.loyalty_transactions (account_id, type, points, reason)
       values ($1, 'campaign', $2, 'saldo inicial')`,
      [accounts[0]!.id, points],
    );
    return accounts[0]!.id;
  }

  it("writes the ledger entry and the discount together (TEST-2037)", async () => {
    const account = await seedAccount("Canjea", 100);
    const order = await insertOrder(tenantA, locationA, 2000);

    await db.asUser(ownerA, async () => {
      await db.query("select public.redeem_loyalty_points($1, $2, 50)", [order, account]);
    });

    // 50 points at the default 10 cents each.
    expect(await orderTotals(order)).toEqual({ discount: 500, shipping: 0, total: 1500 });

    const rows = await db.query<{ points: number }>(
      "select points from public.loyalty_transactions where account_id = $1 and type = 'redeem'",
      [account],
    );
    expect(rows[0]!.points).toBe(-50);

    const balance = await db.query<{ points_balance: number }>(
      "select points_balance from public.loyalty_accounts where id = $1",
      [account],
    );
    expect(balance[0]!.points_balance).toBe(50);
  });

  it("writes nothing at all when the balance is short (TEST-2038)", async () => {
    const account = await seedAccount("Sin saldo", 10);
    const order = await insertOrder(tenantA, locationA, 2000);

    await expect(
      db.asUser(ownerA, () =>
        db.query("select public.redeem_loyalty_points($1, $2, 50)", [order, account]),
      ),
    ).rejects.toThrow(/not have enough points/);

    expect(await orderTotals(order)).toEqual({ discount: 0, shipping: 0, total: 2000 });

    const rows = await db.query<{ count: string }>(
      "select count(*) as count from public.loyalty_transactions where account_id = $1 and type = 'redeem'",
      [account],
    );
    expect(Number(rows[0]!.count)).toBe(0);
  });

  it("rolls the ledger entry back when the discount is refused", async () => {
    // The entire reason this is one function: the points are debited first, so
    // a refusal on the posting must undo them.
    const account = await seedAccount("Rollback", 100000);
    const order = await insertOrder(tenantA, locationA, 2000);

    await expect(
      db.asUser(ownerA, () =>
        db.query("select public.redeem_loyalty_points($1, $2, 1000)", [order, account]),
      ),
    ).rejects.toThrow(/larger than the order/);

    const balance = await db.query<{ points_balance: number }>(
      "select points_balance from public.loyalty_accounts where id = $1",
      [account],
    );
    expect(balance[0]!.points_balance).toBe(100000);
    expect((await orderTotals(order)).discount).toBe(0);
  });

  it("refuses an account from another business", async () => {
    const foreignCustomer = await insertCustomer(tenantB, "Ajeno");
    const foreignAccounts = await db.query<{ id: string }>(
      "insert into public.loyalty_accounts (customer_id) values ($1) returning id",
      [foreignCustomer],
    );
    const order = await insertOrder(tenantA, locationA, 2000);

    await expect(
      db.asUser(ownerA, () =>
        db.query("select public.redeem_loyalty_points($1, $2, 5)", [order, foreignAccounts[0]!.id]),
      ),
    ).rejects.toThrow(/different business/);
  });

  it("refuses a caller without loyalty.manage", async () => {
    const account = await seedAccount("Sin permiso", 100);
    const order = await insertOrder(tenantA, locationA, 2000);

    await expect(
      db.asUser(kitchenA, () =>
        db.query("select public.redeem_loyalty_points($1, $2, 5)", [order, account]),
      ),
    ).rejects.toThrow(/Not allowed/);
  });

  it("refuses zero or negative points", async () => {
    const account = await seedAccount("Cero puntos", 100);
    const order = await insertOrder(tenantA, locationA, 2000);

    await expect(
      db.asUser(ownerA, () =>
        db.query("select public.redeem_loyalty_points($1, $2, 0)", [order, account]),
      ),
    ).rejects.toThrow(/positive number/);
  });
});

// ---------------------------------------------------------------------------
// Isolation and authorization
// ---------------------------------------------------------------------------

describe("tenant isolation (TEST-2012)", () => {
  let promotionA: string;
  let accountA: string;

  beforeAll(async () => {
    promotionA = await insertPromotion(tenantA, "Aislada");
    const accounts = await db.query<{ id: string }>(
      "insert into public.loyalty_accounts (customer_id) values ($1) returning id",
      [customerA],
    );
    accountA = accounts[0]!.id;
  });

  it("does not let tenant B read tenant A's promotions", async () => {
    const rows = await db.asUser(ownerB, () =>
      db.query("select id from public.promotions where id = $1", [promotionA]),
    );
    expect(rows).toEqual([]);
  });

  it("does not let tenant B read tenant A's loyalty accounts", async () => {
    const rows = await db.asUser(ownerB, () =>
      db.query("select id from public.loyalty_accounts where id = $1", [accountA]),
    );
    expect(rows).toEqual([]);
  });

  it("does not let tenant B write tenant A's promotions", async () => {
    const rows = await db.asUser(ownerB, () =>
      db.query("update public.promotions set name = 'Robada' where id = $1 returning id", [
        promotionA,
      ]),
    );
    expect(rows).toEqual([]);
  });

  it("lets tenant A's owner read its own promotion", async () => {
    const rows = await db.asUser(ownerA, () =>
      db.query("select id from public.promotions where id = $1", [promotionA]),
    );
    expect(rows).toHaveLength(1);
  });

  it("gives an unauthenticated caller nothing", async () => {
    const rows = await db.asUser(null, () => db.query("select id from public.promotions"));
    expect(rows).toEqual([]);
  });

  it("keeps customerB out of tenant A's accounts", async () => {
    const rows = await db.query<{ tenant_id: string }>(
      "insert into public.loyalty_accounts (customer_id) values ($1) returning tenant_id",
      [customerB],
    );
    expect(rows[0]!.tenant_id).toBe(tenantB);
  });
});

describe("permissions (TEST-2040, TEST-2041)", () => {
  it("gives the cashier both halves: it is the checkout", async () => {
    const rows = await db.query<{ permission: string }>(
      `select permission from public.role_permissions
       where role = 'cashier'
         and (permission like 'promotions.%' or permission like 'loyalty.%')
       order by permission`,
    );
    expect(rows.map((r) => r.permission)).toEqual([
      "loyalty.manage",
      "loyalty.view",
      "promotions.manage",
      "promotions.view",
    ]);
  });

  it("lets the waiter read but never write", async () => {
    const rows = await db.query<{ permission: string }>(
      `select permission from public.role_permissions
       where role = 'waiter'
         and (permission like 'promotions.%' or permission like 'loyalty.%')
       order by permission`,
    );
    expect(rows.map((r) => r.permission)).toEqual(["loyalty.view", "promotions.view"]);
  });

  it("gives kitchen and delivery nothing from this phase (TEST-2041)", async () => {
    const rows = await db.query<{ role: string }>(
      `select role from public.role_permissions
       where role in ('kitchen','delivery')
         and (permission like 'promotions.%' or permission like 'loyalty.%')`,
    );
    expect(rows).toEqual([]);
  });

  it("does not let a member without loyalty.view read the ledger (TEST-2040)", async () => {
    const rows = await db.asUser(kitchenA, () =>
      db.query("select id from public.loyalty_transactions"),
    );
    expect(rows).toEqual([]);
  });

  it("lets a cashier apply a discount", async () => {
    const promotion = await insertPromotion(tenantA, "Cajero aplica");
    const order = await insertOrder(tenantA, locationA, 2000);

    const rows = await db.asUser(cashierA, () =>
      db.query<{ id: string }>(
        `insert into public.order_promotions
           (order_id, promotion_id, source, label_snapshot, discount_cents)
         values ($1, $2, 'promotion', 'Cajero aplica', 100) returning id`,
        [order, promotion],
      ),
    );
    expect(rows).toHaveLength(1);
  });
});
