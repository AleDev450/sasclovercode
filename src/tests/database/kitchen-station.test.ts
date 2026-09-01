import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, insertTenant, type TestDatabase } from "../helpers/database";

/**
 * Phase 16 - the station snapshot (ADR-020).
 *
 * The test that matters most here mirrors TEST-1307's shape (Phase 13):
 * change the CATEGORY's station after a line already exists, and assert the
 * line does not move. Not because station is a financial fact - it isn't -
 * but because a Realtime filter and a "what's cooking now" board both need
 * the value that was true when the ticket was made, not whatever the menu
 * says today.
 */

let db: TestDatabase;
let tenantA: string;
let tenantB: string;
let locationA: string;

async function insertLocation(tenantId: string, name: string): Promise<string> {
  const rows = await db.query<{ id: string }>(
    "insert into public.locations (tenant_id, name) values ($1, $2) returning id",
    [tenantId, name],
  );
  return rows[0]!.id;
}

async function insertCategory(tenantId: string, slug: string, station: string): Promise<string> {
  const rows = await db.query<{ id: string }>(
    `insert into public.categories (tenant_id, name, slug, kitchen_station)
     values ($1, $2, $2, $3::public.kitchen_station) returning id`,
    [tenantId, slug, station],
  );
  return rows[0]!.id;
}

async function insertProduct(
  tenantId: string,
  categoryId: string | null,
  slug: string,
  priceCents: number,
): Promise<string> {
  const rows = await db.query<{ id: string }>(
    `insert into public.products (tenant_id, category_id, name, slug, base_price_cents, status)
     values ($1, $2, $3, $3, $4, 'active'::public.product_status) returning id`,
    [tenantId, categoryId, slug, priceCents],
  );
  return rows[0]!.id;
}

async function insertOrder(tenantId: string, locationId: string): Promise<string> {
  const rows = await db.query<{ id: string }>(
    `insert into public.orders (tenant_id, location_id, source) values ($1, $2, 'manual') returning id`,
    [tenantId, locationId],
  );
  return rows[0]!.id;
}

async function addItem(
  orderId: string,
  productId: string | null,
  options: { name?: string; price?: number } = {},
): Promise<string> {
  const rows = await db.query<{ id: string }>(
    `insert into public.order_items (order_id, tenant_id, product_id, quantity, name_snapshot, unit_price_cents)
     values ($1, '00000000-0000-0000-0000-000000000000', $2, 1, coalesce($3, 'placeholder'), coalesce($4, 0))
     returning id`,
    [orderId, productId, options.name ?? null, options.price ?? null],
  );
  return rows[0]!.id;
}

async function stationOf(itemId: string): Promise<string> {
  const rows = await db.query<{ station: string }>(
    "select station from public.order_items where id = $1",
    [itemId],
  );
  return rows[0]!.station;
}

beforeAll(async () => {
  db = await createTestDatabase();
  tenantA = await insertTenant(db, { slug: "sugurolls", name: "Sugu Rolls" });
  tenantB = await insertTenant(db, { slug: "polleria-el-rey", name: "Pollería El Rey" });
  locationA = await insertLocation(tenantA, "Miraflores");
});

afterAll(async () => {
  await db.close();
});

describe("the station snapshot", () => {
  it("copies the category's station onto the line at insert", async () => {
    const category = await insertCategory(tenantA, "rolls", "sushi");
    const product = await insertProduct(tenantA, category, "maki", 2490);
    const order = await insertOrder(tenantA, locationA);
    const item = await addItem(order, product);

    expect(await stationOf(item)).toBe("sushi");
  });

  it("THE TEST OF THE PHASE: does not move an existing line when the category's station changes later", async () => {
    const category = await insertCategory(tenantA, "bebidas", "bar");
    const product = await insertProduct(tenantA, category, "gaseosa", 500);
    const order = await insertOrder(tenantA, locationA);
    const item = await addItem(order, product);

    expect(await stationOf(item)).toBe("bar");

    await db.query("update public.categories set kitchen_station = 'kitchen' where id = $1", [
      category,
    ]);

    expect(await stationOf(item)).toBe("bar");
  });

  it("defaults to kitchen for a product with no category", async () => {
    const product = await insertProduct(tenantA, null, "propina", 100);
    const order = await insertOrder(tenantA, locationA);
    const item = await addItem(order, product);

    expect(await stationOf(item)).toBe("kitchen");
  });

  it("defaults to kitchen for a free-text line with no product", async () => {
    const order = await insertOrder(tenantA, locationA);
    const item = await addItem(order, null, { name: "Servicio", price: 500 });

    expect(await stationOf(item)).toBe("kitchen");
  });

  it("cross-tenant: a category from another business never reaches the lookup", async () => {
    const categoryB = await insertCategory(tenantB, "postres", "desserts");
    // A product cannot reference another tenant's category at all - the
    // insert itself is refused before the trigger's station lookup runs,
    // by the ordinary tenant FK shape every catalogue table already has.
    await expect(insertProduct(tenantA, categoryB, "torta", 1500)).rejects.toThrow();
  });

  it("desserts and kitchen stations both work end to end", async () => {
    const category = await insertCategory(tenantA, "postres-a", "desserts");
    const product = await insertProduct(tenantA, category, "torta-a", 1500);
    const order = await insertOrder(tenantA, locationA);
    const item = await addItem(order, product);

    expect(await stationOf(item)).toBe("desserts");
  });
});

describe("categories.kitchen_station", () => {
  it("defaults to kitchen for a category created without one", async () => {
    const rows = await db.query<{ kitchen_station: string }>(
      "insert into public.categories (tenant_id, name, slug) values ($1, 'General', 'general') returning kitchen_station",
      [tenantA],
    );
    expect(rows[0]?.kitchen_station).toBe("kitchen");
  });

  it("accepts exactly the four stations from master section 33", async () => {
    for (const station of ["kitchen", "bar", "sushi", "desserts"]) {
      await expect(insertCategory(tenantA, `estacion-${station}`, station)).resolves.toBeDefined();
    }
  });

  it("rejects a station outside that list", async () => {
    await expect(
      db.query(
        "insert into public.categories (tenant_id, name, slug, kitchen_station) values ($1, 'X', 'x-invalid', 'grill')",
        [tenantA],
      ),
    ).rejects.toThrow();
  });
});
