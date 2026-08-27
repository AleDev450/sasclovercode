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
  create role supabase_auth_admin nologin noinherit;

  grant usage on schema public to anon, authenticated, service_role;
`;

/**
 * Minimal stand-in for the Supabase `auth` schema (Phase 01 KL-103).
 *
 * Only what the migrations and the policies actually touch is recreated:
 * `auth.users` (the FK target of `profiles` and the table the sync triggers
 * hang off) and `auth.uid()`.
 *
 * `auth.uid()` reads the same GUC that PostgREST sets on a real Supabase
 * request - `request.jwt.claims` - so a policy written against the real
 * function is exercised verbatim here. `asUser()` below sets that GUC.
 *
 * What is NOT reproduced: password hashing, email confirmation, token issuance,
 * the rest of the `auth` schema. Those belong to Supabase Auth and are never
 * asserted on by this project.
 */
const SUPABASE_AUTH_SCHEMA_SQL = `
  create schema auth;
  grant usage on schema auth to anon, authenticated, service_role, supabase_auth_admin;

  create table auth.users (
    id                  uuid        not null default gen_random_uuid(),
    email               text,
    raw_user_meta_data  jsonb       not null default '{}'::jsonb,
    created_at          timestamptz not null default now(),

    constraint users_pkey primary key (id),
    constraint users_email_key unique (email)
  );

  create function auth.uid()
  returns uuid
  language sql
  stable
  as $$
    -- The inner nullif guards the CAST, not the result.
    --
    -- asUser clears the GUC by setting it to the empty string, and ''::jsonb
    -- raises "invalid input syntax for type json". On real Supabase an unset
    -- claim reads as NULL and auth.uid() simply returns NULL, so a function
    -- that throws here would be the shim being LESS forgiving than production -
    -- and it would throw inside whatever trigger happened to call it.
    --
    -- Phase 13 is where this first mattered: record_order_status calls
    -- auth.uid() on every order insert, including the ones a test makes outside
    -- an asUser block.
    select nullif(
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub',
      ''
    )::uuid;
  $$;

  grant execute on function auth.uid() to anon, authenticated, service_role;

  -- ---------------------------------------------------------------------
  -- Supabase Storage shim (Phase 06)
  -- ---------------------------------------------------------------------
  --
  -- Enough of the storage schema for the migrations to apply and for the object
  -- policies to be exercised: the bucket registry, the object table, and
  -- storage.foldername, which the policies use to read the tenant out of an
  -- object path.
  --
  -- Not a reimplementation of Storage. Uploads, signed URLs and the resumable
  -- protocol are the real service's job. What IS faithful here is the part
  -- that decides who may touch which row - which is the part worth testing.
  create schema storage;
  grant usage on schema storage to anon, authenticated, service_role;

  create table storage.buckets (
    id                 text        not null,
    name               text        not null,
    public             boolean     not null default false,
    file_size_limit    bigint,
    allowed_mime_types text[],
    created_at         timestamptz not null default now(),

    constraint buckets_pkey primary key (id)
  );

  create table storage.objects (
    id         uuid        not null default gen_random_uuid(),
    bucket_id  text        not null,
    name       text        not null,
    owner      uuid,
    metadata   jsonb       not null default '{}'::jsonb,
    created_at timestamptz not null default now(),

    constraint objects_pkey primary key (id),
    constraint objects_bucket_fkey foreign key (bucket_id) references storage.buckets (id),
    constraint objects_bucket_name_key unique (bucket_id, name)
  );

  alter table storage.objects enable row level security;

  -- The DIRECTORY segments of an object path.
  --
  -- Faithful to the real implementation, which splits on "/" and then drops the
  -- last element - the file name. The first version of this shim kept every
  -- segment, so a path was one element longer here than in production and any
  -- policy indexing into the array would have been tested against the wrong
  -- position. Nothing depended on it until Phase 08 read the folder out of
  -- element 3, which is exactly the kind of thing a shim must not get wrong.
  create function storage.foldername(name text)
  returns text[]
  language sql
  immutable
  as $$
    select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1];
  $$;

  grant select, insert, update, delete on storage.objects to anon, authenticated;
  grant select on storage.buckets to anon, authenticated;
  grant execute on function storage.foldername(text) to anon, authenticated, service_role;
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
  /**
   * Runs `fn` as the `authenticated` role with `auth.uid()` returning `userId`.
   *
   * Pass `null` to run as `authenticated` with no identity, which is what a
   * request carrying a malformed or absent token looks like to the database.
   */
  asUser<T>(userId: string | null, fn: () => Promise<T>): Promise<T>;
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
  await pg.exec(SUPABASE_AUTH_SCHEMA_SQL);

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
    async asUser<T>(userId: string | null, fn: () => Promise<T>) {
      // `set_config(..., true)` would be transaction-local, and these tests run
      // outside an explicit transaction; session scope is what survives here.
      const claims = userId === null ? "{}" : JSON.stringify({ sub: userId });
      await pg.query("select set_config('request.jwt.claims', $1, false)", [claims]);
      await pg.exec("set role authenticated;");
      try {
        return await fn();
      } finally {
        await pg.exec("reset role;");
        await pg.query("select set_config('request.jwt.claims', '', false)");
      }
    },
    async close() {
      await pg.close();
    },
  };
}

/**
 * Creates an auth user and returns its id.
 *
 * The `on_auth_user_created` trigger creates the matching profile, so this is
 * also how a profile comes into existence in tests - exactly as in production.
 */
export async function insertAuthUser(
  db: TestDatabase,
  values: { email: string; fullName?: string },
): Promise<string> {
  const rows = await db.query<{ id: string }>(
    `insert into auth.users (email, raw_user_meta_data)
     values ($1, jsonb_build_object('full_name', $2::text))
     returning id`,
    [values.email, values.fullName ?? null],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error("insertAuthUser returned no id");
  return id;
}

/** Grants a user membership of a tenant. Bypasses RLS: runs as the owner. */
export async function insertMembership(
  db: TestDatabase,
  values: {
    tenantId: string;
    userId: string;
    role?:
      "owner" | "admin" | "manager" | "cashier" | "waiter" | "kitchen" | "delivery" | "accountant";
    status?: "active" | "invited" | "suspended";
  },
): Promise<string> {
  const rows = await db.query<{ id: string }>(
    `insert into public.tenant_members (tenant_id, user_id, role, status)
     values ($1, $2, $3::public.tenant_role,
             coalesce($4, 'active')::public.membership_status)
     returning id`,
    [values.tenantId, values.userId, values.role ?? "owner", values.status ?? null],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error("insertMembership returned no id");
  return id;
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

/**
 * Inserts a domain for a tenant. `active` domains get a verified_at stamp.
 *
 * A custom domain also gets a verification token, because Phase 09 made that an
 * invariant of the table: in production every custom domain arrives through
 * `claim_domain`, which mints one. A fixture that skipped it would be building
 * a row the application can never produce - and the CHECK would refuse it.
 */
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
  const type = values.type ?? "custom";
  const rows = await db.query<{ id: string }>(
    `insert into public.tenant_domains
       (tenant_id, domain, type, is_primary, verification_status, verified_at,
        verification_token)
     values ($1, $2, $3::public.tenant_domain_type, $4,
             $5::public.domain_verification_status,
             case when $5 = 'active' then now() else null end,
             case when $3 = 'custom' then public.new_domain_verification_token()
                  else null end)
     returning id`,
    [values.tenantId, values.domain, type, values.isPrimary ?? false, status],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error("insertDomain returned no id");
  return id;
}
