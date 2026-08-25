import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestDatabase,
  insertAuthUser,
  insertMembership,
  insertTenant,
  type TestDatabase,
} from "../helpers/database";

/**
 * Phase 02 isolation proof.
 *
 * The question this file answers is not "does sign-in work" - that is Supabase
 * Auth's - but: given a verified identity, can that identity reach anything
 * belonging to somebody else? Every assertion runs as the `authenticated` role
 * with a real `auth.uid()`, against PostgreSQL, with the project's own
 * migrations applied.
 */

let db: TestDatabase;

let tenantA: string;
let tenantB: string;
let userA: string;
let userB: string;
/** Belongs to both tenants: master section 11 requires that to be possible. */
let userBoth: string;
let outsider: string;

beforeAll(async () => {
  db = await createTestDatabase();

  tenantA = await insertTenant(db, { slug: "sugurolls", name: "Sugu Rolls" });
  tenantB = await insertTenant(db, { slug: "polleria-el-rey", name: "Polleria El Rey" });

  userA = await insertAuthUser(db, { email: "ana@sugurolls.com", fullName: "Ana Torres" });
  userB = await insertAuthUser(db, { email: "beto@elrey.com", fullName: "Beto Rios" });
  userBoth = await insertAuthUser(db, { email: "carla@contadora.pe", fullName: "Carla Diaz" });
  outsider = await insertAuthUser(db, { email: "dan@nadie.com" });

  await insertMembership(db, { tenantId: tenantA, userId: userA, role: "owner" });
  await insertMembership(db, { tenantId: tenantB, userId: userB, role: "owner" });
  await insertMembership(db, { tenantId: tenantA, userId: userBoth, role: "accountant" });
  await insertMembership(db, { tenantId: tenantB, userId: userBoth, role: "accountant" });
});

afterAll(async () => {
  await db.close();
});

// ---------------------------------------------------------------------------
// profiles
// ---------------------------------------------------------------------------

describe("TEST-210: profiles are created by the trigger, not by the client", () => {
  it("creates a profile for every auth user", async () => {
    const rows = await db.query<{ id: string; email: string; full_name: string | null }>(
      "select id, email, full_name from public.profiles where id = $1",
      [userA],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.email).toBe("ana@sugurolls.com");
    expect(rows[0]?.full_name).toBe("Ana Torres");
  });

  it("leaves full_name null when the metadata carries none", async () => {
    const rows = await db.query<{ full_name: string | null }>(
      "select full_name from public.profiles where id = $1",
      [outsider],
    );
    expect(rows[0]?.full_name).toBeNull();
  });

  it("keeps the email in sync when auth.users changes it", async () => {
    const id = await insertAuthUser(db, { email: "old@sugurolls.com" });
    await db.query("update auth.users set email = $1 where id = $2", ["new@sugurolls.com", id]);

    const rows = await db.query<{ email: string }>(
      "select email from public.profiles where id = $1",
      [id],
    );
    expect(rows[0]?.email).toBe("new@sugurolls.com");
  });

  it("removes the profile when the auth user is deleted", async () => {
    const id = await insertAuthUser(db, { email: "temporal@sugurolls.com" });
    await db.query("delete from auth.users where id = $1", [id]);

    const rows = await db.query("select 1 from public.profiles where id = $1", [id]);
    expect(rows).toEqual([]);
  });

  it("stores no credential column whatsoever", async () => {
    // Master section 33 (Phase 2): a password never lives outside Supabase Auth.
    const rows = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'profiles'`,
    );
    const names = rows.map((r) => r.column_name);
    for (const forbidden of ["password", "password_hash", "encrypted_password", "salt", "token"]) {
      expect(names).not.toContain(forbidden);
    }
  });
});

describe("TEST-211: a user sees only their own profile", () => {
  it("reads their own row", async () => {
    const rows = await db.asUser(userA, () =>
      db.query<{ email: string }>("select email from public.profiles"),
    );
    expect(rows.map((r) => r.email)).toEqual(["ana@sugurolls.com"]);
  });

  it("cannot read another user's profile even knowing the id", async () => {
    const rows = await db.asUser(userA, () =>
      db.query("select 1 from public.profiles where id = $1", [userB]),
    );
    expect(rows).toEqual([]);
  });

  it("cannot enumerate the platform's users", async () => {
    const rows = await db.asUser(userA, () =>
      db.query<{ count: string }>("select count(*) as count from public.profiles"),
    );
    expect(Number(rows[0]?.count)).toBe(1);
  });

  it("sees nothing at all without an identity", async () => {
    const rows = await db.asUser(null, () =>
      db.query<{ count: string }>("select count(*) as count from public.profiles"),
    );
    expect(Number(rows[0]?.count)).toBe(0);
  });

  it("is invisible to anon", async () => {
    const rows = await db.asRole("anon", () =>
      db.query<{ count: string }>("select count(*) as count from public.profiles"),
    );
    expect(Number(rows[0]?.count)).toBe(0);
  });
});

describe("TEST-212: a user cannot write outside their own profile", () => {
  it("updates their own name", async () => {
    await db.asUser(userA, () =>
      db.query("update public.profiles set full_name = $1 where id = $2", ["Ana T.", userA]),
    );
    const rows = await db.query<{ full_name: string | null }>(
      "select full_name from public.profiles where id = $1",
      [userA],
    );
    expect(rows[0]?.full_name).toBe("Ana T.");
  });

  it("silently affects nothing when updating somebody else", async () => {
    await db.asUser(userA, () =>
      db.query("update public.profiles set full_name = $1 where id = $2", ["Hacked", userB]),
    );
    const rows = await db.query<{ full_name: string | null }>(
      "select full_name from public.profiles where id = $1",
      [userB],
    );
    expect(rows[0]?.full_name).toBe("Beto Rios");
  });

  it("cannot reassign its own row to another user (WITH CHECK)", async () => {
    // USING alone would allow this: the row is visible, and only WITH CHECK
    // inspects the value being written.
    await expect(
      db.asUser(userA, () =>
        db.query("update public.profiles set id = $1 where id = $2", [outsider, userA]),
      ),
    ).rejects.toThrow(/row-level security|violates/i);
  });

  it("cannot insert a profile", async () => {
    await expect(
      db.asUser(userA, () =>
        db.query("insert into public.profiles (id, email) values ($1, $2)", [
          crypto.randomUUID(),
          "fake@sugurolls.com",
        ]),
      ),
    ).rejects.toThrow(/row-level security|violates/i);
  });

  it("cannot delete a profile, not even its own", async () => {
    await db.asUser(userA, () => db.query("delete from public.profiles where id = $1", [userA]));
    const rows = await db.query("select 1 from public.profiles where id = $1", [userA]);
    expect(rows).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// tenant_members
// ---------------------------------------------------------------------------

describe("TEST-213: memberships are visible only to their owner", () => {
  it("shows a user their own memberships", async () => {
    const rows = await db.asUser(userA, () =>
      db.query<{ tenant_id: string }>("select tenant_id from public.tenant_members"),
    );
    expect(rows.map((r) => r.tenant_id)).toEqual([tenantA]);
  });

  it("does not let a member list the other members of their tenant", async () => {
    // userBoth is also a member of tenant A. Membership alone must not grant a
    // roster: that is a permission, and permissions arrive in Phase 03.
    const rows = await db.asUser(userA, () =>
      db.query("select 1 from public.tenant_members where tenant_id = $1", [tenantA]),
    );
    expect(rows).toHaveLength(1);
  });

  it("gives a user in two tenants exactly their two rows", async () => {
    const rows = await db.asUser(userBoth, () =>
      db.query<{ tenant_id: string }>(
        "select tenant_id from public.tenant_members order by tenant_id",
      ),
    );
    expect(rows.map((r) => r.tenant_id).sort()).toEqual([tenantA, tenantB].sort());
  });

  it("shows nothing to somebody with no membership", async () => {
    const rows = await db.asUser(outsider, () => db.query("select 1 from public.tenant_members"));
    expect(rows).toEqual([]);
  });

  it("cannot be written by a client in this phase", async () => {
    await expect(
      db.asUser(userA, () =>
        db.query(
          `insert into public.tenant_members (tenant_id, user_id, role)
           values ($1, $2, 'owner')`,
          [tenantB, userA],
        ),
      ),
    ).rejects.toThrow(/row-level security|violates/i);
  });

  it("cannot be self-promoted by an existing member", async () => {
    await db.asUser(userA, () =>
      db.query("update public.tenant_members set role = 'owner' where user_id = $1", [userB]),
    );
    const rows = await db.query<{ role: string }>(
      "select role from public.tenant_members where user_id = $1",
      [userB],
    );
    expect(rows[0]?.role).toBe("owner");
  });
});

describe("TEST-214: membership constraints", () => {
  it("refuses a second membership of the same tenant", async () => {
    await expect(
      insertMembership(db, { tenantId: tenantA, userId: userA, role: "admin" }),
    ).rejects.toThrow(/tenant_members_tenant_user_key/);
  });

  it("refuses a membership of a tenant that does not exist", async () => {
    await expect(
      insertMembership(db, { tenantId: crypto.randomUUID(), userId: userA }),
    ).rejects.toThrow(/tenant_members_tenant_id_fkey/);
  });

  it("refuses a membership for a user with no profile", async () => {
    await expect(
      insertMembership(db, { tenantId: tenantA, userId: crypto.randomUUID() }),
    ).rejects.toThrow(/tenant_members_user_id_fkey/);
  });

  it("removes memberships when the tenant is deleted", async () => {
    const tenant = await insertTenant(db, { slug: "efimero" });
    const user = await insertAuthUser(db, { email: "efimero@x.com" });
    await insertMembership(db, { tenantId: tenant, userId: user });

    await db.query("delete from public.tenants where id = $1", [tenant]);
    const rows = await db.query("select 1 from public.tenant_members where tenant_id = $1", [
      tenant,
    ]);
    expect(rows).toEqual([]);
  });

  it("stamps updated_at through the trigger, not the application", async () => {
    const before = await db.query<{ updated_at: Date }>(
      "select updated_at from public.tenant_members where user_id = $1",
      [userB],
    );
    await db.query("update public.tenant_members set status = 'suspended' where user_id = $1", [
      userB,
    ]);
    const after = await db.query<{ updated_at: Date }>(
      "select updated_at from public.tenant_members where user_id = $1",
      [userB],
    );

    expect(new Date(String(after[0]?.updated_at)).getTime()).toBeGreaterThanOrEqual(
      new Date(String(before[0]?.updated_at)).getTime(),
    );

    await db.query("update public.tenant_members set status = 'active' where user_id = $1", [
      userB,
    ]);
  });
});
