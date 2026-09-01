import { createTestDatabase, type TestDatabase } from "./database";

/**
 * Dumping and restoring, so the recovery strategy stops being a hypothesis.
 *
 * CLOVERCODE_MASTER.md section 33, Phase 27: "realizar al menos una prueba real
 * de restauración", and the sentence that makes it non-negotiable — "un backup
 * que nunca se probó no puede considerarse estrategia de recuperación".
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS AND IS NOT
 * ---------------------------------------------------------------------------
 *
 * This is not `pg_dump`. It reads every table with SQL and writes the rows back
 * with SQL, which is what PGlite makes possible in-process.
 *
 * What it faithfully reproduces is the part that goes wrong: a restore loads
 * rows that ALREADY EXISTED into a schema whose triggers assume rows are being
 * created. `pg_restore` handles that with `--disable-triggers`, which sets
 * `session_replication_role = 'replica'` — the same switch this file uses, and
 * the same one the runbook tells an operator to set.
 *
 * So the mechanism differs and the hazard is identical, which is the part worth
 * rehearsing.
 */

/**
 * Tables in dependency order.
 *
 * With `session_replication_role = 'replica'` foreign keys are not checked
 * either, so the order stops mattering for the restore itself. It is kept
 * because a dump that only loads in one specific order is a dump nobody can use
 * any other way — and because reading it tells you the shape of the schema.
 */
export const DUMP_ORDER = [
  "tenants",
  "profiles",
  "tenant_members",
  "tenant_domains",
  "tenant_settings",
  "tenant_themes",
  "tenant_seo",
  "tenant_social_links",
  "locations",
  "location_hours",
  "categories",
  "products",
  "product_images",
  "product_variants",
  "product_options",
  "customers",
  "customer_addresses",
  "orders",
  "order_items",
  "payment_methods",
  "cash_registers",
  "cash_sessions",
  "payments",
  "audit_logs",
] as const;

export type DumpedTable = { readonly table: string; readonly rows: Record<string, unknown>[] };
export type Dump = readonly DumpedTable[];

/** Reads every row of every table in `DUMP_ORDER`. */
export async function dumpDatabase(db: TestDatabase): Promise<Dump> {
  const dump: DumpedTable[] = [];

  for (const table of DUMP_ORDER) {
    const rows = await db.query<Record<string, unknown>>(
      /*
       * Ordered by the row's own text representation.
       *
       * Not `order by id`: several tables here are keyed on `tenant_id` and
       * have no `id` column at all, and a dump that only works for tables
       * shaped one way is a dump that silently skips the others.
       *
       * The whole row as text is deterministic, present on every table, and
       * identical for identical data - which is exactly the property a
       * comparison between two databases needs.
       */
      `select * from public.${table} as t order by (t.*)::text`,
    );
    dump.push({ table, rows });
  }

  return dump;
}

/** Total rows in a dump, for a quick "did anything arrive" check. */
export function dumpSize(dump: Dump): number {
  return dump.reduce((total, entry) => total + entry.rows.length, 0);
}

/**
 * Writes a dump into a database, one INSERT per row.
 *
 * `replicaMode` is the whole point of this function existing in two modes:
 *
 *   true   what a real restore does. Triggers do not fire, foreign keys are
 *          not checked, and the rows land exactly as they were dumped.
 *   false  what somebody does when they do not know better, and what this
 *          project measured before writing its runbook: the triggers fire,
 *          invent rows the dump also contains, and the load dies on a unique
 *          constraint partway through.
 */
export async function restoreDump(
  db: TestDatabase,
  dump: Dump,
  options: { replicaMode: boolean },
): Promise<void> {
  if (options.replicaMode) {
    await db.exec("set session_replication_role = 'replica';");
  }

  try {
    for (const { table, rows } of dump) {
      for (const row of rows) {
        const columns = Object.keys(row);
        if (columns.length === 0) continue;

        const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");
        await db.query(
          `insert into public.${table} (${columns.map((c) => `"${c}"`).join(", ")})
           values (${placeholders})`,
          columns.map((column) => row[column]),
        );
      }
    }
  } finally {
    if (options.replicaMode) {
      // Always back to normal, even when the load failed. A connection left in
      // replica mode is a connection where nothing enforces anything.
      await db.exec("set session_replication_role = 'origin';");
    }
  }
}

/** A database with every migration applied and nothing in it. */
export async function freshDatabase(): Promise<TestDatabase> {
  return createTestDatabase();
}

/**
 * Compares two dumps and returns the differences in words.
 *
 * Returns descriptions rather than throwing so a test can attach all of them at
 * once: finding out that three tables differ, one run at a time, is three runs.
 */
export function diffDumps(before: Dump, after: Dump): string[] {
  const problems: string[] = [];
  const afterByTable = new Map(after.map((entry) => [entry.table, entry.rows]));

  for (const { table, rows } of before) {
    const restored = afterByTable.get(table);

    if (restored === undefined) {
      problems.push(`${table}: missing from the restored dump`);
      continue;
    }

    if (restored.length !== rows.length) {
      problems.push(`${table}: ${rows.length} rows dumped, ${restored.length} restored`);
      continue;
    }

    for (const [index, original] of rows.entries()) {
      const copy = restored[index];
      if (copy === undefined) continue;

      for (const [column, value] of Object.entries(original)) {
        if (!sameValue(value, copy[column])) {
          problems.push(
            `${table}.${column} row ${index}: ${describe(value)} became ${describe(copy[column])}`,
          );
        }
      }
    }
  }

  return problems;
}

/**
 * Value equality across the dump boundary.
 *
 * `timestamptz` comes back as a `Date`, and two Dates for the same instant are
 * different objects. JSONB comes back as a parsed object. Comparing with `===`
 * would report every timestamp in the database as corrupted by the restore,
 * which is a false alarm large enough to make the whole test useless.
 */
function sameValue(a: unknown, b: unknown): boolean {
  if (a instanceof Date || b instanceof Date) {
    const left = a instanceof Date ? a.getTime() : new Date(String(a)).getTime();
    const right = b instanceof Date ? b.getTime() : new Date(String(b)).getTime();
    return left === right;
  }
  if (a !== null && b !== null && typeof a === "object" && typeof b === "object") {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return a === b;
}

function describe(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (value === null) return "null";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
