import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * `/sitemap.xml` and `/robots.txt`, which are the two routes a crawler asks for
 * before it asks for anything else.
 *
 * Both are resolved by HOSTNAME, so the interesting cases are not "does it
 * return XML" but "whose XML, and when does it return nothing". A sitemap that
 * listed another business's pages would tell Google the two sites are one; a
 * sitemap that kept listing a suspended business would keep it in the results
 * for weeks after it stopped serving.
 *
 * The queries are mocked because what is under test is the decision, not the
 * SQL - the SQL has its own tests against a real PostgreSQL in
 * `src/tests/database/seo.test.ts`.
 */

const state = vi.hoisted(() => ({
  site: null as unknown,
  seo: { robotsIndex: true } as { robotsIndex: boolean },
  domain: null as string | null,
  pages: [] as { slug: string; updatedAt: string }[],
}));

vi.mock("@/modules/cms/server/site-context", () => ({
  getSiteContext: async () => state.site,
  signAssetPaths: async () => new Map<string, string>(),
}));

vi.mock("@/modules/seo/server/queries", () => ({
  getSiteSeo: async () => state.seo,
  getPrimaryDomain: async () => state.domain,
  listPublishedPages: async () => state.pages,
}));

const ACTIVE_SITE = {
  tenant: {
    id: "t-a",
    slug: "sugurolls",
    name: "Sugu Rolls",
    status: "active" as const,
    domain: "sugurolls.clovercodeapp.com",
    domainType: "system" as const,
    isPrimary: true,
  },
  isServing: true,
};

async function loadSitemap() {
  vi.resetModules();
  return (await import("@/app/sitemap")).default;
}

async function loadRobots() {
  vi.resetModules();
  return (await import("@/app/robots")).default;
}

afterEach(() => {
  state.site = null;
  state.seo = { robotsIndex: true };
  state.domain = null;
  state.pages = [];
});

describe("sitemap.xml (TEST-818 to TEST-820)", () => {
  it("lists the published pages of THIS tenant on its own domain (TEST-818)", async () => {
    state.site = ACTIVE_SITE;
    state.domain = "sugurolls.com";
    state.pages = [
      { slug: "inicio", updatedAt: "2026-08-01T00:00:00.000Z" },
      { slug: "carta", updatedAt: "2026-08-02T00:00:00.000Z" },
    ];

    const sitemap = await loadSitemap();
    const entries = await sitemap();

    expect(entries.map((entry) => entry.url)).toEqual([
      "https://sugurolls.com/sitio",
      "https://sugurolls.com/sitio/carta",
    ]);
    // The home page is the entry point of the site, not one page among many.
    expect(entries[0]?.priority).toBe(1);
  });

  it("falls back to the resolving hostname when no domain is primary (EC-804)", async () => {
    state.site = ACTIVE_SITE;
    state.pages = [{ slug: "inicio", updatedAt: "2026-08-01T00:00:00.000Z" }];

    const sitemap = await loadSitemap();
    const entries = await sitemap();

    expect(entries[0]?.url).toBe("https://sugurolls.clovercodeapp.com/sitio");
  });

  it("is empty for a business that asked not to be indexed (TEST-819)", async () => {
    state.site = ACTIVE_SITE;
    state.seo = { robotsIndex: false };
    state.pages = [{ slug: "inicio", updatedAt: "2026-08-01T00:00:00.000Z" }];

    const sitemap = await loadSitemap();
    expect(await sitemap()).toEqual([]);
  });

  it("is empty for a suspended business", async () => {
    state.site = { ...ACTIVE_SITE, isServing: false };
    state.pages = [{ slug: "inicio", updatedAt: "2026-08-01T00:00:00.000Z" }];

    const sitemap = await loadSitemap();
    expect(await sitemap()).toEqual([]);
  });

  /*
   * TEST-820. Anyone can point a DNS record at the platform, so an unknown
   * hostname is an ordinary event and not a fault. Answering with an empty
   * document rather than a 500 also keeps the crawler from retrying forever.
   */
  it("answers an unknown hostname with an empty document, not an error (TEST-820)", async () => {
    const sitemap = await loadSitemap();
    await expect(sitemap()).resolves.toEqual([]);
  });
});

describe("robots.txt", () => {
  it("allows crawling and points at the tenant's own sitemap", async () => {
    state.site = ACTIVE_SITE;
    state.domain = "sugurolls.com";

    const robots = await loadRobots();
    const result = await robots();

    expect(result.sitemap).toBe("https://sugurolls.com/sitemap.xml");
    expect(result.host).toBe("sugurolls.com");
  });

  it("keeps the dashboard out of every tenant's robots.txt", async () => {
    state.site = ACTIVE_SITE;

    const robots = await loadRobots();
    const result = await robots();
    const rule = Array.isArray(result.rules) ? result.rules[0] : result.rules;

    expect(rule?.disallow).toContain("/dashboard");
  });

  it("disallows everything when the business asked not to be indexed", async () => {
    state.site = ACTIVE_SITE;
    state.seo = { robotsIndex: false };

    const robots = await loadRobots();
    const result = await robots();
    const rule = Array.isArray(result.rules) ? result.rules[0] : result.rules;

    expect(rule?.disallow).toBe("/");
    // No sitemap either: a site that does not want to be found does not hand
    // out a map of itself.
    expect(result.sitemap).toBeUndefined();
  });

  it("disallows everything for a suspended business", async () => {
    state.site = { ...ACTIVE_SITE, isServing: false };

    const robots = await loadRobots();
    const result = await robots();
    const rule = Array.isArray(result.rules) ? result.rules[0] : result.rules;

    expect(rule?.disallow).toBe("/");
  });

  it("disallows everything on a hostname no tenant owns", async () => {
    const robots = await loadRobots();
    const result = await robots();
    const rule = Array.isArray(result.rules) ? result.rules[0] : result.rules;

    expect(rule?.disallow).toBe("/");
  });
});
