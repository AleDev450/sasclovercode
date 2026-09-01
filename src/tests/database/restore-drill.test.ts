import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestDatabase,
  insertTenant,
  listMigrationFiles,
  type TestDatabase,
} from "../helpers/database";
import { diffDumps, dumpDatabase, dumpSize, restoreDump, type Dump } from "../helpers/backup";

/**
 * TEST-2701 to TEST-2712 — the restoration drill.
 *
 * Master section 33, Phase 27: "realizar al menos una prueba real de
 * restauración en entorno no productivo", and the reason — "un backup que nunca
 * se probó no puede considerarse estrategia de recuperación".
 *
 * This is that test, and it runs on every push rather than once. A rehearsal
 * somebody has to remember to perform is one that gets performed the first time
 * and never again, which is the same as not having one on the day it matters.
 *
 * What it rehearses is the hazard, not the tooling: a restore loads rows that
 * ALREADY EXISTED into a schema whose 123 triggers assume rows are being
 * created. `pg_restore --disable-triggers` and this file both handle it with
 * `session_replication_role = 'replica'`.
 */

let source: TestDatabase;
let dump: Dump;
let tenantA: string;
let tenantB: string;

beforeAll(async () => {
  source = await createTestDatabase();

  tenantA = await insertTenant(source, { slug: "restaurante-a", name: "Restaurante A" });
  tenantB = await insertTenant(source, { slug: "restaurante-b", name: "Restaurante B" });

  // Enough shape that the interesting triggers have something to act on: a
  // catalogue, a customer and an order with lines.
  for (const [tenant, label] of [
    [tenantA, "A"],
    [tenantB, "B"],
  ] as const) {
    const category = await source.query<{ id: string }>(
      "insert into public.categories (tenant_id, name, slug) values ($1, $2, 'carta') returning id",
      [tenant, `Carta ${label}`],
    );
    await source.query(
      `insert into public.products (tenant_id, category_id, name, slug, status, base_price_cents)
       values ($1, $2, $3, 'plato', 'active', 2490)`,
      [tenant, category[0]!.id, `Plato ${label}`],
    );
    await source.query("insert into public.customers (tenant_id, name) values ($1, $2)", [
      tenant,
      `Cliente ${label}`,
    ]);

    const location = await source.query<{ id: string }>(
      "select id from public.locations where tenant_id = $1 limit 1",
      [tenant],
    );
    await source.query(
      "insert into public.orders (tenant_id, location_id, status) values ($1, $2, 'pending')",
      [tenant, location[0]!.id],
    );
  }

  dump = await dumpDatabase(source);
}, 120_000);

afterAll(async () => {
  await source.close();
});

describe("the schema rebuilds from nothing (TEST-2701, TEST-2702)", () => {
  it("applies every migration to an empty database (TEST-2701)", async () => {
    // The other half of a recovery: data is worth nothing without the schema
    // it belongs to, and section 22 requires that the schema come from
    // versioned migrations rather than from a snapshot somebody took.
    const files = await listMigrationFiles();
    expect(files.length).toBeGreaterThan(0);

    const rebuilt = await createTestDatabase();
    try {
      const tables = await rebuilt.query<{ n: string }>(
        "select count(*)::text n from pg_tables where schemaname = 'public'",
      );
      expect(Number(tables[0]?.n)).toBeGreaterThan(50);
    } finally {
      await rebuilt.close();
    }
  }, 120_000);

  it("produces the same schema every time (TEST-2702)", async () => {
    const one = await createTestDatabase();
    const two = await createTestDatabase();
    try {
      const shape = async (db: TestDatabase) =>
        db.query<{ table_name: string; column_name: string }>(
          `select table_name, column_name from information_schema.columns
           where table_schema = 'public' order by table_name, column_name`,
        );
      expect(await shape(one)).toEqual(await shape(two));
    } finally {
      await one.close();
      await two.close();
    }
  }, 120_000);
});

/**
 * TEST-2703, TEST-2704 — the finding, fixed in place.
 *
 * This is what a restore does when nobody knows about triggers, and it is why
 * the runbook has the line it has. Kept as a test rather than a paragraph so
 * that a future change which quietly makes the naive path work — or makes the
 * correct path fail differently — is noticed.
 */
describe("a naive restore fails (TEST-2703, TEST-2704)", () => {
  it("dies on a constraint the triggers created themselves", async () => {
    const target = await createTestDatabase();
    let message = "";

    try {
      await restoreDump(target, dump, { replicaMode: false });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    } finally {
      await target.close();
    }

    // Not "degrades", not "duplicates": fails, halfway through the load, with
    // part of the data in and part out. `create_tenant_defaults` invents a
    // location when the tenant row lands, and the real location from the dump
    // then collides with it.
    expect(message, "a restore with triggers enabled should fail").not.toBe("");
    expect(message).toMatch(/duplicate key|unique constraint/i);
  }, 120_000);
});

describe("the restore that works (TEST-2705 to TEST-2709)", () => {
  let restored: TestDatabase;
  let after: Dump;

  beforeAll(async () => {
    restored = await createTestDatabase();
    await restoreDump(restored, dump, { replicaMode: true });
    after = await dumpDatabase(restored);
  }, 120_000);

  afterAll(async () => {
    await restored.close();
  });

  it("loads without a trigger firing (TEST-2705)", () => {
    expect(dumpSize(after)).toBe(dumpSize(dump));
  });

  it("restores the same number of rows in every table (TEST-2706)", () => {
    for (const { table, rows } of dump) {
      const copy = after.find((entry) => entry.table === table);
      expect(copy?.rows.length, `${table} row count`).toBe(rows.length);
    }
  });

  it("restores the rows themselves, not just the count (TEST-2707)", () => {
    const problems = diffDumps(dump, after);
    expect(problems, `restored data differs:\n${problems.join("\n")}`).toEqual([]);
  });

  /*
   * TEST-2708 - the columns a trigger would have rewritten.
   *
   * `set_updated_at` stamps `now()` on every update, order numbers are assigned
   * by a trigger, and `tenant_id` on child tables is derived from the parent.
   * If any of those fired during the restore, the data would come back subtly
   * wrong rather than missing - which is the kind of corruption nobody notices
   * until a report disagrees with a customer.
   */
  it("keeps the values a trigger would have overwritten (TEST-2708)", async () => {
    const original = await source.query<{ id: string; number: number; updated_at: Date }>(
      "select id, number, updated_at from public.orders order by id",
    );
    const copy = await restored.query<{ id: string; number: number; updated_at: Date }>(
      "select id, number, updated_at from public.orders order by id",
    );

    expect(copy).toHaveLength(original.length);
    for (const [index, row] of original.entries()) {
      expect(copy[index]?.number, "order number was reassigned").toBe(row.number);
      expect(new Date(String(copy[index]?.updated_at)).getTime(), "updated_at was restamped").toBe(
        new Date(String(row.updated_at)).getTime(),
      );
    }
  });

  it("keeps two tenants apart through the restore (TEST-2709)", async () => {
    const rows = await restored.query<{ tenant_id: string; n: string }>(
      "select tenant_id, count(*)::text n from public.products group by tenant_id",
    );
    expect(rows).toHaveLength(2);
    const ids = rows.map((row) => row.tenant_id).sort();
    expect(ids).toEqual([tenantA, tenantB].sort());
  });
});

/**
 * TEST-2710 to TEST-2712 — the part that matters more than the data.
 *
 * A restore that returns the rows and leaves RLS off returns everyone's rows to
 * everyone. It would look like a successful recovery, and nobody would find out
 * until it was far too late. So the drill checks the defences after the
 * restore, not only the contents.
 */
describe("isolation survives the restore (TEST-2710 to TEST-2712)", () => {
  let restored: TestDatabase;

  beforeAll(async () => {
    restored = await createTestDatabase();
    await restoreDump(restored, dump, { replicaMode: true });
  }, 120_000);

  afterAll(async () => {
    await restored.close();
  });

  it("leaves row level security enabled on every tenant table (TEST-2710)", async () => {
    const rows = await restored.query<{ tablename: string }>(
      `select c.relname as tablename
       from pg_class as c
       join pg_namespace as n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relkind = 'r'
         and not c.relrowsecurity
       order by c.relname`,
    );

    // The catalogue tables of Phase 03 hold no tenant data and are readable by
    // design; everything else must still be protected.
    const allowed = new Set(["roles", "permissions", "role_permissions", "modules"]);
    const unprotected = rows.map((row) => row.tablename).filter((name) => !allowed.has(name));

    expect(unprotected, `tables without RLS after a restore: ${unprotected.join(", ")}`).toEqual(
      [],
    );
  });

  it("still hides one tenant's data from another (TEST-2711)", async () => {
    const userId = await restored.query<{ id: string }>(
      "insert into auth.users (email) values ('a@example.com') returning id",
    );
    await restored.query(
      "insert into public.tenant_members (tenant_id, user_id, role) values ($1, $2, 'owner')",
      [tenantA, userId[0]!.id],
    );

    /*
     * Asserted over `customers`, not over `products`.
     *
     * A published product is PUBLIC - the Phase 11 policy grants it to `anon`
     * and `authenticated` alike, deliberately (the A7-1 lesson), so a member of
     * A can read B's menu exactly as any visitor can. Asserting isolation over
     * it would be asserting something false, and the same premise error was
     * made and corrected in Phases 10 and 11.
     *
     * A customer is never public. If a restore left RLS ineffective, this is
     * where it would show, and this is what would matter: personal data,
     * minimised by ADR-016 and then all gathered back together by a backup.
     */
    const visible = await restored.asUser(userId[0]!.id, () =>
      restored.query<{ tenant_id: string }>("select tenant_id from public.customers"),
    );

    expect(visible.length).toBeGreaterThan(0);
    expect(visible.every((row) => row.tenant_id === tenantA)).toBe(true);
  });

  /*
   * TEST-2712 - the assumption the whole procedure rests on.
   *
   * `session_replication_role = 'replica'` disables triggers and foreign key
   * checks. It does NOT disable policies. If it did, the restore window would
   * be a window with no isolation at all, and the runbook would need a very
   * different shape.
   *
   * Checked rather than believed, because the entire safety of the procedure
   * depends on it being true.
   */
  it("does not let replica mode disable the policies (TEST-2712)", async () => {
    const userId = await restored.query<{ id: string }>(
      "insert into auth.users (email) values ('b@example.com') returning id",
    );
    await restored.query(
      "insert into public.tenant_members (tenant_id, user_id, role) values ($1, $2, 'owner')",
      [tenantB, userId[0]!.id],
    );

    await restored.exec("set session_replication_role = 'replica';");
    try {
      const visible = await restored.asUser(userId[0]!.id, () =>
        restored.query<{ tenant_id: string }>("select tenant_id from public.customers"),
      );
      expect(visible.length).toBeGreaterThan(0);
      expect(visible.every((row) => row.tenant_id === tenantB)).toBe(true);
    } finally {
      await restored.exec("set session_replication_role = 'origin';");
    }
  });
});
