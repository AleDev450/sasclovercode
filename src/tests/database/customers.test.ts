import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, insertTenant, type TestDatabase } from "../helpers/database";

/**
 * Phase 12 at the database level.
 *
 * Two properties carry this file, and both are about something NOT existing:
 *
 *   TEST-1210  no policy on either table grants `anon`
 *   TEST-1216  no policy allows deleting a customer
 *
 * Both are asserted against `pg_policies` rather than by running a query that
 * comes back empty. A query proves the situation today; reading the catalogue
 * proves the rule. Phases 10 and 11 both end with a public policy, so the
 * failure mode here is somebody adding one by analogy - and a query-shaped test
 * would keep passing until the day the data happened to be visible.
 */

let db: TestDatabase;

let tenantA: string;
let tenantB: string;

let ownerA: string;
let waiterA: string;
let kitchenA: string;
let ownerB: string;

let customerA: string;
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

async function insertCustomer(
  tenantId: string,
  name: string,
  options: {
    docType?: string | null;
    docNumber?: string | null;
    email?: string | null;
    phone?: string | null;
    isActive?: boolean;
  } = {},
): Promise<string> {
  const rows = await db.query<{ id: string }>(
    `insert into public.customers (tenant_id, name, doc_type, doc_number, email, phone, is_active)
     values ($1, $2, $3::public.customer_doc_type, $4, $5, $6, coalesce($7::boolean, true))
     returning id`,
    [
      tenantId,
      name,
      options.docType ?? null,
      options.docNumber ?? null,
      options.email ?? null,
      options.phone ?? null,
      options.isActive ?? null,
    ],
  );
  return rows[0]!.id;
}

beforeAll(async () => {
  db = await createTestDatabase();

  tenantA = await insertTenant(db, { slug: "sugurolls", name: "Sugu Rolls" });
  tenantB = await insertTenant(db, { slug: "polleria-el-rey", name: "Pollería El Rey" });

  ownerA = await createUser("owner@sugurolls.com");
  waiterA = await createUser("mozo@sugurolls.com");
  kitchenA = await createUser("cocina@sugurolls.com");
  ownerB = await createUser("owner@polleria.pe");

  await addMember(tenantA, ownerA, "owner");
  await addMember(tenantA, waiterA, "waiter");
  await addMember(tenantA, kitchenA, "kitchen");
  await addMember(tenantB, ownerB, "owner");

  customerA = await insertCustomer(tenantA, "Ana Quispe", {
    docType: "dni",
    docNumber: "45678912",
    phone: "987654321",
  });
  customerB = await insertCustomer(tenantB, "Carlos Rojas", {
    docType: "dni",
    docNumber: "10203040",
  });
});

afterAll(async () => {
  await db.close();
});

describe("the absence of a public policy (TEST-1210, TEST-1216)", () => {
  /*
   * The decision this phase is built around. See section 11 of the SPEC.
   */
  it("grants nothing to anon on either table (TEST-1210)", async () => {
    const rows = await db.query<{ tablename: string; policyname: string; roles: string }>(
      `select tablename, policyname, roles::text as roles
       from pg_policies
       where schemaname = 'public'
         and tablename in ('customers', 'customer_addresses')`,
    );

    expect(rows.length).toBeGreaterThan(0);

    for (const row of rows) {
      expect(
        row.roles.includes("anon"),
        `${row.tablename}.${row.policyname} grants anon: ${row.roles}`,
      ).toBe(false);
    }
  });

  it("really returns nothing to an anonymous reader", async () => {
    const rows = await db.asRole("anon", async () => db.query("select id from public.customers"));
    expect(rows).toHaveLength(0);
  });

  it("has no DELETE policy on customers (TEST-1216)", async () => {
    const rows = await db.query<{ policyname: string }>(
      `select policyname from pg_policies
       where schemaname = 'public' and tablename = 'customers' and cmd = 'DELETE'`,
    );
    expect(rows).toHaveLength(0);
  });

  it("does allow deleting an address, which is not history", async () => {
    const rows = await db.query<{ policyname: string }>(
      `select policyname from pg_policies
       where schemaname = 'public' and tablename = 'customer_addresses' and cmd = 'DELETE'`,
    );
    expect(rows).toHaveLength(1);
  });
});

describe("tenant-scoped identity (TEST-1218, TEST-1219)", () => {
  /*
   * Master section 11, in the place where a global constraint would do the most
   * damage: it would make the same person a customer of exactly one business on
   * the whole platform.
   */
  it("lets the same DNI belong to two different businesses (TEST-1218)", async () => {
    await expect(
      insertCustomer(tenantB, "Ana Quispe", { docType: "dni", docNumber: "45678912" }),
    ).resolves.toBeDefined();
  });

  it("refuses the same DNI twice inside one business (TEST-1218)", async () => {
    await expect(
      insertCustomer(tenantA, "Ana Quispe otra vez", { docType: "dni", docNumber: "45678912" }),
    ).rejects.toThrow(/customers_tenant_document_key/);
  });

  it("distinguishes the same number under different document types", async () => {
    // 45678912 is already a DNI of tenant A. As a CE it is a different document.
    await expect(
      insertCustomer(tenantA, "Homonimo con carne", { docType: "ce", docNumber: "45678912" }),
    ).resolves.toBeDefined();
  });

  it("allows any number of customers with no document at all (TEST-1219)", async () => {
    await expect(insertCustomer(tenantA, "Cliente de paso 1")).resolves.toBeDefined();
    await expect(insertCustomer(tenantA, "Cliente de paso 2")).resolves.toBeDefined();
  });

  it("has no globally unique index on either table", async () => {
    const rows = await db.query<{ indexname: string; indexdef: string }>(
      `select indexname, indexdef from pg_indexes
       where schemaname = 'public'
         and tablename in ('customers', 'customer_addresses')
         and indexdef like 'CREATE UNIQUE%'`,
    );

    expect(rows.length).toBeGreaterThan(0);

    for (const row of rows) {
      if (row.indexname.endsWith("_pkey")) continue;
      const scoped = row.indexdef.includes("tenant_id") || row.indexdef.includes("customer_id");
      expect(scoped, `${row.indexname} is not scoped: ${row.indexdef}`).toBe(true);
    }
  });
});

describe("document validation in the database (TEST-1220)", () => {
  it("refuses a DNI that is not eight digits", async () => {
    for (const bad of ["1234567", "123456789", "1234567a"]) {
      await expect(
        insertCustomer(tenantA, `dni-${bad}`, { docType: "dni", docNumber: bad }),
      ).rejects.toThrow(/customers_document_format/);
    }
  });

  it("accepts real RUCs, check digit included (TEST-1203)", async () => {
    // SUNAT's own RUC and Banco de Crédito's.
    for (const ruc of ["20131312955", "20100047218"]) {
      await expect(
        insertCustomer(tenantA, `empresa-${ruc}`, { docType: "ruc", docNumber: ruc }),
      ).resolves.toBeDefined();
    }
  });

  /*
   * TEST-1220 - the reason `is_valid_ruc` is in SQL and not only in Zod.
   *
   * This insert never goes through the form. It is what a second writer looks
   * like, and Phase 13 will be one.
   */
  it("refuses a RUC whose check digit does not add up (TEST-1220)", async () => {
    await expect(
      insertCustomer(tenantA, "ruc-malo", { docType: "ruc", docNumber: "20131312954" }),
    ).rejects.toThrow(/customers_document_format/);
  });

  it("refuses a RUC with an impossible prefix (TEST-1205)", async () => {
    await expect(
      insertCustomer(tenantA, "ruc-prefijo", { docType: "ruc", docNumber: "12345678901" }),
    ).rejects.toThrow(/customers_document_format/);
  });

  it("refuses a document type without a number, and the reverse", async () => {
    await expect(insertCustomer(tenantA, "medio-documento", { docType: "dni" })).rejects.toThrow(
      /customers_document_complete/,
    );

    await expect(
      insertCustomer(tenantA, "numero-suelto", { docNumber: "45678912" }),
    ).rejects.toThrow(/customers_document_complete/);
  });

  it("refuses a malformed email and a malformed phone", async () => {
    await expect(
      insertCustomer(tenantA, "email-malo", { email: "no-es-un-email" }),
    ).rejects.toThrow(/customers_email_format/);

    await expect(insertCustomer(tenantA, "tel-malo", { phone: "987 654 321" })).rejects.toThrow(
      /customers_phone_format/,
    );
  });

  it("scopes email uniqueness to the tenant, case-insensitively (TEST-1221)", async () => {
    await insertCustomer(tenantA, "Correo uno", { email: "ana@example.pe" });

    await expect(
      insertCustomer(tenantA, "Correo dos", { email: "ANA@example.pe" }),
    ).rejects.toThrow(/customers_tenant_email_key/);

    await expect(
      insertCustomer(tenantB, "Correo en otro negocio", { email: "ana@example.pe" }),
    ).resolves.toBeDefined();
  });
});

describe("row level security (TEST-1211 to TEST-1215)", () => {
  it("lets a member read the customers of their business (TEST-1211)", async () => {
    const rows = await db.asUser(ownerA, async () =>
      db.query<{ id: string }>("select id from public.customers"),
    );
    expect(rows.map((r) => r.id)).toContain(customerA);
  });

  it("hides another business's customers entirely (TEST-1212)", async () => {
    const rows = await db.asUser(ownerA, async () =>
      db.query<{ id: string }>("select id from public.customers where id = $1", [customerB]),
    );
    expect(rows).toHaveLength(0);
  });

  it("shows nothing to a role without customers.view (TEST-1213)", async () => {
    const rows = await db.asUser(kitchenA, async () => db.query("select id from public.customers"));
    expect(rows).toHaveLength(0);
  });

  it("lets a waiter read but not write (TEST-1214)", async () => {
    const rows = await db.asUser(waiterA, async () =>
      db.query<{ id: string }>("select id from public.customers where id = $1", [customerA]),
    );
    expect(rows).toHaveLength(1);

    await expect(
      db.asUser(waiterA, async () =>
        db.query("insert into public.customers (tenant_id, name) values ($1, $2)", [
          tenantA,
          "No deberia entrar",
        ]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("refuses an insert that declares another tenant (TEST-1215)", async () => {
    await expect(
      db.asUser(ownerA, async () =>
        db.query("insert into public.customers (tenant_id, name) values ($1, $2)", [
          tenantB,
          "Infiltrado",
        ]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("refuses to update a customer of another business", async () => {
    const rows = await db.asUser(ownerA, async () =>
      db.query("update public.customers set name = 'Cambiado' where id = $1 returning id", [
        customerB,
      ]),
    );
    expect(rows).toHaveLength(0);
  });
});

describe("addresses (TEST-1217, TEST-1222)", () => {
  it("derives tenant_id from the customer and ignores what the client sends (TEST-1217)", async () => {
    const rows = await db.query<{ tenant_id: string }>(
      `insert into public.customer_addresses (customer_id, tenant_id, label, address_line)
       values ($1, $2, 'Casa', 'Av. Arequipa 123')
       returning tenant_id`,
      // Deliberately the WRONG tenant: exactly what an attacker would supply.
      [customerA, tenantB],
    );
    expect(rows[0]?.tenant_id).toBe(tenantA);
  });

  it("refuses an address for a customer that does not exist", async () => {
    await expect(
      db.query(
        `insert into public.customer_addresses (customer_id, tenant_id, label, address_line)
         values (gen_random_uuid(), $1, 'Casa', 'Calle Falsa 123')`,
        [tenantA],
      ),
    ).rejects.toThrow(/Customer not found/);
  });

  it("allows at most one default address per customer (TEST-1222)", async () => {
    const customer = await insertCustomer(tenantA, "Con dos casas");

    await db.query(
      `insert into public.customer_addresses (customer_id, tenant_id, label, address_line, is_default)
       values ($1, $2, 'Casa', 'Av. Uno 1', true)`,
      [customer, tenantA],
    );

    await expect(
      db.query(
        `insert into public.customer_addresses (customer_id, tenant_id, label, address_line, is_default)
         values ($1, $2, 'Oficina', 'Av. Dos 2', true)`,
        [customer, tenantA],
      ),
    ).rejects.toThrow(/customer_addresses_one_default_per_customer/);

    // Non-default ones are unlimited.
    await expect(
      db.query(
        `insert into public.customer_addresses (customer_id, tenant_id, label, address_line)
         values ($1, $2, 'Oficina', 'Av. Dos 2')`,
        [customer, tenantA],
      ),
    ).resolves.toBeDefined();
  });

  it("hides another business's addresses", async () => {
    await db.query(
      `insert into public.customer_addresses (customer_id, tenant_id, label, address_line)
       values ($1, $2, 'Casa', 'Jr. Union 500')`,
      [customerB, tenantB],
    );

    const rows = await db.asUser(ownerA, async () =>
      db.query("select id from public.customer_addresses where customer_id = $1", [customerB]),
    );
    expect(rows).toHaveLength(0);
  });
});

describe("lifecycle (TEST-1223)", () => {
  it("deactivates rather than deletes", async () => {
    const customer = await insertCustomer(tenantA, "Se va");
    await db.query("update public.customers set is_active = false where id = $1", [customer]);

    const rows = await db.query<{ is_active: boolean }>(
      "select is_active from public.customers where id = $1",
      [customer],
    );
    expect(rows[0]?.is_active).toBe(false);
  });

  it("removes customers and addresses when the tenant goes (TEST-1223)", async () => {
    const tenant = await insertTenant(db, { slug: "efimero", name: "Efímero" });
    const customer = await insertCustomer(tenant, "Cliente efímero");
    await db.query(
      `insert into public.customer_addresses (customer_id, tenant_id, label, address_line)
       values ($1, $2, 'Casa', 'Calle Corta 1')`,
      [customer, tenant],
    );

    await db.query("delete from public.tenants where id = $1", [tenant]);

    const customers = await db.query("select id from public.customers where tenant_id = $1", [
      tenant,
    ]);
    const addresses = await db.query(
      "select id from public.customer_addresses where tenant_id = $1",
      [tenant],
    );
    expect(customers).toHaveLength(0);
    expect(addresses).toHaveLength(0);
  });
});
