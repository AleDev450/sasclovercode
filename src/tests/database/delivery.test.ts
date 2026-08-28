import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { allTransitionPairs } from "@/modules/delivery/lifecycle";
import { createTestDatabase, insertTenant, type TestDatabase } from "../helpers/database";

/**
 * Phase 19 at the database level.
 *
 * Four invariants matter more than the rest, all from ADR-023:
 *
 * - The delivery fee reaches `orders.total_cents` through a trigger and only
 *   through a trigger, using the same formula Phase 13 uses for the lines.
 * - The address and the zone name are SNAPSHOTS: deleting the zone, or the
 *   customer's address, never rewrites where something went.
 * - The two lifecycles are decoupled in one direction only - cancelling an
 *   order cancels its delivery, and nothing a delivery does touches the order's
 *   own state (which, since Phase 18, would move stock).
 * - Money can only change while the order is a draft.
 */

let db: TestDatabase;

let tenantA: string;
let tenantB: string;

let ownerA: string;
let cashierA: string;
let waiterA: string;
let kitchenA: string;
let riderA: string;
let ownerB: string;
let outsiderB: string;

let locationA: string;
let secondLocationA: string;
let locationB: string;

let productA: string;

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

async function insertZone(tenantId: string, name: string): Promise<string> {
  const rows = await db.query<{ id: string }>(
    "insert into public.delivery_zones (tenant_id, name) values ($1, $2) returning id",
    [tenantId, name],
  );
  return rows[0]!.id;
}

async function insertRate(
  zoneId: string,
  locationId: string | null,
  feeCents: number,
): Promise<string> {
  const rows = await db.query<{ id: string }>(
    `insert into public.delivery_rates (zone_id, location_id, fee_cents)
     values ($1, $2, $3) returning id`,
    [zoneId, locationId, feeCents],
  );
  return rows[0]!.id;
}

/** An order with one line, so it can legally move past `pending`. */
async function insertOrder(
  tenantId: string,
  locationId: string,
  unitPriceCents = 2000,
): Promise<string> {
  const rows = await db.query<{ id: string }>(
    "insert into public.orders (tenant_id, location_id) values ($1, $2) returning id",
    [tenantId, locationId],
  );
  const orderId = rows[0]!.id;

  await db.query(
    `insert into public.order_items (order_id, product_id, name_snapshot, unit_price_cents, quantity)
     values ($1, $2, $3, $4, 1)`,
    [orderId, tenantId === tenantA ? productA : null, "Linea", unitPriceCents],
  );

  return orderId;
}

async function insertDelivery(
  orderId: string,
  zoneId: string,
  overrides: { feeCents?: number; zoneName?: string } = {},
): Promise<string> {
  const rows = await db.query<{ id: string }>(
    `insert into public.order_deliveries
       (order_id, zone_id, zone_name_snapshot, fee_cents, address_line)
     values ($1, $2, $3, $4, 'Av. Larco 123') returning id`,
    [orderId, zoneId, overrides.zoneName ?? "Miraflores", overrides.feeCents ?? 800],
  );
  return rows[0]!.id;
}

async function orderTotals(orderId: string): Promise<{ shipping: number; total: number }> {
  const rows = await db.query<{ shipping_cents: string; total_cents: string }>(
    "select shipping_cents, total_cents from public.orders where id = $1",
    [orderId],
  );
  return {
    shipping: Number(rows[0]!.shipping_cents),
    total: Number(rows[0]!.total_cents),
  };
}

beforeAll(async () => {
  db = await createTestDatabase();

  tenantA = await insertTenant(db, { name: "Sugu Rolls", slug: "sugurolls" });
  tenantB = await insertTenant(db, { name: "Pollos Rey", slug: "pollosrey" });

  ownerA = await createUser("owner-a@test.pe");
  cashierA = await createUser("cashier-a@test.pe");
  waiterA = await createUser("waiter-a@test.pe");
  kitchenA = await createUser("kitchen-a@test.pe");
  riderA = await createUser("rider-a@test.pe");
  ownerB = await createUser("owner-b@test.pe");
  outsiderB = await createUser("outsider-b@test.pe");

  await addMember(tenantA, ownerA, "owner");
  await addMember(tenantA, cashierA, "cashier");
  await addMember(tenantA, waiterA, "waiter");
  await addMember(tenantA, kitchenA, "kitchen");
  await addMember(tenantA, riderA, "delivery");
  await addMember(tenantB, ownerB, "owner");
  await addMember(tenantB, outsiderB, "cashier");

  locationA = await insertLocation(tenantA, "Miraflores");
  secondLocationA = await insertLocation(tenantA, "San Isidro");
  locationB = await insertLocation(tenantB, "Surco");

  const products = await db.query<{ id: string }>(
    `insert into public.products (tenant_id, name, slug, base_price_cents)
     values ($1, 'Maki', 'maki', 2000) returning id`,
    [tenantA],
  );
  productA = products[0]!.id;
});

afterAll(async () => {
  await db.close();
});

// ---------------------------------------------------------------------------
// Schema and posture
// ---------------------------------------------------------------------------

describe("schema posture (TEST-1910, TEST-1911)", () => {
  it("has row level security on every table of this phase", async () => {
    const rows = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `select relname, relrowsecurity from pg_class
       where relname in ('delivery_zones','delivery_rates','order_deliveries',
                         'delivery_status_history','delivery_transitions')`,
    );
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => r.relrowsecurity)).toBe(true);
  });

  it("grants nothing to anon on any of the new tables (TEST-1911)", async () => {
    const rows = await db.query<{ tablename: string }>(
      `select tablename from pg_policies
       where schemaname = 'public'
         and tablename = any($1)
         and 'anon' = any(roles)`,
      [["delivery_zones", "delivery_rates", "order_deliveries", "delivery_status_history"]],
    );
    expect(rows).toEqual([]);
  });

  it("has no DELETE policy on order_deliveries beyond the draft correction (TEST-1938)", async () => {
    // One DELETE policy exists, and the guard trigger is what keeps it honest.
    const rows = await db.query<{ tablename: string; cmd: string }>(
      `select tablename, cmd from pg_policies
       where schemaname = 'public' and tablename = 'order_deliveries' and cmd = 'DELETE'`,
    );
    expect(rows).toHaveLength(1);
  });

  it("lets nobody write delivery_status_history directly (TEST-1937)", async () => {
    const rows = await db.query<{ cmd: string }>(
      `select cmd from pg_policies
       where schemaname = 'public' and tablename = 'delivery_status_history'`,
    );
    expect(rows.map((r) => r.cmd)).toEqual(["SELECT"]);
  });

  it("mirrors the TypeScript state machine exactly (TEST-1901)", async () => {
    const rows = await db.query<{ from_status: string; to_status: string }>(
      "select from_status, to_status from public.delivery_transitions order by from_status, to_status",
    );

    const fromSql = rows.map((r) => `${r.from_status}->${r.to_status}`).sort();
    const fromTs = allTransitionPairs()
      .map((p) => `${p.from}->${p.to}`)
      .sort();

    expect(fromSql).toEqual(fromTs);
  });

  it("leaves delivered and cancelled with no way out (TEST-1928)", async () => {
    const rows = await db.query<{ from_status: string }>(
      `select distinct from_status from public.delivery_transitions
       where from_status in ('delivered','cancelled')`,
    );
    expect(rows).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Zones and rates
// ---------------------------------------------------------------------------

describe("zones and rates", () => {
  it("refuses two zones with the same name in one tenant, case-insensitively (TEST-1914)", async () => {
    await insertZone(tenantA, "Barranco");
    await expect(insertZone(tenantA, "BARRANCO")).rejects.toThrow();
  });

  it("accepts the same zone name in a different tenant (TEST-1914)", async () => {
    await expect(insertZone(tenantB, "Barranco")).resolves.toBeTruthy();
  });

  it("refuses a second default rate for one zone (TEST-1915)", async () => {
    const zone = await insertZone(tenantA, "Chorrillos");
    await insertRate(zone, null, 900);
    await expect(insertRate(zone, null, 1000)).rejects.toThrow();
  });

  it("refuses two rates for the same zone and branch (TEST-1916)", async () => {
    const zone = await insertZone(tenantA, "Surquillo");
    await insertRate(zone, locationA, 900);
    await expect(insertRate(zone, locationA, 1000)).rejects.toThrow();
  });

  it("accepts a default rate and one per branch for the same zone", async () => {
    const zone = await insertZone(tenantA, "Magdalena");
    await expect(insertRate(zone, null, 900)).resolves.toBeTruthy();
    await expect(insertRate(zone, locationA, 700)).resolves.toBeTruthy();
    await expect(insertRate(zone, secondLocationA, 1100)).resolves.toBeTruthy();
  });

  it("refuses a rate whose branch belongs to another business (TEST-1917)", async () => {
    const zone = await insertZone(tenantA, "Lince");
    await expect(insertRate(zone, locationB, 900)).rejects.toThrow(/different business/);
  });

  it("derives delivery_rates.tenant_id from the zone, ignoring what was sent (TEST-1918)", async () => {
    const zone = await insertZone(tenantA, "Jesus Maria");
    const rows = await db.query<{ tenant_id: string }>(
      `insert into public.delivery_rates (tenant_id, zone_id, fee_cents)
       values ($1, $2, 900) returning tenant_id`,
      [tenantB, zone],
    );
    expect(rows[0]!.tenant_id).toBe(tenantA);
  });

  it("drops a branch rate when the branch goes, keeping the zone default", async () => {
    const zone = await insertZone(tenantA, "Pueblo Libre");
    const doomed = await insertLocation(tenantA, "Temporal");
    await insertRate(zone, null, 900);
    await insertRate(zone, doomed, 500);

    await db.query("delete from public.locations where id = $1", [doomed]);

    const rows = await db.query<{ count: string }>(
      "select count(*) as count from public.delivery_rates where zone_id = $1",
      [zone],
    );
    expect(Number(rows[0]!.count)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// The delivery of an order
// ---------------------------------------------------------------------------

describe("attaching a delivery", () => {
  it("derives order_deliveries.tenant_id from the order (TEST-1919)", async () => {
    const zone = await insertZone(tenantA, "Zona tenant");
    const order = await insertOrder(tenantA, locationA);
    const rows = await db.query<{ tenant_id: string }>(
      `insert into public.order_deliveries
         (tenant_id, order_id, zone_id, zone_name_snapshot, address_line)
       values ($1, $2, $3, 'Zona tenant', 'Av. Larco 123') returning tenant_id`,
      [tenantB, order, zone],
    );
    expect(rows[0]!.tenant_id).toBe(tenantA);
  });

  it("writes shipping_cents and recomputes total_cents (TEST-1920)", async () => {
    const zone = await insertZone(tenantA, "Zona total");
    const order = await insertOrder(tenantA, locationA, 2000);

    expect(await orderTotals(order)).toEqual({ shipping: 0, total: 2000 });

    await insertDelivery(order, zone, { feeCents: 800 });

    expect(await orderTotals(order)).toEqual({ shipping: 800, total: 2800 });
  });

  it("recomputes the total when the fee changes (TEST-1922)", async () => {
    const zone = await insertZone(tenantA, "Zona fee");
    const order = await insertOrder(tenantA, locationA, 2000);
    const delivery = await insertDelivery(order, zone, { feeCents: 800 });

    await db.query("update public.order_deliveries set fee_cents = 1500 where id = $1", [delivery]);

    expect(await orderTotals(order)).toEqual({ shipping: 1500, total: 3500 });
  });

  it("returns shipping to zero when the delivery is removed (TEST-1921)", async () => {
    const zone = await insertZone(tenantA, "Zona detach");
    const order = await insertOrder(tenantA, locationA, 2000);
    const delivery = await insertDelivery(order, zone, { feeCents: 800 });

    await db.query("delete from public.order_deliveries where id = $1", [delivery]);

    expect(await orderTotals(order)).toEqual({ shipping: 0, total: 2000 });
  });

  it("keeps the total right when a line is added after the delivery", async () => {
    // `recompute_order_totals()` (Phase 13) reads shipping_cents; this phase is
    // what finally puts a number in it. The two formulas have to agree.
    const zone = await insertZone(tenantA, "Zona linea");
    const order = await insertOrder(tenantA, locationA, 2000);
    await insertDelivery(order, zone, { feeCents: 800 });

    await db.query(
      `insert into public.order_items (order_id, name_snapshot, unit_price_cents, quantity)
       values ($1, 'Otra', 1000, 1)`,
      [order],
    );

    expect(await orderTotals(order)).toEqual({ shipping: 800, total: 3800 });
  });

  it("refuses a delivery on an order that left pending (TEST-1923)", async () => {
    const zone = await insertZone(tenantA, "Zona settled");
    const order = await insertOrder(tenantA, locationA);
    await db.query("update public.orders set status = 'confirmed' where id = $1", [order]);

    await expect(insertDelivery(order, zone)).rejects.toThrow(/no longer pending/);
  });

  it("refuses a second delivery for one order (TEST-1925)", async () => {
    const zone = await insertZone(tenantA, "Zona unica");
    const order = await insertOrder(tenantA, locationA);
    await insertDelivery(order, zone);

    await expect(insertDelivery(order, zone)).rejects.toThrow();
  });

  it("refuses a zone belonging to another business (TEST-1926)", async () => {
    const foreignZone = await insertZone(tenantB, "Zona ajena");
    const order = await insertOrder(tenantA, locationA);

    await expect(insertDelivery(order, foreignZone)).rejects.toThrow(/different business/);
  });

  it("refuses half a coordinate (TEST-1936)", async () => {
    const zone = await insertZone(tenantA, "Zona coord");
    const order = await insertOrder(tenantA, locationA);

    await expect(
      db.query(
        `insert into public.order_deliveries
           (order_id, zone_id, zone_name_snapshot, address_line, latitude)
         values ($1, $2, 'Zona coord', 'Av. Larco 123', -12.1215)`,
        [order, zone],
      ),
    ).rejects.toThrow();
  });

  it("refuses half a coordinate on a customer address too (TEST-1936)", async () => {
    const customers = await db.query<{ id: string }>(
      "insert into public.customers (tenant_id, name) values ($1, 'Ana') returning id",
      [tenantA],
    );
    await expect(
      db.query(
        `insert into public.customer_addresses (customer_id, label, address_line, longitude)
         values ($1, 'Casa', 'Av. Larco 1', -77.0297)`,
        [customers[0]!.id],
      ),
    ).rejects.toThrow();
  });

  it("keeps the fee frozen once the order is settled (TEST-1924)", async () => {
    const zone = await insertZone(tenantA, "Zona congelada");
    const order = await insertOrder(tenantA, locationA);
    const delivery = await insertDelivery(order, zone, { feeCents: 800 });

    await db.query("update public.orders set status = 'confirmed' where id = $1", [order]);

    await expect(
      db.query("update public.order_deliveries set fee_cents = 5000 where id = $1", [delivery]),
    ).rejects.toThrow(/cannot change its delivery cost/);
  });

  it("still allows the operational fields once the order is settled (TEST-1924)", async () => {
    const zone = await insertZone(tenantA, "Zona operativa");
    const order = await insertOrder(tenantA, locationA);
    const delivery = await insertDelivery(order, zone);

    await db.query("update public.orders set status = 'confirmed' where id = $1", [order]);

    await expect(
      db.query(
        `update public.order_deliveries
         set courier_user_id = $2, status = 'assigned', address_line = 'Otra calle 456'
         where id = $1`,
        [delivery, riderA],
      ),
    ).resolves.toBeDefined();
  });

  it("refuses to drop a delivery once the order is settled", async () => {
    const zone = await insertZone(tenantA, "Zona no borrable");
    const order = await insertOrder(tenantA, locationA);
    const delivery = await insertDelivery(order, zone);
    await db.query("update public.orders set status = 'confirmed' where id = $1", [order]);

    await expect(
      db.query("delete from public.order_deliveries where id = $1", [delivery]),
    ).rejects.toThrow(/cannot drop its delivery/);
  });
});

// ---------------------------------------------------------------------------
// Courier
// ---------------------------------------------------------------------------

describe("courier", () => {
  it("refuses somebody who is not a member of this business (TEST-1927)", async () => {
    const zone = await insertZone(tenantA, "Zona repartidor");
    const order = await insertOrder(tenantA, locationA);
    const delivery = await insertDelivery(order, zone);

    await expect(
      db.query(
        "update public.order_deliveries set courier_user_id = $2, status = 'assigned' where id = $1",
        [delivery, outsiderB],
      ),
    ).rejects.toThrow(/not an active member/);
  });

  it("accepts a member of this business", async () => {
    const zone = await insertZone(tenantA, "Zona repartidor ok");
    const order = await insertOrder(tenantA, locationA);
    const delivery = await insertDelivery(order, zone);

    await db.query(
      "update public.order_deliveries set courier_user_id = $2, status = 'assigned' where id = $1",
      [delivery, riderA],
    );

    const rows = await db.query<{ status: string; assigned_at: string | null }>(
      "select status, assigned_at from public.order_deliveries where id = $1",
      [delivery],
    );
    expect(rows[0]!.status).toBe("assigned");
    expect(rows[0]!.assigned_at).not.toBeNull();
  });

  it("refuses to leave a delivery in transit with nobody carrying it", async () => {
    const zone = await insertZone(tenantA, "Zona sin repartidor");
    const order = await insertOrder(tenantA, locationA);
    const delivery = await insertDelivery(order, zone);

    await expect(
      db.query("update public.order_deliveries set status = 'assigned' where id = $1", [delivery]),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// The state machine
// ---------------------------------------------------------------------------

describe("state machine", () => {
  async function assignedDelivery(zoneName: string): Promise<string> {
    const zone = await insertZone(tenantA, zoneName);
    const order = await insertOrder(tenantA, locationA);
    const delivery = await insertDelivery(order, zone);
    await db.query(
      "update public.order_deliveries set courier_user_id = $2, status = 'assigned' where id = $1",
      [delivery, riderA],
    );
    return delivery;
  }

  it("refuses a transition not declared in the table (TEST-1928)", async () => {
    const delivery = await assignedDelivery("Zona salto");
    await expect(
      db.query("update public.order_deliveries set status = 'delivered' where id = $1", [delivery]),
    ).rejects.toThrow(/cannot go from assigned to delivered/);
  });

  it("walks the happy path and stamps each timestamp (TEST-1930)", async () => {
    const delivery = await assignedDelivery("Zona feliz");

    await db.query("update public.order_deliveries set status = 'in_transit' where id = $1", [
      delivery,
    ]);
    await db.query("update public.order_deliveries set status = 'delivered' where id = $1", [
      delivery,
    ]);

    const rows = await db.query<{
      status: string;
      dispatched_at: string | null;
      delivered_at: string | null;
    }>("select status, dispatched_at, delivered_at from public.order_deliveries where id = $1", [
      delivery,
    ]);
    expect(rows[0]!.status).toBe("delivered");
    expect(rows[0]!.dispatched_at).not.toBeNull();
    expect(rows[0]!.delivered_at).not.toBeNull();
  });

  it("refuses to fail a delivery without a reason (TEST-1929)", async () => {
    const delivery = await assignedDelivery("Zona sin motivo");
    await db.query("update public.order_deliveries set status = 'in_transit' where id = $1", [
      delivery,
    ]);

    await expect(
      db.query("update public.order_deliveries set status = 'failed' where id = $1", [delivery]),
    ).rejects.toThrow();
  });

  it("allows a second attempt after a failure (TEST-1928)", async () => {
    const delivery = await assignedDelivery("Zona reintento");
    await db.query("update public.order_deliveries set status = 'in_transit' where id = $1", [
      delivery,
    ]);
    await db.query(
      "update public.order_deliveries set status = 'failed', failure_reason = 'Nadie en casa' where id = $1",
      [delivery],
    );

    await db.query("update public.order_deliveries set status = 'assigned' where id = $1", [
      delivery,
    ]);

    const rows = await db.query<{ status: string; failed_at: string | null }>(
      "select status, failed_at from public.order_deliveries where id = $1",
      [delivery],
    );
    expect(rows[0]!.status).toBe("assigned");
    // Leaving `failed` clears its mark; the history keeps the fact it happened.
    expect(rows[0]!.failed_at).toBeNull();
  });

  it("allows unassigning when the rider falls through", async () => {
    const delivery = await assignedDelivery("Zona sin rider");
    await expect(
      db.query(
        "update public.order_deliveries set status = 'pending', courier_user_id = null where id = $1",
        [delivery],
      ),
    ).resolves.toBeDefined();
  });

  it("writes a history row on creation, with no origin (TEST-1932)", async () => {
    const zone = await insertZone(tenantA, "Zona historial");
    const order = await insertOrder(tenantA, locationA);
    const delivery = await insertDelivery(order, zone);

    const rows = await db.query<{ from_status: string | null; to_status: string }>(
      "select from_status, to_status from public.delivery_status_history where delivery_id = $1",
      [delivery],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.from_status).toBeNull();
    expect(rows[0]!.to_status).toBe("pending");
  });

  it("records every change with the user who made it (TEST-1931)", async () => {
    const zone = await insertZone(tenantA, "Zona quien");
    const order = await insertOrder(tenantA, locationA);
    const delivery = await insertDelivery(order, zone);

    await db.asUser(ownerA, async () => {
      await db.query(
        "update public.order_deliveries set courier_user_id = $2, status = 'assigned' where id = $1",
        [delivery, riderA],
      );
    });

    const rows = await db.query<{ to_status: string; changed_by: string | null }>(
      `select to_status, changed_by from public.delivery_status_history
       where delivery_id = $1 order by created_at`,
      [delivery],
    );
    expect(rows).toHaveLength(2);
    expect(rows[1]!.to_status).toBe("assigned");
    expect(rows[1]!.changed_by).toBe(ownerA);
  });

  it("does not write history when the status did not change", async () => {
    const zone = await insertZone(tenantA, "Zona sin cambio");
    const order = await insertOrder(tenantA, locationA);
    const delivery = await insertDelivery(order, zone);

    await db.query("update public.order_deliveries set address_line = 'Otra 1' where id = $1", [
      delivery,
    ]);

    const rows = await db.query<{ count: string }>(
      "select count(*) as count from public.delivery_status_history where delivery_id = $1",
      [delivery],
    );
    expect(Number(rows[0]!.count)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// The one coupling: cancelling the order
// ---------------------------------------------------------------------------

describe("order cancellation (TEST-1933, TEST-1934)", () => {
  it("cancels a live delivery when its order is cancelled", async () => {
    const zone = await insertZone(tenantA, "Zona anulada");
    const order = await insertOrder(tenantA, locationA);
    const delivery = await insertDelivery(order, zone);

    await db.query(
      "update public.orders set status = 'cancelled', cancel_reason = 'Cliente se arrepintio' where id = $1",
      [order],
    );

    const rows = await db.query<{ status: string; failure_reason: string | null }>(
      "select status, failure_reason from public.order_deliveries where id = $1",
      [delivery],
    );
    expect(rows[0]!.status).toBe("cancelled");
    expect(rows[0]!.failure_reason).toBe("Cliente se arrepintio");
  });

  it("cancels a delivery that had already failed", async () => {
    // `failed -> cancelled` has to be declared, or cancelling the order would
    // fail with it.
    const zone = await insertZone(tenantA, "Zona fallida anulada");
    const order = await insertOrder(tenantA, locationA);
    const delivery = await insertDelivery(order, zone);
    await db.query(
      "update public.order_deliveries set courier_user_id = $2, status = 'assigned' where id = $1",
      [delivery, riderA],
    );
    await db.query("update public.order_deliveries set status = 'in_transit' where id = $1", [
      delivery,
    ]);
    await db.query(
      "update public.order_deliveries set status = 'failed', failure_reason = 'Nadie' where id = $1",
      [delivery],
    );

    await db.query(
      "update public.orders set status = 'cancelled', cancel_reason = 'Ya no' where id = $1",
      [order],
    );

    const rows = await db.query<{ status: string }>(
      "select status from public.order_deliveries where id = $1",
      [delivery],
    );
    expect(rows[0]!.status).toBe("cancelled");
  });

  it("never touches a delivery that already arrived (TEST-1934)", async () => {
    const zone = await insertZone(tenantA, "Zona entregada");
    const order = await insertOrder(tenantA, locationA);
    const delivery = await insertDelivery(order, zone);
    await db.query(
      "update public.order_deliveries set courier_user_id = $2, status = 'assigned' where id = $1",
      [delivery, riderA],
    );
    await db.query("update public.order_deliveries set status = 'in_transit' where id = $1", [
      delivery,
    ]);
    await db.query("update public.order_deliveries set status = 'delivered' where id = $1", [
      delivery,
    ]);

    // An order can be cancelled from `pending`, which this one still is.
    await db.query(
      "update public.orders set status = 'cancelled', cancel_reason = 'Error de caja' where id = $1",
      [order],
    );

    const rows = await db.query<{ status: string }>(
      "select status from public.order_deliveries where id = $1",
      [delivery],
    );
    expect(rows[0]!.status).toBe("delivered");
  });

  it("does not touch the order's own status when a delivery arrives", async () => {
    // ADR-023 decision 4: the coupling runs one way only. If this ever fails,
    // a rider's phone is moving stock through the Phase 18 trigger.
    const zone = await insertZone(tenantA, "Zona desacoplada");
    const order = await insertOrder(tenantA, locationA);
    const delivery = await insertDelivery(order, zone);
    await db.query(
      "update public.order_deliveries set courier_user_id = $2, status = 'assigned' where id = $1",
      [delivery, riderA],
    );
    await db.query("update public.order_deliveries set status = 'in_transit' where id = $1", [
      delivery,
    ]);
    await db.query("update public.order_deliveries set status = 'delivered' where id = $1", [
      delivery,
    ]);

    const rows = await db.query<{ status: string; completed_at: string | null }>(
      "select status, completed_at from public.orders where id = $1",
      [order],
    );
    expect(rows[0]!.status).toBe("pending");
    expect(rows[0]!.completed_at).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

describe("snapshots (TEST-1935)", () => {
  it("keeps the delivery alive with its zone name when the zone is deleted", async () => {
    const zone = await insertZone(tenantA, "Zona efimera");
    const order = await insertOrder(tenantA, locationA);
    const delivery = await insertDelivery(order, zone, { zoneName: "Zona efimera" });

    await db.query("delete from public.delivery_zones where id = $1", [zone]);

    const rows = await db.query<{ zone_id: string | null; zone_name_snapshot: string }>(
      "select zone_id, zone_name_snapshot from public.order_deliveries where id = $1",
      [delivery],
    );
    expect(rows[0]!.zone_id).toBeNull();
    expect(rows[0]!.zone_name_snapshot).toBe("Zona efimera");
  });
});

// ---------------------------------------------------------------------------
// Isolation and authorization
// ---------------------------------------------------------------------------

describe("tenant isolation (TEST-1912, TEST-1913)", () => {
  let zoneA: string;
  let deliveryA: string;

  beforeAll(async () => {
    zoneA = await insertZone(tenantA, "Zona aislada");
    await insertRate(zoneA, null, 800);
    const order = await insertOrder(tenantA, locationA);
    deliveryA = await insertDelivery(order, zoneA, { zoneName: "Zona aislada" });
  });

  it("does not let tenant B read tenant A's zones (TEST-1912)", async () => {
    const rows = await db.asUser(ownerB, () =>
      db.query("select id from public.delivery_zones where id = $1", [zoneA]),
    );
    expect(rows).toEqual([]);
  });

  it("does not let tenant B read tenant A's rates (TEST-1912)", async () => {
    const rows = await db.asUser(ownerB, () =>
      db.query("select id from public.delivery_rates where zone_id = $1", [zoneA]),
    );
    expect(rows).toEqual([]);
  });

  it("does not let tenant B read tenant A's deliveries (TEST-1912)", async () => {
    const rows = await db.asUser(ownerB, () =>
      db.query("select id from public.order_deliveries where id = $1", [deliveryA]),
    );
    expect(rows).toEqual([]);
  });

  it("does not let tenant B read tenant A's delivery history (TEST-1912)", async () => {
    const rows = await db.asUser(ownerB, () =>
      db.query("select id from public.delivery_status_history where delivery_id = $1", [deliveryA]),
    );
    expect(rows).toEqual([]);
  });

  it("does not let tenant B write tenant A's zones (TEST-1913)", async () => {
    const rows = await db.asUser(ownerB, () =>
      db.query("update public.delivery_zones set name = 'Robada' where id = $1 returning id", [
        zoneA,
      ]),
    );
    expect(rows).toEqual([]);
  });

  it("does not let tenant B write tenant A's deliveries (TEST-1913)", async () => {
    const rows = await db.asUser(ownerB, () =>
      db.query(
        "update public.order_deliveries set address_line = 'Robada' where id = $1 returning id",
        [deliveryA],
      ),
    );
    expect(rows).toEqual([]);
  });

  it("lets tenant A's owner read its own delivery", async () => {
    const rows = await db.asUser(ownerA, () =>
      db.query("select id from public.order_deliveries where id = $1", [deliveryA]),
    );
    expect(rows).toHaveLength(1);
  });

  it("gives an unauthenticated caller nothing", async () => {
    const rows = await db.asUser(null, () => db.query("select id from public.order_deliveries"));
    expect(rows).toEqual([]);
  });
});

describe("permissions (TEST-1939, TEST-1940, TEST-1941)", () => {
  it("grants the rider what it needs to work a delivery", async () => {
    const rows = await db.query<{ permission: string }>(
      `select permission from public.role_permissions
       where role = 'delivery' and permission like 'deliver%' order by permission`,
      [],
    );
    expect(rows.map((r) => r.permission)).toEqual([
      "deliveries.manage",
      "deliveries.view",
      "delivery_zones.view",
    ]);
  });

  it("does not let the rider edit the price list", async () => {
    const rows = await db.query<{ permission: string }>(
      `select permission from public.role_permissions
       where role = 'delivery' and permission = 'delivery_zones.manage'`,
    );
    expect(rows).toEqual([]);
  });

  it("gives waiter and kitchen nothing from this phase (TEST-1941)", async () => {
    const rows = await db.query<{ role: string }>(
      `select role from public.role_permissions
       where role in ('waiter','kitchen')
         and (permission like 'deliveries.%' or permission like 'delivery_zones.%')`,
    );
    expect(rows).toEqual([]);
  });

  it("lets the accountant read but never write", async () => {
    const rows = await db.query<{ permission: string }>(
      `select permission from public.role_permissions
       where role = 'accountant'
         and (permission like 'deliveries.%' or permission like 'delivery_zones.%')
       order by permission`,
    );
    expect(rows.map((r) => r.permission)).toEqual(["deliveries.view", "delivery_zones.view"]);
  });

  it("does not let a member without deliveries.view read one (TEST-1939)", async () => {
    const zone = await insertZone(tenantA, "Zona permiso");
    const order = await insertOrder(tenantA, locationA);
    const delivery = await insertDelivery(order, zone);

    const rows = await db.asUser(kitchenA, () =>
      db.query("select id from public.order_deliveries where id = $1", [delivery]),
    );
    expect(rows).toEqual([]);
  });

  it("does not let a member without deliveries.manage write one (TEST-1940)", async () => {
    const zone = await insertZone(tenantA, "Zona permiso write");
    const order = await insertOrder(tenantA, locationA);
    const delivery = await insertDelivery(order, zone);

    const rows = await db.asUser(waiterA, () =>
      db.query(
        "update public.order_deliveries set address_line = 'Nueva' where id = $1 returning id",
        [delivery],
      ),
    );
    expect(rows).toEqual([]);
  });

  it("lets a cashier attach and work a delivery", async () => {
    const zone = await insertZone(tenantA, "Zona cajero");
    const order = await insertOrder(tenantA, locationA);

    const rows = await db.asUser(cashierA, () =>
      db.query<{ id: string }>(
        `insert into public.order_deliveries
           (order_id, zone_id, zone_name_snapshot, address_line)
         values ($1, $2, 'Zona cajero', 'Av. Larco 9') returning id`,
        [order, zone],
      ),
    );
    expect(rows).toHaveLength(1);
  });

  it("returns couriers to a cashier, who has no members.view", async () => {
    // The whole reason `get_tenant_couriers` exists rather than reusing
    // `get_tenant_members`.
    const members = await db.asUser(cashierA, () =>
      db.query("select user_id from public.get_tenant_members($1)", [tenantA]),
    );
    expect(members).toEqual([]);

    const couriers = await db.asUser(cashierA, () =>
      db.query("select user_id from public.get_tenant_couriers($1)", [tenantA]),
    );
    expect(couriers.length).toBeGreaterThan(0);
  });

  it("returns no couriers to somebody without deliveries.manage", async () => {
    const rows = await db.asUser(kitchenA, () =>
      db.query("select user_id from public.get_tenant_couriers($1)", [tenantA]),
    );
    expect(rows).toEqual([]);
  });

  it("returns no couriers of another business", async () => {
    const rows = await db.asUser(ownerB, () =>
      db.query("select user_id from public.get_tenant_couriers($1)", [tenantA]),
    );
    expect(rows).toEqual([]);
  });
});
