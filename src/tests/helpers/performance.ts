import type { TestDatabase } from "./database";

/**
 * Measuring query plans against real PostgreSQL.
 *
 * CLOVERCODE_MASTER.md section 33, Phase 26: "medir antes de optimizar". This
 * is the apparatus that makes the measuring possible, and the reason it can
 * exist at all is ADR-007: the tests run actual PostgreSQL in-process, so
 * `EXPLAIN (ANALYZE)` is available and reports a real plan over real rows.
 *
 * ---------------------------------------------------------------------------
 * THE TRAP THIS FILE EXISTS TO AVOID
 * ---------------------------------------------------------------------------
 *
 * `EXPLAIN` on an empty table proves nothing. With ten rows the planner picks a
 * sequential scan whether an index exists or not, because reading ten rows is
 * cheaper than opening an index — and it is right. A test that asserted "uses
 * an index" against a fixture of three rows would fail on correct schemas and
 * pass on broken ones.
 *
 * So `seedVolume` loads enough rows across enough tenants for the planner's
 * choice to be informative, and `analyze` gives it the statistics to choose
 * with. Only then does `explain` mean anything.
 *
 * ---------------------------------------------------------------------------
 * WHAT THESE MEASUREMENTS DO AND DO NOT PROVE
 * ---------------------------------------------------------------------------
 *
 * They prove that a usable index EXISTS for a query shape, and that the planner
 * reaches for it when the data makes that worthwhile.
 *
 * They do NOT prove production picks the same plan. Supabase runs different
 * hardware, different settings and much more data, and its planner may choose
 * differently. That is fine: the failure this catches is the one that matters -
 * somebody deletes an index, or adds a query no index covers - and that failure
 * is identical on every planner.
 */

/** Rows per tenant. Enough that a sequential scan stops being the cheap option. */
const ROWS_PER_TENANT = 60;

/**
 * Tenants.
 *
 * Forty rather than a handful, because several tables get only a few rows per
 * tenant - branches, members, domains - and it is the TENANT count that gives
 * those their volume. A platform serving one business is not the system being
 * measured; one serving hundreds is.
 */
const TENANT_COUNT = 40;

export interface SeededVolume {
  readonly tenantIds: readonly string[];
  /** The tenant whose rows the plan tests query. */
  readonly tenantId: string;
  readonly userId: string;
  readonly locationId: string;
}

/**
 * Loads a catalogue, customers, orders and stock movements across many tenants.
 *
 * Not a fixture for correctness tests - those want three rows and a clear
 * story. This exists to give the planner something to plan against, so it
 * trades readability for volume on purpose.
 */
export async function seedVolume(db: TestDatabase): Promise<SeededVolume> {
  /*
   * Set-based inserts, not a loop of round trips.
   *
   * An earlier version inserted row by row from JavaScript and took long enough
   * that the temptation was to seed less - which is the one thing this harness
   * cannot afford, because too little data makes every plan a sequential scan
   * and every assertion meaningless. `generate_series` moves the loop into
   * PostgreSQL, so realistic volume costs a second instead of a minute.
   */
  await db.exec(`
    insert into public.tenants (slug, name)
    select 'perf-tenant-' || g, 'Perf Tenant ' || g
    from generate_series(0, ${TENANT_COUNT - 1}) as g;
  `);

  const tenantRows = await db.query<{ id: string }>(
    "select id from public.tenants where slug like 'perf-tenant-%' order by slug",
  );
  const tenantIds = tenantRows.map((row) => row.id);
  const tenantId = tenantIds[0]!;

  /*
   * Several branches and several members per tenant.
   *
   * Not decoration. `locations` and `tenant_members` are read on hot paths -
   * `has_permission` runs inside every policy in the system - and with one row
   * each the planner correctly prefers a sequential scan, which would make the
   * assertions below test nothing. A platform with a thousand businesses has
   * thousands of rows in both, so seeding one per tenant models the wrong
   * system.
   */
  await db.exec(`
    insert into public.locations (tenant_id, name)
    select t.id, 'Sede ' || g
    from public.tenants as t
    cross join generate_series(1, 3) as g
    where t.slug like 'perf-tenant-%';
  `);

  await db.exec(`
    insert into auth.users (email)
    select 'perf-' || g || '@example.com'
    from generate_series(0, ${TENANT_COUNT * 4}) as g;
  `);

  const userRows = await db.query<{ id: string }>(
    "select id from auth.users where email like 'perf-%@example.com' order by email",
  );
  const userId = userRows[0]!.id;

  /*
   * Three members per tenant.
   *
   * `has_permission` runs inside every policy in the system, so this table is
   * read more than any other. With one row per tenant the planner correctly
   * prefers a sequential scan and the assertion below would be testing the
   * fixture rather than the schema.
   *
   * The same three people belong to every tenant, which is unusual but not
   * impossible - and irrelevant to a query plan, which cares about row counts
   * and selectivity rather than about who the rows are.
   */
  await db.exec(`
    insert into public.tenant_members (tenant_id, user_id, role)
    select t.id, u.id,
           (case when g = 1 then 'owner' else 'cashier' end)::public.tenant_role
    from public.tenants as t
    cross join generate_series(1, 3) as g
    join lateral (
      select id from auth.users
      where email like 'perf-%@example.com'
      order by email
      offset g - 1
      limit 1
    ) as u on true
    where t.slug like 'perf-tenant-%'
    on conflict do nothing;
  `);

  // Every tenant has a system domain in production; the resolver reads this
  // table once per request, so it needs to look like production.
  await db.exec(`
    insert into public.tenant_domains
      (tenant_id, domain, type, is_primary, verification_status, verified_at)
    select t.id, t.slug || '.clovercodeapp.com', 'system', true, 'active', now()
    from public.tenants as t
    where t.slug like 'perf-tenant-%'
    on conflict do nothing;
  `);

  await db.exec(`
    insert into public.categories (tenant_id, name, slug)
    select t.id, 'Perf', 'perf'
    from public.tenants as t
    where t.slug like 'perf-tenant-%';
  `);

  await db.exec(`
    insert into public.products
      (tenant_id, category_id, name, slug, status, base_price_cents)
    select c.tenant_id, c.id, 'producto-' || g, 'producto-' || g,
           (case when g % 3 = 0 then 'active' else 'draft' end)::public.product_status,
           1000 + g
    from public.categories as c
    join public.tenants as t on t.id = c.tenant_id
    cross join generate_series(1, ${ROWS_PER_TENANT}) as g
    where t.slug like 'perf-tenant-%';
  `);

  await db.exec(`
    insert into public.customers (tenant_id, name, phone)
    select t.id, 'Cliente ' || g, '9' || lpad(g::text, 8, '0')
    from public.tenants as t
    cross join generate_series(1, ${ROWS_PER_TENANT}) as g
    where t.slug like 'perf-tenant-%';
  `);

  /*
   * Orders for EVERY tenant, not just the one being measured.
   *
   * The first version of this seeder loaded orders for one tenant only, and the
   * plan came back as a sequential scan - correctly. With every row belonging to
   * the same tenant, `where tenant_id = ...` filters out nothing, so an index on
   * it is worthless and the planner said so. The measurement was not wrong; the
   * data was, and a seeder that produces unselective data measures nothing.
   *
   * Statuses stay short of `completed` on purpose: a CHECK requires
   * `completed_at` to be present exactly when an order is completed, and this
   * seeder has no business inventing timestamps to satisfy a rule it is not
   * testing.
   */
  await db.exec(`
    insert into public.orders (tenant_id, location_id, status)
    select l.tenant_id, l.id,
           (array['pending', 'confirmed', 'preparing', 'ready'])[1 + (g % 4)]::public.order_status
    from (
      select distinct on (tenant_id) tenant_id, id
      from public.locations
      order by tenant_id, created_at
    ) as l
    join public.tenants as t on t.id = l.tenant_id
    cross join generate_series(1, ${ROWS_PER_TENANT}) as g
    where t.slug like 'perf-tenant-%';
  `);

  /*
   * Two lines per PENDING order.
   *
   * Only pending ones: a trigger from Phase 13 refuses to change the lines of
   * an order that has moved on ("An order that is no longer pending cannot
   * change its lines"), which is the state machine doing exactly what it was
   * built to do. Seeding around it rather than through it keeps this harness
   * from needing privileges the application does not have.
   *
   * Without these lines `order_items` would be empty, and a plan over an empty
   * table says nothing at all.
   */
  await db.exec(`
    insert into public.order_items
      (order_id, tenant_id, name_snapshot, unit_price_cents, quantity)
    select o.id, o.tenant_id, 'Linea ' || g, 1500 * g, g
    from public.orders as o
    join public.tenants as t on t.id = o.tenant_id
    cross join generate_series(1, 2) as g
    where t.slug like 'perf-tenant-%'
      and o.status = 'pending';
  `);

  const locationRows = await db.query<{ id: string }>(
    "select id from public.locations where tenant_id = $1 order by created_at limit 1",
    [tenantId],
  );

  await analyze(db);

  return { tenantIds, tenantId, userId, locationId: locationRows[0]!.id };
}

/** Refreshes the statistics the planner reads. Without this, volume is invisible. */
export async function analyze(db: TestDatabase): Promise<void> {
  await db.exec("analyze;");
}

/** Runs EXPLAIN ANALYZE and returns the plan as the text a person would read. */
export async function explain(
  db: TestDatabase,
  sql: string,
  params: unknown[] = [],
): Promise<string> {
  const rows = await db.query<Record<string, string>>(
    `explain (analyze, buffers, format text) ${sql}`,
    params,
  );
  // PostgreSQL names the column "QUERY PLAN"; reading it by position avoids
  // depending on that spelling.
  return rows.map((row) => Object.values(row)[0] ?? "").join("\n");
}

/**
 * True when the plan reads `table` sequentially.
 *
 * Matches the node name PostgreSQL prints. `Parallel Seq Scan` counts too: it
 * is the same full read with more workers.
 */
export function scansSequentially(plan: string, table: string): boolean {
  return new RegExp(`(Parallel )?Seq Scan on ${table}\\b`).test(plan);
}

/** True when the plan reaches for any index on `table`. */
export function usesIndex(plan: string, table: string): boolean {
  return new RegExp(`(Index Scan|Index Only Scan|Bitmap Index Scan).*${table}`, "s").test(plan);
}

/** The index names a plan actually touched. */
export function indexesUsed(plan: string): string[] {
  const names = new Set<string>();
  for (const match of plan.matchAll(/(?:Index Scan|Index Only Scan) using (\w+)/g)) {
    if (match[1] !== undefined) names.add(match[1]);
  }
  for (const match of plan.matchAll(/Bitmap Index Scan on (\w+)/g)) {
    if (match[1] !== undefined) names.add(match[1]);
  }
  return [...names];
}

/**
 * Asserts a query does not read `table` end to end, and says why when it does.
 *
 * Throws with the whole plan attached rather than a bare boolean: a failing
 * performance test whose message is `expected true to be false` sends the
 * reader back to reproduce it by hand, which is the moment most people stop.
 */
export function expectIndexed(plan: string, table: string, label: string): void {
  if (scansSequentially(plan, table)) {
    throw new Error(
      `${label}: sequential scan on "${table}" with volume loaded.\n` +
        `Either the query lost its index, or the index was never there.\n\n${plan}`,
    );
  }
}

/**
 * Asserts that an index EXISTS and is usable for a query shape, without
 * claiming the planner should prefer it.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A SECOND, DIFFERENT ASSERTION
 * ---------------------------------------------------------------------------
 *
 * Some hot tables are small. `locations` holds a few branches per business,
 * `tenant_members` a few staff, `tenant_domains` one or two names. Even across
 * forty tenants that is a couple of hundred rows - two or three pages - and
 * PostgreSQL correctly reads them end to end rather than opening an index.
 *
 * Asserting `expectIndexed` on those would be asserting something false. The
 * planner is not wrong; the assertion would be. And "make the fixture bigger
 * until the planner agrees with my test" is the exact inversion of "medir antes
 * de optimizar" - it fabricates a measurement to fit a conclusion.
 *
 * What is still worth guaranteeing for those tables is that the index is THERE
 * and COVERS the shape, so that the day a platform has ten thousand businesses
 * the planner has something to reach for. Turning the sequential scan off asks
 * the planner exactly that question: given no choice, can you serve this from
 * an index?
 *
 * A table with no usable index answers no - it falls back to a sequential scan
 * anyway, because `enable_seqscan = off` is a strong preference and not a
 * prohibition. That is the failure this catches.
 */
export async function expectIndexAvailable(
  db: TestDatabase,
  sql: string,
  params: unknown[],
  table: string,
  label: string,
): Promise<string> {
  await db.exec("set enable_seqscan = off;");
  try {
    const plan = await explain(db, sql, params);
    if (!usesIndex(plan, table)) {
      throw new Error(
        `${label}: no usable index on "${table}".
` +
          `Asked the planner to avoid a sequential scan and it could not.

${plan}`,
      );
    }
    return plan;
  } finally {
    await db.exec("reset enable_seqscan;");
  }
}
