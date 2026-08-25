import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, insertTenant, type TestDatabase } from "../helpers/database";

/**
 * Platform operator authority.
 *
 * The invariant this file exists to defend is master section 29: `SUPER_ADMIN`
 * of CloverCode is never `OWNER` of a tenant. Several tests below check that in
 * both directions, because a system where the two blur is a system where one
 * business's owner can reach another's data.
 */

let db: TestDatabase;

let tenantA: string;
let tenantB: string;
let operator: string;
let revokedOperator: string;
let ownerA: string;
let outsider: string;

async function createUser(email: string): Promise<string> {
  const rows = await db.query<{ id: string }>(
    "insert into auth.users (email) values ($1) returning id",
    [email],
  );
  return rows[0]!.id;
}

beforeAll(async () => {
  db = await createTestDatabase();

  tenantA = await insertTenant(db, { slug: "sugurolls", name: "Sugu Rolls" });
  tenantB = await insertTenant(db, { slug: "polleria-el-rey", name: "Pollería El Rey" });

  operator = await createUser("staff@clovercode.com");
  revokedOperator = await createUser("exstaff@clovercode.com");
  ownerA = await createUser("owner@sugurolls.com");
  outsider = await createUser("nobody@example.com");

  await db.query(
    "insert into public.platform_admins (user_id, status) values ($1,'active'),($2,'revoked')",
    [operator, revokedOperator],
  );
  await db.query(
    `insert into public.tenant_members (tenant_id, user_id, role)
     values ($1, $2, 'owner')`,
    [tenantA, ownerA],
  );
});

afterAll(async () => {
  await db.close();
});

describe("schema (TEST-404 to TEST-406)", () => {
  it("keeps platform identity in its own table", async () => {
    const rows = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema='public' and table_name='platform_admins' order by column_name`,
    );
    expect(rows.map((r) => r.column_name)).toEqual([
      "created_at",
      "note",
      "status",
      "updated_at",
      "user_id",
    ]);
  });

  it("hardens is_platform_admin like every other guarded function", async () => {
    const rows = await db.query<{
      prosecdef: boolean;
      proconfig: string[] | null;
      acl: string | null;
      args: string;
    }>(
      `select prosecdef, proconfig, array_to_string(proacl, ',') as acl,
              pg_get_function_identity_arguments(oid) as args
       from pg_proc where proname = 'is_platform_admin'`,
    );
    expect(rows[0]?.prosecdef).toBe(true);
    expect(rows[0]?.proconfig).toContain('search_path=""');
    expect(rows[0]?.acl ?? "").not.toMatch(/(^|,)=/);
    // No user parameter: a caller can only ask about themselves.
    expect(rows[0]?.args).toBe("");
  });

  it("gives platform_admins no write policy at all (TEST-413)", async () => {
    const rows = await db.query<{ cmd: string }>(
      `select cmd from pg_policies
       where schemaname='public' and tablename='platform_admins'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.cmd).toBe("SELECT");
  });
});

describe("platform visibility (TEST-407, TEST-408)", () => {
  it("shows an operator every tenant", async () => {
    const rows = await db.asUser(operator, () =>
      db.query<{ id: string }>("select id from public.tenants"),
    );
    expect(rows).toHaveLength(2);
  });

  it("shows a REVOKED operator nothing", async () => {
    const rows = await db.asUser(revokedOperator, () => db.query("select id from public.tenants"));
    expect(rows).toEqual([]);
  });

  it("lets an operator read any tenant's roster", async () => {
    const rows = await db.asUser(operator, () =>
      db.query("select * from public.tenant_members where tenant_id = $1", [tenantA]),
    );
    expect(rows).toHaveLength(1);
  });

  it("lets an operator read domains of any tenant", async () => {
    const rows = await db.asUser(operator, () => db.query("select * from public.tenant_domains"));
    expect(rows).toEqual([]); // none provisioned yet, but the query is allowed
  });
});

/**
 * Master section 29, checked in both directions.
 */
describe("SUPER_ADMIN is never OWNER (TEST-409 to TEST-411)", () => {
  it("an OWNER still sees only their own tenant", async () => {
    const rows = await db.asUser(ownerA, () =>
      db.query<{ id: string }>("select id from public.tenants"),
    );
    expect(rows.map((r) => r.id)).toEqual([tenantA]);
  });

  it("an OWNER is not a platform operator", async () => {
    const rows = await db.asUser(ownerA, () =>
      db.query<{ r: boolean }>("select public.is_platform_admin() r"),
    );
    expect(rows[0]?.r).toBe(false);
  });

  it("an operator is not a member of any tenant by virtue of being one", async () => {
    const member = await db.asUser(operator, () =>
      db.query<{ r: boolean }>("select public.is_tenant_member($1) r", [tenantA]),
    );
    expect(member[0]?.r).toBe(false);

    const permission = await db.asUser(operator, () =>
      db.query<{ r: boolean }>("select public.has_permission($1,'settings.manage') r", [tenantA]),
    );
    expect(permission[0]?.r).toBe(false);
  });

  it("an operator cannot write a tenant's roster", async () => {
    const recruit = await createUser("recruit@x.com");
    await expect(
      db.asUser(operator, () =>
        db.query(
          `insert into public.tenant_members (tenant_id, user_id, role)
           values ($1, $2, 'admin')`,
          [tenantA, recruit],
        ),
      ),
    ).rejects.toThrow(/row-level security|policy/i);
  });
});

describe("nobody grants themselves platform authority (TEST-412, TEST-413)", () => {
  it.each([
    ["an owner", () => ownerA],
    ["an outsider", () => outsider],
  ])("%s cannot insert a platform_admins row", async (_label, getUser) => {
    await expect(
      db.asUser(getUser(), () =>
        db.query("insert into public.platform_admins (user_id) values ($1)", [getUser()]),
      ),
    ).rejects.toThrow(/row-level security|policy/i);
  });

  it("a user cannot read another user's platform status", async () => {
    const rows = await db.asUser(ownerA, () =>
      db.query("select * from public.platform_admins where user_id = $1", [operator]),
    );
    expect(rows).toEqual([]);
  });

  it("a revoked operator cannot reactivate themselves", async () => {
    await db.asUser(revokedOperator, () =>
      db.query("update public.platform_admins set status='active' where user_id=$1", [
        revokedOperator,
      ]),
    );
    const rows = await db.query<{ status: string }>(
      "select status from public.platform_admins where user_id = $1",
      [revokedOperator],
    );
    expect(rows[0]?.status).toBe("revoked");
  });
});

describe("tenants are archived, never deleted (TEST-414)", () => {
  it("has no DELETE policy for anyone", async () => {
    const rows = await db.query(
      "select 1 from pg_policies where schemaname='public' and tablename='tenants' and cmd='DELETE'",
    );
    expect(rows).toEqual([]);
  });

  it("an operator cannot delete a tenant", async () => {
    await db.asUser(operator, () =>
      db.query("delete from public.tenants where id = $1", [tenantB]),
    );
    const rows = await db.query<{ c: string }>(
      "select count(*)::text c from public.tenants where id = $1",
      [tenantB],
    );
    expect(Number(rows[0]?.c)).toBe(1);
  });
});

describe("provision_tenant (TEST-415 to TEST-420)", () => {
  it("creates tenant, system domain and owner in one call", async () => {
    const id = await db.asUser(operator, async () => {
      const rows = await db.query<{ provision_tenant: string }>(
        "select public.provision_tenant($1,$2,$3)",
        ["Nueva Empresa", "nueva-empresa", "owner@sugurolls.com"],
      );
      return rows[0]!.provision_tenant;
    });

    const tenant = await db.query<{ slug: string; status: string }>(
      "select slug, status from public.tenants where id = $1",
      [id],
    );
    expect(tenant[0]?.slug).toBe("nueva-empresa");
    expect(tenant[0]?.status).toBe("active");

    const domain = await db.query<{
      domain: string;
      type: string;
      is_primary: boolean;
      verification_status: string;
    }>(
      "select domain, type, is_primary, verification_status from public.tenant_domains where tenant_id = $1",
      [id],
    );
    expect(domain[0]?.domain).toBe("nueva-empresa.clovercodeapp.com");
    expect(domain[0]?.type).toBe("system");
    expect(domain[0]?.is_primary).toBe(true);
    expect(domain[0]?.verification_status).toBe("active");

    const member = await db.query<{ role: string; status: string }>(
      "select role, status from public.tenant_members where tenant_id = $1",
      [id],
    );
    expect(member[0]?.role).toBe("owner");
    expect(member[0]?.status).toBe("active");
  });

  it("is idempotent: a second call with the same slug creates nothing new", async () => {
    const call = () =>
      db.asUser(operator, async () => {
        const rows = await db.query<{ provision_tenant: string }>(
          "select public.provision_tenant($1,$2,$3)",
          ["Repetida", "repetida", "owner@sugurolls.com"],
        );
        return rows[0]!.provision_tenant;
      });

    const first = await call();
    const second = await call();

    expect(second).toBe(first);

    const domains = await db.query<{ c: string }>(
      "select count(*)::text c from public.tenant_domains where tenant_id = $1",
      [first],
    );
    const members = await db.query<{ c: string }>(
      "select count(*)::text c from public.tenant_members where tenant_id = $1",
      [first],
    );
    expect(Number(domains[0]?.c)).toBe(1);
    expect(Number(members[0]?.c)).toBe(1);
  });

  it("refuses a caller who is not a platform operator (TEST-418)", async () => {
    await expect(
      db.asUser(ownerA, () =>
        db.query("select public.provision_tenant($1,$2,$3)", [
          "Pirata",
          "pirata",
          "owner@sugurolls.com",
        ]),
      ),
    ).rejects.toThrow(/platform operator/i);
  });

  it("creates NOTHING when the owner email has no account (TEST-419)", async () => {
    await expect(
      db.asUser(operator, () =>
        db.query("select public.provision_tenant($1,$2,$3)", [
          "Sin Dueno",
          "sin-dueno",
          "ghost@nowhere.com",
        ]),
      ),
    ).rejects.toThrow(/No account exists/i);

    // Atomicity: the tenant insert must have rolled back with the rest.
    const rows = await db.query("select 1 from public.tenants where slug = 'sin-dueno'");
    expect(rows).toEqual([]);
  });

  it("is refused by the database for a reserved slug (TEST-420)", async () => {
    await expect(
      db.asUser(operator, () =>
        db.query("select public.provision_tenant($1,$2,$3)", [
          "Sitio Web",
          "www",
          "owner@sugurolls.com",
        ]),
      ),
    ).rejects.toThrow(/tenants_slug_not_reserved|tenants_slug_length/);
  });
});

describe("list_platform_tenants", () => {
  it("returns every tenant with its primary domain and member count", async () => {
    const rows = await db.asUser(operator, () =>
      db.query<{ slug: string; primary_domain: string | null; member_count: string }>(
        "select * from public.list_platform_tenants()",
      ),
    );
    const provisioned = rows.find((r) => r.slug === "nueva-empresa");
    expect(provisioned?.primary_domain).toBe("nueva-empresa.clovercodeapp.com");
    expect(Number(provisioned?.member_count)).toBe(1);
  });

  it("returns nothing to a non-operator, rather than raising", async () => {
    const rows = await db.asUser(ownerA, () =>
      db.query("select * from public.list_platform_tenants()"),
    );
    expect(rows).toEqual([]);
  });
});

/**
 * TEST-421 - the goal master section 49 sets for the whole project.
 */
describe("TEST-421: the section 49 goal, end to end", () => {
  it("provisions a tenant, resolves its domain, and keeps it isolated", async () => {
    const ownerC = await createUser("owner@empresa-c.com");

    const tenantC = await db.asUser(operator, async () => {
      const rows = await db.query<{ provision_tenant: string }>(
        "select public.provision_tenant($1,$2,$3)",
        ["Empresa C", "empresa-c", "owner@empresa-c.com"],
      );
      return rows[0]!.provision_tenant;
    });

    // 1. The system domain resolves, through the Phase 01 resolver.
    const resolved = await db.query<{ tenant_id: string; slug: string }>(
      "select * from public.resolve_tenant_by_domain($1)",
      ["empresa-c.clovercodeapp.com"],
    );
    expect(resolved[0]?.tenant_id).toBe(tenantC);
    expect(resolved[0]?.slug).toBe("empresa-c");

    // 2. Its owner can reach their own business...
    const own = await db.asUser(ownerC, () =>
      db.query<{ id: string }>("select id from public.tenants"),
    );
    expect(own.map((r) => r.id)).toEqual([tenantC]);

    // 3. ...and no other, which is the proof section 49 demands.
    for (const foreign of [tenantA, tenantB]) {
      const rows = await db.asUser(ownerC, () =>
        db.query("select * from public.tenants where id = $1", [foreign]),
      );
      expect(rows, "the new owner reached another tenant").toEqual([]);
    }

    // 4. And being an owner still confers nothing on the platform.
    const isAdmin = await db.asUser(ownerC, () =>
      db.query<{ r: boolean }>("select public.is_platform_admin() r"),
    );
    expect(isAdmin[0]?.r).toBe(false);
  });
});
