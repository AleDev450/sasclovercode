import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "../helpers/database";
import {
  expectIndexAvailable,
  expectIndexed,
  explain,
  indexesUsed,
  scansSequentially,
  seedVolume,
  usesIndex,
} from "../helpers/performance";

/**
 * TEST-2604 to TEST-2613 — the hot queries, measured rather than assumed.
 *
 * Master section 33, Phase 26: "medir antes de optimizar". Every index in this
 * schema was added because somebody reasoned it would be needed, and until this
 * file existed nothing checked whether the planner agreed. Section 8 asks for
 * the opposite discipline too — "evitar sobreindexar; cada índice debe
 * responder a un patrón de consulta real" — and that is also unverifiable
 * without measuring which ones get touched.
 *
 * What a failure here means: either a query lost its index, or an index was
 * never right for the query it was written for. Both are worth a red build,
 * because both surface in production as a page that got slower every week and
 * nobody noticed the month it started.
 */

let db: TestDatabase;
let tenantId: string;

/** Every plan measured, so the unused-index report can look at all of them. */
const measuredPlans: string[] = [];

async function plan(sql: string, params: unknown[] = []): Promise<string> {
  const result = await explain(db, sql, params);
  measuredPlans.push(result);
  return result;
}

beforeAll(async () => {
  db = await createTestDatabase();
  ({ tenantId } = await seedVolume(db));
}, 120_000);

afterAll(async () => {
  await db.close();
});

describe("the measuring apparatus itself (TEST-2604, TEST-2605)", () => {
  it("loaded enough data for a plan to be informative (TEST-2604)", async () => {
    const rows = await db.query<{ n: string }>("select count(*)::text n from public.products");
    // Volume, and spread across tenants: both matter. The first version of the
    // seeder put every order under one tenant, which made `tenant_id` filter
    // nothing and produced a sequential scan the planner was right to choose.
    expect(Number(rows[0]?.n)).toBeGreaterThan(500);

    const tenants = await db.query<{ n: string }>(
      "select count(distinct tenant_id)::text n from public.orders",
    );
    expect(Number(tenants[0]?.n)).toBeGreaterThan(1);
  });

  /*
   * TEST-2605 - the guard of the guard.
   *
   * A performance test that cannot fail proves nothing, and this one would pass
   * happily against a schema with no indexes at all if `scansSequentially` were
   * broken. So: a query that SHOULD scan sequentially, asserted to do so.
   *
   * `units` is a small catalogue table with no selective filter, which is
   * exactly when a sequential scan is the correct plan.
   */
  it("detects a sequential scan when there really is one (TEST-2605)", async () => {
    const sequential = await explain(db, "select count(*) from public.products");
    expect(scansSequentially(sequential, "products")).toBe(true);

    // And the positive detector agrees it is not an index scan.
    expect(usesIndex(sequential, "products")).toBe(false);
  });
});

describe("hot query plans (TEST-2606 to TEST-2612)", () => {
  it("reads the public catalogue by index (TEST-2606)", async () => {
    const result = await plan(
      `select id, name, base_price_cents from public.products
       where tenant_id = $1 and status = 'active'
       order by position, name
       limit 25`,
      [tenantId],
    );
    expectIndexed(result, "products", "public catalogue");
    expect(indexesUsed(result)).toContain("products_tenant_status_idx");
  });

  it("reads products by category by index (TEST-2606b)", async () => {
    // The index master section 8 names explicitly: tenant_id + category_id.
    const category = await db.query<{ id: string }>(
      "select id from public.categories where tenant_id = $1 limit 1",
      [tenantId],
    );
    const result = await plan(
      "select id from public.products where tenant_id = $1 and category_id = $2",
      [tenantId, category[0]!.id],
    );
    expectIndexed(result, "products", "products by category");
  });

  it("reads the order list by index (TEST-2607)", async () => {
    const result = await plan(
      `select id, number, status from public.orders
       where tenant_id = $1 and status = 'ready'
       limit 25`,
      [tenantId],
    );
    expectIndexed(result, "orders", "order list");
  });

  it("reads one tenant's orders by index", async () => {
    const result = await plan(
      "select id from public.orders where tenant_id = $1 order by placed_at desc limit 25",
      [tenantId],
    );
    expectIndexed(result, "orders", "recent orders");
  });

  it("reads the lines of an order by index (TEST-2608)", async () => {
    const order = await db.query<{ id: string }>(
      "select id from public.orders where tenant_id = $1 limit 1",
      [tenantId],
    );
    const result = await plan("select id from public.order_items where order_id = $1", [
      order[0]!.id,
    ]);
    // The N+1 that never happened: order lines are read by order, and if this
    // ever became a sequential scan every order detail page would read every
    // line of every order in the database.
    expectIndexed(result, "order_items", "order lines");
  });

  it("reads customers by index (TEST-2611)", async () => {
    const result = await plan(
      "select id, name from public.customers where tenant_id = $1 order by name limit 25",
      [tenantId],
    );
    expectIndexed(result, "customers", "customer list");
  });

  /*
   * The three below are asserted differently, and the difference is the whole
   * lesson of measuring rather than assuming.
   *
   * `tenant_domains`, `locations` and `tenant_members` hold a handful of rows
   * per business. Even across forty tenants that is a couple of hundred rows,
   * and PostgreSQL reads them end to end rather than opening an index - which
   * is the RIGHT plan at that size. Asserting an index scan would have been
   * asserting something false, and the only way to make it pass would have been
   * to inflate the fixture until the planner agreed with the test. That is
   * fabricating a measurement to fit a conclusion.
   *
   * What still matters is that the index exists and covers the shape, so the
   * planner has something to reach for when a platform has ten thousand
   * businesses. `expectIndexAvailable` asks exactly that.
   */
  it("has a usable index for hostname resolution (TEST-2612)", async () => {
    await db.query(
      `insert into public.tenant_domains
         (tenant_id, domain, type, is_primary, verification_status, verified_at,
          verification_token)
       values ($1, 'perf-medicion.com', 'custom', false, 'active', now(),
               public.new_domain_verification_token())`,
      [tenantId],
    );
    // The single most frequent query in the product: once per request, before
    // anything else can happen.
    const result = await expectIndexAvailable(
      db,
      "select tenant_id from public.tenant_domains where domain = $1",
      ["perf-medicion.com"],
      "tenant_domains",
      "hostname resolution",
    );
    measuredPlans.push(result);
    expect(indexesUsed(result)).toContain("tenant_domains_domain_key");
  });

  it("has a usable index for the branch list", async () => {
    const result = await expectIndexAvailable(
      db,
      "select id from public.locations where tenant_id = $1 and is_active",
      [tenantId],
      "locations",
      "branch list",
    );
    measuredPlans.push(result);
  });

  it("has a usable index for the membership lookup", async () => {
    // `has_permission` runs inside every policy in the system, so a missing
    // index here would not slow one page down - it would slow all of them, on
    // the day the platform is big enough for it to matter.
    const result = await expectIndexAvailable(
      db,
      "select id from public.tenant_members where tenant_id = $1",
      [tenantId],
      "tenant_members",
      "membership lookup",
    );
    measuredPlans.push(result);
  });
});

/**
 * TEST-2613 — section 8's other half: "evitar sobreindexar".
 *
 * Reported rather than asserted, and deliberately so. An index no hot query
 * touches is not automatically wrong: it may serve a foreign key check, a
 * uniqueness guarantee, or a query a later phase will write. What is wrong is
 * nobody ever looking at the list.
 */
describe("index usage report (TEST-2613)", () => {
  it("reports which indexes the measured queries never touched", async () => {
    const all = await db.query<{ indexname: string; tablename: string }>(
      `select indexname, tablename from pg_indexes
       where schemaname = 'public'
         and indexname not like '%_pkey'
       order by tablename, indexname`,
    );

    const touched = new Set(measuredPlans.flatMap((p) => indexesUsed(p)));
    const untouched = all.filter((row) => !touched.has(row.indexname));

    // Printed, not failed. The number is large and most of it is legitimate -
    // unique constraints that exist to be constraints, and indexes for the
    // twenty phases of queries this file does not cover yet.
    console.log(
      `\nIndexes touched by the measured hot queries: ${touched.size}` +
        `\nIndexes not touched: ${untouched.length} of ${all.length}` +
        `\n(An untouched index is not necessarily wrong: it may back a foreign` +
        `\n key, enforce uniqueness, or serve a query not measured here.)\n`,
    );

    expect(all.length).toBeGreaterThan(0);
    expect(touched.size).toBeGreaterThan(0);
  });
});
