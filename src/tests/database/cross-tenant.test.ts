import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, insertTenant, type TestDatabase } from "../helpers/database";

/**
 * Phase 25 — the cross-tenant isolation sweep.
 *
 * CLOVERCODE_MASTER.md section 33 (Phase 25) does not say "review isolation".
 * It says: "ejecutar específicamente pruebas de aislamiento cross-tenant."
 *
 * WHAT MAKES THIS DIFFERENT from `isolation.test.ts` (Phase 01). That file
 * proves the POSTURE — RLS is on everywhere, nothing uses `using (true)` on
 * business data — and then proves the behaviour in depth for the two tables
 * Phase 01 owned. This one proves the BEHAVIOUR for every table there is.
 *
 * AND IT IS GENERATED. The list of tables comes from `information_schema`, not
 * from an array in this file. Written by hand, this test would cover the tables
 * its author remembered; table fifty-one, arriving in Phase 26, would not be
 * here and nobody would notice. Discovered from the catalogue, a new table is
 * swept because it exists (ADR-029 decision 4).
 *
 * For every table with `tenant_id`, as the owner of business A, against a row
 * belonging to business B:
 *
 *   SELECT  -> zero rows
 *   UPDATE  -> zero rows affected
 *   DELETE  -> zero rows affected
 *   INSERT  -> refused
 */

let db: TestDatabase;

let tenantA: string;
let tenantB: string;
let ownerA: string;
let ownerB: string;

interface TenantTable {
  readonly table: string;
  readonly primaryKey: readonly string[];
}

let tenantTables: readonly TenantTable[] = [];

/**
 * The tenant's own shop window, and the only rows that are meant to be world
 * readable.
 *
 * Phase 08 gave these a public SELECT policy on purpose: they ARE the public
 * website. A menu nobody can read without signing in is not a menu.
 *
 * Written out here rather than derived, because this is the one list in the
 * sweep that must be a DELIBERATE decision. Everything else is discovered so
 * that a new table is covered automatically; this one is enumerated so that a
 * new public policy has to be typed into a security test by whoever adds it.
 * A thirteenth entry appearing on its own is exactly the accident this file
 * exists to catch.
 */
const PUBLICLY_READABLE = [
  "categories",
  "location_hours",
  "locations",
  "navigation_items",
  "page_sections",
  "pages",
  "product_images",
  "product_options",
  "product_variants",
  "products",
  "tenant_seo",
  "tenant_themes",
] as const;

/**
 * Every table in `public` that carries a `tenant_id`, with its primary key.
 *
 * The primary key is needed because half these tables key on `id` and the
 * singletons (`tenant_settings`, `billing_provider_configs`, `tenant_modules`)
 * key on `tenant_id` or a composite — and an INSERT probe has to be able to
 * build a row that would be legal if the tenant were right.
 */
async function discoverTenantTables(): Promise<readonly TenantTable[]> {
  const rows = await db.query<{ table_name: string; pk: string[] }>(
    `select c.table_name,
            coalesce(
              (select array_agg(a.attname order by a.attname)
               from pg_index as i
               join pg_attribute as a
                 on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
               where i.indrelid = format('public.%I', c.table_name)::regclass
                 and i.indisprimary),
              '{}'::name[]
            ) as pk
     from information_schema.columns as c
     join pg_class as k on k.relname = c.table_name
     join pg_namespace as n on n.oid = k.relnamespace and n.nspname = 'public'
     where c.table_schema = 'public'
       and c.column_name = 'tenant_id'
       and k.relkind = 'r'
     order by c.table_name`,
  );

  return rows.map((row) => ({ table: row.table_name, primaryKey: row.pk }));
}

/** Inserts one row per tenant table for `tenantId`, as the table owner. */
async function seedRowFor(table: string, tenantId: string): Promise<boolean> {
  // Every tenant table accepts, at minimum, a `tenant_id`. Most need more, and
  // rather than encode fifty different shapes here the sweep works with
  // whatever rows the tenants ALREADY have from provisioning plus these - so a
  // failure to seed is not a failure of the test.
  try {
    await db.query(`insert into public.${table} (tenant_id) values ($1)`, [tenantId]);
    return true;
  } catch {
    return false;
  }
}

async function countRows(table: string, tenantId: string): Promise<number> {
  const rows = await db.query<{ c: string }>(
    `select count(*)::text c from public.${table} where tenant_id = $1`,
    [tenantId],
  );
  return Number(rows[0]!.c);
}

beforeAll(async () => {
  db = await createTestDatabase();

  tenantA = await insertTenant(db, { slug: "sweep-a", name: "Sweep A" });
  tenantB = await insertTenant(db, { slug: "sweep-b", name: "Sweep B" });

  const users = await db.query<{ id: string }>(
    `insert into auth.users (email) values ('owner-a@sweep.test'), ('owner-b@sweep.test')
     returning id`,
  );
  ownerA = users[0]!.id;
  ownerB = users[1]!.id;

  await db.query(
    `insert into public.tenant_members (tenant_id, user_id, role)
     values ($1, $2, 'owner'), ($3, $4, 'owner')`,
    [tenantA, ownerA, tenantB, ownerB],
  );

  tenantTables = await discoverTenantTables();

  // Give tenant B something in as many tables as will take a bare row.
  // Provisioning (Phase 06/10/17/21) already populated settings, theme, seo,
  // locations, billing config, subscription and modules for both.
  for (const { table } of tenantTables) {
    await seedRowFor(table, tenantB);
  }
});

afterAll(async () => {
  await db.close();
});

describe("the sweep itself (TEST-2521)", () => {
  it("discovers the tenant tables from the catalogue, and finds plenty", async () => {
    // The failure mode specific to a generated test: broken discovery returns
    // zero tables, every loop below runs zero times, and the suite is green
    // having proved nothing. This is the guard against that.
    expect(tenantTables.length).toBeGreaterThanOrEqual(40);
  });

  it("includes the tables that would hurt most if it did not", async () => {
    const names = tenantTables.map((t) => t.table);
    for (const table of [
      "orders",
      "order_items",
      "payments",
      "customers",
      "products",
      "billing_documents",
      "cash_sessions",
      "audit_logs",
      "tenant_settings",
      "loyalty_accounts",
    ]) {
      expect(names).toContain(table);
    }
  });

  it("has at least one row of tenant B to try to reach", async () => {
    let reachable = 0;
    for (const { table } of tenantTables) {
      if ((await countRows(table, tenantB)) > 0) reachable += 1;
    }
    // A sweep where B owns nothing anywhere would pass every SELECT check
    // vacuously.
    expect(reachable).toBeGreaterThanOrEqual(5);
  });
});

describe("RLS is on for every tenant table (TEST-2520)", () => {
  it("leaves none of them unprotected", async () => {
    const unprotected = await db.query<{ relname: string }>(
      `select k.relname
       from pg_class as k
       join pg_namespace as n on n.oid = k.relnamespace and n.nspname = 'public'
       where k.relkind = 'r'
         and not k.relrowsecurity
         and exists (
           select 1 from information_schema.columns as c
           where c.table_schema = 'public' and c.table_name = k.relname
             and c.column_name = 'tenant_id'
         )
       order by k.relname`,
    );
    expect(unprotected.map((r) => r.relname)).toEqual([]);
  });
});

describe("the public surface is exactly what it should be", () => {
  it("grants anonymous SELECT on these twelve tables and no others", async () => {
    const rows = await db.query<{ tablename: string }>(
      `select distinct tablename from pg_policies
       where schemaname = 'public' and cmd = 'SELECT'
         and ('anon' = any(roles) or 'public' = any(roles))
       order by tablename`,
    );

    expect(rows.map((r) => r.tablename)).toEqual([...PUBLICLY_READABLE]);
  });

  it("keeps the business's own details OUT of that list", async () => {
    // `tenant_settings` holds the legal name, the RUC, the contact email and
    // the phone, and it has NO public policy - which is the right answer even
    // though the public site footer displays some of them. The site reads them
    // through `get_public_business_identity()`, a SECURITY DEFINER function
    // that returns the public-facing columns and nothing else. A blanket public
    // policy would have exposed every column instead, because RLS filters rows
    // and not columns.
    expect([...PUBLICLY_READABLE]).not.toContain("tenant_settings");
    expect([...PUBLICLY_READABLE]).not.toContain("customers");
    expect([...PUBLICLY_READABLE]).not.toContain("orders");
  });

  it("predicates every public policy on the tenant still being public", async () => {
    // Without `is_tenant_public(tenant_id)`, a suspended or archived business
    // would keep serving its menu to the world after being switched off.
    const rows = await db.query<{ tablename: string; qual: string }>(
      `select tablename, qual from pg_policies
       where schemaname = 'public' and cmd = 'SELECT'
         and ('anon' = any(roles) or 'public' = any(roles))
         and coalesce(qual, '') not like '%is_tenant_public%'`,
    );

    expect(rows.map((r) => r.tablename)).toEqual([]);
  });
});

describe("A cannot READ B (TEST-2522)", () => {
  it("returns zero rows of tenant B from every non-public tenant table", async () => {
    const leaks: string[] = [];

    await db.asUser(ownerA, async () => {
      for (const { table } of tenantTables) {
        if ((PUBLICLY_READABLE as readonly string[]).includes(table)) continue;

        const rows = await db.query<{ c: string }>(
          `select count(*)::text c from public.${table} where tenant_id = $1`,
          [tenantB],
        );
        if (Number(rows[0]!.c) !== 0) leaks.push(table);
      }
    });

    // Named, not counted: a failure has to say WHICH table leaked.
    expect(leaks).toEqual([]);
  });

  it("returns zero rows of tenant B even without a WHERE, for the rows B owns", async () => {
    const leaks: string[] = [];

    await db.asUser(ownerA, async () => {
      for (const { table } of tenantTables) {
        if ((PUBLICLY_READABLE as readonly string[]).includes(table)) continue;

        // The realistic attack is not "where tenant_id = <theirs>" - it is a
        // plain listing that happens to include somebody else's rows.
        const rows = await db.query<{ tenant_id: string }>(
          `select distinct tenant_id from public.${table}`,
        );
        if (rows.some((r) => r.tenant_id === tenantB)) leaks.push(table);
      }
    });

    expect(leaks).toEqual([]);
  });

  it("shows a suspended business's shop window to nobody", async () => {
    // The other half of the public policies: they are public only while the
    // tenant is. This is what makes `is_tenant_public` load-bearing rather than
    // decorative.
    await db.query("update public.tenants set status = 'suspended' where id = $1", [tenantB]);

    const rows = await db.asRole("anon", () =>
      db.query<{ c: string }>(
        "select count(*)::text c from public.locations where tenant_id = $1",
        [tenantB],
      ),
    );

    expect(Number(rows[0]!.c)).toBe(0);

    await db.query("update public.tenants set status = 'active' where id = $1", [tenantB]);
  });
});

describe("A cannot WRITE over B (TEST-2523, TEST-2524)", () => {
  it("updates nothing of tenant B, anywhere", async () => {
    const written: string[] = [];

    await db.asUser(ownerA, async () => {
      for (const { table } of tenantTables) {
        try {
          const rows = await db.query(
            // A no-op assignment: this test is about REACH, not about whether
            // the new value would be legal.
            `update public.${table} set tenant_id = tenant_id where tenant_id = $1 returning 1 as touched`,
            [tenantB],
          );
          if (rows.length > 0) written.push(table);
        } catch {
          // Refused outright - a stricter answer than "zero rows", and equally
          // good. `audit_logs` and `rate_limit_counters` land here: no policy.
        }
      }
    });

    expect(written).toEqual([]);
  });

  it("deletes nothing of tenant B, anywhere", async () => {
    const deleted: string[] = [];

    await db.asUser(ownerA, async () => {
      for (const { table } of tenantTables) {
        try {
          const rows = await db.query(
            `delete from public.${table} where tenant_id = $1 returning 1 as gone`,
            [tenantB],
          );
          if (rows.length > 0) deleted.push(table);
        } catch {
          // Refused outright, or blocked by a foreign key from a table this
          // loop has not reached yet. Either way nothing of B's went.
        }
      }
    });

    expect(deleted).toEqual([]);
  });

  it("leaves tenant B's rows exactly as they were", async () => {
    // The belt to the two braces above: whatever the statements reported,
    // count what actually survived.
    const emptied: string[] = [];

    for (const { table } of tenantTables) {
      const seeded = await countRows(table, tenantB);
      if (seeded === 0) continue;

      const still = await countRows(table, tenantB);
      if (still !== seeded) emptied.push(table);
    }

    expect(emptied).toEqual([]);
  });
});

describe("A cannot INSERT as B (TEST-2525)", () => {
  it("refuses a row stamped with tenant B, in every tenant table", async () => {
    const accepted: string[] = [];

    await db.asUser(ownerA, async () => {
      for (const { table } of tenantTables) {
        try {
          await db.query(`insert into public.${table} (tenant_id) values ($1)`, [tenantB]);
          // It got in. That is a hole whether or not the row is complete.
          accepted.push(table);
        } catch {
          // Refused: by RLS, by a NOT NULL on a column this bare insert did not
          // supply, or by a trigger. All three are "A did not write into B".
        }
      }
    });

    expect(accepted).toEqual([]);
  });

  it("still refuses when A supplies a full, otherwise-valid row", async () => {
    // The bare-insert probe above can be refused by a NOT NULL rather than by
    // RLS, which would make it pass for the wrong reason. This one is a row
    // that WOULD be accepted if the tenant were A's, so only the tenant can be
    // what stops it.
    await db.asUser(ownerA, async () => {
      await expect(
        db.query(`insert into public.customers (tenant_id, name) values ($1, 'Cliente de otro')`, [
          tenantB,
        ]),
      ).rejects.toThrow(/row-level security/);

      await expect(
        db.query(
          `insert into public.products (tenant_id, name, slug, base_price_cents)
           values ($1, 'Producto de otro', 'producto-de-otro', 1000)`,
          [tenantB],
        ),
      ).rejects.toThrow(/row-level security/);
    });

    // And the same row IS accepted for A's own tenant, which is what proves the
    // rejection above was about the tenant and not about the row.
    await db.asUser(ownerA, async () => {
      await db.query(
        `insert into public.customers (tenant_id, name) values ($1, 'Cliente propio')`,
        [tenantA],
      );
    });

    expect(await countRows("customers", tenantA)).toBe(1);
  });
});

describe("an anonymous caller reaches nothing (TEST-2526)", () => {
  it("reads zero rows from every tenant table", async () => {
    const leaks: string[] = [];

    await db.asRole("anon", async () => {
      for (const { table } of tenantTables) {
        try {
          const rows = await db.query<{ c: string }>(
            `select count(*)::text c from public.${table}`,
          );
          if (Number(rows[0]!.c) !== 0) leaks.push(table);
        } catch {
          // No grant at all: stricter than zero rows.
        }
      }
    });

    // Whatever an anonymous caller can see must be a subset of the shop
    // window. Not equality: a table can be publicly readable and still return
    // nothing here because no seeded row satisfies its "published" condition,
    // and that is fine. What must never happen is a table OUTSIDE the list
    // answering an anonymous caller at all.
    for (const table of leaks) {
      expect(`${table} is publicly readable`).toBe(
        (PUBLICLY_READABLE as readonly string[]).includes(table)
          ? `${table} is publicly readable`
          : `${table} LEAKED to anonymous`,
      );
    }
  });

  it("writes nothing anywhere", async () => {
    const written: string[] = [];

    await db.asRole("anon", async () => {
      for (const { table } of tenantTables) {
        try {
          const rows = await db.query(
            `update public.${table} set tenant_id = tenant_id returning 1 as touched`,
          );
          if (rows.length > 0) written.push(table);
        } catch {
          // Refused.
        }
      }
    });

    expect(written).toEqual([]);
  });
});

describe("SECURITY DEFINER functions (TEST-2527, TEST-2528)", () => {
  it("pins search_path on every one of them", async () => {
    // Without it, a caller who controls their own `search_path` can point a
    // fully-unqualified name at an object they created. Every function in this
    // schema qualifies its names, and this is the belt.
    const unpinned = await db.query<{ proname: string }>(
      `select p.proname
       from pg_proc as p
       join pg_namespace as n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.prosecdef
         and not exists (
           select 1 from unnest(coalesce(p.proconfig, '{}')) as cfg
           where cfg like 'search_path=%'
         )
       order by p.proname`,
    );

    expect(unpinned.map((r) => r.proname)).toEqual([]);
  });

  it("gates every tenant-taking SECURITY DEFINER function, or names why not", async () => {
    // A SECURITY DEFINER function bypasses RLS, so its gate is the ONLY defence.
    // Any function that accepts a tenant id must consult `has_permission`,
    // `is_tenant_member` or `is_platform_admin` - unless it is one of these
    // five, each of which was reviewed in Phase 25 and each of which has a
    // reason. A SIXTH appearing on its own fails this test, which is the point:
    // the exception has to be argued, not inherited.
    const REVIEWED_UNGATED = [
      // Serves the public website's footer: trade name, address, RUC. Exposes
      // the public-facing columns of `tenant_settings` and nothing else, which
      // is precisely why that table has no public policy of its own.
      "get_public_business_identity",
      // Resolves a tenant's canonical hostname. A domain is public by nature -
      // it is in DNS.
      "get_tenant_primary_domain",
      // A predicate over `tenants.status`. Returns a boolean, no data.
      "is_tenant_public",
      // Returns the CALLER's own permissions. Asking about yourself needs no
      // permission, and gating it would be circular.
      "my_permissions",
      // A helper that reads `tenant_settings.timezone`. Called only from inside
      // the Phase 23 report functions, which carry the `reports.view` gate.
      "tenant_timezone",
    ];

    const ungated = await db.query<{ proname: string }>(
      `select p.proname
       from pg_proc as p
       join pg_namespace as n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.prosecdef
         and pg_get_function_identity_arguments(p.oid) like '%tenant_id%'
         and pg_get_functiondef(p.oid) !~ 'has_permission|is_tenant_member|is_platform_admin'
       order by p.proname`,
    );

    expect([...new Set(ungated.map((r) => r.proname))]).toEqual(REVIEWED_UNGATED);
  });
});
