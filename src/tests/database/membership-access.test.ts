import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestDatabase,
  insertAuthUser,
  insertMembership,
  insertTenant,
  type TestDatabase,
} from "../helpers/database";

/**
 * `get_my_memberships()` - the only path from an authenticated session to
 * tenant identity while `public.tenants` stays deny-by-default.
 *
 * A SECURITY DEFINER function bypasses RLS by design, so its safety rests
 * entirely on its own WHERE clause. That makes it the highest-risk object added
 * by this phase, and these tests are what hold it to its contract.
 */

interface MembershipRow {
  membership_id: string;
  tenant_id: string;
  tenant_slug: string;
  tenant_name: string;
  tenant_status: string;
  role: string;
  status: string;
}

let db: TestDatabase;

let tenantA: string;
let tenantB: string;
let userA: string;
let userB: string;
let outsider: string;

beforeAll(async () => {
  db = await createTestDatabase();

  tenantA = await insertTenant(db, { slug: "sugurolls", name: "Sugu Rolls" });
  tenantB = await insertTenant(db, { slug: "polleria-el-rey", name: "Polleria El Rey" });

  userA = await insertAuthUser(db, { email: "ana@sugurolls.com" });
  userB = await insertAuthUser(db, { email: "beto@elrey.com" });
  outsider = await insertAuthUser(db, { email: "dan@nadie.com" });

  await insertMembership(db, { tenantId: tenantA, userId: userA, role: "owner" });
  await insertMembership(db, { tenantId: tenantB, userId: userB, role: "manager" });
});

afterAll(async () => {
  await db.close();
});

function callAs(userId: string | null): Promise<MembershipRow[]> {
  return db.asUser(userId, () =>
    db.query<MembershipRow>("select * from public.get_my_memberships()"),
  );
}

describe("TEST-220: returns the caller's own memberships, with tenant identity", () => {
  it("gives user A their tenant", async () => {
    const rows = await callAs(userA);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tenant_id).toBe(tenantA);
    expect(rows[0]?.tenant_slug).toBe("sugurolls");
    expect(rows[0]?.tenant_name).toBe("Sugu Rolls");
    expect(rows[0]?.role).toBe("owner");
    expect(rows[0]?.status).toBe("active");
  });

  it("resolves tenant name and slug even though `tenants` is unreadable", async () => {
    // The point of the function: a direct SELECT returns nothing.
    const direct = await db.asUser(userA, () => db.query("select 1 from public.tenants"));
    expect(direct).toEqual([]);

    const viaFunction = await callAs(userA);
    expect(viaFunction[0]?.tenant_name).toBe("Sugu Rolls");
  });

  it("returns several rows for a user in several tenants", async () => {
    const user = await insertAuthUser(db, { email: "carla@contadora.pe" });
    await insertMembership(db, { tenantId: tenantA, userId: user, role: "accountant" });
    await insertMembership(db, { tenantId: tenantB, userId: user, role: "accountant" });

    const rows = await callAs(user);
    expect(rows.map((r) => r.tenant_id).sort()).toEqual([tenantA, tenantB].sort());
  });

  it("returns nothing for a user with no memberships", async () => {
    expect(await callAs(outsider)).toEqual([]);
  });
});

describe("TEST-221: never returns another user's memberships", () => {
  it("does not leak tenant B to user A", async () => {
    const rows = await callAs(userA);
    expect(rows.map((r) => r.tenant_id)).not.toContain(tenantB);
  });

  it("does not leak tenant A to user B", async () => {
    const rows = await callAs(userB);
    expect(rows.map((r) => r.tenant_id)).toEqual([tenantB]);
  });

  it("takes no user parameter, so nobody can ask about anybody else", async () => {
    // The absence of a parameter is the security property. If an argument is
    // ever added, this fails and forces the question to be revisited.
    const rows = await db.query<{ args: string }>(
      `select pg_get_function_identity_arguments(p.oid) as args
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'get_my_memberships'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.args).toBe("");
  });

  it("returns nothing when there is no identity at all", async () => {
    expect(await callAs(null)).toEqual([]);
  });
});

describe("TEST-222: tenant lifecycle is respected", () => {
  it("hides an archived tenant from its own members", async () => {
    const tenant = await insertTenant(db, { slug: "cerrado", name: "Cerrado SAC" });
    const user = await insertAuthUser(db, { email: "cerrado@x.com" });
    await insertMembership(db, { tenantId: tenant, userId: user });

    expect(await callAs(user)).toHaveLength(1);

    await db.query("update public.tenants set status = 'archived' where id = $1", [tenant]);
    expect(await callAs(user)).toEqual([]);
  });

  it("still returns a suspended tenant, carrying its status", async () => {
    // Same reasoning as the Phase 01 resolver: the application shows a notice,
    // it does not pretend the business never existed.
    const tenant = await insertTenant(db, { slug: "suspendido", name: "Suspendido SAC" });
    const user = await insertAuthUser(db, { email: "suspendido@x.com" });
    await insertMembership(db, { tenantId: tenant, userId: user });

    await db.query("update public.tenants set status = 'suspended' where id = $1", [tenant]);

    const rows = await callAs(user);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tenant_status).toBe("suspended");
  });

  it("reports a non-active membership rather than hiding it", async () => {
    // The application needs to tell "you were removed" apart from "you never
    // had access", so the filtering happens in the application, not here.
    const tenant = await insertTenant(db, { slug: "invitado", name: "Invitado SAC" });
    const user = await insertAuthUser(db, { email: "invitado@x.com" });
    await insertMembership(db, { tenantId: tenant, userId: user, status: "invited" });

    const rows = await callAs(user);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("invited");
  });
});

describe("TEST-223: least privilege and hardening", () => {
  it("is SECURITY DEFINER with a pinned search_path", async () => {
    const rows = await db.query<{ prosecdef: boolean; proconfig: string[] | null }>(
      `select prosecdef, proconfig from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'get_my_memberships'`,
    );
    expect(rows[0]?.prosecdef).toBe(true);
    expect(rows[0]?.proconfig).toContain('search_path=""');
  });

  it("is not executable by PUBLIC", async () => {
    // The Phase 01 audit finding (AUD-01), applied from the start here.
    const rows = await db.query<{ acl: string | null }>(
      `select proacl::text as acl from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'get_my_memberships'`,
    );
    const acl = rows[0]?.acl ?? "";
    expect(acl).not.toMatch(/(^|[{,])=X\//);
    expect(acl).toContain("authenticated=X/");
  });

  it("is not executable by anon", async () => {
    // With no session it could only ever return zero rows, so granting it would
    // add surface for no capability.
    await expect(
      db.asRole("anon", () => db.query("select * from public.get_my_memberships()")),
    ).rejects.toThrow(/permission denied/i);
  });
});
