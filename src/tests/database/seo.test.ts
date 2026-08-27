import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, insertTenant, type TestDatabase } from "../helpers/database";

/**
 * Phase 08 at the database level.
 *
 * Two things are being checked here and they pull in opposite directions, which
 * is why both need saying out loud:
 *
 *   what a public site MUST expose  - the theme, the trade name, the images,
 *                                     the SEO row; without these an anonymous
 *                                     visitor sees a broken generic page
 *
 *   what it must NEVER expose       - the RUC, the legal name, the contact
 *                                     email, the private documents
 *
 * Phase 07 got the first half wrong in a way that only showed up for signed-out
 * visitors (A7-1). The tests below therefore exercise all three readers -
 * anonymous, signed-in stranger, member - rather than assuming that one stands
 * in for the others.
 */

let db: TestDatabase;

let tenantA: string;
let tenantB: string;
let suspended: string;

let ownerA: string;
let cashierA: string;
let strangerId: string;

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

beforeAll(async () => {
  db = await createTestDatabase();

  tenantA = await insertTenant(db, { slug: "sugurolls", name: "Sugu Rolls" });
  tenantB = await insertTenant(db, { slug: "polleria-el-rey", name: "Pollería El Rey" });
  suspended = await insertTenant(db, { slug: "en-pausa", name: "En Pausa", status: "suspended" });

  ownerA = await createUser("owner@sugurolls.com");
  cashierA = await createUser("cashier@sugurolls.com");
  strangerId = await createUser("nadie@example.com");

  await addMember(tenantA, ownerA, "owner");
  await addMember(tenantA, cashierA, "cashier");
  // `strangerId` is deliberately a member of nothing: a person with a
  // CloverCode session who is browsing somebody else's restaurant.
});

afterAll(async () => {
  await db.close();
});

describe("tenant_seo schema (TEST-801 to TEST-806)", () => {
  it("has the tenant as its primary key (TEST-801)", async () => {
    const rows = await db.query<{ attname: string }>(
      `select a.attname
       from pg_index i
       join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
       where i.indrelid = 'public.tenant_seo'::regclass and i.indisprimary`,
    );
    expect(rows.map((r) => r.attname)).toEqual(["tenant_id"]);
  });

  it("defaults robots_index to true (TEST-802)", async () => {
    const rows = await db.query<{ robots_index: boolean }>(
      "select robots_index from public.tenant_seo where tenant_id = $1",
      [tenantA],
    );
    expect(rows[0]?.robots_index).toBe(true);
  });

  it("rejects an image path belonging to ANOTHER tenant (TEST-803)", async () => {
    await expect(
      db.query("update public.tenant_seo set og_image_path = $1 where tenant_id = $2", [
        `tenants/${tenantB}/branding/logo.png`,
        tenantA,
      ]),
    ).rejects.toThrow(/tenant_seo_image_paths_own_tenant/);
  });

  it("accepts an image path in its own folder", async () => {
    await expect(
      db.query("update public.tenant_seo set og_image_path = $1 where tenant_id = $2", [
        `tenants/${tenantA}/branding/logo.png`,
        tenantA,
      ]),
    ).resolves.toBeDefined();
  });

  it("rejects a google verification code that could close its own tag", async () => {
    await expect(
      db.query("update public.tenant_seo set google_verification = $1 where tenant_id = $2", [
        '"><script>alert(1)</script>',
        tenantA,
      ]),
    ).rejects.toThrow(/tenant_seo_google_verification_format/);
  });

  it("rejects a title longer than the column allows", async () => {
    await expect(
      db.query("update public.tenant_seo set site_title = $1 where tenant_id = $2", [
        "x".repeat(121),
        tenantA,
      ]),
    ).rejects.toThrow(/tenant_seo_text_lengths/);
  });

  it("gives pages the three SEO columns, all null by default (TEST-804)", async () => {
    const rows = await db.query<{
      seo_title: string | null;
      seo_description: string | null;
      og_image_path: string | null;
    }>(
      `insert into public.pages (tenant_id, slug, title)
       values ($1, 'columnas', 'Columnas')
       returning seo_title, seo_description, og_image_path`,
      [tenantA],
    );
    expect(rows[0]).toEqual({ seo_title: null, seo_description: null, og_image_path: null });
  });

  it("rejects a page image path belonging to another tenant", async () => {
    await expect(
      db.query(
        `insert into public.pages (tenant_id, slug, title, og_image_path)
         values ($1, 'ajena', 'Ajena', $2)`,
        [tenantA, `tenants/${tenantB}/banners/promo.png`],
      ),
    ).rejects.toThrow(/pages_og_image_path_own_tenant/);
  });

  it("creates the SEO row together with the tenant (TEST-805)", async () => {
    const fresh = await insertTenant(db, { slug: "recien-creada", name: "Recien Creada" });
    const rows = await db.query("select tenant_id from public.tenant_seo where tenant_id = $1", [
      fresh,
    ]);
    expect(rows).toHaveLength(1);
  });

  it("removes the SEO row with its tenant (TEST-806)", async () => {
    const doomed = await insertTenant(db, { slug: "efimera", name: "Efimera" });
    await db.query("delete from public.tenants where id = $1", [doomed]);
    const rows = await db.query("select tenant_id from public.tenant_seo where tenant_id = $1", [
      doomed,
    ]);
    expect(rows).toHaveLength(0);
  });
});

describe("tenant_seo RLS (TEST-807 to TEST-811)", () => {
  it("lets an anonymous visitor read an active tenant's SEO (TEST-807)", async () => {
    const rows = await db.asRole("anon", () =>
      db.query("select tenant_id from public.tenant_seo where tenant_id = $1", [tenantA]),
    );
    expect(rows).toHaveLength(1);
  });

  /*
   * The lesson of A7-1, applied before it can happen again.
   *
   * A visitor who is signed in to CloverCode - to their OWN business - is
   * `authenticated`, not `anon`. If the public policy named only `anon` they
   * would match no policy at all on a stranger's site, and the page would
   * render without its title, its description or its theme. That failure is
   * invisible in a private window, which is how it survived a whole phase.
   */
  it("lets a SIGNED-IN stranger read it too (TEST-808)", async () => {
    const rows = await db.asUser(strangerId, () =>
      db.query("select tenant_id from public.tenant_seo where tenant_id = $1", [tenantA]),
    );
    expect(rows).toHaveLength(1);
  });

  it("hides a suspended tenant's SEO from the public (TEST-809)", async () => {
    for (const reader of ["anon" as const, strangerId]) {
      const rows =
        reader === "anon"
          ? await db.asRole("anon", () =>
              db.query("select tenant_id from public.tenant_seo where tenant_id = $1", [suspended]),
            )
          : await db.asUser(reader, () =>
              db.query("select tenant_id from public.tenant_seo where tenant_id = $1", [suspended]),
            );
      expect(rows, String(reader)).toHaveLength(0);
    }
  });

  it("still shows a suspended business its own SEO, so it can fix it", async () => {
    const ownerS = await createUser("owner@enpausa.pe");
    await addMember(suspended, ownerS, "owner");
    const rows = await db.asUser(ownerS, () =>
      db.query("select tenant_id from public.tenant_seo where tenant_id = $1", [suspended]),
    );
    expect(rows).toHaveLength(1);
  });

  it("refuses a write without content.manage (TEST-810)", async () => {
    await db.asUser(cashierA, () =>
      db.query("update public.tenant_seo set site_title = 'Hackeado' where tenant_id = $1", [
        tenantA,
      ]),
    );
    const rows = await db.query<{ site_title: string | null }>(
      "select site_title from public.tenant_seo where tenant_id = $1",
      [tenantA],
    );
    expect(rows[0]?.site_title).not.toBe("Hackeado");
  });

  it("lets content.manage write its own SEO", async () => {
    await db.asUser(ownerA, () =>
      db.query(
        "update public.tenant_seo set site_title = 'Sugu Rolls Miraflores' where tenant_id = $1",
        [tenantA],
      ),
    );
    const rows = await db.query<{ site_title: string | null }>(
      "select site_title from public.tenant_seo where tenant_id = $1",
      [tenantA],
    );
    expect(rows[0]?.site_title).toBe("Sugu Rolls Miraflores");
  });

  it("does NOT let an owner write another tenant's SEO", async () => {
    await db.asUser(ownerA, () =>
      db.query("update public.tenant_seo set site_title = 'Robado' where tenant_id = $1", [
        tenantB,
      ]),
    );
    const rows = await db.query<{ site_title: string | null }>(
      "select site_title from public.tenant_seo where tenant_id = $1",
      [tenantB],
    );
    expect(rows[0]?.site_title).toBeNull();
  });

  /*
   * The lesson of A6-1.
   *
   * The row is an invariant created by a trigger, and the dashboard reads it
   * without a fallback. A DELETE policy would let a business destroy the row
   * and break its own screen with no way to recreate it; an INSERT policy would
   * let it create a second one for a tenant it does not own if the primary key
   * ever stopped being the tenant.
   */
  it("has no INSERT and no DELETE policy at all (TEST-811)", async () => {
    const rows = await db.query<{ cmd: string }>(
      "select cmd from pg_policies where schemaname = 'public' and tablename = 'tenant_seo'",
    );
    const commands = rows.map((r) => r.cmd).sort();
    expect(commands).toEqual(["SELECT", "SELECT", "UPDATE"]);
  });
});

describe("what a public website needs to render itself", () => {
  it("lets both anonymous and signed-in readers see the theme", async () => {
    const anonRows = await db.asRole("anon", () =>
      db.query("select primary_color from public.tenant_themes where tenant_id = $1", [tenantA]),
    );
    const strangerRows = await db.asUser(strangerId, () =>
      db.query("select primary_color from public.tenant_themes where tenant_id = $1", [tenantA]),
    );
    expect(anonRows).toHaveLength(1);
    expect(strangerRows).toHaveLength(1);
  });

  it("does not leak the theme of a suspended business", async () => {
    const rows = await db.asRole("anon", () =>
      db.query("select primary_color from public.tenant_themes where tenant_id = $1", [suspended]),
    );
    expect(rows).toHaveLength(0);
  });

  it("returns the trade name through the narrow identity function", async () => {
    await db.query("update public.tenant_settings set trade_name = $1 where tenant_id = $2", [
      "Sugu Rolls",
      tenantA,
    ]);
    const rows = await db.asRole("anon", () =>
      db.query<{ trade_name: string }>(
        "select trade_name from public.get_public_business_identity($1)",
        [tenantA],
      ),
    );
    expect(rows[0]?.trade_name).toBe("Sugu Rolls");
  });

  /*
   * The reason `tenant_settings` has no public policy.
   *
   * RLS is row-level: a policy that published the trade name would publish the
   * RUC sitting in the same row. The function exists to return one and not the
   * other, and this asserts the columns it does NOT have.
   */
  it("never exposes the RUC, the legal name or the contact email", async () => {
    await db.query(
      `update public.tenant_settings
       set tax_id = '20512345678', legal_name = 'Sugu SAC', contact_email = 'admin@sugurolls.com'
       where tenant_id = $1`,
      [tenantA],
    );

    const columns = await db.query<{ attname: string }>(
      `select a.attname
       from pg_proc p
       join pg_type t on t.oid = p.prorettype
       join pg_attribute a on a.attrelid = t.typrelid
       where p.proname = 'get_public_business_identity' and a.attnum > 0`,
    );
    const names = columns.map((c) => c.attname);
    expect(names).not.toContain("tax_id");
    expect(names).not.toContain("legal_name");
    expect(names).not.toContain("contact_email");

    const direct = await db.asRole("anon", () =>
      db.query("select tax_id from public.tenant_settings where tenant_id = $1", [tenantA]),
    );
    expect(direct).toHaveLength(0);
  });

  it("returns nothing for a suspended business", async () => {
    const rows = await db.asRole("anon", () =>
      db.query("select trade_name from public.get_public_business_identity($1)", [suspended]),
    );
    expect(rows).toHaveLength(0);
  });

  it("resolves the primary domain for the canonical URL", async () => {
    await db.query(
      `insert into public.tenant_domains
         (tenant_id, domain, type, is_primary, verification_status, verified_at,
          verification_token)
       values ($1, 'sugurolls.com', 'custom', true, 'active', now(),
               public.new_domain_verification_token()),
              ($1, 'sugurolls.clovercodeapp.com', 'system', false, 'active', now(), null)`,
      [tenantA],
    );
    const rows = await db.asRole("anon", () =>
      db.query<{ d: string | null }>("select public.get_tenant_primary_domain($1) d", [tenantA]),
    );
    expect(rows[0]?.d).toBe("sugurolls.com");
  });

  it("returns null when a tenant has no verified domain", async () => {
    const rows = await db.asRole("anon", () =>
      db.query<{ d: string | null }>("select public.get_tenant_primary_domain($1) d", [tenantB]),
    );
    expect(rows[0]?.d).toBeNull();
  });
});

/**
 * The Phase 07 defect this phase had to fix.
 *
 * The bucket is private and Phase 06 gave it one read policy, for members. The
 * public site then rendered images from it as the VISITOR, who is anonymous -
 * so every logo, banner and product photo silently failed to sign. It looked
 * perfect to anyone testing while signed in to the business.
 */
describe("public assets", () => {
  beforeAll(async () => {
    for (const [tenant, folder, file] of [
      [tenantA, "branding", "logo.png"],
      [tenantA, "banners", "promo.png"],
      [tenantA, "products", "maki.png"],
      [tenantA, "documents", "contrato.pdf"],
      [suspended, "branding", "logo.png"],
    ] as const) {
      await db.query("insert into storage.objects (bucket_id, name) values ('tenant-assets', $1)", [
        `tenants/${tenant}/${folder}/${file}`,
      ]);
    }
  });

  it("lets an anonymous visitor read the images a public site shows", async () => {
    const rows = await db.asRole("anon", () =>
      db.query<{ name: string }>("select name from storage.objects order by name"),
    );
    const folders = rows.map((r) => r.name.split("/")[2]);
    expect(folders).toContain("branding");
    expect(folders).toContain("banners");
    expect(folders).toContain("products");
  });

  it("never exposes the documents folder to a visitor", async () => {
    const rows = await db.asRole("anon", () =>
      db.query<{ name: string }>("select name from storage.objects"),
    );
    expect(rows.some((r) => r.name.includes("/documents/"))).toBe(false);
  });

  it("does not expose the assets of a suspended business", async () => {
    const rows = await db.asRole("anon", () =>
      db.query<{ name: string }>("select name from storage.objects"),
    );
    expect(rows.some((r) => r.name.includes(suspended))).toBe(false);
  });

  it("does not let a visitor write anything", async () => {
    await expect(
      db.asRole("anon", () =>
        db.query("insert into storage.objects (bucket_id, name) values ('tenant-assets', $1)", [
          `tenants/${tenantA}/branding/hacked.png`,
        ]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("reads the folder out of the path the way the real service splits it", async () => {
    const rows = await db.query<{ f: string | null }>("select public.storage_path_folder($1) f", [
      `tenants/${tenantA}/branding/logo.png`,
    ]);
    expect(rows[0]?.f).toBe("branding");
  });
});
