import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, insertTenant, type TestDatabase } from "../helpers/database";

/**
 * TEST-2713 to TEST-2717 — retention for the audit trail.
 *
 * `audit_logs` only ever grows: every governed write appends a row and nothing
 * updates or deletes one. Correct for an audit trail, and a problem for
 * recovery — a table nobody can back up in a reasonable window is a table that
 * has stopped being recoverable, which is why the policy belongs to Phase 27
 * rather than to housekeeping.
 *
 * The interesting assertions are not that it deletes. They are the two things
 * it refuses to do.
 */

let db: TestDatabase;
let tenantId: string;
let userId: string;

beforeAll(async () => {
  db = await createTestDatabase();
  tenantId = await insertTenant(db, { slug: "auditada", name: "Auditada" });

  const rows = await db.query<{ id: string }>(
    "insert into auth.users (email) values ('operador@example.com') returning id",
  );
  userId = rows[0]!.id;
  await db.query(
    "insert into public.tenant_members (tenant_id, user_id, role) values ($1, $2, 'owner')",
    [tenantId, userId],
  );
}, 120_000);

afterAll(async () => {
  await db.close();
});

/** Writes an audit row dated `days` in the past. */
async function insertEntry(days: number): Promise<void> {
  await db.query(
    // `new_values` is not decoration: a CHECK refuses a row that records no
    // change, because a row saying nothing changed says nothing.
    `insert into public.audit_logs
       (tenant_id, action, entity_type, entity_id, new_values, created_at)
     values ($1, 'test.update', 'test', gen_random_uuid(), '{"n": 1}'::jsonb,
             now() - ($2 || ' days')::interval)`,
    [tenantId, String(days)],
  );
}

async function countEntries(): Promise<number> {
  const rows = await db.query<{ n: string }>("select count(*)::text n from public.audit_logs");
  return Number(rows[0]?.n);
}

describe("purge_audit_logs (TEST-2713 to TEST-2717)", () => {
  it("deletes what is older than the interval and returns how many (TEST-2713, TEST-2716)", async () => {
    await insertEntry(500);
    await insertEntry(400);
    await insertEntry(10);

    const before = await countEntries();
    const rows = await db.query<{ purge_audit_logs: string }>(
      "select public.purge_audit_logs(interval '365 days')",
    );

    expect(Number(rows[0]?.purge_audit_logs)).toBe(2);
    expect(await countEntries()).toBe(before - 2);
  });

  it("leaves recent entries alone (TEST-2714)", async () => {
    await insertEntry(5);
    const before = await countEntries();
    await db.query("select public.purge_audit_logs(interval '365 days')");
    expect(await countEntries()).toBe(before);
  });

  it("returns zero when there is nothing old enough (EC-2704)", async () => {
    const rows = await db.query<{ purge_audit_logs: string }>(
      "select public.purge_audit_logs(interval '3650 days')",
    );
    expect(Number(rows[0]?.purge_audit_logs)).toBe(0);
  });

  /*
   * TEST-2715 - the assertion that matters most in this file.
   *
   * Without the floor, `purge_audit_logs(interval '1 hour')` empties the trail
   * with a single parameter, and the person most likely to type it is the
   * person who least wants the trail to exist. Master section 17 asks for
   * auditing precisely for that moment.
   */
  it("refuses an interval below the ninety-day floor (TEST-2715)", async () => {
    for (const interval of ["1 hour", "1 day", "89 days"]) {
      await expect(
        db.query(`select public.purge_audit_logs(interval '${interval}')`),
        interval,
      ).rejects.toThrow(/shorter than 90 days/);
    }
  });

  it("accepts exactly the floor", async () => {
    await expect(
      db.query("select public.purge_audit_logs(interval '90 days')"),
    ).resolves.toBeDefined();
  });

  /*
   * TEST-2717 - and the other refusal.
   *
   * The businesses whose actions this table records must not be able to erase
   * it. PostgreSQL grants EXECUTE to PUBLIC on a new function by default, so
   * the migration revokes it and never grants it back to a tenant role.
   */
  it("cannot be executed from a tenant session (TEST-2717)", async () => {
    await expect(
      db.asUser(userId, () => db.query("select public.purge_audit_logs(interval '365 days')")),
    ).rejects.toThrow(/permission denied/i);
  });

  it("cannot be executed by an anonymous caller either", async () => {
    await expect(
      db.asRole("anon", () => db.query("select public.purge_audit_logs(interval '365 days')")),
    ).rejects.toThrow(/permission denied/i);
  });
});
