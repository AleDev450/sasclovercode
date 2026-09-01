import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, insertTenant, type TestDatabase } from "../helpers/database";

/**
 * Phase 14 at the database level.
 *
 * Three invariants matter more than the rest, because their failure is
 * silent rather than an error somebody notices:
 *
 * - A payment can never push an order's paid total past its total (the
 *   overpay cap).
 * - A cash payment always requires an open session at the order's own
 *   location, and voiding one always nets the ledger back out.
 * - Closing a session computes what the till SHOULD hold from the ledger,
 *   not from what a form remembered.
 */

let db: TestDatabase;

let tenantA: string;
let tenantB: string;

let ownerA: string;
let managerA: string;
let cashierA: string;
let accountantA: string;
let ownerB: string;

let locationA: string;
let locationB: string;

let cashMethodA: string;
let yapeMethodA: string;
let inactiveMethodA: string;
let cashMethodB: string;

let registerA: string;
let registerB: string;

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

async function insertLocation(tenantId: string, name: string): Promise<string> {
  const rows = await db.query<{ id: string }>(
    "insert into public.locations (tenant_id, name) values ($1, $2) returning id",
    [tenantId, name],
  );
  return rows[0]!.id;
}

async function insertPaymentMethod(
  tenantId: string,
  type: string,
  name: string,
  isActive = true,
): Promise<string> {
  const rows = await db.query<{ id: string }>(
    `insert into public.payment_methods (tenant_id, type, name, is_active)
     values ($1, $2::public.payment_method_type, $3, $4) returning id`,
    [tenantId, type, name, isActive],
  );
  return rows[0]!.id;
}

async function insertRegister(tenantId: string, locationId: string, name: string): Promise<string> {
  const rows = await db.query<{ id: string }>(
    "insert into public.cash_registers (tenant_id, location_id, name) values ($1, $2, $3) returning id",
    [tenantId, locationId, name],
  );
  return rows[0]!.id;
}

async function openSession(registerId: string, openingCents = 0): Promise<string> {
  const rows = await db.query<{ id: string }>(
    "insert into public.cash_sessions (cash_register_id, opening_cents) values ($1, $2) returning id",
    [registerId, openingCents],
  );
  return rows[0]!.id;
}

async function closeSession(
  sessionId: string,
  closingCents: number,
): Promise<{ expected: string; difference: string }> {
  const rows = await db.query<{ expected_cents: string; difference_cents: string }>(
    `update public.cash_sessions set closing_cents = $2
     where id = $1
     returning expected_cents::text, difference_cents::text`,
    [sessionId, closingCents],
  );
  return { expected: rows[0]!.expected_cents, difference: rows[0]!.difference_cents };
}

/** An order with a known, fixed total: one line, priced to equal it exactly. */
async function insertOrderWithTotal(
  tenantId: string,
  locationId: string,
  totalCents: number,
): Promise<string> {
  const product = await db.query<{ id: string }>(
    `insert into public.products (tenant_id, name, slug, base_price_cents, status)
     values ($1, 'x', $2, $3, 'active'::public.product_status) returning id`,
    [tenantId, `x-${crypto.randomUUID()}`, totalCents],
  );
  const order = await db.query<{ id: string }>(
    `insert into public.orders (tenant_id, location_id, source) values ($1, $2, 'manual') returning id`,
    [tenantId, locationId],
  );
  await db.query(
    `insert into public.order_items
       (order_id, tenant_id, product_id, quantity, name_snapshot, unit_price_cents)
     values ($1, '00000000-0000-0000-0000-000000000000', $2, 1, 'placeholder', 0)`,
    [order[0]!.id, product[0]!.id],
  );
  return order[0]!.id;
}

async function insertPayment(
  orderId: string,
  methodId: string,
  amountCents: number,
  options: { cashSessionId?: string | null; reference?: string } = {},
): Promise<string> {
  const rows = await db.query<{ id: string }>(
    `insert into public.payments (order_id, payment_method_id, cash_session_id, amount_cents, reference)
     values ($1, $2, $3, $4, $5) returning id`,
    [orderId, methodId, options.cashSessionId ?? null, amountCents, options.reference ?? null],
  );
  return rows[0]!.id;
}

async function voidPayment(paymentId: string, reason: string | null): Promise<void> {
  await db.query("update public.payments set voided_at = now(), void_reason = $2 where id = $1", [
    paymentId,
    reason,
  ]);
}

async function orderPaid(orderId: string): Promise<string> {
  const rows = await db.query<{ paid_cents: string }>(
    "select paid_cents::text from public.orders where id = $1",
    [orderId],
  );
  return rows[0]!.paid_cents;
}

async function movementsFor(
  sessionId: string,
): Promise<{ type: string; amount_cents: string; payment_id: string | null }[]> {
  return db.query(
    `select type, amount_cents::text, payment_id from public.cash_movements
     where cash_session_id = $1 order by created_at`,
    [sessionId],
  );
}

beforeAll(async () => {
  db = await createTestDatabase();

  tenantA = await insertTenant(db, { slug: "sugurolls", name: "Sugu Rolls" });
  tenantB = await insertTenant(db, { slug: "polleria-el-rey", name: "Pollería El Rey" });

  ownerA = await createUser("owner@sugurolls.com");
  managerA = await createUser("encargado@sugurolls.com");
  cashierA = await createUser("caja@sugurolls.com");
  accountantA = await createUser("contador@sugurolls.com");
  ownerB = await createUser("owner@polleria.pe");

  await addMember(tenantA, ownerA, "owner");
  await addMember(tenantA, managerA, "manager");
  await addMember(tenantA, cashierA, "cashier");
  await addMember(tenantA, accountantA, "accountant");
  await addMember(tenantB, ownerB, "owner");

  locationA = await insertLocation(tenantA, "Miraflores");
  locationB = await insertLocation(tenantB, "Centro");

  cashMethodA = await insertPaymentMethod(tenantA, "cash", "Efectivo");
  yapeMethodA = await insertPaymentMethod(tenantA, "yape", "Yape - Alejandro");
  inactiveMethodA = await insertPaymentMethod(tenantA, "card", "POS viejo", false);
  cashMethodB = await insertPaymentMethod(tenantB, "cash", "Efectivo");

  registerA = await insertRegister(tenantA, locationA, "Caja 1");
  registerB = await insertRegister(tenantB, locationB, "Caja 1");
});

afterAll(async () => {
  await db.close();
});

describe("the overpay cap (the test of the phase)", () => {
  it("accumulates paid_cents across payments and refuses to exceed the total", async () => {
    const order = await insertOrderWithTotal(tenantA, locationA, 10000);
    const session = await openSession(registerA, 0);

    await insertPayment(order, cashMethodA, 6000, { cashSessionId: session });
    expect(await orderPaid(order)).toBe("6000");

    await expect(insertPayment(order, yapeMethodA, 5000)).rejects.toThrow(/overpaid/);
    expect(await orderPaid(order)).toBe("6000");

    await insertPayment(order, yapeMethodA, 4000);
    expect(await orderPaid(order)).toBe("10000");

    await expect(insertPayment(order, yapeMethodA, 1)).rejects.toThrow(/overpaid/);

    await closeSession(session, 6000);
  });

  it("refuses a payment against a cancelled order", async () => {
    const order = await insertOrderWithTotal(tenantA, locationA, 1000);
    await db.query(
      "update public.orders set status = 'cancelled', cancel_reason = 'cliente se fue' where id = $1",
      [order],
    );

    await expect(insertPayment(order, yapeMethodA, 500)).rejects.toThrow(/cancelled order/);
  });

  it("refuses a payment method that belongs to a different business", async () => {
    const order = await insertOrderWithTotal(tenantA, locationA, 1000);
    await expect(insertPayment(order, cashMethodB, 500)).rejects.toThrow(/different business/);
  });

  it("refuses a payment method that has been deactivated", async () => {
    const order = await insertOrderWithTotal(tenantA, locationA, 1000);
    await expect(insertPayment(order, inactiveMethodA, 500)).rejects.toThrow(/not active/);
  });
});

describe("cash requires an open session at the order's own location", () => {
  it("refuses a cash payment with no session", async () => {
    const order = await insertOrderWithTotal(tenantA, locationA, 1000);
    await expect(insertPayment(order, cashMethodA, 500)).rejects.toThrow(/open cash session/);
  });

  it("refuses a cash payment against a session at a different location", async () => {
    const otherLocation = await insertLocation(tenantA, "San Isidro");
    const otherRegister = await insertRegister(tenantA, otherLocation, "Caja SI");
    const session = await openSession(otherRegister, 0);

    const order = await insertOrderWithTotal(tenantA, locationA, 1000);
    await expect(
      insertPayment(order, cashMethodA, 500, { cashSessionId: session }),
    ).rejects.toThrow(/different location/);

    await closeSession(session, 0);
  });

  it("refuses a cash payment against an already-closed session", async () => {
    const session = await openSession(registerA, 0);
    await closeSession(session, 0);

    const order = await insertOrderWithTotal(tenantA, locationA, 1000);
    await expect(
      insertPayment(order, cashMethodA, 500, { cashSessionId: session }),
    ).rejects.toThrow(/already closed/);
  });

  it("refuses a non-cash payment that names a cash session", async () => {
    const session = await openSession(registerA, 0);
    const order = await insertOrderWithTotal(tenantA, locationA, 1000);

    await expect(
      insertPayment(order, yapeMethodA, 500, { cashSessionId: session }),
    ).rejects.toThrow(/Only a cash payment/);

    await closeSession(session, 0);
  });

  it("accepts a cash payment against an open session at the same location", async () => {
    const session = await openSession(registerA, 0);
    const order = await insertOrderWithTotal(tenantA, locationA, 1000);

    await expect(
      insertPayment(order, cashMethodA, 1000, { cashSessionId: session }),
    ).resolves.toBeDefined();

    await closeSession(session, 1000);
  });
});

describe("one open session per register", () => {
  it("refuses a second open session while one is already open", async () => {
    const register = await insertRegister(tenantA, locationA, "Caja temporal");
    const first = await openSession(register, 0);

    await expect(openSession(register, 0)).rejects.toThrow(/duplicate key|unique/i);

    await closeSession(first, 0);
    await expect(openSession(register, 0)).resolves.toBeDefined();
  });
});

describe("closing computes the ledger, not the form (the till reconciles)", () => {
  it("sums opening + movements into expected_cents, and diffs against the count", async () => {
    const register = await insertRegister(tenantA, locationA, "Caja reconciliacion");
    const session = await openSession(register, 10000);

    const orderOne = await insertOrderWithTotal(tenantA, locationA, 5000);
    await insertPayment(orderOne, cashMethodA, 5000, { cashSessionId: session });

    const orderTwo = await insertOrderWithTotal(tenantA, locationA, 3000);
    await insertPayment(orderTwo, cashMethodA, 3000, { cashSessionId: session });

    // A manual payout: petty cash for a delivery guy's mototaxi.
    await db.query(
      `insert into public.cash_movements (cash_session_id, type, amount_cents, reason)
       values ($1, 'payout', -2000, 'Mototaxi')`,
      [session],
    );

    // opening 10000 + sales 5000 + 3000 - payout 2000 = 16000
    const exact = await closeSession(session, 16000);
    expect(exact.expected).toBe("16000");
    expect(exact.difference).toBe("0");
  });

  it("reports a shortfall when the declared count is lower than expected", async () => {
    const register = await insertRegister(tenantA, locationA, "Caja faltante");
    const session = await openSession(register, 0);

    const order = await insertOrderWithTotal(tenantA, locationA, 1000);
    await insertPayment(order, cashMethodA, 1000, { cashSessionId: session });

    const short = await closeSession(session, 900);
    expect(short.expected).toBe("1000");
    expect(short.difference).toBe("-100");
  });

  it("refuses to close an already-closed session", async () => {
    const register = await insertRegister(tenantA, locationA, "Caja doble cierre");
    const session = await openSession(register, 0);
    await closeSession(session, 0);

    await expect(closeSession(session, 0)).rejects.toThrow(/already closed/);
  });
});

describe("voiding a payment (the ledger nets itself out)", () => {
  it("nets out paid_cents and writes a compensating movement for a cash payment", async () => {
    const session = await openSession(registerA, 0);
    const order = await insertOrderWithTotal(tenantA, locationA, 1000);
    const payment = await insertPayment(order, cashMethodA, 1000, { cashSessionId: session });

    expect(await orderPaid(order)).toBe("1000");
    expect(await movementsFor(session)).toEqual([
      { type: "sale", amount_cents: "1000", payment_id: payment },
    ]);

    await voidPayment(payment, "Monto ingresado por error");

    expect(await orderPaid(order)).toBe("0");
    const movements = await movementsFor(session);
    expect(movements).toEqual([
      { type: "sale", amount_cents: "1000", payment_id: payment },
      { type: "adjustment", amount_cents: "-1000", payment_id: payment },
    ]);

    await closeSession(session, 0);
  });

  it("nets out paid_cents with no movement row for a non-cash payment", async () => {
    const order = await insertOrderWithTotal(tenantA, locationA, 1000);
    const payment = await insertPayment(order, yapeMethodA, 1000);

    expect(await orderPaid(order)).toBe("1000");

    await voidPayment(payment, "Cliente pago dos veces");
    expect(await orderPaid(order)).toBe("0");
  });

  it("refuses to void an already-voided payment", async () => {
    const order = await insertOrderWithTotal(tenantA, locationA, 1000);
    const payment = await insertPayment(order, yapeMethodA, 500);
    await voidPayment(payment, "error");

    await expect(voidPayment(payment, "otra vez")).rejects.toThrow(/already voided/);
  });

  it("refuses to void without a reason", async () => {
    const order = await insertOrderWithTotal(tenantA, locationA, 1000);
    const payment = await insertPayment(order, yapeMethodA, 500);

    await expect(voidPayment(payment, "")).rejects.toThrow(/requires a reason/);
  });

  it("refuses to change the amount or method of an existing payment", async () => {
    const order = await insertOrderWithTotal(tenantA, locationA, 1000);
    const payment = await insertPayment(order, yapeMethodA, 500);

    await expect(
      db.query("update public.payments set amount_cents = 1 where id = $1", [payment]),
    ).rejects.toThrow(/Only voiding fields/);
  });
});

describe("cross-tenant guards", () => {
  it("refuses a cash register whose location belongs to a different business", async () => {
    await expect(insertRegister(tenantA, locationB, "Caja ajena")).rejects.toThrow(
      /different business/,
    );
  });

  it("refuses a cash session on another business's register (via a cross-tenant payment)", async () => {
    const session = await openSession(registerB, 0);
    const order = await insertOrderWithTotal(tenantA, locationA, 1000);

    await expect(
      insertPayment(order, cashMethodA, 500, { cashSessionId: session }),
    ).rejects.toThrow(/different business/);

    await closeSession(session, 0);
  });

  it("derives a payment's tenant from the order, ignoring what is sent", async () => {
    const order = await insertOrderWithTotal(tenantA, locationA, 1000);
    const payment = await insertPayment(order, yapeMethodA, 500);
    const rows = await db.query<{ tenant_id: string }>(
      "select tenant_id from public.payments where id = $1",
      [payment],
    );
    expect(rows[0]?.tenant_id).toBe(tenantA);
  });
});

describe("row level security", () => {
  const tables = [
    "payment_methods",
    "cash_registers",
    "cash_sessions",
    "payments",
    "cash_movements",
  ];

  it("grants nothing to anon on any of the new tables", async () => {
    const rows = await db.query<{ tablename: string; policyname: string; roles: string }>(
      `select tablename, policyname, roles::text as roles
       from pg_policies
       where schemaname = 'public' and tablename = any($1)`,
      [tables],
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.roles.includes("anon"), `${row.tablename}.${row.policyname}: ${row.roles}`).toBe(
        false,
      );
    }
  });

  it("has no DELETE policy on any of the new tables", async () => {
    const rows = await db.query<{ tablename: string }>(
      `select tablename from pg_policies
       where schemaname = 'public' and tablename = any($1) and cmd = 'DELETE'`,
      [tables],
    );
    expect(rows).toHaveLength(0);
  });

  it("has no UPDATE policy on cash_movements: the ledger is append-only", async () => {
    const rows = await db.query<{ policyname: string }>(
      `select policyname from pg_policies
       where schemaname = 'public' and tablename = 'cash_movements' and cmd = 'UPDATE'`,
    );
    expect(rows).toHaveLength(0);
  });

  it("hides another business's payments, sessions and registers", async () => {
    const mine = await insertOrderWithTotal(tenantA, locationA, 500);
    const paymentMine = await insertPayment(mine, yapeMethodA, 500);

    const theirs = await insertOrderWithTotal(tenantB, locationB, 500);
    const paymentTheirs = await insertPayment(theirs, cashMethodB, 500, {
      cashSessionId: await openSession(registerB, 0),
    });

    const visible = await db.asUser(ownerA, async () =>
      db.query<{ id: string }>("select id from public.payments"),
    );
    const ids = visible.map((r) => r.id);
    expect(ids).toContain(paymentMine);
    expect(ids).not.toContain(paymentTheirs);
  });

  it("lets a cashier record a payment but not void one (payments.create vs payments.void)", async () => {
    const order = await insertOrderWithTotal(tenantA, locationA, 1000);

    const created = await db.asUser(cashierA, async () =>
      db.query<{ id: string }>(
        "insert into public.payments (order_id, payment_method_id, amount_cents) values ($1, $2, 500) returning id",
        [order, yapeMethodA],
      ),
    );
    expect(created).toHaveLength(1);
    const paymentId = created[0]!.id;

    // The cashier can SEE the payment (payments.view) but the UPDATE policy's
    // USING clause checks payments.void, which the cashier lacks - so the row
    // is simply not matched by the update rather than raising an error. That
    // is ordinary PostgreSQL RLS behaviour: USING filters like a WHERE
    // clause, it does not throw.
    const voidAttempt = await db.asUser(cashierA, async () =>
      db.query<{ id: string }>(
        "update public.payments set voided_at = now(), void_reason = 'x' where id = $1 returning id",
        [paymentId],
      ),
    );
    expect(voidAttempt).toHaveLength(0);

    await expect(
      db.asUser(managerA, async () =>
        db.query("update public.payments set voided_at = now(), void_reason = 'x' where id = $1", [
          paymentId,
        ]),
      ),
    ).resolves.toBeDefined();
  });

  it("lets owner/admin manage payment methods and refuses a cashier", async () => {
    await expect(
      db.asUser(cashierA, async () =>
        db.query(
          "insert into public.payment_methods (tenant_id, type, name) values ($1, 'transfer', 'Cuenta BCP')",
          [tenantA],
        ),
      ),
    ).rejects.toThrow(/row-level security/);

    await expect(
      db.asUser(ownerA, async () =>
        db.query(
          "insert into public.payment_methods (tenant_id, type, name) values ($1, 'transfer', 'Cuenta BCP')",
          [tenantA],
        ),
      ),
    ).resolves.toBeDefined();
  });

  it("lets the accountant read payments and refuses a write", async () => {
    const rows = await db.asUser(accountantA, async () =>
      db.query("select id from public.payments"),
    );
    expect(rows.length).toBeGreaterThan(0);

    const order = await insertOrderWithTotal(tenantA, locationA, 500);
    await expect(
      db.asUser(accountantA, async () =>
        db.query(
          "insert into public.payments (order_id, payment_method_id, amount_cents) values ($1, $2, 500)",
          [order, yapeMethodA],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("refuses a hand-entered cash movement claiming to be a sale", async () => {
    const session = await openSession(registerA, 0);

    await expect(
      db.asUser(managerA, async () =>
        db.query(
          "insert into public.cash_movements (cash_session_id, type, amount_cents) values ($1, 'sale', 100)",
          [session],
        ),
      ),
    ).rejects.toThrow(/row-level security/);

    await expect(
      db.asUser(managerA, async () =>
        db.query(
          "insert into public.cash_movements (cash_session_id, type, amount_cents, reason) values ($1, 'payout', -100, 'x')",
          [session],
        ),
      ),
    ).resolves.toBeDefined();

    await closeSession(session, 0);
  });
});
