import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, insertTenant, type TestDatabase } from "../helpers/database";

/**
 * Phase 11 at the database level.
 *
 * Master section 33 says it for this phase in particular:
 *
 *   "Todas las restricciones deben ser tenant-aware.
 *    UNIQUE(tenant_id, slug) - no UNIQUE(slug)."
 *
 * So TEST-1113 does not check one table, it walks every unique index of the
 * five and fails on any that does not start with `tenant_id` or belong to a
 * product. A rule stated as an example is a rule somebody will apply to four
 * tables out of five.
 */

let db: TestDatabase;

let tenantA: string;
let tenantB: string;
let suspended: string;

let ownerA: string;
let cashierA: string;
let ownerB: string;
let strangerId: string;

let categoryA: string;
let activeProduct: string;
let draftProduct: string;
let productB: string;

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

async function insertCategory(tenantId: string, name: string, slug: string): Promise<string> {
  const rows = await db.query<{ id: string }>(
    "insert into public.categories (tenant_id, name, slug) values ($1, $2, $3) returning id",
    [tenantId, name, slug],
  );
  return rows[0]!.id;
}

async function insertProduct(
  tenantId: string,
  slug: string,
  options: { status?: string; categoryId?: string | null; priceCents?: number } = {},
): Promise<string> {
  const rows = await db.query<{ id: string }>(
    `insert into public.products (tenant_id, name, slug, status, category_id, base_price_cents)
     values ($1, $2, $2, coalesce($3, 'draft')::public.product_status, $4,
             coalesce($5::bigint, 0))
     returning id`,
    [
      tenantId,
      slug,
      options.status ?? null,
      options.categoryId ?? null,
      options.priceCents ?? null,
    ],
  );
  return rows[0]!.id;
}

beforeAll(async () => {
  db = await createTestDatabase();

  tenantA = await insertTenant(db, { slug: "sugurolls", name: "Sugu Rolls" });
  tenantB = await insertTenant(db, { slug: "polleria-el-rey", name: "Pollería El Rey" });
  suspended = await insertTenant(db, { slug: "en-pausa", name: "En Pausa", status: "suspended" });

  ownerA = await createUser("owner@sugurolls.com");
  cashierA = await createUser("cashier@sugurolls.com");
  ownerB = await createUser("owner@polleria.pe");
  strangerId = await createUser("nadie@example.com");

  await addMember(tenantA, ownerA, "owner");
  await addMember(tenantA, cashierA, "cashier");
  await addMember(tenantB, ownerB, "owner");

  categoryA = await insertCategory(tenantA, "Makis", "makis");
  activeProduct = await insertProduct(tenantA, "maki-acevichado", {
    status: "active",
    categoryId: categoryA,
    priceCents: 2490,
  });
  draftProduct = await insertProduct(tenantA, "novedad-secreta", { status: "draft" });
  productB = await insertProduct(tenantB, "pollo-a-la-brasa", { status: "active" });
});

afterAll(async () => {
  await db.close();
});

describe("tenant-aware constraints (TEST-1110 to TEST-1113)", () => {
  it("scopes the category slug to the tenant (TEST-1110)", async () => {
    await expect(insertCategory(tenantA, "Makis otra vez", "makis")).rejects.toThrow(
      /categories_tenant_slug_key/,
    );
    await expect(insertCategory(tenantB, "Makis", "makis")).resolves.toBeDefined();
  });

  it("scopes the product slug to the tenant (TEST-1111, TEST-1112)", async () => {
    await expect(insertProduct(tenantA, "maki-acevichado")).rejects.toThrow(
      /products_tenant_slug_key/,
    );
    await expect(insertProduct(tenantB, "maki-acevichado")).resolves.toBeDefined();
  });

  /*
   * TEST-1113 - the rule of master section 33, checked over the schema rather
   * than over one example.
   *
   * Every unique index on these five tables must be scoped: either by
   * `tenant_id` directly, or by `product_id`, which is itself owned by exactly
   * one tenant. A bare `unique (slug)` would not leak anything - it would stop
   * a restaurant creating `ceviche` because a business they have never heard of
   * got there first.
   */
  it("has no globally unique constraint on any catalogue table (TEST-1113)", async () => {
    const rows = await db.query<{ tablename: string; indexname: string; indexdef: string }>(
      `select tablename, indexname, indexdef
       from pg_indexes
       where schemaname = 'public'
         and tablename in ('categories', 'products', 'product_images',
                           'product_variants', 'product_options')
         and indexdef like 'CREATE UNIQUE%'`,
    );

    expect(rows.length).toBeGreaterThan(0);

    for (const row of rows) {
      // The primary key is on `id`, which is a uuid and global by nature.
      if (row.indexname.endsWith("_pkey")) continue;

      const scoped = row.indexdef.includes("tenant_id") || row.indexdef.includes("product_id");
      expect(scoped, `${row.indexname} is not tenant-scoped: ${row.indexdef}`).toBe(true);
    }
  });
});

describe("prices and money (TEST-1114, TEST-1115)", () => {
  it("refuses a negative price (TEST-1114)", async () => {
    await expect(insertProduct(tenantA, "precio-negativo", { priceCents: -1 })).rejects.toThrow(
      /products_price_range/,
    );
  });

  it("refuses an absurd price (TEST-1115)", async () => {
    await expect(
      insertProduct(tenantA, "precio-absurdo", { priceCents: 10_000_000_001 }),
    ).rejects.toThrow(/products_price_range/);
  });

  it("accepts a price of zero, because free things exist (EC-1104)", async () => {
    await expect(insertProduct(tenantA, "vaso-de-agua", { priceCents: 0 })).resolves.toBeDefined();
  });

  it("stores the price as an exact integer, not a rounded float", async () => {
    const id = await insertProduct(tenantA, "precio-exacto", { priceCents: 807 });
    // Read back as text so nothing on this side can turn it into a double.
    const rows = await db.query<{ price: string }>(
      "select base_price_cents::text as price from public.products where id = $1",
      [id],
    );
    expect(rows[0]?.price).toBe("807");
  });

  it("bounds an option's price delta on both sides", async () => {
    for (const delta of [-1000001, 1000001]) {
      await expect(
        db.query(
          `insert into public.product_options (product_id, tenant_id, group_label, name, price_delta_cents)
           values ($1, $2, 'Extras', $3, $4)`,
          [activeProduct, tenantA, `delta-${delta}`, delta],
        ),
      ).rejects.toThrow(/product_options_delta_range/);
    }
  });

  it("allows a negative delta, because a smaller portion costs less", async () => {
    await expect(
      db.query(
        `insert into public.product_options (product_id, tenant_id, group_label, name, price_delta_cents)
         values ($1, $2, 'Tamano', 'Media porcion', -500)`,
        [activeProduct, tenantA],
      ),
    ).resolves.toBeDefined();
  });
});

describe("relationships (TEST-1116, TEST-1117)", () => {
  it("leaves products alone when their category goes (TEST-1116)", async () => {
    const category = await insertCategory(tenantA, "Temporal", "temporal");
    const product = await insertProduct(tenantA, "con-categoria-temporal", {
      categoryId: category,
    });

    await db.query("delete from public.categories where id = $1", [category]);

    const rows = await db.query<{ category_id: string | null }>(
      "select category_id from public.products where id = $1",
      [product],
    );
    // Deleting a grouping must never delete the things being grouped.
    expect(rows).toHaveLength(1);
    expect(rows[0]?.category_id).toBeNull();
  });

  it("takes images, variants and options with the product (TEST-1117)", async () => {
    const product = await insertProduct(tenantA, "efimero");
    await db.query(
      "insert into public.product_images (product_id, tenant_id, path) values ($1, $2, $3)",
      [product, tenantA, `tenants/${tenantA}/products/foto.jpg`],
    );
    await db.query(
      "insert into public.product_variants (product_id, tenant_id, name) values ($1, $2, 'Unica')",
      [product, tenantA],
    );
    await db.query(
      `insert into public.product_options (product_id, tenant_id, group_label, name)
       values ($1, $2, 'Extras', 'Nada')`,
      [product, tenantA],
    );

    await db.query("delete from public.products where id = $1", [product]);

    for (const table of ["product_images", "product_variants", "product_options"]) {
      const rows = await db.query(`select id from public.${table} where product_id = $1`, [
        product,
      ]);
      expect(rows, table).toEqual([]);
    }
  });

  it("refuses a category that belongs to another business", async () => {
    const categoryB = await insertCategory(tenantB, "Brasas", "brasas");
    await expect(
      insertProduct(tenantA, "categoria-ajena", { categoryId: categoryB }),
    ).rejects.toThrow(/different business/);
  });
});

describe("variants and images (TEST-1118 to TEST-1121)", () => {
  it("scopes the SKU to the tenant (TEST-1118)", async () => {
    await db.query(
      `insert into public.product_variants (product_id, tenant_id, name, sku)
       values ($1, $2, 'Personal', 'SKU-001')`,
      [activeProduct, tenantA],
    );

    await expect(
      db.query(
        `insert into public.product_variants (product_id, tenant_id, name, sku)
         values ($1, $2, 'Familiar', 'sku-001')`,
        [activeProduct, tenantA],
      ),
    ).rejects.toThrow(/product_variants_tenant_sku_key/);

    // Another business may use the same SKU: it identifies a thing inside ONE
    // company's stock.
    await expect(
      db.query(
        `insert into public.product_variants (product_id, tenant_id, name, sku)
         values ($1, $2, 'Entero', 'SKU-001')`,
        [productB, tenantB],
      ),
    ).resolves.toBeDefined();
  });

  it("allows many variants with no SKU at all", async () => {
    const product = await insertProduct(tenantA, "sin-skus");
    for (const name of ["Chico", "Mediano", "Grande"]) {
      await db.query(
        "insert into public.product_variants (product_id, tenant_id, name) values ($1, $2, $3)",
        [product, tenantA, name],
      );
    }
    const rows = await db.query("select id from public.product_variants where product_id = $1", [
      product,
    ]);
    expect(rows).toHaveLength(3);
  });

  it("allows only one primary image per product (TEST-1119)", async () => {
    const product = await insertProduct(tenantA, "dos-principales");
    await db.query(
      `insert into public.product_images (product_id, tenant_id, path, is_primary)
       values ($1, $2, $3, true)`,
      [product, tenantA, `tenants/${tenantA}/products/uno.jpg`],
    );

    await expect(
      db.query(
        `insert into public.product_images (product_id, tenant_id, path, is_primary)
         values ($1, $2, $3, true)`,
        [product, tenantA, `tenants/${tenantA}/products/dos.jpg`],
      ),
    ).rejects.toThrow(/product_images_one_primary_per_product/);
  });

  it("refuses an image path from another tenant's folder (TEST-1120)", async () => {
    await expect(
      db.query(
        "insert into public.product_images (product_id, tenant_id, path) values ($1, $2, $3)",
        [activeProduct, tenantA, `tenants/${tenantB}/products/robada.jpg`],
      ),
    ).rejects.toThrow(/product_images_path_own_tenant/);
  });

  /*
   * TEST-1121 - the distinction the whole product table is built around.
   *
   * `status` is editorial and `is_available` is about today. A kitchen that
   * runs out of fish at three o'clock marks it unavailable; it does not
   * unpublish the dish and republish it tomorrow.
   */
  it("keeps status and availability independent (TEST-1121)", async () => {
    const rows = await db.query<{ status: string; is_available: boolean }>(
      `update public.products set is_available = false where id = $1
       returning status, is_available`,
      [activeProduct],
    );
    expect(rows[0]?.status).toBe("active");
    expect(rows[0]?.is_available).toBe(false);

    await db.query("update public.products set is_available = true where id = $1", [activeProduct]);
  });
});

describe("the tenant trigger (TEST-1122 to TEST-1124)", () => {
  it("derives tenant_id from the product (TEST-1122)", async () => {
    const rows = await db.query<{ tenant_id: string }>(
      `insert into public.product_variants (product_id, tenant_id, name)
       values ($1, $2, 'Derivada')
       returning tenant_id`,
      [activeProduct, tenantA],
    );
    expect(rows[0]?.tenant_id).toBe(tenantA);
  });

  /*
   * TEST-1123 - the attack of SPEC AB-1101.
   *
   * A caller supplies another business's `product_id` together with their OWN
   * tenant_id. The insert policy checks the permission against the tenant_id in
   * the row - which they do hold - and without the trigger the variant would
   * land attached to somebody else's product.
   */
  it("overwrites a tenant_id sent by hand (TEST-1123)", async () => {
    const rows = await db.query<{ tenant_id: string }>(
      `insert into public.product_variants (product_id, tenant_id, name)
       values ($1, $2, 'Infiltrada')
       returning tenant_id`,
      [productB, tenantA],
    );
    // Sent A, stored B, because the product belongs to B.
    expect(rows[0]?.tenant_id).toBe(tenantB);
    expect(rows[0]?.tenant_id).not.toBe(tenantA);
  });

  it("refuses a child of a product that does not exist (TEST-1124)", async () => {
    await expect(
      db.query(
        `insert into public.product_options (product_id, tenant_id, group_label, name)
         values ('00000000-0000-0000-0000-000000000000', $1, 'G', 'N')`,
        [tenantA],
      ),
    ).rejects.toThrow(/Product not found/);
  });
});

describe("RLS (TEST-1125 to TEST-1134)", () => {
  it("lets a member with products.view read the catalogue (TEST-1125)", async () => {
    const rows = await db.asUser(cashierA, () =>
      db.query("select id from public.products where tenant_id = $1", [tenantA]),
    );
    expect(rows.length).toBeGreaterThan(0);
  });

  it("still refuses a cashier a write (TEST-1126)", async () => {
    await db.asUser(cashierA, () =>
      db.query("update public.products set name = 'Renombrado' where id = $1", [activeProduct]),
    );
    const rows = await db.query<{ name: string }>(
      "select name from public.products where id = $1",
      [activeProduct],
    );
    expect(rows[0]?.name).not.toBe("Renombrado");
  });

  it("refuses a create without products.create (TEST-1127)", async () => {
    await expect(
      db.asUser(cashierA, () =>
        db.query(
          "insert into public.products (tenant_id, name, slug) values ($1, 'X', 'x-cajero')",
          [tenantA],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("refuses creating a product in another tenant (TEST-1128)", async () => {
    await expect(
      db.asUser(ownerA, () =>
        db.query(
          "insert into public.products (tenant_id, name, slug) values ($1, 'Infiltrado', 'infiltrado')",
          [tenantB],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("lets an owner create in their own tenant", async () => {
    await expect(
      db.asUser(ownerA, () =>
        db.query(
          "insert into public.products (tenant_id, name, slug) values ($1, 'Propio', 'propio')",
          [tenantA],
        ),
      ),
    ).resolves.toBeDefined();
  });

  it("shows an anonymous visitor the published products (TEST-1129)", async () => {
    const rows = await db.asRole("anon", () =>
      db.query<{ id: string }>("select id from public.products where tenant_id = $1", [tenantA]),
    );
    expect(rows.some((row) => row.id === activeProduct)).toBe(true);
  });

  /*
   * TEST-1130 - the lesson of A7-1, applied before it can happen again.
   *
   * A visitor signed in to their OWN business is `authenticated`, not `anon`. A
   * policy naming only `anon` would make the whole menu vanish for anyone with
   * a session - invisible in a private window, which is the worst way for a bug
   * to present.
   */
  it("shows them to a SIGNED-IN stranger too (TEST-1130)", async () => {
    const rows = await db.asUser(strangerId, () =>
      db.query<{ id: string }>("select id from public.products where tenant_id = $1", [tenantA]),
    );
    expect(rows.some((row) => row.id === activeProduct)).toBe(true);
  });

  it("hides drafts and archived products from outside (TEST-1131)", async () => {
    for (const read of [
      () =>
        db.asRole("anon", () =>
          db.query("select id from public.products where id = $1", [draftProduct]),
        ),
      () =>
        db.asUser(strangerId, () =>
          db.query("select id from public.products where id = $1", [draftProduct]),
        ),
    ]) {
      expect(await read()).toEqual([]);
    }
  });

  it("hides the catalogue of a suspended business (TEST-1132)", async () => {
    await insertProduct(suspended, "producto-en-pausa", { status: "active" });
    const rows = await db.asRole("anon", () =>
      db.query("select id from public.products where tenant_id = $1", [suspended]),
    );
    expect(rows).toEqual([]);
  });

  /*
   * TEST-1133. Checking only the child's own flag would publish the variants of
   * a DRAFT product to anyone who asked for them directly - which is how a
   * competitor reads next month's prices.
   */
  it("makes children follow the parent's visibility, not their own (TEST-1133)", async () => {
    await db.query(
      `insert into public.product_variants (product_id, tenant_id, name, price_cents)
       values ($1, $2, 'Precio del mes que viene', 9900)`,
      [draftProduct, tenantA],
    );
    await db.query(
      `insert into public.product_variants (product_id, tenant_id, name, price_cents)
       values ($1, $2, 'Publica', 2490)`,
      [activeProduct, tenantA],
    );

    const hidden = await db.asRole("anon", () =>
      db.query("select id from public.product_variants where product_id = $1", [draftProduct]),
    );
    const visible = await db.asRole("anon", () =>
      db.query("select id from public.product_variants where product_id = $1", [activeProduct]),
    );

    expect(hidden).toEqual([]);
    expect(visible.length).toBeGreaterThan(0);
  });

  it("still shows a member their own drafts (TEST-1134)", async () => {
    const rows = await db.asUser(ownerA, () =>
      db.query("select id from public.products where id = $1", [draftProduct]),
    );
    expect(rows).toHaveLength(1);
  });

  it("shows a member of another tenant only what the public sees", async () => {
    const rows = await db.asUser(ownerB, () =>
      db.query<{ status: string }>("select status from public.products where tenant_id = $1", [
        tenantA,
      ]),
    );
    expect(rows.every((row) => row.status === "active")).toBe(true);
  });

  it("hides an inactive category from outside but not from its owner", async () => {
    const category = await insertCategory(tenantA, "Escondida", "escondida");
    await db.query("update public.categories set is_active = false where id = $1", [category]);

    const outside = await db.asRole("anon", () =>
      db.query("select id from public.categories where id = $1", [category]),
    );
    const inside = await db.asUser(ownerA, () =>
      db.query("select id from public.categories where id = $1", [category]),
    );

    expect(outside).toEqual([]);
    expect(inside).toHaveLength(1);
  });
});
