import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, insertTenant, type TestDatabase } from "../helpers/database";

/**
 * Phase 30 at the database level.
 *
 * - Anybody can file a sheet in the Libro de Reclamaciones, and nobody can read
 *   one without `complaints.view` in that business.
 * - A filed sheet cannot be edited or deleted; only its answer can be written.
 * - The correlative is per business and the deadline is 15 business days.
 * - Legal texts are readable publicly for an active business only.
 */

let db: TestDatabase;
let tenantA: string;
let tenantB: string;
let ownerA: string;
let waiterA: string;
let ownerB: string;

function sheet(overrides: Record<string, unknown> = {}) {
  return {
    consumerName: "Rosa Quispe",
    consumerAddress: "Av. Brasil 123, Pueblo Libre",
    documentType: "dni",
    documentNumber: "4567 8901",
    consumerEmail: "Rosa@Correo.pe",
    consumerPhone: "+51 999 888 777",
    itemType: "producto",
    amountCents: 4500,
    itemDescription: "Pedido de makis",
    type: "reclamo",
    detail: "Llego frio.",
    consumerRequest: "Que me devuelvan el dinero.",
    ...overrides,
  };
}

async function file(tenantId: string, data: unknown) {
  return db.asRole("anon", () =>
    db.query<{ complaint_number: number; filed_at: string; due_on: string }>(
      "select * from public.submit_complaint($1, $2::jsonb)",
      [tenantId, JSON.stringify(data)],
    ),
  );
}

async function refusal(tenantId: string, data: unknown): Promise<string | null> {
  try {
    await file(tenantId, data);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

async function createUser(email: string): Promise<string> {
  const rows = await db.query<{ id: string }>(
    "insert into auth.users (email) values ($1) returning id",
    [email],
  );
  return rows[0]!.id;
}

beforeAll(async () => {
  db = await createTestDatabase();
  tenantA = await insertTenant(db, { slug: "libro-a", name: "Libro A" });
  tenantB = await insertTenant(db, { slug: "libro-b", name: "Libro B" });

  await db.query(
    `update public.tenant_settings set legal_name = 'INVERSIONES SUGU S.A.C.',
       tax_id = '20608920961', address_line = 'Jr. Fernandini 1195', district = 'Pueblo Libre'
     where tenant_id = $1`,
    [tenantA],
  );

  ownerA = await createUser("owner@libro-a.test");
  waiterA = await createUser("waiter@libro-a.test");
  ownerB = await createUser("owner@libro-b.test");
  await db.query(
    `insert into public.tenant_members (tenant_id, user_id, role) values
       ($1, $2, 'owner'), ($1, $3, 'waiter'), ($4, $5, 'owner')`,
    [tenantA, ownerA, waiterA, tenantB, ownerB],
  );
});

afterAll(async () => {
  await db.close();
});

describe("filing a complaint", () => {
  it("lets an anonymous consumer file, and numbers sheets per business", async () => {
    const first = await file(tenantA, sheet());
    const second = await file(tenantA, sheet({ type: "queja" }));
    const other = await file(tenantB, sheet());

    expect(first[0]!.complaint_number).toBe(1);
    expect(second[0]!.complaint_number).toBe(2);
    expect(other[0]!.complaint_number).toBe(1);

    const rows = await db.query<{
      provider_name: string;
      provider_tax_id: string;
      document_type: string;
      document_number: string;
      consumer_email: string;
      consumer_phone: string;
      status: string;
    }>("select * from public.complaints where tenant_id = $1 and number = 1", [tenantA]);

    // The provider is copied from the settings; the consumer's data normalised.
    expect(rows[0]).toMatchObject({
      provider_name: "INVERSIONES SUGU S.A.C.",
      provider_tax_id: "20608920961",
      document_type: "DNI",
      document_number: "45678901",
      consumer_email: "rosa@correo.pe",
      consumer_phone: "+51999888777",
      status: "pending",
    });
  });

  it("sets the deadline 15 business days after filing", async () => {
    const rows = await db.query<{ due: string; weekday: number }>(
      `select public.complaint_due_date('2026-09-18 10:00:00-05'::timestamptz)::text as due,
              extract(isodow from public.complaint_due_date('2026-09-18 10:00:00-05'::timestamptz))::int as weekday`,
    );
    // Friday 18 Sep 2026 -> the count starts Monday 21 -> 15th business day is Friday 9 Oct.
    expect(rows[0]).toEqual({ due: "2026-10-09", weekday: 5 });
  });

  it("refuses an incomplete sheet, a minor without guardian, and a suspended business", async () => {
    expect(await refusal(tenantA, sheet({ detail: "  " }))).toBe("MISSING_FIELD");
    expect(await refusal(tenantA, sheet({ isMinor: true }))).toBe("INVALID_COMPLAINT");
    expect(await refusal(tenantA, sheet({ documentType: "LIBRETA" }))).toBe("INVALID_COMPLAINT");
    expect(await refusal(tenantA, sheet({ type: "sugerencia" }))).toBe("INVALID_COMPLAINT");
    expect(
      await refusal(tenantA, sheet({ isMinor: true, guardianName: "Luis Quispe" })),
    ).toBeNull();

    const suspended = await insertTenant(db, { slug: "libro-susp", status: "suspended" });
    expect(await refusal(suspended, sheet())).toBe("STORE_UNAVAILABLE");
  });
});

describe("reading and answering the book", () => {
  it("is invisible to anonymous callers, to other businesses and to a waiter", async () => {
    const anon = await db.asRole("anon", () => db.query("select 1 from public.complaints"));
    const waiter = await db.asUser(waiterA, () => db.query("select 1 from public.complaints"));
    const otherOwner = await db.asUser(ownerB, () =>
      db.query("select 1 from public.complaints where tenant_id = $1", [tenantA]),
    );
    const owner = await db.asUser(ownerA, () =>
      db.query("select 1 from public.complaints where tenant_id = $1", [tenantA]),
    );

    expect(anon).toEqual([]);
    expect(waiter).toEqual([]);
    expect(otherOwner).toEqual([]);
    expect(owner.length).toBeGreaterThan(0);
  });

  it("lets the owner answer, stamping who and when", async () => {
    await db.asUser(ownerA, () =>
      db.query(
        "update public.complaints set response = 'Le devolvimos el importe.' where tenant_id = $1 and number = 1",
        [tenantA],
      ),
    );

    const rows = await db.query<{ status: string; responded_by: string; responded_at: string }>(
      "select status, responded_by, responded_at from public.complaints where tenant_id = $1 and number = 1",
      [tenantA],
    );
    expect(rows[0]!.status).toBe("answered");
    expect(rows[0]!.responded_by).toBe(ownerA);
    expect(rows[0]!.responded_at).not.toBeNull();
  });

  it("refuses to rewrite what the consumer filed, even for the owner", async () => {
    await expect(
      db.asUser(ownerA, () =>
        db.query(
          "update public.complaints set detail = 'Todo estuvo bien.' where tenant_id = $1 and number = 2",
          [tenantA],
        ),
      ),
    ).rejects.toThrow(/cannot be altered/);
  });

  it("cannot be deleted by anyone through the API", async () => {
    const deleted = await db.asUser(ownerA, () =>
      db.query("delete from public.complaints where tenant_id = $1 returning id", [tenantA]),
    );
    expect(deleted).toEqual([]);
  });

  it("does not let an owner insert a sheet directly", async () => {
    await expect(
      db.asUser(ownerA, () =>
        db.query(
          `insert into public.complaints (tenant_id, number, provider_name, consumer_name, consumer_address,
             document_type, document_number, consumer_email, consumer_phone, item_type,
             item_description, type, detail, consumer_request, due_on)
           values ($1, 99, 'X', 'Y', 'Z', 'DNI', '12345678', 'a@b.pe', '999999999', 'producto',
             'x', 'reclamo', 'x', 'x', current_date)`,
          [tenantA],
        ),
      ),
    ).rejects.toThrow();
  });
});

describe("legal documents", () => {
  it("serves a business's own text publicly, and only while it is active", async () => {
    await db.query(
      "insert into public.tenant_legal_documents (tenant_id, kind, body) values ($1, 'terms', '### Hola')",
      [tenantA],
    );

    const visible = await db.asRole("anon", () =>
      db.query<{ body: string }>("select body from public.get_public_legal_document($1, 'terms')", [
        tenantA,
      ]),
    );
    expect(visible).toEqual([{ body: "### Hola" }]);

    const identity = await db.asRole("anon", () =>
      db.query<{ legal_name: string; tax_id: string }>(
        "select legal_name, tax_id from public.get_public_legal_identity($1)",
        [tenantA],
      ),
    );
    expect(identity).toEqual([{ legal_name: "INVERSIONES SUGU S.A.C.", tax_id: "20608920961" }]);

    await db.query("update public.tenants set status = 'suspended' where id = $1", [tenantA]);
    const hidden = await db.asRole("anon", () =>
      db.query("select body from public.get_public_legal_document($1, 'terms')", [tenantA]),
    );
    expect(hidden).toEqual([]);
    await db.query("update public.tenants set status = 'active' where id = $1", [tenantA]);
  });

  it("is written by content managers only", async () => {
    await expect(
      db.asUser(waiterA, () =>
        db.query(
          "insert into public.tenant_legal_documents (tenant_id, kind, body) values ($1, 'privacy', 'x')",
          [tenantA],
        ),
      ),
    ).rejects.toThrow();

    await db.asUser(ownerA, () =>
      db.query(
        "insert into public.tenant_legal_documents (tenant_id, kind, body) values ($1, 'privacy', 'Texto propio')",
        [tenantA],
      ),
    );
  });
});
