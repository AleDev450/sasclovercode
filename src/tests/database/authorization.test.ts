import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ALL_PERMISSIONS, ALL_ROLES } from "@/lib/permissions";
import { createTestDatabase, insertTenant, type TestDatabase } from "../helpers/database";

/**
 * Authorization and RLS, executed against real PostgreSQL.
 *
 * Master section 21 makes these mandatory, and section 33 (Phase 3) demands the
 * proof that `Tenant A != Tenant B` at the PostgreSQL level. That proof is
 * TEST-331 at the bottom of this file.
 *
 * Every assertion runs under a real session identity via `asUser()`, so RLS is
 * actually evaluated rather than bypassed by the owner role.
 */

let db: TestDatabase;

/** Two unrelated businesses. */
let tenantA: string;
let tenantB: string;

/** Members of A, one per role under test. */
let ownerA: string;
let adminA: string;
let cashierA: string;
let invitedA: string;
let suspendedA: string;

/** A member of B, used to prove nothing leaks across the boundary. */
let ownerB: string;

/** Someone with an account but no membership anywhere. */
let outsider: string;

async function createUser(email: string): Promise<string> {
  const rows = await db.query<{ id: string }>(
    "insert into auth.users (email) values ($1) returning id",
    [email],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error("createUser returned no id");
  return id;
}

async function addMember(
  tenantId: string,
  userId: string,
  role: string,
  status = "active",
): Promise<void> {
  await db.query(
    `insert into public.tenant_members (tenant_id, user_id, role, status)
     values ($1, $2, $3::public.tenant_role, $4::public.membership_status)`,
    [tenantId, userId, role, status],
  );
}

beforeAll(async () => {
  db = await createTestDatabase();

  tenantA = await insertTenant(db, { slug: "sugurolls", name: "Sugu Rolls" });
  tenantB = await insertTenant(db, { slug: "polleria-el-rey", name: "Pollería El Rey" });

  ownerA = await createUser("owner-a@sugurolls.com");
  adminA = await createUser("admin-a@sugurolls.com");
  cashierA = await createUser("cashier-a@sugurolls.com");
  invitedA = await createUser("invited-a@sugurolls.com");
  suspendedA = await createUser("suspended-a@sugurolls.com");
  ownerB = await createUser("owner-b@polleria.pe");
  outsider = await createUser("nobody@example.com");

  await addMember(tenantA, ownerA, "owner");
  await addMember(tenantA, adminA, "admin");
  await addMember(tenantA, cashierA, "cashier");
  await addMember(tenantA, invitedA, "waiter", "invited");
  await addMember(tenantA, suspendedA, "manager", "suspended");
  await addMember(tenantB, ownerB, "owner");
});

afterAll(async () => {
  await db.close();
});

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

describe("catalogue (TEST-309, TEST-310, TEST-311)", () => {
  /*
   * Counted against the TypeScript catalogue rather than a literal.
   *
   * The number used to be written here, and every phase that added a
   * permission had to come and bump it - at which point the assertion tests
   * nothing except that somebody typed the new number. `ALL_PERMISSIONS` is
   * itself checked against the database, name by name, in
   * `authorization-schema.test.ts`, so counting against it still catches a row
   * that exists on one side only.
   */
  it("loads 8 roles and one permission per catalogue entry", async () => {
    const roles = await db.query<{ c: string }>("select count(*)::text c from public.roles");
    const perms = await db.query<{ c: string }>("select count(*)::text c from public.permissions");
    expect(Number(roles[0]?.c)).toBe(ALL_ROLES.length);
    expect(Number(perms[0]?.c)).toBe(ALL_PERMISSIONS.length);
  });

  it("gives owner every permission and admin all but settings.manage", async () => {
    const owner = await db.query<{ c: string }>(
      "select count(*)::text c from public.role_permissions where role = 'owner'",
    );
    const admin = await db.query<{ permission: string }>(
      "select permission from public.role_permissions where role = 'admin'",
    );
    expect(Number(owner[0]?.c)).toBe(ALL_PERMISSIONS.length);
    expect(admin).toHaveLength(ALL_PERMISSIONS.length - 1);
    expect(admin.map((r) => r.permission)).not.toContain("settings.manage");
  });

  it("rejects a malformed permission code", async () => {
    await expect(
      db.query(
        "insert into public.permissions (code, resource, action) values ('Bad Code','Bad','Code')",
      ),
    ).rejects.toThrow(/permissions_code_format|permissions_code_matches_parts/);
  });

  it("rejects a code that disagrees with its parts", async () => {
    await expect(
      db.query("insert into public.permissions (code, resource, action) values ('a.b','x','y')"),
    ).rejects.toThrow(/permissions_code_matches_parts/);
  });

  it("rejects a mapping to a permission that does not exist", async () => {
    await expect(
      db.query(
        "insert into public.role_permissions (role, permission) values ('owner','ghost.perm')",
      ),
    ).rejects.toThrow(/role_permissions_permission_fkey/);
  });

  it("is readable by any authenticated user", async () => {
    const rows = await db.asUser(outsider, () =>
      db.query<{ c: string }>("select count(*)::text c from public.permissions"),
    );
    expect(Number(rows[0]?.c)).toBe(ALL_PERMISSIONS.length);
  });

  it("is not writable by an authenticated user", async () => {
    await expect(
      db.asUser(ownerA, () =>
        db.query(
          "insert into public.permissions (code, resource, action) values ('evil.act','evil','act')",
        ),
      ),
    ).rejects.toThrow(/row-level security|policy/i);
  });
});

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

describe("is_tenant_member (TEST-314 to TEST-316)", () => {
  it("is true for an active member", async () => {
    const rows = await db.asUser(adminA, () =>
      db.query<{ r: boolean }>("select public.is_tenant_member($1) r", [tenantA]),
    );
    expect(rows[0]?.r).toBe(true);
  });

  it.each([
    ["invited", () => invitedA],
    ["suspended", () => suspendedA],
  ])("is false for a %s membership", async (_label, getUser) => {
    const rows = await db.asUser(getUser(), () =>
      db.query<{ r: boolean }>("select public.is_tenant_member($1) r", [tenantA]),
    );
    expect(rows[0]?.r).toBe(false);
  });

  it("is false for a tenant the user does not belong to", async () => {
    const rows = await db.asUser(adminA, () =>
      db.query<{ r: boolean }>("select public.is_tenant_member($1) r", [tenantB]),
    );
    expect(rows[0]?.r).toBe(false);
  });

  it("is false for a user with no membership at all", async () => {
    const rows = await db.asUser(outsider, () =>
      db.query<{ r: boolean }>("select public.is_tenant_member($1) r", [tenantA]),
    );
    expect(rows[0]?.r).toBe(false);
  });
});

describe("has_permission (TEST-317, TEST-318)", () => {
  it.each([
    ["owner", () => ownerA, "settings.manage", true],
    ["admin", () => adminA, "settings.manage", false],
    ["admin", () => adminA, "members.manage", true],
    ["cashier", () => cashierA, "members.view", false],
    ["cashier", () => cashierA, "cash.open", true],
    ["cashier", () => cashierA, "products.delete", false],
  ])("%s + %s", async (_role, getUser, permission, expected) => {
    const rows = await db.asUser(getUser(), () =>
      db.query<{ r: boolean }>("select public.has_permission($1, $2) r", [tenantA, permission]),
    );
    expect(rows[0]?.r).toBe(expected);
  });

  it("is false in a tenant where the user has no membership (TEST-301 isolation)", async () => {
    // ownerA is an owner - but only of tenant A.
    const rows = await db.asUser(ownerA, () =>
      db.query<{ r: boolean }>("select public.has_permission($1, $2) r", [
        tenantB,
        "settings.manage",
      ]),
    );
    expect(rows[0]?.r).toBe(false);
  });

  it("is false for an unknown tenant id rather than raising (EC-307)", async () => {
    const rows = await db.asUser(ownerA, () =>
      db.query<{ r: boolean }>("select public.has_permission($1, $2) r", [
        "00000000-0000-0000-0000-000000000000",
        "orders.view",
      ]),
    );
    expect(rows[0]?.r).toBe(false);
  });

  it("my_permissions returns the role's whole set", async () => {
    const rows = await db.asUser(cashierA, () =>
      db.query<{ permission: string }>("select * from public.my_permissions($1)", [tenantA]),
    );
    const codes = rows.map((r) => r.permission);
    expect(codes).toContain("cash.open");
    expect(codes).toContain("orders.create");
    expect(codes).not.toContain("members.view");
    expect(codes).not.toContain("settings.manage");
  });

  it("my_permissions is empty for a foreign tenant", async () => {
    const rows = await db.asUser(ownerA, () =>
      db.query("select * from public.my_permissions($1)", [tenantB]),
    );
    expect(rows).toEqual([]);
  });
});

describe("function hardening (TEST-312, TEST-313)", () => {
  it.each(["is_tenant_member", "has_permission", "my_permissions"])(
    "%s is SECURITY DEFINER with a pinned search_path",
    async (name) => {
      const rows = await db.query<{ prosecdef: boolean; proconfig: string[] | null }>(
        "select prosecdef, proconfig from pg_proc where proname = $1",
        [name],
      );
      expect(rows[0]?.prosecdef).toBe(true);
      expect(rows[0]?.proconfig).toContain('search_path=""');
    },
  );

  it.each(["is_tenant_member", "has_permission", "my_permissions"])(
    "%s does not leave EXECUTE with PUBLIC",
    async (name) => {
      const rows = await db.query<{ acl: string | null }>(
        "select array_to_string(proacl, ',') as acl from pg_proc where proname = $1",
        [name],
      );
      // A PUBLIC grant shows up as an entry with an empty grantee ("=X/owner").
      expect(rows[0]?.acl ?? "").not.toMatch(/(^|,)=/);
    },
  );

  it("takes no user id parameter, so it cannot be used as an oracle", async () => {
    const rows = await db.query<{ args: string }>(
      `select pg_get_function_identity_arguments(oid) as args
       from pg_proc where proname in ('is_tenant_member','has_permission','my_permissions')`,
    );
    for (const row of rows) {
      expect(row.args).not.toMatch(/user/i);
    }
  });
});

// ---------------------------------------------------------------------------
// Policies
// ---------------------------------------------------------------------------

describe("tenants policy (TEST-319, TEST-320)", () => {
  it("lets a member read their own tenant", async () => {
    const rows = await db.asUser(adminA, () =>
      db.query<{ slug: string }>("select slug from public.tenants"),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.slug).toBe("sugurolls");
  });

  it("does NOT let a member read another tenant, even by id", async () => {
    const rows = await db.asUser(adminA, () =>
      db.query("select * from public.tenants where id = $1", [tenantB]),
    );
    expect(rows).toEqual([]);
  });

  it("shows nothing to an invited or suspended member", async () => {
    for (const user of [invitedA, suspendedA]) {
      const rows = await db.asUser(user, () => db.query("select * from public.tenants"));
      expect(rows).toEqual([]);
    }
  });

  it("shows nothing to a user with no membership", async () => {
    const rows = await db.asUser(outsider, () => db.query("select * from public.tenants"));
    expect(rows).toEqual([]);
  });

  it("still denies INSERT and UPDATE to members", async () => {
    await expect(
      db.asUser(ownerA, () =>
        db.query("insert into public.tenants (slug, name) values ('sneaky','Sneaky')"),
      ),
    ).rejects.toThrow(/row-level security|policy/i);

    await db.asUser(ownerA, () =>
      db.query("update public.tenants set name = 'Renamed' where id = $1", [tenantA]),
    );
    const rows = await db.query<{ name: string }>("select name from public.tenants where id = $1", [
      tenantA,
    ]);
    expect(rows[0]?.name).toBe("Sugu Rolls");
  });
});

describe("tenant_members roster (TEST-321 to TEST-323)", () => {
  it("shows only the own row without members.view", async () => {
    const rows = await db.asUser(cashierA, () =>
      db.query<{ user_id: string }>("select user_id from public.tenant_members"),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.user_id).toBe(cashierA);
  });

  it("shows the whole roster of the OWN tenant with members.view", async () => {
    const rows = await db.asUser(adminA, () =>
      db.query<{ tenant_id: string }>("select tenant_id from public.tenant_members"),
    );
    expect(rows.length).toBe(5);
    expect(rows.every((r) => r.tenant_id === tenantA)).toBe(true);
  });

  it("never shows the roster of another tenant", async () => {
    const rows = await db.asUser(adminA, () =>
      db.query("select * from public.tenant_members where tenant_id = $1", [tenantB]),
    );
    expect(rows).toEqual([]);
  });
});

describe("tenant_members writes (TEST-324 to TEST-326)", () => {
  it("denies INSERT without members.manage", async () => {
    const newUser = await createUser("recruit-1@x.com");
    await expect(
      db.asUser(cashierA, () =>
        db.query(
          `insert into public.tenant_members (tenant_id, user_id, role)
           values ($1, $2, 'waiter')`,
          [tenantA, newUser],
        ),
      ),
    ).rejects.toThrow(/row-level security|policy/i);
  });

  it("allows INSERT into the OWN tenant with members.manage", async () => {
    const newUser = await createUser("recruit-2@x.com");
    await expect(
      db.asUser(adminA, () =>
        db.query(
          `insert into public.tenant_members (tenant_id, user_id, role)
           values ($1, $2, 'waiter')`,
          [tenantA, newUser],
        ),
      ),
    ).resolves.toBeDefined();
  });

  it("denies INSERT into ANOTHER tenant despite holding the permission here", async () => {
    const newUser = await createUser("recruit-3@x.com");
    await expect(
      db.asUser(adminA, () =>
        db.query(
          `insert into public.tenant_members (tenant_id, user_id, role)
           values ($1, $2, 'waiter')`,
          [tenantB, newUser],
        ),
      ),
    ).rejects.toThrow(/row-level security|policy/i);
  });

  it("denies DELETE of a member of another tenant", async () => {
    await db.asUser(adminA, () =>
      db.query("delete from public.tenant_members where tenant_id = $1", [tenantB]),
    );
    const rows = await db.query<{ c: string }>(
      "select count(*)::text c from public.tenant_members where tenant_id = $1",
      [tenantB],
    );
    expect(Number(rows[0]?.c)).toBe(1);
  });
});

describe("privilege escalation guard (TEST-327 to TEST-329)", () => {
  it("stops an admin from minting an owner", async () => {
    const newUser = await createUser("wannabe-owner@x.com");
    await expect(
      db.asUser(adminA, () =>
        db.query(
          `insert into public.tenant_members (tenant_id, user_id, role)
           values ($1, $2, 'owner')`,
          [tenantA, newUser],
        ),
      ),
    ).rejects.toThrow(/row-level security|policy/i);
  });

  it("lets an owner mint another owner", async () => {
    const newUser = await createUser("co-owner@x.com");
    await expect(
      db.asUser(ownerA, () =>
        db.query(
          `insert into public.tenant_members (tenant_id, user_id, role)
           values ($1, $2, 'owner')`,
          [tenantA, newUser],
        ),
      ),
    ).resolves.toBeDefined();
  });

  it("stops an admin from promoting somebody to owner", async () => {
    const target = await createUser("promote-me@x.com");
    await db.asUser(ownerA, () =>
      db.query(
        `insert into public.tenant_members (tenant_id, user_id, role)
         values ($1, $2, 'waiter')`,
        [tenantA, target],
      ),
    );

    // USING lets the row be targeted (it is a manageable non-owner row), but
    // WITH CHECK rejects what it would become. PostgreSQL raises rather than
    // silently updating nothing, which is the stricter of the two outcomes.
    await expect(
      db.asUser(adminA, () =>
        db.query(
          "update public.tenant_members set role = 'owner' where tenant_id = $1 and user_id = $2",
          [tenantA, target],
        ),
      ),
    ).rejects.toThrow(/row-level security|policy/i);

    const rows = await db.query<{ role: string }>(
      "select role from public.tenant_members where tenant_id = $1 and user_id = $2",
      [tenantA, target],
    );
    expect(rows[0]?.role).toBe("waiter");
  });

  it("stops an admin from promoting THEMSELVES to owner", async () => {
    await expect(
      db.asUser(adminA, () =>
        db.query(
          "update public.tenant_members set role = 'owner' where tenant_id = $1 and user_id = $2",
          [tenantA, adminA],
        ),
      ),
    ).rejects.toThrow(/row-level security|policy/i);

    const rows = await db.query<{ role: string }>(
      "select role from public.tenant_members where tenant_id = $1 and user_id = $2",
      [tenantA, adminA],
    );
    expect(rows[0]?.role).toBe("admin");
  });

  it("stops an admin from removing an owner", async () => {
    await db.asUser(adminA, () =>
      db.query("delete from public.tenant_members where tenant_id = $1 and user_id = $2", [
        tenantA,
        ownerA,
      ]),
    );
    const rows = await db.query<{ c: string }>(
      "select count(*)::text c from public.tenant_members where tenant_id = $1 and user_id = $2",
      [tenantA, ownerA],
    );
    expect(Number(rows[0]?.c)).toBe(1);
  });
});

describe("anonymous access (TEST-330)", () => {
  it.each(["tenants", "tenant_members"])("sees no rows of %s", async (table) => {
    const rows = await db.asRole("anon", () =>
      db.query<{ c: string }>(`select count(*)::text c from public.${table}`),
    );
    expect(Number(rows[0]?.c)).toBe(0);
  });

  it("cannot read the catalogue either: it is granted to authenticated only", async () => {
    const rows = await db.asRole("anon", () =>
      db.query<{ c: string }>("select count(*)::text c from public.permissions"),
    );
    expect(Number(rows[0]?.c)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// TEST-331 - the proof this phase exists to produce
// ---------------------------------------------------------------------------

describe("TEST-331: Tenant A != Tenant B at the PostgreSQL level", () => {
  const TENANT_TABLES = ["tenants", "tenant_members"] as const;

  it("no member of A reads a single row belonging to B, in any table", async () => {
    const membersOfA = [
      ["owner", () => ownerA],
      ["admin", () => adminA],
      ["cashier", () => cashierA],
      ["invited", () => invitedA],
      ["suspended", () => suspendedA],
    ] as const;

    for (const [label, getUser] of membersOfA) {
      // tenants: nothing whose id is B
      const tenants = await db.asUser(getUser(), () =>
        db.query("select * from public.tenants where id = $1", [tenantB]),
      );
      expect(tenants, `${label} of A reached tenant B`).toEqual([]);

      // tenant_members: nothing scoped to B
      const members = await db.asUser(getUser(), () =>
        db.query("select * from public.tenant_members where tenant_id = $1", [tenantB]),
      );
      expect(members, `${label} of A reached B's roster`).toEqual([]);
    }
  });

  it("no member of B reads a single row belonging to A", async () => {
    for (const table of TENANT_TABLES) {
      const column = table === "tenants" ? "id" : "tenant_id";
      const rows = await db.asUser(ownerB, () =>
        db.query(`select * from public.${table} where ${column} = $1`, [tenantA]),
      );
      expect(rows, `owner of B reached A via ${table}`).toEqual([]);
    }
  });

  it("an unrestricted SELECT never mixes the two tenants", async () => {
    const fromA = await db.asUser(ownerA, () =>
      db.query<{ id: string }>("select id from public.tenants"),
    );
    const fromB = await db.asUser(ownerB, () =>
      db.query<{ id: string }>("select id from public.tenants"),
    );

    expect(fromA.map((r) => r.id)).toEqual([tenantA]);
    expect(fromB.map((r) => r.id)).toEqual([tenantB]);

    const idsA = new Set(fromA.map((r) => r.id));
    expect(idsA.has(tenantB)).toBe(false);
  });

  it("no role in the catalogue grants cross-tenant reach", async () => {
    // Give one user every role in turn inside tenant A, and check each time
    // that tenant B stays invisible. Proves isolation is not a property of the
    // roles we happened to test above.
    const roles = await db.query<{ code: string }>("select code from public.roles order by rank");
    const probe = await createUser("role-probe@x.com");

    for (const { code } of roles) {
      await db.query("delete from public.tenant_members where user_id = $1", [probe]);
      await addMember(tenantA, probe, code);

      const tenants = await db.asUser(probe, () =>
        db.query("select * from public.tenants where id = $1", [tenantB]),
      );
      const members = await db.asUser(probe, () =>
        db.query("select * from public.tenant_members where tenant_id = $1", [tenantB]),
      );

      expect(tenants, `role ${code} reached tenant B`).toEqual([]);
      expect(members, `role ${code} reached B's roster`).toEqual([]);
    }
  });

  it("writes aimed at B from inside A change nothing", async () => {
    const before = await db.query<{ c: string }>(
      "select count(*)::text c from public.tenant_members where tenant_id = $1",
      [tenantB],
    );

    await db.asUser(ownerA, () =>
      db.query("update public.tenant_members set role = 'waiter' where tenant_id = $1", [tenantB]),
    );
    await db.asUser(ownerA, () =>
      db.query("delete from public.tenant_members where tenant_id = $1", [tenantB]),
    );

    const after = await db.query<{ c: string; role: string }>(
      "select count(*)::text c, max(role::text) role from public.tenant_members where tenant_id = $1",
      [tenantB],
    );

    expect(after[0]?.c).toBe(before[0]?.c);
    expect(after[0]?.role).toBe("owner");
  });
});

// ---------------------------------------------------------------------------
// Findings of the Phase 03 audit
// ---------------------------------------------------------------------------

describe("audit: moving a membership across tenants", () => {
  it("rejects an UPDATE that reassigns a row to another tenant", async () => {
    // A cross-tenant WRITE vector the original suite never exercised: instead
    // of inserting into B, take a row you legitimately manage in A and change
    // its tenant_id. USING passes (the row is yours), WITH CHECK must not.
    const victim = await createUser("relocate-me@x.com");
    await db.asUser(ownerA, () =>
      db.query(
        `insert into public.tenant_members (tenant_id, user_id, role)
         values ($1, $2, 'waiter')`,
        [tenantA, victim],
      ),
    );

    await expect(
      db.asUser(adminA, () =>
        db.query("update public.tenant_members set tenant_id = $1 where user_id = $2", [
          tenantB,
          victim,
        ]),
      ),
    ).rejects.toThrow(/row-level security|policy/i);

    const rows = await db.query<{ tenant_id: string }>(
      "select tenant_id from public.tenant_members where user_id = $1",
      [victim],
    );
    expect(rows[0]?.tenant_id).toBe(tenantA);
  });
});

describe("audit: get_tenant_members", () => {
  it("returns the roster WITH identities for a caller holding members.view", async () => {
    const rows = await db.asUser(adminA, () =>
      db.query<{ email: string; role: string }>("select * from public.get_tenant_members($1)", [
        tenantA,
      ]),
    );
    expect(rows.length).toBeGreaterThan(1);
    // The whole point of the fix: names, not opaque uuids.
    expect(rows.every((r) => typeof r.email === "string" && r.email.length > 0)).toBe(true);
    expect(rows.map((r) => r.email)).toContain("owner-a@sugurolls.com");
  });

  it("returns nothing to a caller without members.view", async () => {
    const rows = await db.asUser(cashierA, () =>
      db.query("select * from public.get_tenant_members($1)", [tenantA]),
    );
    expect(rows).toEqual([]);
  });

  it("returns nothing for a tenant the caller does not belong to", async () => {
    const rows = await db.asUser(adminA, () =>
      db.query("select * from public.get_tenant_members($1)", [tenantB]),
    );
    expect(rows).toEqual([]);
  });

  it("is hardened like every other SECURITY DEFINER function here", async () => {
    const rows = await db.query<{
      prosecdef: boolean;
      proconfig: string[] | null;
      acl: string | null;
    }>(
      `select prosecdef, proconfig, array_to_string(proacl, ',') as acl
       from pg_proc where proname = 'get_tenant_members'`,
    );
    expect(rows[0]?.prosecdef).toBe(true);
    expect(rows[0]?.proconfig).toContain('search_path=""');
    expect(rows[0]?.acl ?? "").not.toMatch(/(^|,)=/);
  });
});

describe("audit: profiles stay closed", () => {
  it("does not expose co-members' profile rows directly", async () => {
    // The roster comes from the guarded function. `profiles` itself remains
    // own-row-only, so personal data is not opened up as a side effect.
    const rows = await db.asUser(adminA, () =>
      db.query<{ id: string }>("select id from public.profiles"),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(adminA);
  });
});
