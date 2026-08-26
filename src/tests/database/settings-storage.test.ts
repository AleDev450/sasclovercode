import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, insertTenant, type TestDatabase } from "../helpers/database";

/**
 * Business settings, theme and — the new thing in Phase 06 — file isolation.
 *
 * The storage assertions are the ones that earn their keep: this is the first
 * phase where one business could reach another's *files*, and the guarantee is
 * a policy that reads the tenant out of the object path rather than trusting
 * the application to build that path correctly.
 */

let db: TestDatabase;

let tenantA: string;
let tenantB: string;
let ownerA: string;
let cashierA: string;
let ownerB: string;

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

/** Uploads as the given user, returning whether the policy allowed it. */
async function tryUpload(userId: string, path: string): Promise<boolean> {
  try {
    await db.asUser(userId, () =>
      db.query("insert into storage.objects (bucket_id, name) values ('tenant-assets', $1)", [
        path,
      ]),
    );
    return true;
  } catch {
    return false;
  }
}

beforeAll(async () => {
  db = await createTestDatabase();

  tenantA = await insertTenant(db, { slug: "sugurolls", name: "Sugu Rolls" });
  tenantB = await insertTenant(db, { slug: "polleria-el-rey", name: "Pollería El Rey" });

  ownerA = await createUser("owner@sugurolls.com");
  cashierA = await createUser("cashier@sugurolls.com");
  ownerB = await createUser("owner@polleria.pe");

  await addMember(tenantA, ownerA, "owner");
  await addMember(tenantA, cashierA, "cashier");
  await addMember(tenantB, ownerB, "owner");
});

afterAll(async () => {
  await db.close();
});

describe("schema and constraints (TEST-601 to TEST-607)", () => {
  it("creates one settings and one theme row per tenant, keyed by tenant", async () => {
    const rows = await db.query<{ column_name: string }>(
      `select column_name from information_schema.key_column_usage
       where table_name = 'tenant_settings' and constraint_name = 'tenant_settings_pkey'`,
    );
    expect(rows.map((r) => r.column_name)).toEqual(["tenant_id"]);
  });

  it.each([
    [
      "a RUC that is not 11 digits",
      "update public.tenant_settings set tax_id = '123' where tenant_id = $1",
      /tax_id_format/,
    ],
    [
      "a lowercase currency",
      "update public.tenant_settings set currency = 'pen' where tenant_id = $1",
      /currency_format/,
    ],
    [
      "a malformed email",
      "update public.tenant_settings set contact_email = 'nope' where tenant_id = $1",
      /contact_email_format/,
    ],
  ])("rejects %s", async (_label, sql, pattern) => {
    await db.query(
      "insert into public.tenant_settings (tenant_id) values ($1) on conflict do nothing",
      [tenantA],
    );
    await expect(db.query(sql, [tenantA])).rejects.toThrow(pattern);
  });

  it("accepts a valid RUC", async () => {
    await expect(
      db.query("update public.tenant_settings set tax_id = '20512345678' where tenant_id = $1", [
        tenantA,
      ]),
    ).resolves.toBeDefined();
  });

  it.each(["red", "#FFF", "#GGGGGG", "rgb(0,0,0)", "#FFFFFF"])(
    "rejects the colour %j",
    async (colour) => {
      await db.query(
        "insert into public.tenant_themes (tenant_id) values ($1) on conflict do nothing",
        [tenantA],
      );
      await expect(
        db.query("update public.tenant_themes set primary_color = $2 where tenant_id = $1", [
          tenantA,
          colour,
        ]),
      ).rejects.toThrow(/primary_color_format/);
    },
  );

  it("accepts a lowercase six-digit hex colour", async () => {
    await expect(
      db.query("update public.tenant_themes set primary_color = '#1a2b3c' where tenant_id = $1", [
        tenantA,
      ]),
    ).resolves.toBeDefined();
  });

  it("rejects a branding path that is not ours at all", async () => {
    await expect(
      db.query("update public.tenant_themes set logo_path = 'evil/logo.png' where tenant_id = $1", [
        tenantA,
      ]),
    ).rejects.toThrow(/paths_own_tenant/);
  });

  it("rejects a branding path pointing at ANOTHER tenant's folder", async () => {
    // The shape alone used to be enough, so a well-formed path into somebody
    // else's folder was storable. Unreadable, but it should not exist.
    await expect(
      db.query("update public.tenant_themes set logo_path = $2 where tenant_id = $1", [
        tenantA,
        `tenants/${tenantB}/branding/logo.png`,
      ]),
    ).rejects.toThrow(/paths_own_tenant/);
  });

  it("accepts a branding path inside the tenant's own folder", async () => {
    await expect(
      db.query("update public.tenant_themes set logo_path = $2 where tenant_id = $1", [
        tenantA,
        `tenants/${tenantA}/branding/logo.png`,
      ]),
    ).resolves.toBeDefined();
  });

  it("rejects a social link that is not https (TEST-605)", async () => {
    await expect(
      db.query(
        `insert into public.tenant_social_links (tenant_id, platform, url)
         values ($1, 'instagram', 'http://insecure.example.com/page')`,
        [tenantA],
      ),
    ).rejects.toThrow(/url_https/);
  });

  it("rejects the same platform twice for one tenant (TEST-606)", async () => {
    await db.query(
      `insert into public.tenant_social_links (tenant_id, platform, url)
       values ($1, 'facebook', 'https://facebook.com/sugurolls')`,
      [tenantA],
    );
    await expect(
      db.query(
        `insert into public.tenant_social_links (tenant_id, platform, url)
         values ($1, 'facebook', 'https://facebook.com/otro')`,
        [tenantA],
      ),
    ).rejects.toThrow(/tenant_platform_key/);
  });

  it("lets two tenants each use the same platform", async () => {
    await expect(
      db.query(
        `insert into public.tenant_social_links (tenant_id, platform, url)
         values ($1, 'facebook', 'https://facebook.com/polleria')`,
        [tenantB],
      ),
    ).resolves.toBeDefined();
  });

  it("cascades all three tables when a tenant is deleted (TEST-607)", async () => {
    // Settings and theme arrive with the tenant, via the trigger.
    const doomed = await insertTenant(db, { slug: "doomed-co", name: "Doomed" });
    await db.query(
      `insert into public.tenant_social_links (tenant_id, platform, url)
       values ($1, 'x', 'https://x.com/doomed')`,
      [doomed],
    );

    await db.query("delete from public.tenants where id = $1", [doomed]);

    for (const table of ["tenant_settings", "tenant_themes", "tenant_social_links"]) {
      const rows = await db.query<{ c: string }>(
        `select count(*)::text c from public.${table} where tenant_id = $1`,
        [doomed],
      );
      expect(Number(rows[0]?.c), `${table} kept an orphan`).toBe(0);
    }
  });
});

describe("RLS on settings (TEST-608 to TEST-613)", () => {
  it("lets any active member read their own settings", async () => {
    const rows = await db.asUser(cashierA, () =>
      db.query("select * from public.tenant_settings where tenant_id = $1", [tenantA]),
    );
    expect(rows).toHaveLength(1);
  });

  it("does NOT let a member read another tenant's settings", async () => {
    await db.query(
      "insert into public.tenant_settings (tenant_id) values ($1) on conflict do nothing",
      [tenantB],
    );
    const rows = await db.asUser(ownerA, () =>
      db.query("select * from public.tenant_settings where tenant_id = $1", [tenantB]),
    );
    expect(rows).toEqual([]);
  });

  it("refuses a write without settings.manage", async () => {
    await db.asUser(cashierA, () =>
      db.query("update public.tenant_settings set city = 'Lima' where tenant_id = $1", [tenantA]),
    );
    const rows = await db.query<{ city: string | null }>(
      "select city from public.tenant_settings where tenant_id = $1",
      [tenantA],
    );
    expect(rows[0]?.city).toBeNull();
  });

  it("allows a write with settings.manage", async () => {
    await db.asUser(ownerA, () =>
      db.query("update public.tenant_settings set city = 'Lima' where tenant_id = $1", [tenantA]),
    );
    const rows = await db.query<{ city: string | null }>(
      "select city from public.tenant_settings where tenant_id = $1",
      [tenantA],
    );
    expect(rows[0]?.city).toBe("Lima");
  });

  it("does NOT let an owner write another tenant's settings", async () => {
    await db.asUser(ownerA, () =>
      db.query("update public.tenant_settings set city = 'Hijacked' where tenant_id = $1", [
        tenantB,
      ]),
    );
    const rows = await db.query<{ city: string | null }>(
      "select city from public.tenant_settings where tenant_id = $1",
      [tenantB],
    );
    expect(rows[0]?.city).toBeNull();
  });

  it("keeps fiscal and contact settings away from an anonymous caller", async () => {
    for (const table of ["tenant_settings", "tenant_social_links"]) {
      const rows = await db.asRole("anon", () =>
        db.query<{ c: string }>(`select count(*)::text c from public.${table}`),
      );
      expect(Number(rows[0]?.c), table).toBe(0);
    }
  });

  /*
   * `tenant_themes` used to be in the list above, and Phase 08 deliberately
   * took it out.
   *
   * The premise changed rather than the guarantee. A theme is the colours,
   * typography and logo of a public website: every value in the row is visible
   * in the rendered page, so hiding the row hid nothing while making the site
   * unable to render itself for a visitor. What still must not be public is the
   * fiscal identity next door, and that is what the assertion above holds.
   */
  it("does show an anonymous caller the theme, which is the site's own appearance", async () => {
    const rows = await db.asRole("anon", () =>
      db.query<{ c: string }>("select count(*)::text c from public.tenant_themes"),
    );
    expect(Number(rows[0]?.c)).toBeGreaterThan(0);
  });
});

/**
 * The new isolation surface of this phase.
 */
describe("storage isolation (TEST-614 to TEST-618)", () => {
  it("extracts the tenant from a well-formed path", async () => {
    const rows = await db.query<{ r: string | null }>(
      "select public.storage_path_tenant_id($1) r",
      [`tenants/${tenantA}/branding/logo.png`],
    );
    expect(rows[0]?.r).toBe(tenantA);
  });

  it.each([
    ["a path outside tenants/", "public/logo.png"],
    ["a non-uuid second segment", "tenants/not-a-uuid/branding/logo.png"],
    ["a path with no folder", "tenants/x/logo.png"],
    ["an empty path", ""],
  ])("returns null for %s", async (_label, path) => {
    const rows = await db.query<{ r: string | null }>(
      "select public.storage_path_tenant_id($1) r",
      [path],
    );
    expect(rows[0]?.r).toBeNull();
  });

  it("lets settings.manage upload into its own folder", async () => {
    await expect(tryUpload(ownerA, `tenants/${tenantA}/branding/logo.png`)).resolves.toBe(true);
  });

  it("refuses an upload into ANOTHER tenant's folder (TEST-615)", async () => {
    await expect(tryUpload(ownerA, `tenants/${tenantB}/branding/logo.png`)).resolves.toBe(false);
  });

  it("refuses an upload from a member without settings.manage", async () => {
    await expect(tryUpload(cashierA, `tenants/${tenantA}/branding/other.png`)).resolves.toBe(false);
  });

  it("refuses a path that does not follow the convention (TEST-618)", async () => {
    for (const path of ["logo.png", "public/logo.png", `tenants/${tenantA}`]) {
      await expect(tryUpload(ownerA, path), path).resolves.toBe(false);
    }
  });

  it("lets a member read an asset of their own tenant (TEST-616)", async () => {
    const rows = await db.asUser(cashierA, () =>
      db.query("select name from storage.objects where bucket_id = 'tenant-assets'"),
    );
    expect(rows.length).toBeGreaterThan(0);
  });

  /*
   * TEST-617, restated for Phase 08.
   *
   * It used to assert that a member of A sees no object of B at all. That is no
   * longer the invariant, and it should not be: `branding`, `banners` and
   * `products` are the files an active business SHOWS on its public website, so
   * every visitor on the internet can read them - a member of another company
   * included, and they could already read them by loading the page.
   *
   * The isolation that remains, and the one that always mattered, is over the
   * files that are NOT on a website. `documents` holds invoices and contracts,
   * and nobody outside the business reads those.
   */
  it("does NOT let a member read another tenant's private documents (TEST-617)", async () => {
    await tryUpload(ownerB, `tenants/${tenantB}/documents/contrato.pdf`);

    const rows = await db.asUser(ownerA, () =>
      db.query<{ name: string }>(
        "select name from storage.objects where bucket_id = 'tenant-assets'",
      ),
    );
    expect(rows.some((r) => r.name.includes("documents"))).toBe(false);
  });

  it("cannot be escaped with a traversal segment (AB-604)", async () => {
    await expect(
      tryUpload(ownerA, `tenants/${tenantA}/../${tenantB}/branding/logo.png`),
    ).resolves.toBe(false);
  });

  it("keeps the bucket private", async () => {
    const rows = await db.query<{ public: boolean }>(
      "select public from storage.buckets where id = 'tenant-assets'",
    );
    expect(rows[0]?.public).toBe(false);
  });
});

describe("provisioning creates defaults (TEST-619, TEST-620)", () => {
  it("gives a new tenant its settings and theme", async () => {
    const operator = await createUser("staff@clovercode.com");
    await db.query("insert into public.platform_admins (user_id) values ($1)", [operator]);

    const id = await db.asUser(
      operator,
      async () =>
        (
          await db.query<{ provision_tenant: string }>("select public.provision_tenant($1,$2,$3)", [
            "Nueva Empresa",
            "nueva-empresa",
            "owner@sugurolls.com",
          ])
        )[0]!.provision_tenant,
    );

    const settings = await db.query<{ trade_name: string; currency: string; timezone: string }>(
      "select trade_name, currency, timezone from public.tenant_settings where tenant_id = $1",
      [id],
    );
    expect(settings[0]?.trade_name).toBe("Nueva Empresa");
    expect(settings[0]?.currency).toBe("PEN");
    expect(settings[0]?.timezone).toBe("America/Lima");

    const theme = await db.query<{ primary_color: string }>(
      "select primary_color from public.tenant_themes where tenant_id = $1",
      [id],
    );
    expect(theme[0]?.primary_color).toBe("#16a34a");
  });

  it("gives defaults to a tenant inserted DIRECTLY, not only to a provisioned one", async () => {
    // Phase 04 lets a platform operator INSERT into `tenants`, so provisioning
    // is not the only way a business appears. A trigger makes the defaults an
    // invariant of the table rather than a habit of one code path.
    const direct = await insertTenant(db, { slug: "insertada-directa", name: "Directa" });

    const settings = await db.query<{ trade_name: string }>(
      "select trade_name from public.tenant_settings where tenant_id = $1",
      [direct],
    );
    const theme = await db.query<{ c: string }>(
      "select count(*)::text c from public.tenant_themes where tenant_id = $1",
      [direct],
    );

    expect(settings[0]?.trade_name).toBe("Directa");
    expect(Number(theme[0]?.c)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Findings of the Phase 06 audit
// ---------------------------------------------------------------------------

describe("audit: a business cannot destroy its own configuration", () => {
  it("refuses a DELETE of the settings row, even from an owner", async () => {
    // `FOR ALL` also granted DELETE. An owner could remove the row the trigger
    // exists to guarantee, after which every read failed and nothing in the
    // product could recreate it - the trigger only fires on tenant INSERT. A
    // business could permanently break its own dashboard with one request.
    await db.asUser(ownerA, () =>
      db.query("delete from public.tenant_settings where tenant_id = $1", [tenantA]),
    );

    const rows = await db.query<{ c: string }>(
      "select count(*)::text c from public.tenant_settings where tenant_id = $1",
      [tenantA],
    );
    expect(Number(rows[0]?.c)).toBe(1);
  });

  it("refuses a DELETE of the theme row", async () => {
    await db.asUser(ownerA, () =>
      db.query("delete from public.tenant_themes where tenant_id = $1", [tenantA]),
    );

    const rows = await db.query<{ c: string }>(
      "select count(*)::text c from public.tenant_themes where tenant_id = $1",
      [tenantA],
    );
    expect(Number(rows[0]?.c)).toBe(1);
  });

  it("refuses an INSERT of a second settings row", async () => {
    await expect(
      db.asUser(ownerA, () =>
        db.query("insert into public.tenant_settings (tenant_id) values ($1)", [tenantB]),
      ),
    ).rejects.toThrow(/row-level security|policy|duplicate key/i);
  });

  it("still allows the UPDATE that the screen actually needs", async () => {
    await db.asUser(ownerA, () =>
      db.query("update public.tenant_settings set district = 'Miraflores' where tenant_id = $1", [
        tenantA,
      ]),
    );
    const rows = await db.query<{ district: string | null }>(
      "select district from public.tenant_settings where tenant_id = $1",
      [tenantA],
    );
    expect(rows[0]?.district).toBe("Miraflores");
  });

  it("keeps full write access for social links, which ARE a collection", async () => {
    await db.asUser(ownerA, () =>
      db.query(
        `insert into public.tenant_social_links (tenant_id, platform, url)
         values ($1, 'youtube', 'https://youtube.com/@sugurolls')`,
        [tenantA],
      ),
    );
    await db.asUser(ownerA, () =>
      db.query(
        "delete from public.tenant_social_links where tenant_id = $1 and platform = 'youtube'",
        [tenantA],
      ),
    );

    const rows = await db.query<{ c: string }>(
      "select count(*)::text c from public.tenant_social_links where tenant_id = $1 and platform = 'youtube'",
      [tenantA],
    );
    expect(Number(rows[0]?.c)).toBe(0);
  });
});

describe("audit: the bucket ceiling matches what the folders accept", () => {
  it("does not allow a MIME type no folder would take", async () => {
    const rows = await db.query<{ allowed_mime_types: string[] }>(
      "select allowed_mime_types from storage.buckets where id = 'tenant-assets'",
    );
    const allowed = rows[0]?.allowed_mime_types ?? [];

    // SVG was excluded from branding because it can carry script. Leaving it
    // allowed at the bucket contradicted that at the layer that matters most.
    expect(allowed).not.toContain("image/svg+xml");
    expect(allowed).toContain("image/png");
    expect(allowed).toContain("application/pdf");
  });
});
