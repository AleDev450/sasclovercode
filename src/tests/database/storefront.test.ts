import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, insertTenant, type TestDatabase } from "../helpers/database";

/**
 * Phase 29 at the database level.
 *
 * The invariants worth a test, from the SPEC and ADR-033:
 *
 * - An anonymous visitor can create an order through `place_web_order` and
 *   through nothing else, and cannot read it back except with its token.
 * - Every amount - line, extra, delivery - is computed by the database.
 * - A closed shop, a switched-off shop, a missing module or a product of
 *   another business refuses the WHOLE order, leaving nothing behind.
 * - Every public read is scoped to the tenant it was asked about.
 */

let db: TestDatabase;

let tenantA: string;
let tenantB: string;
let locationA: string;

let makiA: string;
let makiVariantsA: string;
let fiveA: string;
let tenA: string;
let sauceA: string;
let avocadoA: string;
let soldOutA: string;
let makiB: string;
let sauceB: string;

let yapeA: string;
let cashHiddenA: string;
let zoneA: string;
let zoneB: string;

interface PlacedOrder {
  order_id: string;
  order_number: number;
  access_token: string;
  total_cents: string;
}

async function insertProduct(
  tenantId: string,
  slug: string,
  priceCents: number,
  extra: { isAvailable?: boolean; status?: string } = {},
): Promise<string> {
  const rows = await db.query<{ id: string }>(
    `insert into public.products (tenant_id, name, slug, base_price_cents, status, is_available)
     values ($1, $2, $2, $3, $4::public.product_status, $5) returning id`,
    [tenantId, slug, priceCents, extra.status ?? "active", extra.isAvailable ?? true],
  );
  return rows[0]!.id;
}

async function insertOption(
  productId: string,
  group: string,
  name: string,
  deltaCents: number,
): Promise<string> {
  const rows = await db.query<{ id: string }>(
    `insert into public.product_options (product_id, tenant_id, group_label, name, price_delta_cents)
     select $1, p.tenant_id, $2, $3, $4 from public.products as p where p.id = $1
     returning id`,
    [productId, group, name, deltaCents],
  );
  return rows[0]!.id;
}

async function insertVariant(productId: string, name: string, priceCents: number): Promise<string> {
  const rows = await db.query<{ id: string }>(
    `insert into public.product_variants (product_id, tenant_id, name, price_cents)
     select $1, p.tenant_id, $2, $3 from public.products as p where p.id = $1
     returning id`,
    [productId, name, priceCents],
  );
  return rows[0]!.id;
}

async function insertZone(
  tenantId: string,
  name: string,
  feeCents: number,
  freeFrom: number | null,
) {
  const rows = await db.query<{ id: string }>(
    "insert into public.delivery_zones (tenant_id, name) values ($1, $2) returning id",
    [tenantId, name],
  );
  const zoneId = rows[0]!.id;
  await db.query(
    `insert into public.delivery_rates (zone_id, location_id, fee_cents, min_order_free_cents)
     values ($1, null, $2, $3)`,
    [zoneId, feeCents, freeFrom],
  );
  return zoneId;
}

async function insertPaymentMethod(
  tenantId: string,
  name: string,
  type: string,
  showOnWebsite: boolean,
): Promise<string> {
  const rows = await db.query<{ id: string }>(
    `insert into public.payment_methods (tenant_id, type, name, reference, show_on_website)
     values ($1, $2::public.payment_method_type, $3, '999 111 222', $4) returning id`,
    [tenantId, type, name, showOnWebsite],
  );
  return rows[0]!.id;
}

/** Calls `place_web_order` as an anonymous visitor. */
function placeAsAnon(tenantId: string, order: unknown): Promise<PlacedOrder[]> {
  return db.asRole("anon", () =>
    db.query<PlacedOrder>("select * from public.place_web_order($1, $2::jsonb)", [
      tenantId,
      JSON.stringify(order),
    ]),
  );
}

/** The error message `place_web_order` raised, or null when it succeeded. */
async function refusal(tenantId: string, order: unknown): Promise<string | null> {
  try {
    await placeAsAnon(tenantId, order);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function pickup(items: unknown[], extra: Record<string, unknown> = {}) {
  return {
    contact: { name: "Rosa Quispe", phone: "+51 999 888 777" },
    fulfillment: "pickup",
    paymentMethodId: yapeA,
    items,
    ...extra,
  };
}

async function countOrders(tenantId: string): Promise<number> {
  const rows = await db.query<{ c: string }>(
    "select count(*)::text as c from public.orders where tenant_id = $1",
    [tenantId],
  );
  return Number(rows[0]!.c);
}

beforeAll(async () => {
  db = await createTestDatabase();

  tenantA = await insertTenant(db, { slug: "sugu-a", name: "Sugu A" });
  tenantB = await insertTenant(db, { slug: "sugu-b", name: "Sugu B" });

  const locations = await db.query<{ id: string }>(
    "select id from public.locations where tenant_id = $1",
    [tenantA],
  );
  locationA = locations[0]!.id;

  makiA = await insertProduct(tenantA, "acevichado", 2500);
  makiVariantsA = await insertProduct(tenantA, "furai", 0);
  fiveA = await insertVariant(makiVariantsA, "Por 5", 1500);
  tenA = await insertVariant(makiVariantsA, "Por 10", 2800);
  sauceA = await insertOption(makiA, "Salsa", "Acevichada", 0);
  avocadoA = await insertOption(makiA, "Extras", "Palta", 300);
  soldOutA = await insertProduct(tenantA, "agotado", 1000, { isAvailable: false });

  makiB = await insertProduct(tenantB, "maki-b", 900);
  sauceB = await insertOption(makiB, "Salsa", "Teriyaki", 100);

  yapeA = await insertPaymentMethod(tenantA, "Yape", "yape", true);
  cashHiddenA = await insertPaymentMethod(tenantA, "Efectivo caja", "cash", false);

  zoneA = await insertZone(tenantA, "Pueblo Libre", 700, 6000);
  zoneB = await insertZone(tenantB, "Miraflores", 500, null);
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  // Every test starts from a shop that is open, taking orders, and has every
  // module - individual tests switch one thing off.
  await db.query(
    `update public.tenant_storefronts
     set mode = 'open', ordering_enabled = true, accepts_delivery = true,
         accepts_pickup = true, min_order_cents = 0, order_location_id = null
     where tenant_id in ($1, $2)`,
    [tenantA, tenantB],
  );
  await db.query("delete from public.tenant_modules where tenant_id in ($1, $2)", [
    tenantA,
    tenantB,
  ]);
  await db.query("delete from public.location_hours where tenant_id in ($1, $2)", [
    tenantA,
    tenantB,
  ]);
  await db.query("update public.tenants set status = 'active' where id in ($1, $2)", [
    tenantA,
    tenantB,
  ]);
});

describe("provisioning", () => {
  it("gives every new business a storefront row with safe defaults", async () => {
    const tenant = await insertTenant(db, { slug: "recien-creado" });
    const rows = await db.query<{
      ordering_enabled: boolean;
      mode: string;
      accepts_delivery: boolean;
      accepts_pickup: boolean;
      bestsellers_days: number;
    }>("select * from public.tenant_storefronts where tenant_id = $1", [tenant]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      ordering_enabled: true,
      mode: "auto",
      accepts_delivery: true,
      accepts_pickup: true,
      bestsellers_days: 30,
    });

    // Phase 21 provisioning survived the redefinition of the trigger.
    const subscriptions = await db.query(
      "select 1 from public.subscriptions where tenant_id = $1",
      [tenant],
    );
    expect(subscriptions).toHaveLength(1);
  });

  it("refuses an ordering branch that belongs to another business", async () => {
    const other = await db.query<{ id: string }>(
      "select id from public.locations where tenant_id = $1",
      [tenantB],
    );
    await expect(
      db.query("update public.tenant_storefronts set order_location_id = $1 where tenant_id = $2", [
        other[0]!.id,
        tenantA,
      ]),
    ).rejects.toThrow(/different business/);
  });

  it("refuses a storefront that neither delivers nor lets anybody pick up", async () => {
    await expect(
      db.query(
        `update public.tenant_storefronts set accepts_delivery = false, accepts_pickup = false
         where tenant_id = $1`,
        [tenantA],
      ),
    ).rejects.toThrow(/fulfillment_any/);
  });
});

describe("opening state (FR2904)", () => {
  async function isOpen(tenantId: string): Promise<boolean> {
    const rows = await db.asRole("anon", () =>
      db.query<{ open: boolean }>("select public.storefront_is_open($1) as open", [tenantId]),
    );
    return rows[0]!.open;
  }

  async function localWeekday(): Promise<number> {
    const rows = await db.query<{ dow: number }>(
      "select extract(dow from now() at time zone 'America/Lima')::int as dow",
    );
    return rows[0]!.dow;
  }

  it("obeys a forced mode over everything else", async () => {
    await db.query("update public.tenant_storefronts set mode = 'closed' where tenant_id = $1", [
      tenantA,
    ]);
    expect(await isOpen(tenantA)).toBe(false);

    await db.query("update public.tenant_storefronts set mode = 'open' where tenant_id = $1", [
      tenantA,
    ]);
    expect(await isOpen(tenantA)).toBe(true);
  });

  it("is open in auto when the branch has no hours at all", async () => {
    await db.query("update public.tenant_storefronts set mode = 'auto' where tenant_id = $1", [
      tenantA,
    ]);
    expect(await isOpen(tenantA)).toBe(true);
  });

  it("is open in auto inside today's shift and closed on another day's", async () => {
    await db.query("update public.tenant_storefronts set mode = 'auto' where tenant_id = $1", [
      tenantA,
    ]);
    const today = await localWeekday();

    await db.query(
      `insert into public.location_hours (location_id, tenant_id, day_of_week, opens_at, closes_at)
       values ($1, $2, $3, '00:00', '24:00')`,
      [locationA, tenantA, (today + 1) % 7],
    );
    expect(await isOpen(tenantA)).toBe(false);

    await db.query(
      `insert into public.location_hours (location_id, tenant_id, day_of_week, opens_at, closes_at)
       values ($1, $2, $3, '00:00', '24:00')`,
      [locationA, tenantA, today],
    );
    expect(await isOpen(tenantA)).toBe(true);
  });
});

describe("place_web_order: the happy path", () => {
  it("creates a pickup order priced by the database, with a tracking token", async () => {
    const before = await countOrders(tenantA);

    const placed = await placeAsAnon(
      tenantA,
      pickup([
        // `unitPriceCents` is not a field the function reads. Sending one is
        // the classic cart attack, and it must change nothing.
        { productId: makiA, quantity: 2, unitPriceCents: 1 },
      ]),
    );

    expect(placed).toHaveLength(1);
    expect(placed[0]!.access_token).toMatch(/^[0-9a-f]{64}$/);
    expect(Number(placed[0]!.total_cents)).toBe(5000);
    expect(await countOrders(tenantA)).toBe(before + 1);

    const orders = await db.query<{ source: string; status: string; location_id: string }>(
      "select source, status, location_id from public.orders where id = $1",
      [placed[0]!.order_id],
    );
    expect(orders[0]).toEqual({ source: "web", status: "pending", location_id: locationA });

    const web = await db.query<{ access_token_hash: string; contact_phone: string }>(
      "select access_token_hash, contact_phone from public.web_orders where order_id = $1",
      [placed[0]!.order_id],
    );
    // The phone is normalised and the token is stored only as its hash.
    expect(web[0]!.contact_phone).toBe("+51999888777");
    expect(web[0]!.access_token_hash).not.toBe(placed[0]!.access_token);
    expect(web[0]!.access_token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("prices extras and copies them onto the line", async () => {
    const placed = await placeAsAnon(
      tenantA,
      pickup([{ productId: makiA, quantity: 1, optionIds: [sauceA, avocadoA, avocadoA] }]),
    );

    const lines = await db.query<{ unit_price_cents: string; options_snapshot: string }>(
      "select unit_price_cents, options_snapshot from public.order_items where order_id = $1",
      [placed[0]!.order_id],
    );
    // 2500 + 0 + 300, and the duplicated palta charged once.
    expect(Number(lines[0]!.unit_price_cents)).toBe(2800);
    expect(lines[0]!.options_snapshot).toContain("Salsa: Acevichada");
    expect(lines[0]!.options_snapshot).toContain("Extras: Palta");
  });

  it("charges the variant's price", async () => {
    const placed = await placeAsAnon(
      tenantA,
      pickup([{ productId: makiVariantsA, variantId: tenA, quantity: 1 }]),
    );
    expect(Number(placed[0]!.total_cents)).toBe(2800);
  });

  it("reuses the customer with the same phone instead of creating another", async () => {
    await placeAsAnon(tenantA, pickup([{ productId: makiA, quantity: 1 }]));
    await placeAsAnon(tenantA, pickup([{ productId: makiA, quantity: 1 }]));

    const customers = await db.query(
      "select 1 from public.customers where tenant_id = $1 and phone = '+51999888777'",
      [tenantA],
    );
    expect(customers).toHaveLength(1);
  });

  it("adds the zone fee to a delivery, and waives it above the free threshold", async () => {
    const small = await placeAsAnon(tenantA, {
      ...pickup([{ productId: makiA, quantity: 1 }]),
      fulfillment: "delivery",
      delivery: { zoneId: zoneA, address: "Av. Brasil 123", reference: "Frente al parque" },
    });
    expect(Number(small[0]!.total_cents)).toBe(2500 + 700);

    const large = await placeAsAnon(tenantA, {
      ...pickup([{ productId: makiA, quantity: 3 }]),
      fulfillment: "delivery",
      delivery: { zoneId: zoneA, address: "Av. Brasil 123" },
    });
    expect(Number(large[0]!.total_cents)).toBe(7500);

    const deliveries = await db.query<{ zone_name_snapshot: string; recipient_phone: string }>(
      "select zone_name_snapshot, recipient_phone from public.order_deliveries where order_id = $1",
      [small[0]!.order_id],
    );
    expect(deliveries[0]).toEqual({
      zone_name_snapshot: "Pueblo Libre",
      recipient_phone: "+51999888777",
    });
  });
});

describe("place_web_order: refusals leave nothing behind", () => {
  it("refuses a closed shop", async () => {
    await db.query("update public.tenant_storefronts set mode = 'closed' where tenant_id = $1", [
      tenantA,
    ]);
    const before = await countOrders(tenantA);
    expect(await refusal(tenantA, pickup([{ productId: makiA, quantity: 1 }]))).toBe(
      "STORE_CLOSED",
    );
    expect(await countOrders(tenantA)).toBe(before);
  });

  it("refuses a shop with web orders switched off", async () => {
    await db.query(
      "update public.tenant_storefronts set ordering_enabled = false where tenant_id = $1",
      [tenantA],
    );
    expect(await refusal(tenantA, pickup([{ productId: makiA, quantity: 1 }]))).toBe(
      "ORDERING_DISABLED",
    );
  });

  it("refuses a suspended business", async () => {
    await db.query("update public.tenants set status = 'suspended' where id = $1", [tenantA]);
    expect(await refusal(tenantA, pickup([{ productId: makiA, quantity: 1 }]))).toBe(
      "STORE_UNAVAILABLE",
    );
  });

  it("refuses a business without the orders module", async () => {
    await db.query(
      "insert into public.tenant_modules (tenant_id, module_code, is_enabled) values ($1, 'orders', false)",
      [tenantA],
    );
    expect(await refusal(tenantA, pickup([{ productId: makiA, quantity: 1 }]))).toBe(
      "STORE_UNAVAILABLE",
    );
  });

  it("refuses delivery without the delivery module", async () => {
    await db.query(
      "insert into public.tenant_modules (tenant_id, module_code, is_enabled) values ($1, 'delivery', false)",
      [tenantA],
    );
    expect(
      await refusal(tenantA, {
        ...pickup([{ productId: makiA, quantity: 1 }]),
        fulfillment: "delivery",
        delivery: { zoneId: zoneA, address: "Av. Brasil 123" },
      }),
    ).toBe("FULFILLMENT_UNAVAILABLE");
  });

  it("refuses a product of another business, and rolls back the whole order", async () => {
    const before = await countOrders(tenantA);
    const customersBefore = await db.query<{ c: string }>(
      "select count(*)::text as c from public.customers where tenant_id = $1",
      [tenantA],
    );

    expect(
      await refusal(
        tenantA,
        pickup(
          [
            { productId: makiA, quantity: 1 },
            { productId: makiB, quantity: 1 },
          ],
          {
            contact: { name: "Nuevo", phone: "987654321" },
          },
        ),
      ),
    ).toBe("PRODUCT_UNAVAILABLE");

    expect(await countOrders(tenantA)).toBe(before);
    const customersAfter = await db.query<{ c: string }>(
      "select count(*)::text as c from public.customers where tenant_id = $1",
      [tenantA],
    );
    expect(customersAfter[0]!.c).toBe(customersBefore[0]!.c);
  });

  it("refuses a product that is sold out today", async () => {
    expect(await refusal(tenantA, pickup([{ productId: soldOutA, quantity: 1 }]))).toBe(
      "PRODUCT_UNAVAILABLE",
    );
  });

  it("refuses an extra that belongs to another product", async () => {
    expect(
      await refusal(tenantA, pickup([{ productId: makiA, quantity: 1, optionIds: [sauceB] }])),
    ).toBe("PRODUCT_UNAVAILABLE");
  });

  it("requires a variant when the product is sold by presentation", async () => {
    expect(await refusal(tenantA, pickup([{ productId: makiVariantsA, quantity: 1 }]))).toBe(
      "VARIANT_REQUIRED",
    );
    expect(
      await refusal(tenantA, pickup([{ productId: makiVariantsA, variantId: fiveA, quantity: 1 }])),
    ).toBeNull();
  });

  it("refuses an order below the minimum", async () => {
    await db.query(
      "update public.tenant_storefronts set min_order_cents = 3000 where tenant_id = $1",
      [tenantA],
    );
    expect(await refusal(tenantA, pickup([{ productId: makiA, quantity: 1 }]))).toBe(
      "BELOW_MINIMUM",
    );
  });

  it("refuses a zone of another business", async () => {
    expect(
      await refusal(tenantA, {
        ...pickup([{ productId: makiA, quantity: 1 }]),
        fulfillment: "delivery",
        delivery: { zoneId: zoneB, address: "Av. Larco 1" },
      }),
    ).toBe("INVALID_ZONE");
  });

  it("requires a payment method the website offers", async () => {
    expect(
      await refusal(
        tenantA,
        pickup([{ productId: makiA, quantity: 1 }], { paymentMethodId: null }),
      ),
    ).toBe("INVALID_PAYMENT_METHOD");
    expect(
      await refusal(
        tenantA,
        pickup([{ productId: makiA, quantity: 1 }], { paymentMethodId: cashHiddenA }),
      ),
    ).toBe("INVALID_PAYMENT_METHOD");
  });

  it("refuses nonsense: an empty cart, a bad phone, an absurd quantity", async () => {
    expect(await refusal(tenantA, pickup([]))).toBe("EMPTY_CART");
    expect(
      await refusal(
        tenantA,
        pickup([{ productId: makiA, quantity: 1 }], { contact: { name: "X", phone: "12" } }),
      ),
    ).toBe("INVALID_CONTACT");
    expect(await refusal(tenantA, pickup([{ productId: makiA, quantity: 500 }]))).toBe(
      "INVALID_ORDER",
    );
    expect(await refusal(tenantA, pickup([{ productId: "not-a-uuid", quantity: 1 }]))).toBe(
      "INVALID_ORDER",
    );
  });
});

describe("what a visitor can read", () => {
  it("cannot read orders, web orders or storefronts directly", async () => {
    await placeAsAnon(tenantA, pickup([{ productId: makiA, quantity: 1 }]));

    const rows = await db.asRole("anon", async () => ({
      orders: await db.query("select 1 from public.orders"),
      web: await db.query("select 1 from public.web_orders"),
      storefronts: await db.query("select 1 from public.tenant_storefronts"),
    }));
    expect(rows).toEqual({ orders: [], web: [], storefronts: [] });
  });

  it("follows an order with its token, on its own business only", async () => {
    const placed = await placeAsAnon(tenantA, pickup([{ productId: makiA, quantity: 2 }]));
    const token = placed[0]!.access_token;

    const own = await db.asRole("anon", () =>
      db.query<{ order_number: number; total_cents: string; items: unknown[] }>(
        "select * from public.get_public_web_order($1, $2)",
        [tenantA, token],
      ),
    );
    expect(own).toHaveLength(1);
    expect(own[0]!.order_number).toBe(placed[0]!.order_number);
    expect(own[0]!.items).toHaveLength(1);

    const elsewhere = await db.asRole("anon", () =>
      db.query("select * from public.get_public_web_order($1, $2)", [tenantB, token]),
    );
    expect(elsewhere).toEqual([]);

    const guessed = await db.asRole("anon", () =>
      db.query("select * from public.get_public_web_order($1, $2)", [tenantA, "' or 1=1 --"]),
    );
    expect(guessed).toEqual([]);
  });

  it("reads the storefront, zones, methods and social links of one business", async () => {
    await db.query(
      `insert into public.tenant_social_links (tenant_id, platform, url)
       values ($1, 'instagram', 'https://instagram.com/sugu'), ($2, 'tiktok', 'https://tiktok.com/@b')`,
      [tenantA, tenantB],
    );

    const result = await db.asRole("anon", async () => ({
      storefront: await db.query<{ can_order: boolean; accepts_delivery: boolean }>(
        "select can_order, accepts_delivery from public.get_public_storefront($1)",
        [tenantA],
      ),
      zones: await db.query<{ name: string; fee_cents: string }>(
        "select name, fee_cents from public.list_public_delivery_zones($1)",
        [tenantA],
      ),
      methods: await db.query<{ name: string }>(
        "select name from public.list_public_payment_methods($1)",
        [tenantA],
      ),
      social: await db.query<{ platform: string }>(
        "select platform from public.list_public_social_links($1)",
        [tenantA],
      ),
    }));

    expect(result.storefront).toEqual([{ can_order: true, accepts_delivery: true }]);
    expect(result.zones.map((zone) => zone.name)).toEqual(["Pueblo Libre"]);
    expect(result.methods.map((method) => method.name)).toEqual(["Yape"]);
    expect(result.social.map((link) => link.platform)).toEqual(["instagram"]);
  });

  it("hides delivery when the module is off", async () => {
    await db.query(
      "insert into public.tenant_modules (tenant_id, module_code, is_enabled) values ($1, 'delivery', false)",
      [tenantA],
    );
    const result = await db.asRole("anon", async () => ({
      storefront: await db.query<{ accepts_delivery: boolean }>(
        "select accepts_delivery from public.get_public_storefront($1)",
        [tenantA],
      ),
      zones: await db.query("select 1 from public.list_public_delivery_zones($1)", [tenantA]),
    }));
    expect(result.storefront[0]!.accepts_delivery).toBe(false);
    expect(result.zones).toEqual([]);
  });

  it("returns nothing for a suspended business", async () => {
    await db.query("update public.tenants set status = 'suspended' where id = $1", [tenantA]);
    const result = await db.asRole("anon", async () => ({
      storefront: await db.query("select 1 from public.get_public_storefront($1)", [tenantA]),
      methods: await db.query("select 1 from public.list_public_payment_methods($1)", [tenantA]),
    }));
    expect(result).toEqual({ storefront: [], methods: [] });
  });

  it("ranks bestsellers by units sold, ignoring cancelled orders", async () => {
    const tenant = await insertTenant(db, { slug: "ranking" });
    const first = await insertProduct(tenant, "primero", 1000);
    const second = await insertProduct(tenant, "segundo", 1000);
    await db.query("update public.tenant_storefronts set mode = 'open' where tenant_id = $1", [
      tenant,
    ]);

    const order = (items: unknown[]) =>
      placeAsAnon(tenant, {
        contact: { name: "Cliente", phone: "912345678" },
        fulfillment: "pickup",
        items,
      });

    await order([{ productId: first, quantity: 1 }]);
    await order([{ productId: second, quantity: 2 }]);
    const cancelled = await order([{ productId: first, quantity: 5 }]);
    await db.query(
      `update public.orders set status = 'cancelled', cancelled_at = now(), cancel_reason = 'Prueba'
       where id = $1`,
      [cancelled[0]!.order_id],
    );

    const ranking = await db.asRole("anon", () =>
      db.query<{ product_id: string; units: string }>(
        "select product_id, units from public.list_public_bestsellers($1, 8)",
        [tenant],
      ),
    );
    expect(ranking.map((row) => row.product_id)).toEqual([second, first]);
  });
});
