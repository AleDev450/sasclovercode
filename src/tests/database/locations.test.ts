import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, insertTenant, type TestDatabase } from "../helpers/database";

/**
 * Phase 10 at the database level.
 *
 * `locations` is the column that orders, tills, stock and invoices will all
 * carry from Phase 13 onwards. If the isolation here were loose, every one of
 * those tables would inherit the fault - so these tests spend most of their
 * time trying to attach something to another business's branch, and the rest
 * making sure a business cannot end up with no branch at all.
 */

let db: TestDatabase;

let tenantA: string;
let tenantB: string;
let suspended: string;

let ownerA: string;
let cashierA: string;
let ownerB: string;
let strangerId: string;

/** The location every tenant is born with. */
let defaultA: string;
let defaultB: string;

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

async function defaultLocationOf(tenantId: string): Promise<string> {
  const rows = await db.query<{ id: string }>(
    "select id from public.locations where tenant_id = $1 order by created_at limit 1",
    [tenantId],
  );
  return rows[0]!.id;
}

/** Inserts a location directly. Runs as the owner role, bypassing RLS. */
async function insertLocation(tenantId: string, name: string, isActive = true): Promise<string> {
  const rows = await db.query<{ id: string }>(
    "insert into public.locations (tenant_id, name, is_active) values ($1, $2, $3) returning id",
    [tenantId, name, isActive],
  );
  return rows[0]!.id;
}

async function insertHour(
  locationId: string,
  day: number,
  opens: string,
  closes: string,
): Promise<string> {
  const rows = await db.query<{ id: string }>(
    `insert into public.location_hours (location_id, tenant_id, day_of_week, opens_at, closes_at)
     values ($1, '00000000-0000-0000-0000-000000000000', $2, $3, $4)
     returning id`,
    [locationId, day, opens, closes],
  );
  return rows[0]!.id;
}

beforeAll(async () => {
  db = await createTestDatabase();

  tenantA = await insertTenant(db, { slug: "sugurolls", name: "Sugu Rolls" });
  tenantB = await insertTenant(db, { slug: "polleria-el-rey", name: "Pollería El Rey" });
  suspended = await insertTenant(db, { slug: "en-pausa", name: "En Pausa", status: "suspended" });

  ownerA = await createUser("owner@sugurolls.com");
  cashierA = await createUser("cashier@sugurolls.com");
  ownerB = await createUser("owner@polleria.pe");
  strangerId = await createUser("nadie@example.com");

  await addMember(tenantA, ownerA, "owner");
  await addMember(tenantA, cashierA, "cashier");
  await addMember(tenantB, ownerB, "owner");

  defaultA = await defaultLocationOf(tenantA);
  defaultB = await defaultLocationOf(tenantB);
});

afterAll(async () => {
  await db.close();
});

describe("catalogue and schema (TEST-1001 to TEST-1010)", () => {
  it("gives every role locations.view (TEST-1001)", async () => {
    const roles = await db.query<{ c: string }>(
      `select count(*)::text c from public.role_permissions where permission = 'locations.view'`,
    );
    const total = await db.query<{ c: string }>("select count(*)::text c from public.roles");
    // Every operational role works AT a branch, so every one of them can read
    // the list. From Phase 13 a cashier who cannot see branches cannot be told
    // which one they are working in.
    expect(roles[0]?.c).toBe(total[0]?.c);
  });

  it("restricts locations.manage to owner and admin (TEST-1002)", async () => {
    const rows = await db.query<{ role: string }>(
      `select role from public.role_permissions
       where permission = 'locations.manage' order by role`,
    );
    expect(rows.map((r) => r.role)).toEqual(["owner", "admin"]);
  });

  it("makes the name unique per tenant, ignoring case (TEST-1003)", async () => {
    await insertLocation(tenantA, "Miraflores");
    await expect(insertLocation(tenantA, "  MIRAFLORES  ")).rejects.toThrow(
      /locations_tenant_name_key/,
    );
  });

  it("lets two tenants use the same branch name (TEST-1004)", async () => {
    await expect(insertLocation(tenantB, "Miraflores")).resolves.toBeDefined();
  });

  it("rejects one coordinate without the other (TEST-1005)", async () => {
    await expect(
      db.query(
        "insert into public.locations (tenant_id, name, latitude) values ($1, 'Media coord', -12.1)",
        [tenantA],
      ),
    ).rejects.toThrow(/locations_coordinates_together/);
  });

  it("rejects a latitude outside the planet (TEST-1006)", async () => {
    await expect(
      db.query(
        `insert into public.locations (tenant_id, name, latitude, longitude)
         values ($1, 'Polo imposible', 91, 0)`,
        [tenantA],
      ),
    ).rejects.toThrow(/locations_latitude_range/);
  });

  it("rejects a longitude outside the planet (TEST-1007)", async () => {
    await expect(
      db.query(
        `insert into public.locations (tenant_id, name, latitude, longitude)
         values ($1, 'Meridiano imposible', 0, 181)`,
        [tenantA],
      ),
    ).rejects.toThrow(/locations_longitude_range/);
  });

  it("accepts real Lima coordinates", async () => {
    await expect(
      db.query(
        `insert into public.locations (tenant_id, name, latitude, longitude)
         values ($1, 'Con mapa', -12.121500, -77.029700)`,
        [tenantA],
      ),
    ).resolves.toBeDefined();
  });

  it("rejects a weekday outside 0..6 (TEST-1008)", async () => {
    await expect(insertHour(defaultA, 7, "09:00", "18:00")).rejects.toThrow(
      /location_hours_day_range/,
    );
  });

  it("rejects a shift that closes before it opens (TEST-1009)", async () => {
    await expect(insertHour(defaultA, 3, "18:00", "09:00")).rejects.toThrow(/location_hours_order/);
  });

  it("rejects a zero-length shift", async () => {
    await expect(insertHour(defaultA, 3, "09:00", "09:00")).rejects.toThrow(/location_hours_order/);
  });

  it("accepts 24:00 as a closing time (TEST-1010)", async () => {
    // "Open until midnight" without pretending it closes at 23:59.
    await expect(insertHour(defaultA, 5, "18:00", "24:00")).resolves.toBeDefined();
  });
});

describe("invariants (TEST-1011 to TEST-1016)", () => {
  it("gives a brand new tenant exactly one location (TEST-1011)", async () => {
    const fresh = await insertTenant(db, { slug: "recien-abierta", name: "Recien Abierta" });
    const rows = await db.query<{ name: string; is_active: boolean }>(
      "select name, is_active from public.locations where tenant_id = $1",
      [fresh],
    );
    expect(rows).toHaveLength(1);
    // Named after the business (TEST-1012): a one-branch business should never
    // have to think about branches, and its own name reads as a fact rather
    // than as a setting somebody has to fill in.
    expect(rows[0]?.name).toBe("Recien Abierta");
    expect(rows[0]?.is_active).toBe(true);
  });

  it("removes locations and hours with the tenant (TEST-1013)", async () => {
    const doomed = await insertTenant(db, { slug: "efimera", name: "Efimera" });
    const location = await defaultLocationOf(doomed);
    await insertHour(location, 1, "09:00", "13:00");

    await db.query("delete from public.tenants where id = $1", [doomed]);

    const locations = await db.query("select id from public.locations where tenant_id = $1", [
      doomed,
    ]);
    const hours = await db.query("select id from public.location_hours where tenant_id = $1", [
      doomed,
    ]);
    expect(locations).toEqual([]);
    expect(hours).toEqual([]);
  });

  /*
   * TEST-1014 - the invariant that later phases depend on.
   *
   * From Phase 13 an order needs a branch to happen at, so a tenant with zero
   * active locations is a tenant that cannot take an order - and the error
   * would surface three modules away from the setting that caused it, as
   * "cannot create order" rather than "you closed your only branch".
   */
  it("refuses to deactivate the last active location (TEST-1014)", async () => {
    const tenant = await insertTenant(db, { slug: "una-sola", name: "Una Sola" });
    const only = await defaultLocationOf(tenant);

    await expect(
      db.query("update public.locations set is_active = false where id = $1", [only]),
    ).rejects.toThrow(/at least one active location/);
  });

  it("allows deactivating one when another stays active (TEST-1015)", async () => {
    const tenant = await insertTenant(db, { slug: "dos-sedes", name: "Dos Sedes" });
    const first = await defaultLocationOf(tenant);
    await insertLocation(tenant, "Segunda");

    await expect(
      db.query("update public.locations set is_active = false where id = $1", [first]),
    ).resolves.toBeDefined();
  });

  it("allows reactivating (TEST-1016)", async () => {
    const tenant = await insertTenant(db, { slug: "reactivar", name: "Reactivar" });
    const first = await defaultLocationOf(tenant);
    await insertLocation(tenant, "Segunda");
    await db.query("update public.locations set is_active = false where id = $1", [first]);

    await expect(
      db.query("update public.locations set is_active = true where id = $1", [first]),
    ).resolves.toBeDefined();
  });

  it("does not fire the guard when nothing changes", async () => {
    const tenant = await insertTenant(db, { slug: "sin-cambio", name: "Sin Cambio" });
    const only = await defaultLocationOf(tenant);
    // Updating an unrelated column on the last active location must not be
    // mistaken for deactivating it.
    await expect(
      db.query("update public.locations set phone = '999888777' where id = $1", [only]),
    ).resolves.toBeDefined();
  });
});

describe("opening hours (TEST-1017 to TEST-1023)", () => {
  let location: string;

  beforeAll(async () => {
    const tenant = await insertTenant(db, { slug: "horarios", name: "Horarios" });
    location = await defaultLocationOf(tenant);
  });

  it("accepts a split shift on one day (TEST-1017)", async () => {
    await insertHour(location, 1, "12:00", "15:00");
    await expect(insertHour(location, 1, "19:00", "23:00")).resolves.toBeDefined();
  });

  it("refuses an overlapping shift (TEST-1018)", async () => {
    await expect(insertHour(location, 1, "14:00", "20:00")).rejects.toThrow(/overlaps/);
  });

  it("refuses a shift fully inside another", async () => {
    await expect(insertHour(location, 1, "13:00", "14:00")).rejects.toThrow(/overlaps/);
  });

  it("refuses a shift that swallows another", async () => {
    await expect(insertHour(location, 1, "11:00", "16:00")).rejects.toThrow(/overlaps/);
  });

  /*
   * TEST-1019. Touching is not overlapping. A business that resumes exactly
   * when the previous shift ended should not have to invent a one-minute gap.
   */
  it("accepts shifts that touch at the boundary (TEST-1019)", async () => {
    await insertHour(location, 2, "10:00", "12:00");
    await expect(insertHour(location, 2, "12:00", "14:00")).resolves.toBeDefined();
  });

  it("does not compare shifts across days (TEST-1020)", async () => {
    await expect(insertHour(location, 4, "12:00", "15:00")).resolves.toBeDefined();
  });

  it("does not let a shift collide with itself when edited (TEST-1021)", async () => {
    const id = await insertHour(location, 6, "09:00", "13:00");
    await expect(
      db.query("update public.location_hours set closes_at = '14:00' where id = $1", [id]),
    ).resolves.toBeDefined();
  });

  it("derives tenant_id from the location (TEST-1022)", async () => {
    const rows = await db.query<{ tenant_id: string; location_tenant: string }>(
      `select h.tenant_id, l.tenant_id as location_tenant
       from public.location_hours as h
       join public.locations as l on l.id = h.location_id
       where h.location_id = $1 limit 1`,
      [location],
    );
    expect(rows[0]?.tenant_id).toBe(rows[0]?.location_tenant);
  });

  /*
   * TEST-1023 - the attack of SPEC AB-1002.
   *
   * A caller supplies another business's `location_id` together with their OWN
   * tenant_id. The insert policy checks the permission against the tenant_id in
   * the row - which they do hold - and without the trigger the shift would land
   * attached to somebody else's branch. Deriving the value makes the two
   * impossible to disagree.
   */
  it("overwrites a tenant_id sent by hand (TEST-1023)", async () => {
    const id = await db.query<{ id: string }>(
      `insert into public.location_hours (location_id, tenant_id, day_of_week, opens_at, closes_at)
       values ($1, $2, 0, '08:00', '10:00')
       returning id`,
      [defaultB, tenantA],
    );

    const rows = await db.query<{ tenant_id: string }>(
      "select tenant_id from public.location_hours where id = $1",
      [id[0]!.id],
    );
    // Sent tenantA, stored tenantB, because the branch belongs to B.
    expect(rows[0]?.tenant_id).toBe(tenantB);
    expect(rows[0]?.tenant_id).not.toBe(tenantA);
  });

  it("refuses a shift on a location that does not exist", async () => {
    await expect(
      db.query(
        `insert into public.location_hours (location_id, tenant_id, day_of_week, opens_at, closes_at)
         values ('00000000-0000-0000-0000-000000000000', $1, 0, '08:00', '10:00')`,
        [tenantA],
      ),
    ).rejects.toThrow(/Location not found/);
  });
});

describe("RLS (TEST-1024 to TEST-1034)", () => {
  let inactiveA: string;

  beforeAll(async () => {
    inactiveA = await insertLocation(tenantA, "Cerrada temporalmente", false);
    await insertHour(defaultA, 1, "09:00", "18:00");
    await insertHour(inactiveA, 1, "09:00", "18:00");

    // A suspended business with a branch of its own.
    const suspendedLocation = await defaultLocationOf(suspended);
    await insertHour(suspendedLocation, 1, "09:00", "18:00");
  });

  it("lets a member with locations.view read their own branches (TEST-1024)", async () => {
    const rows = await db.asUser(cashierA, () =>
      db.query("select id from public.locations where tenant_id = $1", [tenantA]),
    );
    expect(rows.length).toBeGreaterThan(0);
  });

  /*
   * TEST-1025, stated precisely rather than sweepingly.
   *
   * "A member of A sees nothing of B" is NOT the invariant here, and writing it
   * that way would have been wrong in an interesting direction: B's active
   * branches are published on B's own website, so a member of A can already
   * read the name, address and phone by loading that site. The public policy
   * grants `authenticated` deliberately (the A7-1 lesson), so it matches them.
   *
   * What must stay private is the part that is NOT on the website: a branch B
   * has closed. That is a business fact about B - it may be a failing shop, a
   * lease that fell through, a move nobody has announced - and it belongs to
   * B alone.
   */
  it("hides another tenant's INACTIVE branches from a member (TEST-1025)", async () => {
    const closed = await insertLocation(tenantB, "Cerrada de B", false);

    const rows = await db.asUser(cashierA, () =>
      db.query("select id from public.locations where id = $1", [closed]),
    );
    expect(rows).toEqual([]);

    // And the owner of B still sees it, because they have to be able to edit it.
    const ownerRows = await db.asUser(ownerB, () =>
      db.query("select id from public.locations where id = $1", [closed]),
    );
    expect(ownerRows).toHaveLength(1);
  });

  it("refuses a write without locations.manage (TEST-1026)", async () => {
    await db.asUser(cashierA, () =>
      db.query("update public.locations set name = 'Renombrada' where id = $1", [defaultA]),
    );
    const rows = await db.query<{ name: string }>(
      "select name from public.locations where id = $1",
      [defaultA],
    );
    expect(rows[0]?.name).not.toBe("Renombrada");
  });

  it("refuses creating a branch in another tenant (TEST-1027)", async () => {
    await expect(
      db.asUser(ownerA, () =>
        db.query("insert into public.locations (tenant_id, name) values ($1, 'Infiltrada')", [
          tenantB,
        ]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("lets an owner create a branch in their own tenant", async () => {
    await expect(
      db.asUser(ownerA, () =>
        db.query("insert into public.locations (tenant_id, name) values ($1, 'San Isidro')", [
          tenantA,
        ]),
      ),
    ).resolves.toBeDefined();
  });

  /*
   * TEST-1028. From Phase 13 orders, tills, stock movements and invoices all
   * reference a location. Deleting one would either cascade that history away
   * or leave it dangling, and neither is acceptable for records a business is
   * legally required to keep.
   */
  it("has no DELETE policy on locations (TEST-1028)", async () => {
    const rows = await db.query<{ policyname: string }>(
      `select policyname from pg_policies
       where schemaname = 'public' and tablename = 'locations' and cmd = 'DELETE'`,
    );
    expect(rows).toEqual([]);
  });

  it("silently refuses a delete from an owner", async () => {
    await db.asUser(ownerA, () =>
      db.query("delete from public.locations where id = $1", [defaultA]),
    );
    const rows = await db.query("select id from public.locations where id = $1", [defaultA]);
    expect(rows).toHaveLength(1);
  });

  it("shows an anonymous visitor the active branches of an active tenant (TEST-1029)", async () => {
    const rows = await db.asRole("anon", () =>
      db.query<{ id: string }>("select id from public.locations where tenant_id = $1", [tenantA]),
    );
    expect(rows.length).toBeGreaterThan(0);
  });

  /*
   * TEST-1030 - the lesson of A7-1, applied before it can happen again.
   *
   * A visitor signed in to their OWN business is `authenticated`, not `anon`.
   * A policy naming only `anon` would make the branch list vanish for anyone
   * with a session - invisible in a private window, which is the worst way for
   * a bug to present.
   */
  it("shows them to a SIGNED-IN stranger too (TEST-1030)", async () => {
    const rows = await db.asUser(strangerId, () =>
      db.query<{ id: string }>("select id from public.locations where tenant_id = $1", [tenantA]),
    );
    expect(rows.length).toBeGreaterThan(0);
  });

  it("hides an inactive branch from the outside (TEST-1031)", async () => {
    for (const read of [
      () =>
        db.asRole("anon", () =>
          db.query("select id from public.locations where id = $1", [inactiveA]),
        ),
      () =>
        db.asUser(strangerId, () =>
          db.query("select id from public.locations where id = $1", [inactiveA]),
        ),
    ]) {
      expect(await read()).toEqual([]);
    }
  });

  it("hides the branches of a suspended business (TEST-1032)", async () => {
    const rows = await db.asRole("anon", () =>
      db.query("select id from public.locations where tenant_id = $1", [suspended]),
    );
    expect(rows).toEqual([]);
  });

  it("applies the same rules to opening hours (TEST-1033)", async () => {
    const visible = await db.asRole("anon", () =>
      db.query("select id from public.location_hours where location_id = $1", [defaultA]),
    );
    const hidden = await db.asRole("anon", () =>
      db.query("select id from public.location_hours where location_id = $1", [inactiveA]),
    );
    const suspendedHours = await db.asRole("anon", () =>
      db.query("select id from public.location_hours where tenant_id = $1", [suspended]),
    );

    expect(visible.length).toBeGreaterThan(0);
    expect(hidden).toEqual([]);
    expect(suspendedHours).toEqual([]);
  });

  it("still shows a member their own inactive branch (TEST-1034)", async () => {
    const rows = await db.asUser(ownerA, () =>
      db.query("select id from public.locations where id = $1", [inactiveA]),
    );
    // The person editing an inactive branch has to be able to see it.
    expect(rows).toHaveLength(1);
  });

  it("shows a member of another tenant only what the public sees", async () => {
    const rows = await db.asUser(ownerB, () =>
      db.query<{ is_active: boolean }>(
        "select is_active from public.locations where tenant_id = $1",
        [tenantA],
      ),
    );
    expect(rows.every((row) => row.is_active)).toBe(true);
  });
});
