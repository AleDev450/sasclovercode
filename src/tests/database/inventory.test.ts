import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, insertTenant, type TestDatabase } from "../helpers/database";

/**
 * Phase 18 at the database level.
 *
 * Three invariants matter more than the rest, all from ADR-022:
 *
 * - Current stock is a VIEW (`inventory_stock_levels`), always the exact
 *   sum of `stock_movements` - never a resting number that could drift.
 * - Completing an order writes exactly the `sale` movements its recipe
 *   implies, once, and a cancellation before `completed` writes nothing.
 * - `sale` movements are refused from every direct caller - only the
 *   order-completion trigger may ever write one.
 */

let db: TestDatabase;

let tenantA: string;
let tenantB: string;

let ownerA: string;
let managerA: string;
let cashierA: string;
let accountantA: string;
let ownerB: string;

let locationA: string;
let locationB: string;
let secondLocationA: string;

let kgUnitA: string;
let unidadUnitA: string;

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

async function unitId(tenantId: string, abbreviation: string): Promise<string> {
  const rows = await db.query<{ id: string }>(
    "select id from public.units where tenant_id = $1 and abbreviation = $2",
    [tenantId, abbreviation],
  );
  return rows[0]!.id;
}

async function insertInventoryItem(
  tenantId: string,
  unitId: string,
  name: string,
): Promise<string> {
  const rows = await db.query<{ id: string }>(
    "insert into public.inventory_items (tenant_id, unit_id, name) values ($1, $2, $3) returning id",
    [tenantId, unitId, name],
  );
  return rows[0]!.id;
}

async function insertSupplier(tenantId: string, name: string): Promise<string> {
  const rows = await db.query<{ id: string }>(
    "insert into public.suppliers (tenant_id, name) values ($1, $2) returning id",
    [tenantId, name],
  );
  return rows[0]!.id;
}

async function insertPurchase(
  tenantId: string,
  supplierId: string,
  locationId: string,
): Promise<string> {
  const rows = await db.query<{ id: string }>(
    "insert into public.purchases (tenant_id, supplier_id, location_id) values ($1, $2, $3) returning id",
    [tenantId, supplierId, locationId],
  );
  return rows[0]!.id;
}

async function insertPurchaseLine(
  purchaseId: string,
  inventoryItemId: string,
  locationId: string,
  quantity: number,
  unitCostCents: number,
): Promise<string> {
  const rows = await db.query<{ id: string }>(
    `insert into public.stock_movements
       (inventory_item_id, location_id, type, quantity, unit_cost_cents, purchase_id)
     values ($1, $2, 'purchase', $3, $4, $5) returning id`,
    [inventoryItemId, locationId, quantity, unitCostCents, purchaseId],
  );
  return rows[0]!.id;
}

async function insertManualMovement(
  inventoryItemId: string,
  locationId: string,
  type: string,
  quantity: number,
  reason = "x",
): Promise<string> {
  const rows = await db.query<{ id: string }>(
    `insert into public.stock_movements (inventory_item_id, location_id, type, quantity, reason)
     values ($1, $2, $3::public.stock_movement_type, $4, $5) returning id`,
    [inventoryItemId, locationId, type, quantity, reason],
  );
  return rows[0]!.id;
}

async function stockLevel(inventoryItemId: string, locationId: string): Promise<number> {
  const rows = await db.query<{ quantity_on_hand: string }>(
    `select quantity_on_hand::text from public.inventory_stock_levels
     where inventory_item_id = $1 and location_id = $2`,
    [inventoryItemId, locationId],
  );
  return rows.length === 0 ? 0 : Number(rows[0]!.quantity_on_hand);
}

async function insertProduct(tenantId: string, slug: string, priceCents: number): Promise<string> {
  const rows = await db.query<{ id: string }>(
    `insert into public.products (tenant_id, name, slug, base_price_cents, status)
     values ($1, $2, $2, $3, 'active'::public.product_status) returning id`,
    [tenantId, slug, priceCents],
  );
  return rows[0]!.id;
}

/** tenant_id is derived from product_id by trigger - not a parameter here. */
async function insertRecipe(productId: string, isActive = true): Promise<string> {
  const rows = await db.query<{ id: string }>(
    "insert into public.recipes (product_id, is_active) values ($1, $2) returning id",
    [productId, isActive],
  );
  return rows[0]!.id;
}

async function insertRecipeItem(
  recipeId: string,
  inventoryItemId: string,
  quantity: number,
): Promise<void> {
  await db.query(
    "insert into public.recipe_items (recipe_id, inventory_item_id, quantity) values ($1, $2, $3)",
    [recipeId, inventoryItemId, quantity],
  );
}

async function insertOrder(tenantId: string, locationId: string): Promise<string> {
  const rows = await db.query<{ id: string }>(
    "insert into public.orders (tenant_id, location_id, source) values ($1, $2, 'manual') returning id",
    [tenantId, locationId],
  );
  return rows[0]!.id;
}

async function addOrderItem(
  orderId: string,
  productId: string | null,
  quantity: number,
  options: { name?: string; price?: number } = {},
): Promise<string> {
  const rows = await db.query<{ id: string }>(
    `insert into public.order_items (order_id, tenant_id, product_id, quantity, name_snapshot, unit_price_cents)
     values ($1, '00000000-0000-0000-0000-000000000000', $2, $3, coalesce($4, 'placeholder'), coalesce($5, 0))
     returning id`,
    [orderId, productId, quantity, options.name ?? null, options.price ?? null],
  );
  return rows[0]!.id;
}

/** Steps an order through the transitions needed to reach `target`. */
async function advanceOrderTo(orderId: string, target: string): Promise<void> {
  const path: Record<string, readonly string[]> = {
    confirmed: ["confirmed"],
    preparing: ["confirmed", "preparing"],
    ready: ["confirmed", "preparing", "ready"],
    completed: ["confirmed", "preparing", "ready", "completed"],
    cancelled: ["cancelled"],
  };
  for (const status of path[target] ?? []) {
    await db.query("update public.orders set status = $2::public.order_status where id = $1", [
      orderId,
      status,
    ]);
  }
}

async function salesFor(orderId: string): Promise<
  { inventory_item_id: string; quantity: string; order_item_id: string }[]
> {
  return db.query(
    `select inventory_item_id, quantity::text, order_item_id from public.stock_movements
     where order_id = $1 and type = 'sale' order by created_at`,
    [orderId],
  );
}

beforeAll(async () => {
  db = await createTestDatabase();

  tenantA = await insertTenant(db, { slug: "sugurolls", name: "Sugu Rolls" });
  tenantB = await insertTenant(db, { slug: "polleria-el-rey", name: "Pollería El Rey" });

  ownerA = await createUser("owner@sugurolls.com");
  managerA = await createUser("encargado@sugurolls.com");
  cashierA = await createUser("caja@sugurolls.com");
  accountantA = await createUser("contador@sugurolls.com");
  ownerB = await createUser("owner@polleria.pe");

  await addMember(tenantA, ownerA, "owner");
  await addMember(tenantA, managerA, "manager");
  await addMember(tenantA, cashierA, "cashier");
  await addMember(tenantA, accountantA, "accountant");
  await addMember(tenantB, ownerB, "owner");

  locationA = await insertLocation(tenantA, "Miraflores");
  secondLocationA = await insertLocation(tenantA, "San Isidro");
  locationB = await insertLocation(tenantB, "Centro");

  kgUnitA = await unitId(tenantA, "kg");
  unidadUnitA = await unitId(tenantA, "unidad");
});

afterAll(async () => {
  await db.close();
});

describe("units: every tenant gets a starter set", () => {
  it("seeds kg, g, l, ml, unidad automatically", async () => {
    const rows = await db.query<{ abbreviation: string }>(
      "select abbreviation from public.units where tenant_id = $1 order by abbreviation",
      [tenantA],
    );
    expect(rows.map((r) => r.abbreviation).sort()).toEqual(["g", "kg", "l", "ml", "unidad"]);
  });

  it("refuses two units with the same abbreviation (case-insensitive) per tenant", async () => {
    await expect(
      db.query("insert into public.units (tenant_id, name, abbreviation) values ($1, 'Kilo', 'KG')", [
        tenantA,
      ]),
    ).rejects.toThrow(/duplicate key|unique/i);
  });
});

describe("inventory_items", () => {
  it("refuses a unit that belongs to a different business", async () => {
    const unitB = await unitId(tenantB, "kg");
    await expect(insertInventoryItem(tenantA, unitB, "Salmon ajeno")).rejects.toThrow(
      /different business/,
    );
  });
});

describe("purchases and stock_movements: sign by type", () => {
  it("refuses a purchase with a non-positive quantity", async () => {
    const item = await insertInventoryItem(tenantA, kgUnitA, `Item-${crypto.randomUUID()}`);
    const supplier = await insertSupplier(tenantA, `Prov-${crypto.randomUUID()}`);
    const purchase = await insertPurchase(tenantA, supplier, locationA);
    await expect(insertPurchaseLine(purchase, item, locationA, -1, 500)).rejects.toThrow(
      /stock_movements_sign_by_type/,
    );
  });

  it("refuses a waste with a positive quantity", async () => {
    const item = await insertInventoryItem(tenantA, kgUnitA, `Item-${crypto.randomUUID()}`);
    await expect(insertManualMovement(item, locationA, "waste", 5)).rejects.toThrow(
      /stock_movements_sign_by_type/,
    );
  });

  it("allows adjustment and return in either direction", async () => {
    const item = await insertInventoryItem(tenantA, kgUnitA, `Item-${crypto.randomUUID()}`);
    await expect(insertManualMovement(item, locationA, "adjustment", 3)).resolves.toBeDefined();
    await expect(insertManualMovement(item, locationA, "adjustment", -3)).resolves.toBeDefined();
    await expect(insertManualMovement(item, locationA, "return", 2)).resolves.toBeDefined();
    await expect(insertManualMovement(item, locationA, "return", -2)).resolves.toBeDefined();
  });

  it("refuses a movement of exactly zero", async () => {
    const item = await insertInventoryItem(tenantA, kgUnitA, `Item-${crypto.randomUUID()}`);
    await expect(insertManualMovement(item, locationA, "adjustment", 0)).rejects.toThrow(
      /stock_movements_quantity_not_zero/,
    );
  });

  it("a purchase always needs unit_cost_cents; a non-purchase never has one", async () => {
    const item = await insertInventoryItem(tenantA, kgUnitA, `Item-${crypto.randomUUID()}`);
    const supplier = await insertSupplier(tenantA, `Prov-${crypto.randomUUID()}`);
    const purchase = await insertPurchase(tenantA, supplier, locationA);
    await expect(
      db.query(
        "insert into public.stock_movements (inventory_item_id, location_id, type, quantity, purchase_id) values ($1, $2, 'purchase', 1, $3)",
        [item, locationA, purchase],
      ),
    ).rejects.toThrow(/stock_movements_purchase_fields/);
  });

});

describe("purchases.total_cost_cents: summed by trigger", () => {
  it("sums its own lines and stays right across multiple purchases", async () => {
    const item = await insertInventoryItem(tenantA, kgUnitA, `Item-${crypto.randomUUID()}`);
    const supplier = await insertSupplier(tenantA, `Prov-${crypto.randomUUID()}`);

    const purchaseOne = await insertPurchase(tenantA, supplier, locationA);
    await insertPurchaseLine(purchaseOne, item, locationA, 10, 500);
    await insertPurchaseLine(purchaseOne, item, locationA, 5, 480);

    const totalOne = await db.query<{ total_cost_cents: string }>(
      "select total_cost_cents::text from public.purchases where id = $1",
      [purchaseOne],
    );
    // 10*500 + 5*480 = 5000 + 2400 = 7400
    expect(totalOne[0]?.total_cost_cents).toBe("7400");

    const purchaseTwo = await insertPurchase(tenantA, supplier, locationA);
    await insertPurchaseLine(purchaseTwo, item, locationA, 2, 1000);

    const totalTwo = await db.query<{ total_cost_cents: string }>(
      "select total_cost_cents::text from public.purchases where id = $1",
      [purchaseTwo],
    );
    expect(totalTwo[0]?.total_cost_cents).toBe("2000");
    // The first purchase's own total is untouched by the second's lines.
    const totalOneAgain = await db.query<{ total_cost_cents: string }>(
      "select total_cost_cents::text from public.purchases where id = $1",
      [purchaseOne],
    );
    expect(totalOneAgain[0]?.total_cost_cents).toBe("7400");
  });

  it("refuses a purchase whose supplier or location belongs to a different business", async () => {
    const supplierB = await insertSupplier(tenantB, "Ajeno");
    await expect(insertPurchase(tenantA, supplierB, locationA)).rejects.toThrow(
      /different business/,
    );
    const supplier = await insertSupplier(tenantA, `Prov-${crypto.randomUUID()}`);
    await expect(insertPurchase(tenantA, supplier, locationB)).rejects.toThrow(/different business/);
  });
});

describe("inventory_stock_levels: derived, never stored (THE test of the phase)", () => {
  it("sums correctly across several movements, per item per location", async () => {
    const item = await insertInventoryItem(tenantA, kgUnitA, `Item-${crypto.randomUUID()}`);
    const supplier = await insertSupplier(tenantA, `Prov-${crypto.randomUUID()}`);

    expect(await stockLevel(item, locationA)).toBe(0);

    const purchase = await insertPurchase(tenantA, supplier, locationA);
    await insertPurchaseLine(purchase, item, locationA, 20, 500);
    expect(await stockLevel(item, locationA)).toBe(20);

    await insertManualMovement(item, locationA, "waste", -3, "se cayo");
    expect(await stockLevel(item, locationA)).toBe(17);

    await insertManualMovement(item, locationA, "adjustment", 1, "conteo");
    expect(await stockLevel(item, locationA)).toBe(18);
  });

  it("tracks each location independently - the same item, two balances", async () => {
    const item = await insertInventoryItem(tenantA, kgUnitA, `Item-${crypto.randomUUID()}`);
    const supplier = await insertSupplier(tenantA, `Prov-${crypto.randomUUID()}`);
    const purchase = await insertPurchase(tenantA, supplier, locationA);

    await insertPurchaseLine(purchase, item, locationA, 10, 100);
    expect(await stockLevel(item, locationA)).toBe(10);
    expect(await stockLevel(item, secondLocationA)).toBe(0);
  });

  it("can go negative, and nothing blocks that (ADR-022 decision 4)", async () => {
    const item = await insertInventoryItem(tenantA, kgUnitA, `Item-${crypto.randomUUID()}`);
    await insertManualMovement(item, locationA, "waste", -5, "sin stock previo");
    expect(await stockLevel(item, locationA)).toBe(-5);
  });
});

describe("transfers: two rows, opposite sign, one group", () => {
  it("moves stock from one location to another, netting to zero", async () => {
    const item = await insertInventoryItem(tenantA, kgUnitA, `Item-${crypto.randomUUID()}`);
    const supplier = await insertSupplier(tenantA, `Prov-${crypto.randomUUID()}`);
    const purchase = await insertPurchase(tenantA, supplier, locationA);
    await insertPurchaseLine(purchase, item, locationA, 10, 200);

    const groupId = crypto.randomUUID();
    await db.query(
      `insert into public.stock_movements (inventory_item_id, location_id, type, quantity, transfer_group_id)
       values ($1, $2, 'transfer', -4, $3), ($1, $4, 'transfer', 4, $3)`,
      [item, locationA, groupId, secondLocationA],
    );

    expect(await stockLevel(item, locationA)).toBe(6);
    expect(await stockLevel(item, secondLocationA)).toBe(4);

    const rows = await db.query<{ quantity: string }>(
      "select quantity::text from public.stock_movements where transfer_group_id = $1",
      [groupId],
    );
    const sum = rows.reduce((total, row) => total + Number(row.quantity), 0);
    expect(sum).toBe(0);
  });

  it("a transfer always needs a group id; a non-transfer never has one", async () => {
    const item = await insertInventoryItem(tenantA, kgUnitA, `Item-${crypto.randomUUID()}`);
    await expect(
      db.query(
        "insert into public.stock_movements (inventory_item_id, location_id, type, quantity) values ($1, $2, 'transfer', 5)",
        [item, locationA],
      ),
    ).rejects.toThrow(/stock_movements_transfer_fields/);
  });
});

describe("recipes: consuming stock when an order completes", () => {
  it("writes exactly the sale movements its recipe implies, once", async () => {
    const salmon = await insertInventoryItem(tenantA, kgUnitA, `Salmon-${crypto.randomUUID()}`);
    const nori = await insertInventoryItem(tenantA, unidadUnitA, `Nori-${crypto.randomUUID()}`);
    const supplier = await insertSupplier(tenantA, `Prov-${crypto.randomUUID()}`);
    const purchase = await insertPurchase(tenantA, supplier, locationA);
    await insertPurchaseLine(purchase, salmon, locationA, 10, 500);
    await insertPurchaseLine(purchase, nori, locationA, 50, 50);

    const product = await insertProduct(tenantA, `maki-${crypto.randomUUID()}`, 2490);
    const recipe = await insertRecipe(product);
    await insertRecipeItem(recipe, salmon, 0.2);
    await insertRecipeItem(recipe, nori, 2);

    const order = await insertOrder(tenantA, locationA);
    const orderItem = await addOrderItem(order, product, 3);

    await advanceOrderTo(order, "completed");

    const sales = await salesFor(order);
    expect(sales).toHaveLength(2);
    const bySalmon = sales.find((s) => s.inventory_item_id === salmon)!;
    const byNori = sales.find((s) => s.inventory_item_id === nori)!;
    // 0.2 * 3 = 0.6, negated
    expect(bySalmon.quantity).toBe("-0.600");
    // 2 * 3 = 6, negated
    expect(byNori.quantity).toBe("-6.000");
    expect(bySalmon.order_item_id).toBe(orderItem);

    expect(await stockLevel(salmon, locationA)).toBe(9.4);
    expect(await stockLevel(nori, locationA)).toBe(44);
  });

  it("writes nothing for a line with no product", async () => {
    const order = await insertOrder(tenantA, locationA);
    await addOrderItem(order, null, 1, { name: "Servicio", price: 500 });
    await advanceOrderTo(order, "completed");
    expect(await salesFor(order)).toHaveLength(0);
  });

  it("writes nothing for a product with no recipe", async () => {
    const product = await insertProduct(tenantA, `sin-receta-${crypto.randomUUID()}`, 1000);
    const order = await insertOrder(tenantA, locationA);
    await addOrderItem(order, product, 1);
    await advanceOrderTo(order, "completed");
    expect(await salesFor(order)).toHaveLength(0);
  });

  it("writes nothing for a product whose recipe is inactive", async () => {
    const item = await insertInventoryItem(tenantA, kgUnitA, `Item-${crypto.randomUUID()}`);
    const product = await insertProduct(tenantA, `pausado-${crypto.randomUUID()}`, 1000);
    const recipe = await insertRecipe(product, false);
    await insertRecipeItem(recipe, item, 1);

    const order = await insertOrder(tenantA, locationA);
    await addOrderItem(order, product, 1);
    await advanceOrderTo(order, "completed");
    expect(await salesFor(order)).toHaveLength(0);
  });

  it("writes nothing when an order is cancelled at any point before completed", async () => {
    const item = await insertInventoryItem(tenantA, kgUnitA, `Item-${crypto.randomUUID()}`);
    const product = await insertProduct(tenantA, `cancelable-${crypto.randomUUID()}`, 1000);
    const recipe = await insertRecipe(product);
    await insertRecipeItem(recipe, item, 1);

    for (const upTo of [[], ["confirmed"], ["confirmed", "preparing"], ["confirmed", "preparing", "ready"]]) {
      const order = await insertOrder(tenantA, locationA);
      await addOrderItem(order, product, 1);
      for (const status of upTo) {
        await db.query("update public.orders set status = $2::public.order_status where id = $1", [
          order,
          status,
        ]);
      }
      await db.query(
        "update public.orders set status = 'cancelled', cancel_reason = 'x' where id = $1",
        [order],
      );
      expect(await salesFor(order)).toHaveLength(0);
    }
  });

  it("never double-writes: the trigger's WHEN clause is a no-op past completed", async () => {
    const item = await insertInventoryItem(tenantA, kgUnitA, `Item-${crypto.randomUUID()}`);
    const product = await insertProduct(tenantA, `idempotente-${crypto.randomUUID()}`, 1000);
    const recipe = await insertRecipe(product);
    await insertRecipeItem(recipe, item, 1);

    const order = await insertOrder(tenantA, locationA);
    await addOrderItem(order, product, 1);
    await advanceOrderTo(order, "completed");
    expect(await salesFor(order)).toHaveLength(1);

    // A same-status update (guard_order_status_change treats it as a no-op)
    // must not re-fire the completion trigger a second time.
    await db.query("update public.orders set status = 'completed' where id = $1", [order]);
    expect(await salesFor(order)).toHaveLength(1);
  });
});

describe("recipes: cross-tenant guards and uniqueness", () => {
  it("refuses a recipe on a product that does not exist", async () => {
    await expect(insertRecipe("00000000-0000-0000-0000-000000000000")).rejects.toThrow(
      /Product not found/,
    );
  });

  it("derives the recipe's tenant from its product - always correctly, never a mismatch to guard", async () => {
    // Unlike inventory_items (unit_id) or purchases (supplier_id/location_id),
    // a recipe has exactly ONE tenant-scoped reference, so there is nothing
    // for it to disagree with - the derived tenant_id IS the product's own.
    const productB = await insertProduct(tenantB, `ajeno-${crypto.randomUUID()}`, 500);
    const recipeId = await insertRecipe(productB);
    const rows = await db.query<{ tenant_id: string }>(
      "select tenant_id from public.recipes where id = $1",
      [recipeId],
    );
    expect(rows[0]?.tenant_id).toBe(tenantB);
  });

  it("refuses a recipe_item whose inventory item belongs to a different business", async () => {
    const product = await insertProduct(tenantA, `receta-${crypto.randomUUID()}`, 500);
    const recipe = await insertRecipe(product);
    const itemB = await insertInventoryItem(tenantB, await unitId(tenantB, "kg"), `Ajeno-${crypto.randomUUID()}`);
    await expect(insertRecipeItem(recipe, itemB, 1)).rejects.toThrow(/different business/);
  });

  it("refuses the same inventory item twice in one recipe", async () => {
    const item = await insertInventoryItem(tenantA, kgUnitA, `Item-${crypto.randomUUID()}`);
    const product = await insertProduct(tenantA, `duplicado-${crypto.randomUUID()}`, 500);
    const recipe = await insertRecipe(product);
    await insertRecipeItem(recipe, item, 1);
    await expect(insertRecipeItem(recipe, item, 2)).rejects.toThrow(
      /recipe_items_recipe_item_key|duplicate key/,
    );
  });

  it("allows only one recipe per product", async () => {
    const product = await insertProduct(tenantA, `unico-${crypto.randomUUID()}`, 500);
    await insertRecipe(product);
    await expect(insertRecipe(product)).rejects.toThrow(/duplicate key|unique/i);
  });
});

describe("row level security", () => {
  const tables = [
    "units",
    "inventory_items",
    "suppliers",
    "purchases",
    "stock_movements",
    "recipes",
    "recipe_items",
  ];

  it("grants nothing to anon on any of the new tables", async () => {
    const rows = await db.query<{ tablename: string; policyname: string; roles: string }>(
      `select tablename, policyname, roles::text as roles
       from pg_policies
       where schemaname = 'public' and tablename = any($1)`,
      [tables],
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.roles.includes("anon"), `${row.tablename}.${row.policyname}: ${row.roles}`).toBe(
        false,
      );
    }
  });

  it("has no DELETE policy on stock_movements or purchases, ever", async () => {
    const rows = await db.query<{ tablename: string }>(
      `select tablename from pg_policies
       where schemaname = 'public' and tablename in ('stock_movements', 'purchases') and cmd = 'DELETE'`,
    );
    expect(rows).toHaveLength(0);
  });

  it("has no UPDATE policy on stock_movements or purchases, ever", async () => {
    const rows = await db.query<{ tablename: string }>(
      `select tablename from pg_policies
       where schemaname = 'public' and tablename in ('stock_movements', 'purchases') and cmd = 'UPDATE'`,
    );
    expect(rows).toHaveLength(0);
  });

  it("hides another business's inventory items and purchases", async () => {
    const mine = await insertInventoryItem(tenantA, kgUnitA, `Mio-${crypto.randomUUID()}`);
    const theirsUnit = await unitId(tenantB, "kg");
    const theirs = await insertInventoryItem(tenantB, theirsUnit, `Ajeno-${crypto.randomUUID()}`);

    const visible = await db.asUser(ownerA, async () =>
      db.query<{ id: string }>("select id from public.inventory_items"),
    );
    const ids = visible.map((r) => r.id);
    expect(ids).toContain(mine);
    expect(ids).not.toContain(theirs);
  });

  it("lets a manager (inventory.manage) create an inventory item; a view-only role cannot", async () => {
    const created = await db.asUser(managerA, async () =>
      db.query<{ id: string }>(
        "insert into public.inventory_items (tenant_id, unit_id, name) values ($1, $2, $3) returning id",
        [tenantA, kgUnitA, `Manager-${crypto.randomUUID()}`],
      ),
    );
    expect(created).toHaveLength(1);

    await expect(
      db.asUser(accountantA, async () =>
        db.query(
          "insert into public.inventory_items (tenant_id, unit_id, name) values ($1, $2, $3)",
          [tenantA, kgUnitA, `Contador-${crypto.randomUUID()}`],
        ),
      ),
    ).rejects.toThrow(/row-level security/);

    const readable = await db.asUser(accountantA, async () =>
      db.query<{ id: string }>("select id from public.inventory_items limit 1"),
    );
    expect(readable.length).toBeGreaterThan(0);
  });

  it("gates a purchase insert on purchases.create, distinct from inventory.manage", async () => {
    const supplier = await insertSupplier(tenantA, `Prov-${crypto.randomUUID()}`);

    const created = await db.asUser(managerA, async () =>
      db.query<{ id: string }>(
        "insert into public.purchases (tenant_id, supplier_id, location_id) values ($1, $2, $3) returning id",
        [tenantA, supplier, locationA],
      ),
    );
    expect(created).toHaveLength(1);

    // cashier holds neither inventory.manage nor purchases.create.
    await expect(
      db.asUser(cashierA, async () =>
        db.query(
          "insert into public.purchases (tenant_id, supplier_id, location_id) values ($1, $2, $3)",
          [tenantA, supplier, locationA],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("gates a manual stock movement (adjustment/waste/return) on inventory.manage", async () => {
    const item = await insertInventoryItem(tenantA, kgUnitA, `Item-${crypto.randomUUID()}`);

    await expect(
      db.asUser(managerA, async () =>
        db.query(
          "insert into public.stock_movements (inventory_item_id, location_id, type, quantity, reason) values ($1, $2, 'adjustment', 1, 'x')",
          [item, locationA],
        ),
      ),
    ).resolves.toBeDefined();

    await expect(
      db.asUser(cashierA, async () =>
        db.query(
          "insert into public.stock_movements (inventory_item_id, location_id, type, quantity, reason) values ($1, $2, 'adjustment', 1, 'x')",
          [item, locationA],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("refuses `sale` from every direct caller, even one holding inventory.manage", async () => {
    const item = await insertInventoryItem(tenantA, kgUnitA, `Item-${crypto.randomUUID()}`);
    const order = await insertOrder(tenantA, locationA);
    const orderItem = await addOrderItem(order, null, 1, { name: "x", price: 100 });

    await expect(
      db.asUser(managerA, async () =>
        db.query(
          "insert into public.stock_movements (inventory_item_id, location_id, type, quantity, order_id, order_item_id) values ($1, $2, 'sale', -1, $3, $4)",
          [item, locationA, order, orderItem],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("makes the current-stock view respect the same tenant isolation as the ledger it sums", async () => {
    const item = await insertInventoryItem(tenantA, kgUnitA, `Item-${crypto.randomUUID()}`);
    await insertManualMovement(item, locationA, "adjustment", 5, "inicial");

    const itemB = await insertInventoryItem(tenantB, await unitId(tenantB, "kg"), `Ajeno-${crypto.randomUUID()}`);
    await insertManualMovement(itemB, locationB, "adjustment", 5, "inicial");

    const visible = await db.asUser(ownerA, async () =>
      db.query<{ inventory_item_id: string }>("select inventory_item_id from public.inventory_stock_levels"),
    );
    const ids = visible.map((r) => r.inventory_item_id);
    expect(ids).toContain(item);
    expect(ids).not.toContain(itemB);
  });
});
