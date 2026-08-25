import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

/**
 * Real PostgreSQL for tests, in-process.
 *
 * The migrations in `supabase/migrations` are executed against an actual
 * PostgreSQL engine (PGlite compiles Postgres to WebAssembly), so constraints,
 * partial unique indexes, triggers, RLS and SECURITY DEFINER behaviour are
 * verified rather than assumed.
 *
 * Fidelity caveats, documented in the Phase 01 SPEC:
 *
 *   - PGlite runs PostgreSQL 18; `supabase/config.toml` pins 17. Everything
 *     used here (enums, CHECK, partial unique indexes, RLS, SECURITY DEFINER)
 *     behaves identically across both.
 *   - There is no Supabase `auth` schema and no PostgREST. Phase 03 extends
 *     this harness with an `auth.uid()` shim when policies start needing it.
 *
 * Running `supabase start` against Docker remains the higher-fidelity check;
 * this harness is what makes the check run in CI on every push.
 */

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

/** Roles Supabase provides out of the box, recreated so GRANTs resolve. */
const SUPABASE_ROLES_SQL = `
  create role anon nologin noinherit;
  create role authenticated nologin noinherit;
  create role service_role nologin noinherit bypassrls;

  grant usage on schema public to anon, authenticated, service_role;
`;

/**
 * Mirrors Supabase's default table grants.
 *
 * This matters: without these grants a "cannot read" assertion would pass for
 * the wrong reason - lack of privilege rather than RLS. Granting first and then
 * showing zero rows is what actually proves RLS is doing the work.
 */
const SUPABASE_GRANTS_SQL = `
  grant select, insert, update, delete on all tables in schema public
    to anon, authenticated;
`;

export interface TestDatabase {
  /** Runs one or more statements. */
  exec(sql: string): Promise<void>;
  /** Runs a parameterised query and returns rows. */
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Runs `fn` with the session role set to `role`, then resets it. */
  asRole<T>(role: string, fn: () => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** Migration file names in the order PostgreSQL will see them. */
export async function listMigrationFiles(): Promise<string[]> {
  const entries = await readdir(MIGRATIONS_DIR);
  return entries.filter((name) => name.endsWith(".sql")).sort();
}

export async function readMigration(fileName: string): Promise<string> {
  return readFile(join(MIGRATIONS_DIR, fileName), "utf8");
}

/**
 * Boots a database with every migration applied.
 *
 * Each call is an isolated instance, so tests cannot leak state into each other.
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  const pg = new PGlite();

  await pg.exec(SUPABASE_ROLES_SQL);

  for (const fileName of await listMigrationFiles()) {
    const sql = await readMigration(fileName);
    try {
      await pg.exec(sql);
    } catch (error) {
      throw new Error(
        `Migration ${fileName} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  await pg.exec(SUPABASE_GRANTS_SQL);

  return {
    async exec(sql) {
      await pg.exec(sql);
    },
    async query<T = Record<string, unknown>>(sql: string, params?: unknown[]) {
      const result = await pg.query<T>(sql, params);
      return result.rows;
    },
    async asRole<T>(role: string, fn: () => Promise<T>) {
      await pg.exec(`set role ${role};`);
      try {
        return await fn();
      } finally {
        await pg.exec("reset role;");
      }
    },
    async close() {
      await pg.close();
    },
  };
}

/** Inserts a tenant and returns its id. Bypasses RLS: runs as the owner. */
export async function insertTenant(
  db: TestDatabase,
  values: { slug: string; name?: string; status?: "active" | "suspended" | "archived" },
): Promise<string> {
  const rows = await db.query<{ id: string }>(
    `insert into public.tenants (slug, name, status)
     values ($1, $2, coalesce($3, 'active')::public.tenant_status)
     returning id`,
    [values.slug, values.name ?? values.slug, values.status ?? null],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error("insertTenant returned no id");
  return id;
}

/** Inserts a domain for a tenant. `active` domains get a verified_at stamp. */
export async function insertDomain(
  db: TestDatabase,
  values: {
    tenantId: string;
    domain: string;
    type?: "system" | "custom";
    isPrimary?: boolean;
    verificationStatus?: "pending" | "verifying" | "active" | "failed";
  },
): Promise<string> {
  const status = values.verificationStatus ?? "active";
  const rows = await db.query<{ id: string }>(
    `insert into public.tenant_domains
       (tenant_id, domain, type, is_primary, verification_status, verified_at)
     values ($1, $2, $3::public.tenant_domain_type, $4,
             $5::public.domain_verification_status,
             case when $5 = 'active' then now() else null end)
     returning id`,
    [values.tenantId, values.domain, values.type ?? "custom", values.isPrimary ?? false, status],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error("insertDomain returned no id");
  return id;
}
