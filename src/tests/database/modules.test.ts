import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ALL_MODULES } from "@/lib/features";
import { createTestDatabase, insertTenant, type TestDatabase } from "../helpers/database";

/**
 * Phase 21 at the database level.
 *
 * Three invariants matter more than the rest, all from ADR-025:
 *
 * - `has_module()` is FAIL-CLOSED. There is no branch that grants a module
 *   because data is missing; a tenant with no subscription has nothing.
 * - The override beats the plan in BOTH directions, and the resolution order
 *   is override → plan → false.
 * - A tenant may READ what it has contracted and may never WRITE it. That
 *   asymmetry is what makes the paywall a paywall.
 */

let db: TestDatabase;

let tenantA: string;
let tenantB: string;

let ownerA: string;
let ownerB: string;
let admin: string;

async function createUser(email: string): Promise<string> {
  const rows = await db.query<{ id: string }>(
    "insert into auth.users (email) values ($1) returning id",
    [email],
  );
  return rows[0]!.id;
}

async function addMember(tenantId: string, userId: string, role: string): Promise<void> {
  await db.query(
    `insert into public.tenant_members (tenant_id, user_id, role)
     values ($1, $2, $3::public.tenant_role)`,
    [tenantId, userId, role],
  );
}

async function hasModule(tenantId: string, module: string): Promise<boolean> {
  const rows = await db.query<{ ok: boolean }>("select public.has_module($1, $2) as ok", [
    tenantId,
    module,
  ]);
  return rows[0]!.ok;
}

async function myModules(tenantId: string): Promise<string[]> {
  const rows = await db.query<{ module: string }>("select module from public.my_modules($1)", [
    tenantId,
  ]);
  return rows.map((r) => r.module);
}

async function setStatus(tenantId: string, status: string): Promise<void> {
  await db.query(
    `update public.subscriptions
     set status = $2::public.subscription_status,
         cancelled_at = case when $2 = 'cancelled' then now() else null end
     where tenant_id = $1`,
    [tenantId, status],
  );
}

async function setPlan(tenantId: string, planCode: string): Promise<void> {
  await db.query("update public.subscriptions set plan_code = $2 where tenant_id = $1", [
    tenantId,
    planCode,
  ]);
}

beforeAll(async () => {
  db = await createTestDatabase();

  tenantA = await insertTenant(db, { name: "Sugu Rolls", slug: "sugurolls" });
  tenantB = await insertTenant(db, { name: "Pollos Rey", slug: "pollosrey" });

  ownerA = await createUser("owner-a@test.pe");
  ownerB = await createUser("owner-b@test.pe");
  admin = await createUser("admin@clovercode.pe");

  await addMember(tenantA, ownerA, "owner");
  await addMember(tenantB, ownerB, "owner");

  await db.query("insert into public.platform_admins (user_id) values ($1)", [admin]);
});

afterAll(async () => {
  await db.close();
});

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

describe("catalogue (TEST-2110, TEST-2111, TEST-2112)", () => {
  it("has row level security on every table of this phase", async () => {
    const rows = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `select relname, relrowsecurity from pg_class
       where relname in ('modules','plans','plan_modules','subscriptions','tenant_modules')`,
    );
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => r.relrowsecurity)).toBe(true);
  });

  it("keeps the catalogue read-only (TEST-2111)", async () => {
    const rows = await db.query<{ cmd: string }>(
      `select distinct cmd from pg_policies
       where schemaname = 'public' and tablename in ('modules','plans','plan_modules')`,
    );
    expect(rows.map((r) => r.cmd)).toEqual(["SELECT"]);
  });

  it("declares exactly the ten modules of master section 33 (TEST-2112)", async () => {
    const rows = await db.query<{ code: string }>(
      "select code from public.modules order by position",
    );
    expect(rows.map((r) => r.code)).toEqual([...ALL_MODULES]);
  });

  it("has exactly one default plan (TEST-2113)", async () => {
    const rows = await db.query<{ code: string }>("select code from public.plans where is_default");
    expect(rows).toHaveLength(1);
  });

  it("refuses a second default plan (TEST-2113)", async () => {
    await expect(
      db.query("update public.plans set is_default = true where code = 'starter'"),
    ).rejects.toThrow();
  });

  it("gives the default plan every module, so nothing was taken away", async () => {
    const rows = await db.query<{ module_code: string }>(
      `select pm.module_code from public.plan_modules as pm
       join public.plans as p on p.code = pm.plan_code
       where p.is_default order by pm.module_code`,
    );
    expect(rows.map((r) => r.module_code).sort()).toEqual([...ALL_MODULES].sort());
  });

  it("refuses to delete a plan somebody has contracted (TEST-2131)", async () => {
    const rows = await db.query<{ plan_code: string }>(
      "select plan_code from public.subscriptions where tenant_id = $1",
      [tenantA],
    );
    await expect(
      db.query("delete from public.plans where code = $1", [rows[0]!.plan_code]),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Provisioning
// ---------------------------------------------------------------------------

describe("provisioning (TEST-2114)", () => {
  it("gives every new tenant a subscription to the default plan", async () => {
    const fresh = await insertTenant(db, { name: "Nuevo", slug: "nuevo" });
    const rows = await db.query<{
      plan_code: string;
      status: string;
      trial_ends_at: string | null;
    }>("select plan_code, status, trial_ends_at from public.subscriptions where tenant_id = $1", [
      fresh,
    ]);
    expect(rows).toHaveLength(1);

    // Phase 22 changed this deliberately: every shipped plan carries 14 trial
    // days, so a new business lands in `trialing` rather than `active`. Access
    // is identical - `trialing` already granted every module (ADR-025 decision
    // 3) - but the row now says the truth about what it is paying, which is
    // nothing yet.
    expect(rows[0]!.status).toBe("trialing");
    expect(rows[0]!.trial_ends_at).not.toBeNull();

    const defaults = await db.query<{ code: string }>(
      "select code from public.plans where is_default",
    );
    expect(rows[0]!.plan_code).toBe(defaults[0]!.code);
  });

  it("still grants every module while on trial", async () => {
    // The behaviour change above must not cost a new tenant anything.
    const fresh = await insertTenant(db, { name: "En prueba", slug: "en-prueba" });
    expect(await myModules(fresh)).toEqual([...ALL_MODULES]);
  });

  it("refuses a second subscription for one tenant (TEST-2132)", async () => {
    await expect(
      db.query("insert into public.subscriptions (tenant_id, plan_code) values ($1, 'starter')", [
        tenantA,
      ]),
    ).rejects.toThrow();
  });

  it("left every tenant that existed before this phase with full access", async () => {
    // The backfill runs in the same migration that creates the table, so there
    // is no instant in which a tenant exists without a subscription.
    const rows = await db.query<{ count: string }>(
      `select count(*) as count from public.tenants as t
       where not exists (
         select 1 from public.subscriptions as s where s.tenant_id = t.id
       )`,
    );
    expect(Number(rows[0]!.count)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

describe("has_module (TEST-2115 to TEST-2123)", () => {
  it("grants a module the plan includes (TEST-2115)", async () => {
    await setPlan(tenantA, "starter");
    expect(await hasModule(tenantA, "catalog")).toBe(true);
  });

  it("refuses a module the plan does not include (TEST-2116)", async () => {
    await setPlan(tenantA, "starter");
    expect(await hasModule(tenantA, "inventory")).toBe(false);
    expect(await hasModule(tenantA, "pos")).toBe(false);
  });

  it("lets an override grant what the plan does not (TEST-2117)", async () => {
    await setPlan(tenantA, "starter");
    await db.query(
      `insert into public.tenant_modules (tenant_id, module_code, is_enabled)
       values ($1, 'inventory', true)`,
      [tenantA],
    );
    expect(await hasModule(tenantA, "inventory")).toBe(true);
  });

  it("lets an override take away what the plan does give (TEST-2118)", async () => {
    // The direction that makes the table worth having: without it, every
    // downward exception would need a plan of its own.
    await setPlan(tenantA, "starter");
    await db.query(
      `insert into public.tenant_modules (tenant_id, module_code, is_enabled)
       values ($1, 'catalog', false)`,
      [tenantA],
    );
    expect(await hasModule(tenantA, "catalog")).toBe(false);
  });

  it("returns to the plan when the override is removed", async () => {
    await db.query(
      "delete from public.tenant_modules where tenant_id = $1 and module_code = 'catalog'",
      [tenantA],
    );
    expect(await hasModule(tenantA, "catalog")).toBe(true);
  });

  it("turns everything off when the subscription is suspended (TEST-2119)", async () => {
    await setPlan(tenantB, "enterprise");
    expect(await hasModule(tenantB, "orders")).toBe(true);

    await setStatus(tenantB, "suspended");
    expect(await hasModule(tenantB, "orders")).toBe(false);
    expect(await myModules(tenantB)).toEqual([]);
  });

  it("turns everything off when the subscription is cancelled (TEST-2120)", async () => {
    await setStatus(tenantB, "cancelled");
    expect(await hasModule(tenantB, "orders")).toBe(false);
  });

  it("keeps access during a trial and while payment is late (TEST-2121)", async () => {
    for (const status of ["trialing", "past_due", "active"]) {
      await setStatus(tenantB, status);
      expect(await hasModule(tenantB, "orders"), `${status} should grant`).toBe(true);
    }
  });

  it("still honours an override while suspended", async () => {
    // The override is checked FIRST, so a suspended tenant with a forced-on
    // module keeps it. That is the documented precedence, and worth pinning:
    // it is how a support exception survives a billing state.
    await setStatus(tenantB, "suspended");
    await db.query(
      `insert into public.tenant_modules (tenant_id, module_code, is_enabled)
       values ($1, 'website', true)`,
      [tenantB],
    );
    expect(await hasModule(tenantB, "website")).toBe(true);
    expect(await hasModule(tenantB, "orders")).toBe(false);

    await db.query("delete from public.tenant_modules where tenant_id = $1", [tenantB]);
    await setStatus(tenantB, "active");
  });

  it("gives a tenant with no subscription nothing at all (TEST-2122)", async () => {
    const orphan = await insertTenant(db, { name: "Huerfano", slug: "huerfano" });
    await db.query("delete from public.subscriptions where tenant_id = $1", [orphan]);

    for (const code of ALL_MODULES) {
      expect(await hasModule(orphan, code), `${code} must be closed`).toBe(false);
    }
    expect(await myModules(orphan)).toEqual([]);
  });

  it("agrees with has_module row for row (TEST-2123)", async () => {
    await setPlan(tenantA, "professional");
    const listed = await myModules(tenantA);

    for (const code of ALL_MODULES) {
      const single = await hasModule(tenantA, code);
      expect(listed.includes(code), `${code}: my_modules and has_module disagree`).toBe(single);
    }
  });

  it("returns modules in catalogue order", async () => {
    await setPlan(tenantA, "enterprise");
    await db.query("delete from public.tenant_modules where tenant_id = $1", [tenantA]);
    expect(await myModules(tenantA)).toEqual([...ALL_MODULES]);
  });
});

// ---------------------------------------------------------------------------
// Who may write
// ---------------------------------------------------------------------------

describe("write access (TEST-2124 to TEST-2127)", () => {
  it("does not let a tenant change its own subscription (TEST-2124)", async () => {
    const rows = await db.asUser(ownerA, () =>
      db.query(
        "update public.subscriptions set plan_code = 'enterprise' where tenant_id = $1 returning tenant_id",
        [tenantA],
      ),
    );
    expect(rows).toEqual([]);
  });

  it("does not let a tenant give itself a module (TEST-2125)", async () => {
    await expect(
      db.asUser(ownerA, () =>
        db.query(
          `insert into public.tenant_modules (tenant_id, module_code, is_enabled)
           values ($1, 'billing', true)`,
          [tenantA],
        ),
      ),
    ).rejects.toThrow();
  });

  it("lets a tenant READ its own subscription", async () => {
    const rows = await db.asUser(ownerA, () =>
      db.query("select plan_code from public.subscriptions where tenant_id = $1", [tenantA]),
    );
    expect(rows).toHaveLength(1);
  });

  it("does not let a tenant read another's subscription (TEST-2126)", async () => {
    const rows = await db.asUser(ownerB, () =>
      db.query("select plan_code from public.subscriptions where tenant_id = $1", [tenantA]),
    );
    expect(rows).toEqual([]);
  });

  it("lets a platform admin write both (TEST-2127)", async () => {
    const updated = await db.asUser(admin, () =>
      db.query(
        "update public.subscriptions set plan_code = 'professional' where tenant_id = $1 returning tenant_id",
        [tenantA],
      ),
    );
    expect(updated).toHaveLength(1);

    const inserted = await db.asUser(admin, () =>
      db.query(
        `insert into public.tenant_modules (tenant_id, module_code, is_enabled)
         values ($1, 'billing', true) returning module_code`,
        [tenantA],
      ),
    );
    expect(inserted).toHaveLength(1);

    await db.asUser(admin, () =>
      db.query("delete from public.tenant_modules where tenant_id = $1", [tenantA]),
    );
    await setPlan(tenantA, "enterprise");
  });

  it("gives an unauthenticated caller nothing", async () => {
    const rows = await db.asUser(null, () =>
      db.query("select tenant_id from public.subscriptions"),
    );
    expect(rows).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// multi_location
// ---------------------------------------------------------------------------

describe("multi_location (TEST-2128, TEST-2129, TEST-2130)", () => {
  async function locationCount(tenantId: string): Promise<number> {
    const rows = await db.query<{ count: string }>(
      "select count(*) as count from public.locations where tenant_id = $1 and is_active",
      [tenantId],
    );
    return Number(rows[0]!.count);
  }

  it("refuses a second active location without the module (TEST-2128)", async () => {
    const tenant = await insertTenant(db, { name: "Una sede", slug: "una-sede" });
    await setPlan(tenant, "starter");

    // Provisioning already made the first one.
    expect(await locationCount(tenant)).toBe(1);

    await expect(
      db.query("insert into public.locations (tenant_id, name) values ($1, 'Segunda')", [tenant]),
    ).rejects.toThrow(/more than one active location/);
  });

  it("allows the second one with the module (TEST-2129)", async () => {
    const tenant = await insertTenant(db, { name: "Dos sedes", slug: "dos-sedes" });
    await setPlan(tenant, "enterprise");

    await expect(
      db.query("insert into public.locations (tenant_id, name) values ($1, 'Segunda')", [tenant]),
    ).resolves.toBeDefined();
    expect(await locationCount(tenant)).toBe(2);
  });

  it("frees the slot when a location is deactivated (TEST-2130)", async () => {
    // Two guards meet here, and the interaction is worth pinning down.
    //
    // Phase 10 requires at LEAST one active location; multi_location caps a
    // `starter` tenant at ONE. So a single-shop business on starter cannot add
    // a second and cannot close its only one - it moves by editing the address
    // of the location it has, which is the right operation anyway (KL-2107).
    //
    // The slot genuinely frees only for a business that has more than one,
    // which is the grandfathered case below.
    const tenant = await insertTenant(db, { name: "Rota sedes", slug: "rota-sedes" });
    await setPlan(tenant, "enterprise");
    await db.query("insert into public.locations (tenant_id, name) values ($1, 'Segunda')", [
      tenant,
    ]);
    expect(await locationCount(tenant)).toBe(2);

    // Downgraded: the two it has survive (KL-2104), a third is refused.
    await setPlan(tenant, "starter");
    await expect(
      db.query("insert into public.locations (tenant_id, name) values ($1, 'Tercera')", [tenant]),
    ).rejects.toThrow(/more than one active location/);

    // Closing one is allowed - there is still another active - and it does NOT
    // free a slot on starter, because one active is already the cap.
    await db.query(
      "update public.locations set is_active = false where tenant_id = $1 and name = 'Segunda'",
      [tenant],
    );
    expect(await locationCount(tenant)).toBe(1);

    await expect(
      db.query("insert into public.locations (tenant_id, name) values ($1, 'Tercera')", [tenant]),
    ).rejects.toThrow(/more than one active location/);

    // With the module back, the closed one can reopen.
    await setPlan(tenant, "enterprise");
    await expect(
      db.query(
        "update public.locations set is_active = true where tenant_id = $1 and name = 'Segunda'",
        [tenant],
      ),
    ).resolves.toBeDefined();
    expect(await locationCount(tenant)).toBe(2);
  });

  it("cannot leave a starter tenant with no location at all", async () => {
    // Phase 10's invariant still holds underneath: whatever the plan says, a
    // business always has somewhere to operate from.
    const tenant = await insertTenant(db, { name: "Sola", slug: "sola" });
    await setPlan(tenant, "starter");

    await expect(
      db.query("update public.locations set is_active = false where tenant_id = $1", [tenant]),
    ).rejects.toThrow(/at least one active location/);
  });

  it("never blocks an INACTIVE location, however many there are", async () => {
    const tenant = await insertTenant(db, { name: "Inactivas", slug: "inactivas" });
    await setPlan(tenant, "starter");

    for (const name of ["Cerrada uno", "Cerrada dos"]) {
      await expect(
        db.query(
          "insert into public.locations (tenant_id, name, is_active) values ($1, $2, false)",
          [tenant, name],
        ),
      ).resolves.toBeDefined();
    }
  });

  it("does not deactivate existing locations when the module is removed (KL-2104)", async () => {
    const tenant = await insertTenant(db, { name: "Conserva", slug: "conserva" });
    await setPlan(tenant, "enterprise");
    await db.query("insert into public.locations (tenant_id, name) values ($1, 'Segunda')", [
      tenant,
    ]);

    await setPlan(tenant, "starter");

    // Documented behaviour, not an oversight: destroying configuration over a
    // commercial change is worse, and which one survives is not a decision a
    // trigger can take.
    expect(await locationCount(tenant)).toBe(2);
  });
});
