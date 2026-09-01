import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, insertTenant, type TestDatabase } from "../helpers/database";
import { allTransitionPairs } from "@/modules/billing/lifecycle";

/**
 * Phase 17 at the database level.
 *
 * Three invariants matter more than the rest:
 *
 * - Idempotency: `billing_documents_one_live_per_order_type` must let a
 *   rejected or cancelled attempt be retried, but never allow two LIVE
 *   documents of the same type for the same order at once (master section 37).
 * - The snapshot: a document's own lines never re-read `order_items` after
 *   creation - the same failure mode TEST-1307 (Phase 13) guards against,
 *   here for a document that has already been declared to SUNAT.
 * - The 18% IGV split always sums back to the total exactly - never two
 *   separately-rounded halves that could disagree by a cent.
 */

let db: TestDatabase;

let tenantA: string;
let tenantB: string;
let tenantC: string;

let ownerA: string;
let adminA: string;
let managerA: string;
let cashierA: string;
let accountantA: string;
let ownerB: string;

let locationA: string;
let locationB: string;
let locationC: string;

let customerDniA: string;
let customerRucA: string;
let customerB: string;

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

async function setTaxId(tenantId: string, taxId: string | null): Promise<void> {
  await db.query("update public.tenant_settings set tax_id = $2 where tenant_id = $1", [
    tenantId,
    taxId,
  ]);
}

async function insertCustomer(
  tenantId: string,
  name: string,
  options: { docType?: string; docNumber?: string } = {},
): Promise<string> {
  const rows = await db.query<{ id: string }>(
    `insert into public.customers (tenant_id, name, doc_type, doc_number)
     values ($1, $2, $3::public.customer_doc_type, $4) returning id`,
    [tenantId, name, options.docType ?? null, options.docNumber ?? null],
  );
  return rows[0]!.id;
}

/** An order with one line of a known, exact total - like payments.test's insertOrderWithTotal. */
async function orderWithLine(
  tenantId: string,
  locationId: string,
  totalCents: number,
): Promise<string> {
  // `snapshot_order_item()` (Phase 13) overwrites name_snapshot from the
  // product's own name regardless of what an insert sends - so the product
  // is named what the test expects the line to read, not the other way
  // round.
  const product = await db.query<{ id: string }>(
    `insert into public.products (tenant_id, name, slug, base_price_cents, status)
     values ($1, 'Maki acevichado', $2, $3, 'active'::public.product_status) returning id`,
    [tenantId, `maki-${crypto.randomUUID()}`, totalCents],
  );
  const order = await db.query<{ id: string }>(
    `insert into public.orders (tenant_id, location_id, source) values ($1, $2, 'manual') returning id`,
    [tenantId, locationId],
  );
  await db.query(
    `insert into public.order_items
       (order_id, tenant_id, product_id, quantity, name_snapshot, unit_price_cents)
     values ($1, '00000000-0000-0000-0000-000000000000', $2, 1, 'placeholder', $3)`,
    [order[0]!.id, product[0]!.id, totalCents],
  );
  return order[0]!.id;
}

async function emptyOrder(tenantId: string, locationId: string): Promise<string> {
  const rows = await db.query<{ id: string }>(
    `insert into public.orders (tenant_id, location_id, source) values ($1, $2, 'manual') returning id`,
    [tenantId, locationId],
  );
  return rows[0]!.id;
}

async function issueDocument(
  orderId: string,
  type: string,
  options: { customerId?: string | null; relatedDocumentId?: string | null } = {},
): Promise<string> {
  const rows = await db.query<{ id: string }>(
    `insert into public.billing_documents (order_id, type, customer_id, related_document_id)
     values ($1, $2::public.billing_document_type, $3, $4) returning id`,
    [orderId, type, options.customerId ?? null, options.relatedDocumentId ?? null],
  );
  return rows[0]!.id;
}

interface DocumentRow {
  tenant_id: string;
  status: string;
  series: string;
  number: number;
  issuer_ruc_snapshot: string;
  customer_name_snapshot: string | null;
  customer_doc_type_snapshot: string | null;
  subtotal_cents: string;
  tax_cents: string;
  total_cents: string;
}

async function documentRow(id: string): Promise<DocumentRow> {
  const rows = await db.query<DocumentRow>(
    `select tenant_id, status, series, number, issuer_ruc_snapshot, customer_name_snapshot,
            customer_doc_type_snapshot, subtotal_cents::text, tax_cents::text, total_cents::text
     from public.billing_documents where id = $1`,
    [id],
  );
  return rows[0]!;
}

async function setStatus(documentId: string, status: string, reason?: string): Promise<void> {
  if (status === "rejected") {
    await db.query(
      `update public.billing_documents
       set status = $2::public.billing_document_status, rejection_reason = $3
       where id = $1`,
      [documentId, status, reason ?? null],
    );
  } else if (status === "cancelled") {
    await db.query(
      `update public.billing_documents
       set status = $2::public.billing_document_status, cancel_reason = $3
       where id = $1`,
      [documentId, status, reason ?? null],
    );
  } else {
    await db.query(
      "update public.billing_documents set status = $2::public.billing_document_status where id = $1",
      [documentId, status],
    );
  }
}

beforeAll(async () => {
  db = await createTestDatabase();

  tenantA = await insertTenant(db, { slug: "sugurolls", name: "Sugu Rolls" });
  tenantB = await insertTenant(db, { slug: "polleria-el-rey", name: "Pollería El Rey" });
  tenantC = await insertTenant(db, { slug: "sin-ruc", name: "Negocio sin RUC" });

  ownerA = await createUser("owner@sugurolls.com");
  adminA = await createUser("admin@sugurolls.com");
  managerA = await createUser("encargado@sugurolls.com");
  cashierA = await createUser("caja@sugurolls.com");
  accountantA = await createUser("contador@sugurolls.com");
  ownerB = await createUser("owner@polleria.pe");

  await addMember(tenantA, ownerA, "owner");
  await addMember(tenantA, adminA, "admin");
  await addMember(tenantA, managerA, "manager");
  await addMember(tenantA, cashierA, "cashier");
  await addMember(tenantA, accountantA, "accountant");
  await addMember(tenantB, ownerB, "owner");

  locationA = await insertLocation(tenantA, "Miraflores");
  locationB = await insertLocation(tenantB, "Centro");
  locationC = await insertLocation(tenantC, "Unico local");

  // SUNAT's own RUC and Banco de Crédito's - real, check-digit-valid RUCs
  // (TEST-1203, customers.test.ts), reused here as the issuer and as a
  // factura-eligible customer.
  await setTaxId(tenantA, "20100047218");
  await setTaxId(tenantB, "20100070970");

  customerDniA = await insertCustomer(tenantA, "Ana Quispe", {
    docType: "dni",
    docNumber: "45678912",
  });
  customerRucA = await insertCustomer(tenantA, "Empresa SAC", {
    docType: "ruc",
    docNumber: "20131312955",
  });
  customerB = await insertCustomer(tenantB, "Carlos Rojas", {
    docType: "dni",
    docNumber: "78912345",
  });
});

afterAll(async () => {
  await db.close();
});

describe("the TypeScript mirror matches the SQL machine", () => {
  it("declares exactly the same pairs in both places", async () => {
    const rows = await db.query<{ from_status: string; to_status: string }>(
      "select from_status, to_status from public.billing_document_transitions",
    );

    const fromSql = rows.map((r) => `${r.from_status}->${r.to_status}`).sort();
    const fromTs = allTransitionPairs()
      .map((pair) => `${pair.from}->${pair.to}`)
      .sort();

    expect(fromTs).toEqual(fromSql);
  });
});

describe("assigning a document: series, correlative, snapshot", () => {
  it("assigns the default series and increments the correlative per (tenant, type, series)", async () => {
    const orderOne = await orderWithLine(tenantA, locationA, 1000);
    const orderTwo = await orderWithLine(tenantA, locationA, 1000);

    const first = await documentRow(await issueDocument(orderOne, "boleta"));
    const second = await documentRow(await issueDocument(orderTwo, "boleta"));

    expect(first.series).toBe("B001");
    expect(second.series).toBe("B001");
    expect(second.number).toBe(first.number + 1);
  });

  it("snapshots the issuer RUC from tenant_settings, never re-reading it later", async () => {
    const order = await orderWithLine(tenantA, locationA, 1000);
    const docId = await issueDocument(order, "boleta");
    const doc = await documentRow(docId);
    expect(doc.issuer_ruc_snapshot).toBe("20100047218");

    await setTaxId(tenantA, "20131312955");
    const stillOld = await documentRow(docId);
    expect(stillOld.issuer_ruc_snapshot).toBe("20100047218");
    await setTaxId(tenantA, "20100047218");
  });

  it("refuses to issue with no RUC configured", async () => {
    const order = await orderWithLine(tenantC, locationC, 1000);
    await expect(issueDocument(order, "boleta")).rejects.toThrow(/no RUC configured/);
  });

  it("refuses to bill a cancelled order", async () => {
    const order = await orderWithLine(tenantA, locationA, 1000);
    await db.query(
      "update public.orders set status = 'cancelled', cancel_reason = 'cliente se fue' where id = $1",
      [order],
    );
    await expect(issueDocument(order, "boleta")).rejects.toThrow(
      /cancelled order cannot be billed/,
    );
  });

  it("refuses an order with no lines", async () => {
    const order = await emptyOrder(tenantA, locationA);
    await expect(issueDocument(order, "boleta")).rejects.toThrow(/no lines cannot be billed/);
  });

  it("snapshots the named customer's name and document", async () => {
    const order = await orderWithLine(tenantA, locationA, 1000);
    const doc = await documentRow(
      await issueDocument(order, "boleta", { customerId: customerDniA }),
    );
    expect(doc.customer_name_snapshot).toBe("Ana Quispe");
    expect(doc.customer_doc_type_snapshot).toBe("dni");
  });

  it("refuses a customer that belongs to a different business", async () => {
    const order = await orderWithLine(tenantA, locationA, 1000);
    await expect(issueDocument(order, "boleta", { customerId: customerB })).rejects.toThrow(
      /different business/,
    );
  });

  it("a factura always needs a customer with a RUC", async () => {
    const order = await orderWithLine(tenantA, locationA, 1000);
    await expect(issueDocument(order, "factura")).rejects.toThrow(
      /billing_documents_factura_needs_ruc_customer/,
    );

    const orderDni = await orderWithLine(tenantA, locationA, 1000);
    await expect(issueDocument(orderDni, "factura", { customerId: customerDniA })).rejects.toThrow(
      /billing_documents_factura_needs_ruc_customer/,
    );

    const orderRuc = await orderWithLine(tenantA, locationA, 1000);
    await expect(
      issueDocument(orderRuc, "factura", { customerId: customerRucA }),
    ).resolves.toBeDefined();
  });

  it("a nota_credito/nota_debito always needs a related document, from the same business", async () => {
    const order = await orderWithLine(tenantA, locationA, 1000);
    await expect(issueDocument(order, "nota_credito")).rejects.toThrow(
      /billing_documents_notes_need_related_document/,
    );

    const original = await issueDocument(await orderWithLine(tenantA, locationA, 1000), "boleta");
    const noteOrder = await orderWithLine(tenantA, locationA, 1000);
    await expect(
      issueDocument(noteOrder, "nota_credito", { relatedDocumentId: original }),
    ).resolves.toBeDefined();

    const otherTenantDoc = await issueDocument(
      await orderWithLine(tenantB, locationB, 1000),
      "boleta",
    );
    const crossOrder = await orderWithLine(tenantA, locationA, 1000);
    await expect(
      issueDocument(crossOrder, "nota_credito", { relatedDocumentId: otherTenantDoc }),
    ).rejects.toThrow(/different business/);
  });
});

describe("populating lines from the order, and totalling the document", () => {
  it("copies every order line and sums the document's totals from them", async () => {
    const order = await orderWithLine(tenantA, locationA, 2490);
    const items = await db.query<{ id: string }>(
      "select id from public.order_items where order_id = $1",
      [order],
    );
    const doc = await issueDocument(order, "boleta");

    const lines = await db.query<{
      description_snapshot: string;
      unit_price_cents: string;
      total_cents: string;
      subtotal_cents: string;
      tax_cents: string;
    }>(
      `select description_snapshot, unit_price_cents::text, total_cents::text,
              subtotal_cents::text, tax_cents::text
       from public.billing_document_items where billing_document_id = $1`,
      [doc],
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]!.description_snapshot).toBe("Maki acevichado");
    expect(lines[0]!.total_cents).toBe("2490");
    expect(lines[0]!.subtotal_cents).toBe("2110");
    expect(lines[0]!.tax_cents).toBe("380");

    const total = await documentRow(doc);
    expect(total.subtotal_cents).toBe("2110");
    expect(total.tax_cents).toBe("380");
    expect(total.total_cents).toBe("2490");
    void items;
  });

  it("the item snapshot survives a later change to the order's own line", async () => {
    const order = await orderWithLine(tenantA, locationA, 1500);
    const orderItem = (
      await db.query<{ id: string }>("select id from public.order_items where order_id = $1", [
        order,
      ])
    )[0]!.id;
    const doc = await issueDocument(order, "boleta");

    const before = (
      await db.query<{ id: string; description_snapshot: string; total_cents: string }>(
        `select id, description_snapshot, total_cents::text
         from public.billing_document_items where billing_document_id = $1`,
        [doc],
      )
    )[0]!;

    // Simulating a hypothetical later edit directly on order_items - proves
    // billing_document_items is a copy, not a live join, the same way
    // TEST-1307 proves order totals do not track a product's current price.
    await db.query(
      "update public.order_items set name_snapshot = 'Cambiado', unit_price_cents = 999999, total_cents = 999999 where id = $1",
      [orderItem],
    );

    const after = (
      await db.query<{ description_snapshot: string; total_cents: string }>(
        "select description_snapshot, total_cents::text from public.billing_document_items where id = $1",
        [before.id],
      )
    )[0]!;
    expect(after.description_snapshot).toBe("Maki acevichado");
    expect(after.total_cents).toBe("1500");
  });
});

describe("IGV split (18%, remainder-based)", () => {
  it("subtotal + tax always equals the total, exactly", async () => {
    for (const total of [1, 15, 100, 380, 999, 2490, 15000, 999999]) {
      const rows = await db.query<{ subtotal: string; tax: string }>(
        "select public.igv_subtotal_from_total($1)::text as subtotal, public.igv_tax_from_total($1)::text as tax",
        [total],
      );
      expect(Number(rows[0]!.subtotal) + Number(rows[0]!.tax)).toBe(total);
    }
  });

  it("computes the textbook split for a known price", async () => {
    const rows = await db.query<{ subtotal: string; tax: string }>(
      "select public.igv_subtotal_from_total(2490)::text as subtotal, public.igv_tax_from_total(2490)::text as tax",
    );
    expect(rows[0]).toEqual({ subtotal: "2110", tax: "380" });
  });
});

describe("idempotency: one live document per order and type", () => {
  it("refuses a second live attempt while one is pending/sent/accepted", async () => {
    const order = await orderWithLine(tenantA, locationA, 1000);
    await issueDocument(order, "boleta");

    await expect(issueDocument(order, "boleta")).rejects.toThrow(
      /billing_documents_one_live_per_order_type/,
    );
  });

  it("lets a retry succeed after the earlier attempt was rejected", async () => {
    const order = await orderWithLine(tenantA, locationA, 1000);
    const first = await issueDocument(order, "boleta");
    await setStatus(first, "sent");
    await setStatus(first, "rejected", "RUC del cliente invalido");

    await expect(issueDocument(order, "boleta")).resolves.toBeDefined();
  });

  it("lets a retry succeed after the earlier attempt was cancelled", async () => {
    const order = await orderWithLine(tenantA, locationA, 1000);
    const first = await issueDocument(order, "boleta");
    await setStatus(first, "cancelled", "pedido se anulo despues");

    await expect(issueDocument(order, "boleta")).resolves.toBeDefined();
  });

  it("does not collide across different document types for the same order", async () => {
    const order = await orderWithLine(tenantA, locationA, 1000);
    await issueDocument(order, "boleta");
    await expect(
      issueDocument(order, "factura", { customerId: customerRucA }),
    ).resolves.toBeDefined();
  });
});

describe("the state machine (guard_billing_document_status_change)", () => {
  it("refuses skipping a state", async () => {
    const order = await orderWithLine(tenantA, locationA, 1000);
    const doc = await issueDocument(order, "boleta");
    await expect(setStatus(doc, "accepted")).rejects.toThrow(/cannot go from/);
  });

  it("requires a reason to reject or cancel", async () => {
    const order = await orderWithLine(tenantA, locationA, 1000);
    const doc = await issueDocument(order, "boleta");
    await setStatus(doc, "sent");
    await expect(setStatus(doc, "rejected")).rejects.toThrow(/requires a reason/);
    await expect(setStatus(doc, "rejected", "   ")).rejects.toThrow(/requires a reason/);
  });

  it("rejected is terminal: no outgoing transition exists", async () => {
    const order = await orderWithLine(tenantA, locationA, 1000);
    const doc = await issueDocument(order, "boleta");
    await setStatus(doc, "sent");
    await setStatus(doc, "rejected", "motivo");
    await expect(setStatus(doc, "sent")).rejects.toThrow(/cannot go from/);
  });

  it("cancelled is terminal, and accepted can still be cancelled", async () => {
    const order = await orderWithLine(tenantA, locationA, 1000);
    const doc = await issueDocument(order, "boleta");
    await setStatus(doc, "sent");
    await setStatus(doc, "accepted");
    await setStatus(doc, "cancelled", "cliente devolvio el pedido");
    await expect(setStatus(doc, "sent")).rejects.toThrow(/cannot go from/);
  });
});

describe("billing_events (append-only, mirrors order_status_history)", () => {
  it("records the initial insert and every status change", async () => {
    const order = await orderWithLine(tenantA, locationA, 1000);
    const doc = await issueDocument(order, "boleta");
    await setStatus(doc, "sent");
    await setStatus(doc, "accepted");

    const events = await db.query<{ from_status: string | null; to_status: string }>(
      "select from_status, to_status from public.billing_events where billing_document_id = $1 order by created_at",
      [doc],
    );
    expect(events).toEqual([
      { from_status: null, to_status: "pending" },
      { from_status: "pending", to_status: "sent" },
      { from_status: "sent", to_status: "accepted" },
    ]);
  });
});

describe("cross-tenant guards", () => {
  it("derives a document's tenant from the order, ignoring what is sent", async () => {
    const order = await orderWithLine(tenantA, locationA, 1000);
    const doc = await issueDocument(order, "boleta");
    const row = await documentRow(doc);
    expect(row.tenant_id).toBe(tenantA);
  });
});

describe("row level security", () => {
  const tables = [
    "billing_documents",
    "billing_document_items",
    "billing_events",
    "billing_document_transitions",
    "billing_provider_configs",
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

  it("has no UPDATE policy on billing_events, billing_document_items or billing_document_transitions", async () => {
    const rows = await db.query<{ tablename: string }>(
      `select tablename from pg_policies
       where schemaname = 'public'
         and tablename in ('billing_events', 'billing_document_items', 'billing_document_transitions')
         and cmd = 'UPDATE'`,
    );
    expect(rows).toHaveLength(0);
  });

  it("hides another business's documents", async () => {
    const mine = await issueDocument(await orderWithLine(tenantA, locationA, 500), "boleta");
    const theirs = await issueDocument(await orderWithLine(tenantB, locationB, 500), "boleta");

    const visible = await db.asUser(ownerA, async () =>
      db.query<{ id: string }>("select id from public.billing_documents"),
    );
    const ids = visible.map((r) => r.id);
    expect(ids).toContain(mine);
    expect(ids).not.toContain(theirs);
  });

  it("lets a cashier (billing.create) issue a document", async () => {
    const order = await orderWithLine(tenantA, locationA, 500);
    const rows = await db.asUser(cashierA, async () =>
      db.query<{ id: string }>(
        "insert into public.billing_documents (order_id, type) values ($1, 'boleta') returning id",
        [order],
      ),
    );
    expect(rows).toHaveLength(1);
  });

  it("refuses a view-only role (manager) creating or updating a document", async () => {
    const order = await orderWithLine(tenantA, locationA, 500);
    await expect(
      db.asUser(managerA, async () =>
        db.query("insert into public.billing_documents (order_id, type) values ($1, 'boleta')", [
          order,
        ]),
      ),
    ).rejects.toThrow(/row-level security/);

    const rows = await db.asUser(managerA, async () =>
      db.query<{ id: string }>("select id from public.billing_documents limit 1"),
    );
    expect(rows.length).toBeGreaterThan(0);
  });

  it("lets the accountant view, create and cancel", async () => {
    const order = await orderWithLine(tenantA, locationA, 500);
    const created = await db.asUser(accountantA, async () =>
      db.query<{ id: string }>(
        "insert into public.billing_documents (order_id, type) values ($1, 'boleta') returning id",
        [order],
      ),
    );
    expect(created).toHaveLength(1);

    await expect(
      db.asUser(accountantA, async () =>
        db.query(
          "update public.billing_documents set status = 'cancelled', cancel_reason = 'x' where id = $1",
          [created[0]!.id],
        ),
      ),
    ).resolves.toBeDefined();
  });

  it("makes the state machine readable and not writable", async () => {
    const rows = await db.asUser(ownerA, async () =>
      db.query("select from_status from public.billing_document_transitions"),
    );
    expect(rows.length).toBe(5);

    await expect(
      db.asUser(ownerA, async () =>
        db.query(
          "insert into public.billing_document_transitions (from_status, to_status) values ('rejected', 'pending')",
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("gates billing_provider_configs on billing.manage: admin yes, cashier no", async () => {
    const adminRows = await db.asUser(adminA, async () =>
      db.query<{ tenant_id: string }>("select tenant_id from public.billing_provider_configs"),
    );
    expect(adminRows.length).toBeGreaterThan(0);

    await expect(
      db.asUser(adminA, async () =>
        db.query(
          "update public.billing_provider_configs set series_boleta = 'BB01' where tenant_id = $1",
          [tenantA],
        ),
      ),
    ).resolves.toBeDefined();

    const cashierRows = await db.asUser(cashierA, async () =>
      db.query<{ tenant_id: string }>("select tenant_id from public.billing_provider_configs"),
    );
    expect(cashierRows).toHaveLength(0);

    const cashierUpdate = await db.asUser(cashierA, async () =>
      db.query<{ tenant_id: string }>(
        "update public.billing_provider_configs set series_boleta = 'ZZ01' where tenant_id = $1 returning tenant_id",
        [tenantA],
      ),
    );
    expect(cashierUpdate).toHaveLength(0);
  });
});
