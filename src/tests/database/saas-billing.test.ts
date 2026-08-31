import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, insertTenant, type TestDatabase } from "../helpers/database";

/**
 * Phase 22 at the database level.
 *
 * Four invariants matter more than the rest, all from ADR-026:
 *
 * - The cycle is IDEMPOTENT. Running it twice issues no second charge, and the
 *   guarantee is the unique index, not a check somebody wrote.
 * - The order of the six steps is fixed, and the whole sequence is walked over
 *   one subscription so a reordering breaks a test instead of an invoice.
 * - `subscription_events` is written ONLY by trigger: there is no INSERT
 *   policy at all, for anybody.
 * - Master section 22: no foreign key crosses between CloverCode's billing and
 *   the restaurant's own. TEST-2230 asserts that over pg_constraint.
 *
 * Time is moved by writing explicit dates, never by sleeping.
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

interface CycleSummary {
  subscriptions_advanced: number;
  charges_issued: number;
  marked_past_due: number;
  suspended: number;
  cancelled: number;
}

/** The cycle only runs for a platform admin, so every call goes through one. */
async function runCycle(): Promise<CycleSummary> {
  const rows = await db.asUser(admin, () =>
    db.query<CycleSummary>("select * from public.run_subscription_billing()"),
  );
  return rows[0]!;
}

async function subscriptionOf(tenantId: string): Promise<{
  id: string;
  status: string;
  plan_code: string;
  current_period_start: string;
  current_period_end: string | null;
  trial_ends_at: string | null;
  cancel_at_period_end: boolean;
}> {
  const rows = await db.query<{
    id: string;
    status: string;
    plan_code: string;
    current_period_start: string;
    current_period_end: string | null;
    trial_ends_at: string | null;
    cancel_at_period_end: boolean;
  }>(
    `select id, status, plan_code, current_period_start, current_period_end,
            trial_ends_at, cancel_at_period_end
     from public.subscriptions where tenant_id = $1`,
    [tenantId],
  );
  return rows[0]!;
}

async function chargesOf(tenantId: string) {
  return db.query<{
    id: string;
    status: string;
    amount_cents: string;
    currency: string;
    due_at: string;
    plan_code_snapshot: string;
    period_start: string;
  }>(
    `select id, status, amount_cents, currency, due_at, plan_code_snapshot, period_start
     from public.saas_payments where tenant_id = $1 order by period_start`,
    [tenantId],
  );
}

async function eventsOf(tenantId: string) {
  return db.query<{ type: string; from_status: string | null; to_status: string | null }>(
    `select type, from_status, to_status from public.subscription_events
     where tenant_id = $1 order by created_at`,
    [tenantId],
  );
}

/** Moves a subscription's clock by rewriting its dates. No sleeping. */
async function backdate(tenantId: string, sql: string): Promise<void> {
  await db.query(`update public.subscriptions set ${sql} where tenant_id = $1`, [tenantId]);
}

/**
 * Puts a subscription in a period that already ended.
 *
 * Both ends move: `subscriptions_period_ordered` (Phase 21) requires the end to
 * be after the start, so pushing only the end inverts the period and the CHECK
 * refuses it - which is the constraint doing its job, and the reason this
 * helper exists instead of an inline UPDATE.
 */
async function endPeriodInThePast(tenantId: string, daysAgo = 40): Promise<void> {
  await db.query(
    `update public.subscriptions
     set current_period_start = now() - ($2 || ' days')::interval,
         current_period_end = now() - interval '1 hour'
     where tenant_id = $1`,
    [tenantId, daysAgo],
  );
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
// Posture
// ---------------------------------------------------------------------------

describe("schema posture (TEST-2210 to TEST-2213)", () => {
  it("has row level security on both new tables", async () => {
    const rows = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `select relname, relrowsecurity from pg_class
       where relname in ('saas_payments','subscription_events')`,
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.relrowsecurity)).toBe(true);
  });

  it("lets NOBODY write subscription_events, platform admin included (TEST-2211)", async () => {
    const rows = await db.query<{ cmd: string }>(
      `select cmd from pg_policies
       where schemaname = 'public' and tablename = 'subscription_events'`,
    );
    expect(rows.map((r) => r.cmd)).toEqual(["SELECT"]);
  });

  it("has no DELETE policy on saas_payments (TEST-2212)", async () => {
    const rows = await db.query<{ cmd: string }>(
      `select cmd from pg_policies
       where schemaname = 'public' and tablename = 'saas_payments' and cmd = 'DELETE'`,
    );
    expect(rows).toEqual([]);
  });

  it("grants nothing to anon (TEST-2213)", async () => {
    const rows = await db.query<{ tablename: string }>(
      `select tablename from pg_policies
       where schemaname = 'public' and tablename = any($1) and 'anon' = any(roles)`,
      [["saas_payments", "subscription_events"]],
    );
    expect(rows).toEqual([]);
  });

  it("keeps CloverCode's billing and the restaurant's completely apart (TEST-2230)", async () => {
    // Master section 22, asserted over pg_constraint rather than trusted to
    // naming. No FK from this phase's tables into the restaurant's money, and
    // none the other way.
    const saas = ["saas_payments", "subscription_events", "subscriptions"];
    const restaurant = [
      "payments",
      "payment_methods",
      "billing_documents",
      "billing_document_items",
      "cash_sessions",
      "cash_movements",
      "orders",
    ];

    const rows = await db.query<{ src: string; dst: string }>(
      `select src.relname as src, dst.relname as dst
       from pg_constraint as c
       join pg_class as src on src.oid = c.conrelid
       join pg_class as dst on dst.oid = c.confrelid
       where c.contype = 'f'
         and (
           (src.relname = any($1) and dst.relname = any($2))
           or (src.relname = any($2) and dst.relname = any($1))
         )`,
      [saas, restaurant],
    );
    expect(rows).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The history, written only by trigger
// ---------------------------------------------------------------------------

describe("subscription_events (TEST-2214 to TEST-2218)", () => {
  it("records `created` when a tenant is provisioned (TEST-2214)", async () => {
    const fresh = await insertTenant(db, { name: "Historial", slug: "historial" });
    const events = await eventsOf(fresh);
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("created");
  });

  it("records a plan change with where it came from (TEST-2215)", async () => {
    const fresh = await insertTenant(db, { name: "Cambia plan", slug: "cambia-plan" });
    await db.query("update public.subscriptions set plan_code = 'starter' where tenant_id = $1", [
      fresh,
    ]);

    const events = await eventsOf(fresh);
    const change = events.find((e) => e.type === "plan_changed");
    expect(change).toBeDefined();
  });

  it("records a status change (TEST-2216)", async () => {
    const fresh = await insertTenant(db, { name: "Cambia estado", slug: "cambia-estado" });
    await db.query("update public.subscriptions set status = 'suspended' where tenant_id = $1", [
      fresh,
    ]);

    const events = await eventsOf(fresh);
    const change = events.find((e) => e.type === "status_changed");
    expect(change?.to_status).toBe("suspended");
  });

  it("does not record a status change that changed nothing", async () => {
    const fresh = await insertTenant(db, { name: "Sin cambio", slug: "sin-cambio-sub" });
    const before = (await eventsOf(fresh)).length;

    await db.query("update public.subscriptions set status = status where tenant_id = $1", [fresh]);

    expect((await eventsOf(fresh)).length).toBe(before);
  });

  it("refuses a direct INSERT even from a platform admin (TEST-2211)", async () => {
    const sub = await subscriptionOf(tenantA);
    // RLS RAISES on INSERT rather than silently filtering the way it does on
    // SELECT and UPDATE - which is the stronger outcome: forging history is not
    // quietly ignored, it fails.
    await expect(
      db.asUser(admin, () =>
        db.query(
          `insert into public.subscription_events (tenant_id, subscription_id, type)
           values ($1, $2, 'created')`,
          [tenantA, sub.id],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });
});

// ---------------------------------------------------------------------------
// The cycle, walked end to end over one subscription
// ---------------------------------------------------------------------------

describe("the billing cycle (TEST-2219 to TEST-2225)", () => {
  let tenant: string;

  beforeAll(async () => {
    tenant = await insertTenant(db, { name: "Ciclo", slug: "ciclo" });
    // A known price, so every assertion below is about a number this test chose.
    await db.query("update public.subscriptions set plan_code = 'starter' where tenant_id = $1", [
      tenant,
    ]);
  });

  it("starts a new tenant on trial, and charges it nothing (TEST-2220)", async () => {
    const sub = await subscriptionOf(tenant);
    expect(sub.status).toBe("trialing");
    expect(sub.trial_ends_at).not.toBeNull();

    await runCycle();

    expect((await subscriptionOf(tenant)).status).toBe("trialing");
    expect(await chargesOf(tenant)).toEqual([]);
  });

  it("closes an expired trial and opens the first paid period (TEST-2219)", async () => {
    const before = await subscriptionOf(tenant);
    await backdate(
      tenant,
      `current_period_start = now() - interval '15 days',
       trial_ends_at = now() - interval '1 day',
       current_period_end = now() - interval '1 day'`,
    );

    const summary = await runCycle();
    expect(summary.subscriptions_advanced).toBeGreaterThan(0);

    const after = await subscriptionOf(tenant);
    expect(after.status).not.toBe("trialing");
    // The paid period starts where the TRIAL ended, not "now": a cycle run a
    // day late must not give the business a free day.
    expect(new Date(after.current_period_start).getTime()).toBe(
      new Date(after.trial_ends_at!).getTime(),
    );
    expect(after.trial_ends_at).not.toBe(before.trial_ends_at);
  });

  it("issues one charge for the period, at the plan's price (TEST-2221)", async () => {
    const charges = await chargesOf(tenant);
    expect(charges).toHaveLength(1);

    const plan = await db.query<{ price_cents: string; currency: string }>(
      "select price_cents, currency from public.plans where code = 'starter'",
    );
    expect(charges[0]!.amount_cents).toBe(plan[0]!.price_cents);
    expect(charges[0]!.currency).toBe(plan[0]!.currency);
    expect(charges[0]!.plan_code_snapshot).toBe("starter");
  });

  it("marks it past_due the moment that charge falls due unpaid (TEST-2224)", async () => {
    // A subscription is billed IN ADVANCE, so the charge is due the instant the
    // period opens. `past_due` is therefore the honest description of "the
    // period started and the money has not arrived yet" - and it still grants
    // every module (ADR-025 decision 3), so nothing about the service changes.
    expect((await subscriptionOf(tenant)).status).toBe("past_due");
  });

  it("issues no second charge when run again (TEST-2222)", async () => {
    const before = (await chargesOf(tenant)).length;

    const summary = await runCycle();
    expect(summary.charges_issued).toBe(0);

    expect((await chargesOf(tenant)).length).toBe(before);
  });

  it("advances the period when it ends, and charges for the new one (TEST-2223)", async () => {
    const before = (await chargesOf(tenant)).length;
    // Three days, deliberately inside the plan's seven days of grace: this step
    // is about advancing and charging, not about suspension.
    await endPeriodInThePast(tenant, 3);

    const summary = await runCycle();
    expect(summary.subscriptions_advanced).toBeGreaterThan(0);
    expect(summary.charges_issued).toBeGreaterThan(0);

    expect((await chargesOf(tenant)).length).toBeGreaterThan(before);
    expect((await subscriptionOf(tenant)).status).toBe("past_due");
  });

  it("suspends it once the grace period runs out (TEST-2225)", async () => {
    // starter ships with seven grace days; push the oldest debt past them.
    await db.query(
      `update public.saas_payments set due_at = now() - interval '30 days'
       where tenant_id = $1 and status = 'pending'`,
      [tenant],
    );

    const summary = await runCycle();
    expect(summary.suspended).toBeGreaterThan(0);
    expect((await subscriptionOf(tenant)).status).toBe("suspended");
  });

  it("stops charging a suspended subscription", async () => {
    const before = (await chargesOf(tenant)).length;
    await runCycle();
    expect((await chargesOf(tenant)).length).toBe(before);
  });

  it("comes back to life when every overdue charge is paid (TEST-2226)", async () => {
    const pending = await db.query<{ id: string }>(
      "select id from public.saas_payments where tenant_id = $1 and status = 'pending'",
      [tenant],
    );
    expect(pending.length).toBeGreaterThan(0);

    for (const charge of pending) {
      await db.asUser(admin, () =>
        db.query("select public.record_saas_payment($1, 'transferencia', 'op-1', null)", [
          charge.id,
        ]),
      );
    }

    expect((await subscriptionOf(tenant)).status).toBe("active");
  });
  it("wrote a history for every one of those moves", async () => {
    const types = (await eventsOf(tenant)).map((e) => e.type);
    expect(types).toContain("created");
    expect(types).toContain("status_changed");
    expect(types).toContain("period_advanced");
    expect(types).toContain("charge_issued");
    expect(types).toContain("payment_recorded");
  });
});

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

describe("recording and voiding (TEST-2227, TEST-2228)", () => {
  async function tenantWithCharge(slug: string): Promise<{ tenant: string; charge: string }> {
    const tenant = await insertTenant(db, { name: slug, slug });
    await db.query(
      `update public.subscriptions
       set status = 'active', plan_code = 'starter', trial_ends_at = null,
           current_period_start = now() - interval '40 days',
           current_period_end = now() - interval '1 hour'
       where tenant_id = $1`,
      [tenant],
    );
    await runCycle();

    const charges = await chargesOf(tenant);
    return { tenant, charge: charges[0]!.id };
  }

  it("refuses to record a payment twice (TEST-2227)", async () => {
    const { charge } = await tenantWithCharge("pago-doble");

    await db.asUser(admin, () =>
      db.query("select public.record_saas_payment($1, 'yape', null, null)", [charge]),
    );

    await expect(
      db.asUser(admin, () =>
        db.query("select public.record_saas_payment($1, 'yape', null, null)", [charge]),
      ),
    ).rejects.toThrow(/not pending/);
  });

  it("refuses a payment with no method", async () => {
    const { charge } = await tenantWithCharge("sin-metodo");
    await expect(
      db.asUser(admin, () =>
        db.query("select public.record_saas_payment($1, '  ', null, null)", [charge]),
      ),
    ).rejects.toThrow(/requires a method/);
  });

  it("refuses to void a charge that was paid (TEST-2228)", async () => {
    const { charge } = await tenantWithCharge("anular-pagado");
    await db.asUser(admin, () =>
      db.query("select public.record_saas_payment($1, 'deposito', null, null)", [charge]),
    );

    await expect(
      db.asUser(admin, () => db.query("select public.void_saas_payment($1, 'error')", [charge])),
    ).rejects.toThrow(/cannot be voided/);
  });

  it("voids an unpaid charge with its reason, and it stops being debt", async () => {
    const { tenant, charge } = await tenantWithCharge("anular-ok");

    await db.asUser(admin, () =>
      db.query("select public.void_saas_payment($1, 'Emitido por error')", [charge]),
    );

    const rows = await db.query<{ status: string; notes: string }>(
      "select status, notes from public.saas_payments where id = $1",
      [charge],
    );
    expect(rows[0]!.status).toBe("void");
    expect(rows[0]!.notes).toBe("Emitido por error");

    // A period 40 days in the past produces more than one charge, so voiding
    // one leaves the rest owing. Void them all, then prove the cycle does not
    // suspend over debt that is no longer debt.
    const others = await db.query<{ id: string }>(
      "select id from public.saas_payments where tenant_id = $1 and status = 'pending'",
      [tenant],
    );
    for (const other of others) {
      await db.asUser(admin, () =>
        db.query("select public.void_saas_payment($1, 'Emitido por error')", [other.id]),
      );
    }

    await db.query("update public.subscriptions set status = 'active' where tenant_id = $1", [
      tenant,
    ]);
    await runCycle();
    expect((await subscriptionOf(tenant)).status).not.toBe("suspended");
  });

  it("refuses to void without a reason", async () => {
    const { charge } = await tenantWithCharge("anular-sin-motivo");
    await expect(
      db.asUser(admin, () => db.query("select public.void_saas_payment($1, '   ')", [charge])),
    ).rejects.toThrow(/requires a reason/);
  });

  it("refuses a caller who is not a platform admin", async () => {
    const { charge } = await tenantWithCharge("sin-permiso-saas");
    await expect(
      db.asUser(ownerA, () =>
        db.query("select public.record_saas_payment($1, 'yape', null, null)", [charge]),
      ),
    ).rejects.toThrow(/platform admin/);

    await expect(
      db.asUser(ownerA, () => db.query("select public.run_subscription_billing()")),
    ).rejects.toThrow(/platform admin/);
  });

  it("settles a zero charge on sight, so nobody is suspended over nothing", async () => {
    const tenant = await insertTenant(db, { name: "Cortesia", slug: "cortesia" });
    const sub = await subscriptionOf(tenant);

    const rows = await db.query<{ status: string; method: string }>(
      `insert into public.saas_payments
         (subscription_id, plan_code_snapshot, period_start, period_end,
          amount_cents, currency, due_at)
       values ($1, 'starter', now(), now() + interval '1 month', 0, 'PEN', now())
       returning status, method`,
      [sub.id],
    );
    expect(rows[0]!.status).toBe("paid");
  });
});

// ---------------------------------------------------------------------------
// Cancellation
// ---------------------------------------------------------------------------

describe("cancel at period end (TEST-2229, TEST-2234)", () => {
  it("does not cancel before the period runs out", async () => {
    const tenant = await insertTenant(db, { name: "Cancela luego", slug: "cancela-luego" });
    await db.query(
      `update public.subscriptions
       set status = 'active', trial_ends_at = null, cancel_at_period_end = true,
           current_period_start = now() - interval '20 days',
           current_period_end = now() + interval '10 days'
       where tenant_id = $1`,
      [tenant],
    );

    await runCycle();
    // The assertion is about cancellation, not about what an outstanding
    // charge does to the status: a period that has not ended is not cancelled.
    const sub = await subscriptionOf(tenant);
    expect(sub.status).not.toBe("cancelled");
    expect(sub.cancel_at_period_end).toBe(true);
  });

  it("cancels when the period runs out (TEST-2229)", async () => {
    const tenant = await insertTenant(db, { name: "Cancela ya", slug: "cancela-ya" });
    await db.query(
      `update public.subscriptions
       set status = 'active', trial_ends_at = null, cancel_at_period_end = true,
           current_period_start = now() - interval '40 days',
           current_period_end = now() - interval '1 hour'
       where tenant_id = $1`,
      [tenant],
    );

    const summary = await runCycle();
    expect(summary.cancelled).toBeGreaterThan(0);

    const sub = await subscriptionOf(tenant);
    expect(sub.status).toBe("cancelled");
    // The flag is cleared: it has done its job, and the CHECK forbids both.
    expect(sub.cancel_at_period_end).toBe(false);
  });

  it("never charges a cancelled subscription again (TEST-2234)", async () => {
    const tenant = await insertTenant(db, { name: "Cancelada", slug: "cancelada" });
    await db.query(
      `update public.subscriptions
       set status = 'cancelled', cancelled_at = now(), trial_ends_at = null,
           current_period_start = now() - interval '120 days',
           current_period_end = now() - interval '90 days'
       where tenant_id = $1`,
      [tenant],
    );

    await runCycle();
    expect(await chargesOf(tenant)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Snapshots and isolation
// ---------------------------------------------------------------------------

describe("snapshots and access (TEST-2231, TEST-2232, TEST-2233, TEST-2236)", () => {
  it("keeps the charge intact when the plan's price changes afterwards (TEST-2236)", async () => {
    const tenant = await insertTenant(db, { name: "Snapshot", slug: "snapshot" });
    await db.query(
      `update public.subscriptions
       set status = 'active', plan_code = 'starter', trial_ends_at = null,
           current_period_start = now() - interval '40 days',
           current_period_end = now() - interval '1 hour'
       where tenant_id = $1`,
      [tenant],
    );
    await runCycle();

    const before = (await chargesOf(tenant))[0]!;

    await db.query("update public.plans set price_cents = 99999 where code = 'starter'");

    const after = (await chargesOf(tenant))[0]!;
    expect(after.amount_cents).toBe(before.amount_cents);
    expect(after.plan_code_snapshot).toBe("starter");

    await db.query("update public.plans set price_cents = 9900 where code = 'starter'");
  });

  it("lets a business read its own charges and write none (TEST-2231)", async () => {
    const read = await db.asUser(ownerA, () =>
      db.query("select id from public.saas_payments where tenant_id = $1", [tenantA]),
    );
    expect(Array.isArray(read)).toBe(true);

    const sub = await subscriptionOf(tenantA);
    await expect(
      db.asUser(ownerA, () =>
        db.query(
          `insert into public.saas_payments
             (subscription_id, plan_code_snapshot, period_start, period_end,
              amount_cents, currency, due_at)
           values ($1, 'starter', now(), now() + interval '1 month', 100, 'PEN', now())`,
          [sub.id],
        ),
      ),
    ).rejects.toThrow();
  });

  it("does not let a business read another's charges (TEST-2232)", async () => {
    const rows = await db.asUser(ownerB, () =>
      db.query("select id from public.saas_payments where tenant_id = $1", [tenantA]),
    );
    expect(rows).toEqual([]);
  });

  it("does not let a business read another's history", async () => {
    const rows = await db.asUser(ownerB, () =>
      db.query("select id from public.subscription_events where tenant_id = $1", [tenantA]),
    );
    expect(rows).toEqual([]);
  });

  it("lets a business read its OWN history: it is why it was suspended", async () => {
    const rows = await db.asUser(ownerA, () =>
      db.query("select id from public.subscription_events where tenant_id = $1", [tenantA]),
    );
    expect(rows.length).toBeGreaterThan(0);
  });

  it("lets a platform admin write charges (TEST-2233)", async () => {
    const sub = await subscriptionOf(tenantB);
    const rows = await db.asUser(admin, () =>
      db.query<{ id: string }>(
        `insert into public.saas_payments
           (subscription_id, plan_code_snapshot, period_start, period_end,
            amount_cents, currency, due_at)
         values ($1, 'starter', now() + interval '400 days', now() + interval '430 days',
                 9900, 'PEN', now() + interval '400 days')
         returning id`,
        [sub.id],
      ),
    );
    expect(rows).toHaveLength(1);
  });

  it("gives an unauthenticated caller nothing", async () => {
    const rows = await db.asUser(null, () => db.query("select id from public.saas_payments"));
    expect(rows).toEqual([]);
  });

  it("does not touch a single row of the business's own data when suspended (TEST-2235)", async () => {
    const tenant = await insertTenant(db, { name: "Intacta", slug: "intacta" });
    const locations = await db.query<{ count: string }>(
      "select count(*) as count from public.locations where tenant_id = $1",
      [tenant],
    );

    await db.query(`update public.subscriptions set status = 'suspended' where tenant_id = $1`, [
      tenant,
    ]);

    const after = await db.query<{ count: string }>(
      "select count(*) as count from public.locations where tenant_id = $1",
      [tenant],
    );
    expect(after[0]!.count).toBe(locations[0]!.count);

    // And the modules are off, which is Phase 21's job and still works.
    const modules = await db.query<{ module: string }>("select module from public.my_modules($1)", [
      tenant,
    ]);
    expect(modules).toEqual([]);
  });
});
