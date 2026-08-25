import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, insertTenant, type TestDatabase } from "../helpers/database";

/**
 * Pages, sections and navigation — and the genuinely new surface of Phase 07:
 * a role with no session reading business rows.
 *
 * The anonymous assertions are the ones that matter most. Every other policy in
 * CloverCode answers "does this user belong to this tenant"; a visitor belongs
 * to none, so these answer "is this row publishable at all". Getting that wrong
 * publishes drafts, or the content of a suspended business.
 */

let db: TestDatabase;

let tenantA: string;
let tenantB: string;
let suspended: string;
let archived: string;

let ownerA: string;
let cashierA: string;
let ownerB: string;

let publishedPage: string;
let draftPage: string;

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

async function createPage(
  tenantId: string,
  slug: string,
  status: "draft" | "published",
): Promise<string> {
  const rows = await db.query<{ id: string }>(
    `insert into public.pages (tenant_id, slug, title, status)
     values ($1, $2, $3, $4::public.page_status) returning id`,
    [tenantId, slug, slug, status],
  );
  return rows[0]!.id;
}

beforeAll(async () => {
  db = await createTestDatabase();

  tenantA = await insertTenant(db, { slug: "sugurolls", name: "Sugu Rolls" });
  tenantB = await insertTenant(db, { slug: "polleria-el-rey", name: "Pollería El Rey" });
  suspended = await insertTenant(db, { slug: "en-pausa", name: "En Pausa", status: "suspended" });
  archived = await insertTenant(db, { slug: "cerrada", name: "Cerrada", status: "archived" });

  ownerA = await createUser("owner@sugurolls.com");
  cashierA = await createUser("cashier@sugurolls.com");
  ownerB = await createUser("owner@polleria.pe");

  await addMember(tenantA, ownerA, "owner");
  await addMember(tenantA, cashierA, "cashier");
  await addMember(tenantB, ownerB, "owner");

  publishedPage = await createPage(tenantA, "nosotros", "published");
  draftPage = await createPage(tenantA, "borrador", "draft");
});

afterAll(async () => {
  await db.close();
});

describe("pages schema (TEST-701, TEST-702, TEST-706)", () => {
  it("scopes the slug to the tenant, so two businesses can share one", async () => {
    await expect(createPage(tenantB, "nosotros", "published")).resolves.toBeDefined();
  });

  it("rejects a duplicate slug within one tenant", async () => {
    await expect(createPage(tenantA, "nosotros", "draft")).rejects.toThrow(/pages_tenant_slug_key/);
  });

  it.each(["Nosotros", "sobre nosotros", "-x", "x-", "sobre/nosotros"])(
    "rejects the slug %j",
    async (slug) => {
      await expect(createPage(tenantA, slug, "draft")).rejects.toThrow(/pages_slug_format/);
    },
  );

  it("cascades sections when a page is deleted", async () => {
    const page = await createPage(tenantA, "temporal", "draft");
    await db.query(
      "insert into public.page_sections (page_id, tenant_id, type, content) values ($1,$2,'text','{}'::jsonb)",
      [page, tenantA],
    );
    await db.query("delete from public.pages where id = $1", [page]);

    const rows = await db.query<{ c: string }>(
      "select count(*)::text c from public.page_sections where page_id = $1",
      [page],
    );
    expect(Number(rows[0]?.c)).toBe(0);
  });

  it("rejects a section whose content is not an object", async () => {
    await expect(
      db.query(
        "insert into public.page_sections (page_id, tenant_id, type, content) values ($1,$2,'text','[]'::jsonb)",
        [publishedPage, tenantA],
      ),
    ).rejects.toThrow(/content_is_object/);
  });
});

describe("section tenant stays in step with its page (TEST-707)", () => {
  it("overwrites a tenant_id the caller got wrong", async () => {
    // The column is denormalised so policies need no join. The trigger makes it
    // impossible for that convenience to become a lie.
    const rows = await db.query<{ tenant_id: string }>(
      `insert into public.page_sections (page_id, tenant_id, type, content)
       values ($1, $2, 'text', '{}'::jsonb) returning tenant_id`,
      [publishedPage, tenantB],
    );
    expect(rows[0]?.tenant_id).toBe(tenantA);
  });

  it("refuses a section pointing at a page that does not exist", async () => {
    await expect(
      db.query(
        "insert into public.page_sections (page_id, tenant_id, type, content) values ($1,$2,'text','{}'::jsonb)",
        ["00000000-0000-0000-0000-000000000000", tenantA],
      ),
    ).rejects.toThrow(/does not exist|fkey/i);
  });
});

describe("navigation schema (TEST-703 to TEST-705)", () => {
  async function addNav(values: {
    tenantId: string;
    label: string;
    linkType: "page" | "external";
    pageId?: string | null;
    url?: string | null;
    parentId?: string | null;
  }): Promise<string> {
    const rows = await db.query<{ id: string }>(
      `insert into public.navigation_items
         (tenant_id, label, link_type, page_id, external_url, parent_id)
       values ($1,$2,$3::public.nav_link_type,$4,$5,$6) returning id`,
      [
        values.tenantId,
        values.label,
        values.linkType,
        values.pageId ?? null,
        values.url ?? null,
        values.parentId ?? null,
      ],
    );
    return rows[0]!.id;
  }

  it("accepts a page link and an external https link", async () => {
    await expect(
      addNav({ tenantId: tenantA, label: "Nosotros", linkType: "page", pageId: publishedPage }),
    ).resolves.toBeDefined();
    await expect(
      addNav({
        tenantId: tenantA,
        label: "Blog",
        linkType: "external",
        url: "https://blog.example.com",
      }),
    ).resolves.toBeDefined();
  });

  it.each([
    ["http", "http://insecure.example.com"],
    ["javascript", "javascript:alert(1)"],
    ["a relative path", "/interno"],
  ])("rejects an external link using %s", async (_label, url) => {
    await expect(
      addNav({ tenantId: tenantA, label: "Malo", linkType: "external", url }),
    ).rejects.toThrow(/external_url_https|external_url_length/);
  });

  it("rejects a page link with no page", async () => {
    await expect(addNav({ tenantId: tenantA, label: "Roto", linkType: "page" })).rejects.toThrow(
      /target_matches_type/,
    );
  });

  it("rejects an external link that also carries a page", async () => {
    await expect(
      addNav({
        tenantId: tenantA,
        label: "Ambiguo",
        linkType: "external",
        url: "https://example.com",
        pageId: publishedPage,
      }),
    ).rejects.toThrow(/target_matches_type/);
  });

  describe("hierarchy (TEST-708 to TEST-712)", () => {
    it("accepts one level of nesting inside the same tenant", async () => {
      const parent = await addNav({
        tenantId: tenantA,
        label: "Carta",
        linkType: "external",
        url: "https://example.com/carta",
      });
      await expect(
        addNav({
          tenantId: tenantA,
          label: "Makis",
          linkType: "external",
          url: "https://example.com/makis",
          parentId: parent,
        }),
      ).resolves.toBeDefined();
    });

    it("rejects an item that is its own parent", async () => {
      const item = await addNav({
        tenantId: tenantA,
        label: "Solo",
        linkType: "external",
        url: "https://example.com/solo",
      });
      await expect(
        db.query("update public.navigation_items set parent_id = id where id = $1", [item]),
      ).rejects.toThrow(/not_own_parent/);
    });

    it("rejects a two-item cycle", async () => {
      const a = await addNav({
        tenantId: tenantA,
        label: "A",
        linkType: "external",
        url: "https://example.com/a",
      });
      const b = await addNav({
        tenantId: tenantA,
        label: "B",
        linkType: "external",
        url: "https://example.com/b",
        parentId: a,
      });
      await expect(
        db.query("update public.navigation_items set parent_id = $2 where id = $1", [a, b]),
      ).rejects.toThrow(/cycle|two levels/i);
    });

    it("rejects a third level", async () => {
      const parent = await addNav({
        tenantId: tenantA,
        label: "N1",
        linkType: "external",
        url: "https://example.com/1",
      });
      const child = await addNav({
        tenantId: tenantA,
        label: "N2",
        linkType: "external",
        url: "https://example.com/2",
        parentId: parent,
      });
      await expect(
        addNav({
          tenantId: tenantA,
          label: "N3",
          linkType: "external",
          url: "https://example.com/3",
          parentId: child,
        }),
      ).rejects.toThrow(/two levels/i);
    });

    it("rejects a parent belonging to another tenant", async () => {
      const foreign = await addNav({
        tenantId: tenantB,
        label: "Ajeno",
        linkType: "external",
        url: "https://example.com/ajeno",
      });
      await expect(
        addNav({
          tenantId: tenantA,
          label: "Colado",
          linkType: "external",
          url: "https://example.com/colado",
          parentId: foreign,
        }),
      ).rejects.toThrow(/another tenant/i);
    });
  });
});

describe("member RLS (TEST-713 to TEST-716)", () => {
  it("shows nothing to a member without content.view", async () => {
    const rows = await db.asUser(cashierA, () => db.query("select * from public.pages"));
    expect(rows).toEqual([]);
  });

  it("shows the tenant's pages to a member with content.view", async () => {
    const rows = await db.asUser(ownerA, () =>
      db.query<{ tenant_id: string }>("select tenant_id from public.pages"),
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.tenant_id === tenantA)).toBe(true);
  });

  it("never shows another tenant's pages", async () => {
    const rows = await db.asUser(ownerA, () =>
      db.query("select * from public.pages where tenant_id = $1", [tenantB]),
    );
    expect(rows).toEqual([]);
  });

  it("refuses a write from a member without content.manage", async () => {
    await expect(
      db.asUser(cashierA, () =>
        db.query(
          "insert into public.pages (tenant_id, slug, title) values ($1,'colada','Colada')",
          [tenantA],
        ),
      ),
    ).rejects.toThrow(/row-level security|policy/i);
  });

  it("refuses a write into another tenant even with content.manage here", async () => {
    await expect(
      db.asUser(ownerA, () =>
        db.query(
          "insert into public.pages (tenant_id, slug, title) values ($1,'invasion','Invasion')",
          [tenantB],
        ),
      ),
    ).rejects.toThrow(/row-level security|policy/i);
  });
});

/**
 * The new surface of this phase.
 */
describe("anonymous read (TEST-717 to TEST-723)", () => {
  it("reads a published page", async () => {
    const rows = await db.asRole("anon", () =>
      db.query<{ slug: string }>("select slug from public.pages where tenant_id = $1", [tenantA]),
    );
    expect(rows.map((r) => r.slug)).toContain("nosotros");
  });

  it("does NOT read a draft", async () => {
    const rows = await db.asRole("anon", () =>
      db.query<{ slug: string }>("select slug from public.pages"),
    );
    expect(rows.map((r) => r.slug)).not.toContain("borrador");
  });

  it("does NOT read pages of a SUSPENDED tenant", async () => {
    await createPage(suspended, "oferta", "published");
    const rows = await db.asRole("anon", () =>
      db.query("select * from public.pages where tenant_id = $1", [suspended]),
    );
    expect(rows).toEqual([]);
  });

  it("does NOT read pages of an ARCHIVED tenant", async () => {
    await createPage(archived, "adios", "published");
    const rows = await db.asRole("anon", () =>
      db.query("select * from public.pages where tenant_id = $1", [archived]),
    );
    expect(rows).toEqual([]);
  });

  it("does not see the sections of a draft page", async () => {
    await db.query(
      "insert into public.page_sections (page_id, tenant_id, type, content) values ($1,$2,'text','{}'::jsonb)",
      [draftPage, tenantA],
    );
    const rows = await db.asRole("anon", () =>
      db.query("select * from public.page_sections where page_id = $1", [draftPage]),
    );
    expect(rows).toEqual([]);
  });

  it("does not see a hidden section of a published page", async () => {
    const rows = await db.query<{ id: string }>(
      `insert into public.page_sections (page_id, tenant_id, type, content, is_visible)
       values ($1,$2,'text','{}'::jsonb,false) returning id`,
      [publishedPage, tenantA],
    );
    const seen = await db.asRole("anon", () =>
      db.query("select * from public.page_sections where id = $1", [rows[0]!.id]),
    );
    expect(seen).toEqual([]);
  });

  it("does not see an inactive navigation entry", async () => {
    const rows = await db.query<{ id: string }>(
      `insert into public.navigation_items (tenant_id, label, link_type, external_url, is_active)
       values ($1,'Oculto','external','https://example.com/oculto',false) returning id`,
      [tenantA],
    );
    const seen = await db.asRole("anon", () =>
      db.query("select * from public.navigation_items where id = $1", [rows[0]!.id]),
    );
    expect(seen).toEqual([]);
  });

  it("does not advertise a navigation entry pointing at a draft", async () => {
    // The link would 404, but its LABEL would leak what the business is about
    // to launch.
    const rows = await db.query<{ id: string }>(
      `insert into public.navigation_items (tenant_id, label, link_type, page_id)
       values ($1,'Proximamente','page',$2) returning id`,
      [tenantA, draftPage],
    );
    const seen = await db.asRole("anon", () =>
      db.query("select * from public.navigation_items where id = $1", [rows[0]!.id]),
    );
    expect(seen).toEqual([]);
  });

  it.each(["pages", "page_sections", "navigation_items"])("cannot write to %s", async (table) => {
    const sql =
      table === "pages"
        ? "insert into public.pages (tenant_id, slug, title) values ($1,'anon','Anon')"
        : table === "page_sections"
          ? `insert into public.page_sections (page_id, tenant_id, type, content) values ('${publishedPage}',$1,'text','{}'::jsonb)`
          : `insert into public.navigation_items (tenant_id, label, link_type, external_url) values ($1,'Anon','external','https://example.com/x')`;

    await expect(db.asRole("anon", () => db.query(sql, [tenantA]))).rejects.toThrow(
      /row-level security|policy/i,
    );
  });

  it("has no anonymous policy other than SELECT", async () => {
    const rows = await db.query<{ cmd: string; policyname: string }>(
      `select cmd, policyname from pg_policies
       where schemaname = 'public'
         and tablename in ('pages','page_sections','navigation_items')
         and 'anon' = any(roles)`,
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.cmd === "SELECT")).toBe(true);
  });
});

describe("is_tenant_public", () => {
  it.each([
    ["active", () => tenantA, true],
    ["suspended", () => suspended, false],
    ["archived", () => archived, false],
  ])("is %s -> %s", async (_label, getTenant, expected) => {
    const rows = await db.query<{ r: boolean }>("select public.is_tenant_public($1) r", [
      getTenant(),
    ]);
    expect(rows[0]?.r).toBe(expected);
  });

  it("is hardened like every other guarded function", async () => {
    const rows = await db.query<{
      prosecdef: boolean;
      proconfig: string[] | null;
      acl: string | null;
    }>(
      `select prosecdef, proconfig, array_to_string(proacl, ',') as acl
       from pg_proc where proname = 'is_tenant_public'`,
    );
    expect(rows[0]?.prosecdef).toBe(true);
    expect(rows[0]?.proconfig).toContain('search_path=""');
    expect(rows[0]?.acl ?? "").not.toMatch(/(^|,)=/);
  });
});
