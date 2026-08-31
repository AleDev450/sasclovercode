import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, insertAuthUser, type TestDatabase } from "../helpers/database";

/**
 * Phase 25 — the rate limiter.
 *
 * Phase 02 left KL-203: "no application rate limiting exists; one needs shared
 * state." The state is now in PostgreSQL, because the deployment target is
 * serverless and an in-memory counter is per instance — it allows N x limit
 * attempts with N instances and does not know it (ADR-029 decision 3).
 *
 * Three properties matter more than the arithmetic:
 *
 * - The table is unreadable and unwritable by ANYBODY. A readable counter is an
 *   oracle; a writable one is a way to lock somebody else out.
 * - The identifier is hashed. The limiter needs an opaque key, not an address,
 *   and storing the address would make this a second and less-guarded IP log.
 * - Buckets and subjects do not interfere with each other, which is what stops
 *   one endpoint's traffic from throttling another's.
 */

let db: TestDatabase;

const IP_A = "190.12.44.7";
const IP_B = "190.12.44.8";

async function consume(
  bucket: string,
  subject: string,
  limit = 3,
  windowSeconds = 60,
): Promise<boolean> {
  const rows = await db.query<{ allowed: boolean }>(
    "select public.consume_rate_limit($1, $2, $3, $4) as allowed",
    [bucket, subject, limit, windowSeconds],
  );
  return rows[0]!.allowed;
}

beforeAll(async () => {
  db = await createTestDatabase();
});

afterAll(async () => {
  await db.close();
});

describe("counting (TEST-2530, TEST-2539)", () => {
  it("allows up to the limit and denies the next one", async () => {
    expect(await consume("auth.sign_in", IP_A, 3)).toBe(true);
    expect(await consume("auth.sign_in", IP_A, 3)).toBe(true);
    expect(await consume("auth.sign_in", IP_A, 3)).toBe(true);
    expect(await consume("auth.sign_in", IP_A, 3)).toBe(false);
  });

  it("keeps denying once over, rather than letting the count wrap", async () => {
    expect(await consume("auth.sign_in", IP_A, 3)).toBe(false);
    expect(await consume("auth.sign_in", IP_A, 3)).toBe(false);
  });

  it("denies everything when the limit is zero", async () => {
    // A way to switch a bucket off without a deploy, and the only sensible
    // reading of "allow zero".
    expect(await consume("auth.sign_in", "someone-else", 0)).toBe(false);
  });

  it("refuses a window that is not positive", async () => {
    await expect(consume("auth.sign_in", IP_B, 5, 0)).rejects.toThrow(/window must be positive/);
  });
});

describe("separation (TEST-2531, TEST-2532)", () => {
  it("counts each bucket on its own", async () => {
    // A flood of password resets must not lock the sign-in form.
    expect(await consume("auth.password_reset", IP_A, 3)).toBe(true);
    expect(await consume("auth.password_reset", IP_A, 3)).toBe(true);
  });

  it("counts each subject on its own", async () => {
    // IP_A is already over its limit for auth.sign_in from the first block.
    expect(await consume("auth.sign_in", IP_B, 3)).toBe(true);
  });
});

describe("windows (TEST-2533)", () => {
  it("starts a new window from zero", async () => {
    const subject = "window-test";

    expect(await consume("auth.sign_in", subject, 1, 60)).toBe(true);
    expect(await consume("auth.sign_in", subject, 1, 60)).toBe(false);

    // Move this subject's window into the past, which is what the passage of
    // time does. Faster than waiting sixty seconds, and exercises the same
    // rows: `consume_rate_limit` computes the CURRENT window and will not find
    // the moved one.
    await db.query(
      `update public.rate_limit_counters
       set window_start = window_start - interval '10 minutes'
       where subject_hash = encode(sha256(convert_to($1, 'UTF8')), 'hex')`,
      [subject],
    );

    expect(await consume("auth.sign_in", subject, 1, 60)).toBe(true);
  });

  it("puts two calls in the same window in the same row", async () => {
    const subject = "same-window";
    await consume("auth.sign_in", subject, 5, 3600);
    await consume("auth.sign_in", subject, 5, 3600);

    const rows = await db.query<{ c: string; hits: number }>(
      `select count(*)::text c, max(hits) as hits from public.rate_limit_counters
       where subject_hash = encode(sha256(convert_to($1, 'UTF8')), 'hex')`,
      [subject],
    );

    expect(Number(rows[0]!.c)).toBe(1);
    expect(rows[0]!.hits).toBe(2);
  });
});

describe("the subject is never stored (TEST-2534, TEST-2535)", () => {
  it("keeps a hash and not the address", async () => {
    await consume("auth.sign_in", "203.0.113.45", 5);

    const rows = await db.query<{ subject_hash: string }>(
      "select subject_hash from public.rate_limit_counters",
    );

    // Not one row anywhere contains the address in any form.
    for (const row of rows) {
      expect(row.subject_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(row.subject_hash).not.toContain("203.0.113.45");
    }
  });

  it("hashes the same subject to the same value, or the counter would reset", async () => {
    const subject = "stable-hash";
    await consume("auth.sign_in", subject, 5, 3600);
    await consume("auth.sign_in", subject, 5, 3600);

    const rows = await db.query<{ c: string }>(
      `select count(distinct subject_hash)::text c from public.rate_limit_counters
       where subject_hash = encode(sha256(convert_to($1, 'UTF8')), 'hex')`,
      [subject],
    );

    expect(Number(rows[0]!.c)).toBe(1);
  });

  it("copes with an empty subject rather than refusing to count it", async () => {
    // A request with no address at all is still a request. "We could not tell
    // who this is" is not a reason to stop counting.
    expect(await consume("auth.sign_in", "", 2)).toBe(true);
  });
});

describe("nobody can read or write the table (TEST-2536, TEST-2537)", () => {
  it("has RLS on and not a single policy", async () => {
    const rls = await db.query<{ relrowsecurity: boolean }>(
      "select relrowsecurity from pg_class where relname = 'rate_limit_counters'",
    );
    expect(rls[0]?.relrowsecurity).toBe(true);

    const policies = await db.query<{ policyname: string }>(
      "select policyname from pg_policies where tablename = 'rate_limit_counters'",
    );
    expect(policies).toEqual([]);
  });

  it("shows an authenticated user nothing", async () => {
    const user = await insertAuthUser(db, { email: "curious@rate.test" });

    const rows = await db.asUser(user, () =>
      db.query<{ c: string }>("select count(*)::text c from public.rate_limit_counters"),
    );

    // Zero rows despite there being plenty: a readable counter would answer
    // "how many attempts does this address have left?"
    expect(Number(rows[0]!.c)).toBe(0);
  });

  it("shows an anonymous caller nothing", async () => {
    const rows = await db.asRole("anon", () =>
      db.query<{ c: string }>("select count(*)::text c from public.rate_limit_counters"),
    );
    expect(Number(rows[0]!.c)).toBe(0);
  });

  it("lets neither of them write, so nobody can lock somebody else out", async () => {
    const user = await insertAuthUser(db, { email: "malicious@rate.test" });

    await db.asUser(user, async () => {
      await expect(
        db.query(
          `insert into public.rate_limit_counters (bucket, subject_hash, window_start, hits)
           values ('auth.sign_in', repeat('a', 64), now(), 9999)`,
        ),
      ).rejects.toThrow(/row-level security/);
    });

    // And no DELETE either: clearing your own counter would defeat the limit.
    const before = await db.query<{ c: string }>(
      "select count(*)::text c from public.rate_limit_counters",
    );
    await db.asUser(user, () => db.query("delete from public.rate_limit_counters"));
    const after = await db.query<{ c: string }>(
      "select count(*)::text c from public.rate_limit_counters",
    );

    expect(after[0]!.c).toBe(before[0]!.c);
  });

  it("still lets anon and authenticated CALL the function", async () => {
    // It limits the surface WITHOUT a session, so requiring a session to call
    // it would be a contradiction.
    const allowed = await db.asRole("anon", () =>
      db.query<{ allowed: boolean }>(
        "select public.consume_rate_limit('auth.sign_in', 'anon-caller', 5, 60) as allowed",
      ),
    );
    expect(allowed[0]!.allowed).toBe(true);
  });
});

describe("purging (TEST-2538)", () => {
  it("removes expired windows and keeps live ones", async () => {
    await consume("auth.sign_in", "purge-live", 5, 3600);

    await db.query(
      `insert into public.rate_limit_counters (bucket, subject_hash, window_start, hits)
       values ('auth.sign_in', repeat('b', 64), now() - interval '3 days', 1)`,
    );

    const deleted = await db.query<{ purge_rate_limits: number }>(
      "select public.purge_rate_limits()",
    );
    expect(deleted[0]!.purge_rate_limits).toBeGreaterThanOrEqual(1);

    const stale = await db.query<{ c: string }>(
      `select count(*)::text c from public.rate_limit_counters
       where subject_hash = repeat('b', 64)`,
    );
    expect(Number(stale[0]!.c)).toBe(0);

    const live = await db.query<{ c: string }>(
      `select count(*)::text c from public.rate_limit_counters
       where subject_hash = encode(sha256(convert_to('purge-live', 'UTF8')), 'hex')`,
    );
    expect(Number(live[0]!.c)).toBe(1);
  });

  it("is not callable by a signed-in user", async () => {
    const user = await insertAuthUser(db, { email: "purger@rate.test" });

    await db.asUser(user, async () => {
      await expect(db.query("select public.purge_rate_limits()")).rejects.toThrow(/permission/i);
    });
  });
});

describe("the table's own shape", () => {
  it("refuses a bucket that is not domain.action shaped", async () => {
    await expect(
      db.query(
        `insert into public.rate_limit_counters (bucket, subject_hash, window_start)
         values ('Whatever', repeat('c', 64), now())`,
      ),
    ).rejects.toThrow(/rate_limit_counters_bucket_format/);
  });

  it("refuses anything that is not a sha256 hex digest", async () => {
    await expect(
      db.query(
        `insert into public.rate_limit_counters (bucket, subject_hash, window_start)
         values ('auth.sign_in', '190.12.44.7', now())`,
      ),
    ).rejects.toThrow(/rate_limit_counters_subject_hash_format/);
  });

  it("carries no tenant_id, because it governs the surface before a tenant exists", async () => {
    const rows = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'rate_limit_counters'
       order by column_name`,
    );

    expect(rows.map((r) => r.column_name)).toEqual([
      "bucket",
      "hits",
      "subject_hash",
      "window_start",
    ]);
  });
});
