import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestDatabase,
  insertDomain,
  insertTenant,
  type TestDatabase,
} from "../helpers/database";

/**
 * Tenant isolation, verified against a real PostgreSQL.
 *
 * This is the suite the whole product rests on. Master section 5: "Nunca debe
 * existir la posibilidad de que un tenant acceda a información de otro tenant."
 *
 * Note on how these assertions get their meaning: the harness grants
 * SELECT/INSERT/UPDATE/DELETE on every public table to `anon` and
 * `authenticated`, exactly as Supabase does. So "anon sees zero rows" proves
 * RLS is doing the work, not that a GRANT happened to be missing.
 */

let db: TestDatabase;

/** Two unrelated businesses on the platform. */
let tenantA: string;
let tenantB: string;

beforeAll(async () => {
  db = await createTestDatabase();

  tenantA = await insertTenant(db, { slug: "sugurolls", name: "Sugu Rolls" });
  tenantB = await insertTenant(db, { slug: "polleria-el-rey", name: "Pollería El Rey" });

  await insertDomain(db, {
    tenantId: tenantA,
    domain: "sugurolls.clovercodeapp.com",
    type: "system",
    isPrimary: true,
  });
  await insertDomain(db, { tenantId: tenantA, domain: "sugurolls.com", type: "custom" });

  await insertDomain(db, {
    tenantId: tenantB,
    domain: "polleria-el-rey.clovercodeapp.com",
    type: "system",
    isPrimary: true,
  });
});

afterAll(async () => {
  await db.close();
});

describe("RLS posture (TEST-131, TEST-132)", () => {
  it("has row level security enabled on both tables", async () => {
    const rows = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `select relname, relrowsecurity from pg_class
       where relname in ('tenants', 'tenant_domains') order by relname`,
    );
    expect(rows).toEqual([
      { relname: "tenant_domains", relrowsecurity: true },
      { relname: "tenants", relrowsecurity: true },
    ]);
  });

  // Phase 02 adds policies to `profiles` and `tenant_members`, so this is no
  // longer "no policies anywhere". What must not change is the posture of the
  // two tenant tables: opening those up is an authorization decision that
  // belongs to Phase 03, and until then nothing but the guarded resolver reads
  // them.
  /*
   * Phase 01 left this table with no policies at all, Phase 04 added the
   * platform operator, and Phase 09 gave a business a screen for its own
   * domains - so "platform only" stopped being the invariant.
   *
   * What replaced it is narrower and says more. Every policy is predicated on
   * platform authority OR on a domains permission in the row's own tenant, and
   * - the part worth asserting on its own - there is still no UPDATE policy
   * reachable from a tenant session. RLS is row-level, so a policy permissive
   * enough to let a business set `is_primary` would also let it write
   * `verification_status = 'active'`, which is the state that serves traffic.
   * That is why every tenant-side write goes through a SECURITY DEFINER
   * function instead.
   */
  it("predicates every tenant_domains policy on platform authority or a domains permission", async () => {
    // An INSERT policy has no `qual`, only `with_check`. Reading just one of
    // the two columns would silently pass a policy it never inspected.
    const rows = await db.query<{ policyname: string; cmd: string; predicate: string | null }>(
      `select policyname, cmd, coalesce(qual, with_check) as predicate
       from pg_policies
       where schemaname = 'public' and tablename = 'tenant_domains'`,
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const predicate = row.predicate ?? "";
      expect(
        predicate.includes("is_platform_admin") ||
          predicate.includes("'domains.view'") ||
          predicate.includes("'domains.manage'"),
        `${row.policyname} is predicated on neither platform authority nor a domains permission`,
      ).toBe(true);
    }
  });

  it("gives a tenant session no UPDATE path into tenant_domains at all", async () => {
    const rows = await db.query<{ policyname: string; predicate: string | null }>(
      `select policyname, coalesce(qual, with_check) as predicate
       from pg_policies
       where schemaname = 'public' and tablename = 'tenant_domains' and cmd = 'UPDATE'`,
    );
    // The platform policy may update; nothing else may.
    for (const row of rows) {
      expect(
        (row.predicate ?? "").includes("is_platform_admin"),
        `${row.policyname} lets something other than an operator update a domain`,
      ).toBe(true);
    }
  });

  it("predicates every tenants policy on membership or on platform authority", async () => {
    const rows = await db.query<{ policyname: string; cmd: string; predicate: string | null }>(
      `select policyname, cmd, coalesce(qual, with_check) as predicate
       from pg_policies
       where schemaname = 'public' and tablename = 'tenants'`,
    );

    // The member-scoped SELECT from Phase 03 must still be there and unchanged.
    const memberPolicy = rows.find((r) => r.policyname === "tenants_select_member");
    expect(memberPolicy?.cmd).toBe("SELECT");
    expect(memberPolicy?.predicate).toContain("is_tenant_member");

    // And nothing may be predicated on anything looser than those two checks.
    for (const row of rows) {
      const predicate = row.predicate ?? "";
      expect(
        predicate.includes("is_tenant_member") || predicate.includes("is_platform_admin"),
        `${row.policyname} is predicated on neither membership nor platform authority`,
      ).toBe(true);
    }
  });

  it("has no DELETE policy on tenants for anybody, so they are archived", async () => {
    const rows = await db.query<{ policyname: string }>(
      `select policyname from pg_policies
       where schemaname = 'public' and tablename = 'tenants' and cmd = 'DELETE'`,
    );
    expect(rows).toEqual([]);
  });

  // Phase-agnostic: this one must hold for every table any phase ever adds.
  it("has row level security enabled on every table in the public schema", async () => {
    const rows = await db.query<{ tablename: string }>(
      `select c.relname as tablename
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
       order by c.relname`,
    );
    expect(rows.map((r) => r.tablename)).toEqual([]);
  });

  it("has no policy that would grant blanket access to tenant data", async () => {
    // Master §10 forbids `using (true)` on tables holding private data.
    //
    // The Phase 03 catalogue (roles / permissions / role_permissions) does use
    // `using (true)`, and legitimately: it holds no tenant data, only the
    // product's capability list. Everything else must be predicated.
    //
    // Phase 13 added `order_transitions` to the same list, on the same grounds:
    // it is the order lifecycle of the PRODUCT, not of any business - a tenant
    // does not get to invent a path from `completed` back to `pending`. It
    // holds two enum columns and no tenant data.
    //
    // Phase 17 added `billing_document_transitions` on the identical grounds:
    // the billing document lifecycle, not any tenant's own documents.
    //
    // Anything added here must satisfy the next test as well: an exception is
    // only safe while it stays read-only.
    const CATALOGUE = [
      "roles",
      "permissions",
      "role_permissions",
      "order_transitions",
      "billing_document_transitions",
    ];

    const rows = await db.query<{ tablename: string; qual: string | null }>(
      "select tablename, qual from pg_policies where schemaname = 'public'",
    );

    const offenders = rows.filter((r) => r.qual === "true" && !CATALOGUE.includes(r.tablename));
    expect(offenders).toEqual([]);
  });

  it("keeps the catalogue exception read-only, so it cannot become a write hole", async () => {
    const rows = await db.query<{ cmd: string }>(
      `select cmd from pg_policies
       where schemaname = 'public'
         and tablename in ('roles','permissions','role_permissions','order_transitions',
                           'billing_document_transitions')`,
    );
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => r.cmd === "SELECT")).toBe(true);
  });
});

describe("anonymous clients cannot read tenant data (TEST-133, TEST-134)", () => {
  it("sees zero tenants despite holding SELECT", async () => {
    const rows = await db.asRole("anon", () =>
      db.query<{ count: string }>("select count(*) as count from public.tenants"),
    );
    expect(Number(rows[0]?.count)).toBe(0);
  });

  it("sees zero domains despite holding SELECT", async () => {
    const rows = await db.asRole("anon", () =>
      db.query<{ count: string }>("select count(*) as count from public.tenant_domains"),
    );
    expect(Number(rows[0]?.count)).toBe(0);
  });

  it("cannot reach a specific tenant even knowing its id", async () => {
    const rows = await db.asRole("anon", () =>
      db.query("select * from public.tenants where id = $1", [tenantA]),
    );
    expect(rows).toEqual([]);
  });

  it("cannot enumerate slugs", async () => {
    const rows = await db.asRole("anon", () =>
      db.query("select slug from public.tenants where slug like '%'"),
    );
    expect(rows).toEqual([]);
  });

  it("applies the same rules to the authenticated role in this phase", async () => {
    const rows = await db.asRole("authenticated", () =>
      db.query<{ count: string }>("select count(*) as count from public.tenants"),
    );
    expect(Number(rows[0]?.count)).toBe(0);
  });
});

describe("anonymous clients cannot write (TEST-135)", () => {
  it("cannot insert a tenant", async () => {
    await expect(
      db.asRole("anon", () =>
        db.query("insert into public.tenants (slug, name) values ('intruder', 'Intruder')"),
      ),
    ).rejects.toThrow(/row-level security|policy/i);
  });

  it("cannot claim a domain", async () => {
    await expect(
      db.asRole("anon", () =>
        db.query(
          `insert into public.tenant_domains (tenant_id, domain, type)
           values ($1, 'stolen.com', 'custom')`,
          [tenantA],
        ),
      ),
    ).rejects.toThrow(/row-level security|policy/i);
  });

  it("silently affects nothing when updating another tenant", async () => {
    // UPDATE under RLS with no policy matches no rows rather than erroring.
    await db.asRole("anon", () =>
      db.query("update public.tenants set name = 'Hijacked' where id = $1", [tenantA]),
    );
    const rows = await db.query<{ name: string }>("select name from public.tenants where id = $1", [
      tenantA,
    ]);
    expect(rows[0]?.name).toBe("Sugu Rolls");
  });

  it("cannot delete another tenant", async () => {
    await db.asRole("anon", () => db.query("delete from public.tenants where id = $1", [tenantB]));
    const rows = await db.query<{ count: string }>(
      "select count(*) as count from public.tenants where id = $1",
      [tenantB],
    );
    expect(Number(rows[0]?.count)).toBe(1);
  });
});

describe("resolve_tenant_by_domain (TEST-136 to TEST-139)", () => {
  it("returns the owning tenant for a system domain", async () => {
    const rows = await db.asRole("anon", () =>
      db.query<{ slug: string; name: string; domain_type: string; is_primary: boolean }>(
        "select * from public.resolve_tenant_by_domain($1)",
        ["sugurolls.clovercodeapp.com"],
      ),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.slug).toBe("sugurolls");
    expect(rows[0]?.domain_type).toBe("system");
    expect(rows[0]?.is_primary).toBe(true);
  });

  it("returns the owning tenant for a verified custom domain", async () => {
    const rows = await db.asRole("anon", () =>
      db.query<{ slug: string }>("select * from public.resolve_tenant_by_domain($1)", [
        "sugurolls.com",
      ]),
    );
    expect(rows[0]?.slug).toBe("sugurolls");
  });

  it("normalises case and surrounding whitespace", async () => {
    const rows = await db.query<{ slug: string }>(
      "select * from public.resolve_tenant_by_domain($1)",
      ["  SUGUROLLS.COM  "],
    );
    expect(rows[0]?.slug).toBe("sugurolls");
  });

  it("does NOT resolve an unverified domain (TEST-137)", async () => {
    await insertDomain(db, {
      tenantId: tenantB,
      domain: "banco-conocido.com",
      verificationStatus: "pending",
    });
    const rows = await db.query("select * from public.resolve_tenant_by_domain($1)", [
      "banco-conocido.com",
    ]);
    expect(rows).toEqual([]);
  });

  it.each(["pending", "verifying", "failed"] as const)(
    "does not resolve a domain in state %s",
    async (status) => {
      const tenant = await insertTenant(db, { slug: `state-${status}` });
      await insertDomain(db, {
        tenantId: tenant,
        domain: `state-${status}.com`,
        verificationStatus: status,
      });
      const rows = await db.query("select * from public.resolve_tenant_by_domain($1)", [
        `state-${status}.com`,
      ]);
      expect(rows).toEqual([]);
    },
  );

  it("does NOT resolve an archived tenant (TEST-138)", async () => {
    const archived = await insertTenant(db, { slug: "gone-away", status: "archived" });
    await insertDomain(db, { tenantId: archived, domain: "gone-away.com" });

    const rows = await db.query("select * from public.resolve_tenant_by_domain($1)", [
      "gone-away.com",
    ]);
    expect(rows).toEqual([]);
  });

  it("DOES resolve a suspended tenant, carrying its status (EC-111)", async () => {
    const suspended = await insertTenant(db, { slug: "on-hold", status: "suspended" });
    await insertDomain(db, { tenantId: suspended, domain: "on-hold.com" });

    const rows = await db.query<{ slug: string; status: string }>(
      "select * from public.resolve_tenant_by_domain($1)",
      ["on-hold.com"],
    );
    expect(rows[0]?.slug).toBe("on-hold");
    expect(rows[0]?.status).toBe("suspended");
  });

  it("returns nothing for an unknown host", async () => {
    const rows = await db.query("select * from public.resolve_tenant_by_domain($1)", [
      "nobody-registered-this.com",
    ]);
    expect(rows).toEqual([]);
  });

  it("returns at most one row (TEST-139)", async () => {
    for (const host of [
      "sugurolls.com",
      "sugurolls.clovercodeapp.com",
      "polleria-el-rey.clovercodeapp.com",
    ]) {
      const rows = await db.query("select * from public.resolve_tenant_by_domain($1)", [host]);
      expect(rows.length).toBeLessThanOrEqual(1);
    }
  });

  it("cannot be used to enumerate: a wildcard is just a literal", async () => {
    for (const probe of ["%", "%.com", "_", "' or '1'='1"]) {
      const rows = await db.query("select * from public.resolve_tenant_by_domain($1)", [probe]);
      expect(rows).toEqual([]);
    }
  });

  // Audit finding: PostgreSQL grants EXECUTE to PUBLIC by default, so every
  // role created later - including one added by a future phase for a narrower
  // purpose - silently inherited the right to call a SECURITY DEFINER function.
  // The migration now revokes from PUBLIC and names the two roles explicitly.
  it("is executable only by the roles it was granted to (least privilege)", async () => {
    const [row] = await db.query<{ acl: string | null }>(
      `select proacl::text as acl from pg_proc
       where proname = 'resolve_tenant_by_domain'`,
    );
    const acl = row?.acl ?? "";

    // A leading `=X/` entry is the PUBLIC grant. It must be gone.
    expect(acl).not.toMatch(/(^|[{,])=X\//);
    expect(acl).toContain("anon=X/");
    expect(acl).toContain("authenticated=X/");
  });

  it("denies a role that was never granted execute", async () => {
    await db.exec(`
      create role audit_probe nologin noinherit;
      grant usage on schema public to audit_probe;
    `);

    await expect(
      db.asRole("audit_probe", async () =>
        db.query("select * from public.resolve_tenant_by_domain($1)", [
          "sugurolls.clovercodeapp.com",
        ]),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it("pins search_path, so it cannot be hijacked (AB-103)", async () => {
    const rows = await db.query<{ proconfig: string[] | null; prosecdef: boolean }>(
      `select proconfig, prosecdef from pg_proc
       where proname = 'resolve_tenant_by_domain'`,
    );
    expect(rows[0]?.prosecdef).toBe(true);
    // An empty search_path is stored verbatim as `search_path=""`.
    expect(rows[0]?.proconfig).toContain('search_path=""');
  });
});

/**
 * TEST-140 - the mandatory isolation proof for this phase.
 */
describe("TEST-140: no hostname ever yields another tenant's data", () => {
  it("maps every registered host to its own owner and to nobody else", async () => {
    const expectations: { host: string; slug: string }[] = [
      { host: "sugurolls.clovercodeapp.com", slug: "sugurolls" },
      { host: "sugurolls.com", slug: "sugurolls" },
      { host: "polleria-el-rey.clovercodeapp.com", slug: "polleria-el-rey" },
    ];

    for (const { host, slug } of expectations) {
      const rows = await db.asRole("anon", () =>
        db.query<{ slug: string; tenant_id: string }>(
          "select * from public.resolve_tenant_by_domain($1)",
          [host],
        ),
      );
      expect(rows, `${host} must resolve`).toHaveLength(1);
      expect(rows[0]?.slug, `${host} resolved to the wrong tenant`).toBe(slug);
    }
  });

  it("never returns tenant B's id for any of tenant A's hosts", async () => {
    for (const host of ["sugurolls.clovercodeapp.com", "sugurolls.com"]) {
      const rows = await db.query<{ tenant_id: string }>(
        "select * from public.resolve_tenant_by_domain($1)",
        [host],
      );
      expect(rows[0]?.tenant_id).toBe(tenantA);
      expect(rows[0]?.tenant_id).not.toBe(tenantB);
    }
  });

  it("leaves tenant B unreachable from tenant A's hosts and vice versa", async () => {
    const aRows = await db.query<{ tenant_id: string }>(
      "select * from public.resolve_tenant_by_domain($1)",
      ["sugurolls.com"],
    );
    const bRows = await db.query<{ tenant_id: string }>(
      "select * from public.resolve_tenant_by_domain($1)",
      ["polleria-el-rey.clovercodeapp.com"],
    );

    expect(aRows[0]?.tenant_id).not.toBe(bRows[0]?.tenant_id);
  });

  it("exposes only public-facing columns, never the whole tenant row", async () => {
    const rows = await db.query<Record<string, unknown>>(
      "select * from public.resolve_tenant_by_domain($1)",
      ["sugurolls.com"],
    );
    expect(Object.keys(rows[0] ?? {}).sort()).toEqual([
      "domain",
      "domain_type",
      "is_primary",
      "name",
      "slug",
      "status",
      "tenant_id",
    ]);
  });
});
