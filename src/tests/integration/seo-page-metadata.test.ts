import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * `buildPageMetadata`, which is where "hostname + pathname" (master section 31)
 * actually happens: the hostname has already picked the business, and the slug
 * picks the page whose title, description and canonical are emitted.
 */

const state = vi.hoisted(() => ({
  site: null as unknown,
  seo: {
    siteTitle: null as string | null,
    siteDescription: null as string | null,
    ogTitle: null as string | null,
    ogDescription: null as string | null,
    ogImagePath: null as string | null,
    twitterImagePath: null as string | null,
    robotsIndex: true,
    googleVerification: null as string | null,
  },
  page: null as unknown,
  identity: {
    name: "Sugu Rolls",
    addressLine: null,
    district: null,
    city: null,
    phone: null,
    currency: "PEN",
  },
  domain: null as string | null,
}));

vi.mock("@/modules/cms/server/site-context", () => ({
  getSiteContext: async () => state.site,
  signAssetPaths: async (paths: string[]) =>
    new Map(paths.map((path) => [path, `https://signed.example/${path}`])),
}));

vi.mock("@/modules/seo/server/queries", () => ({
  getSiteSeo: async () => state.seo,
  getPageSeo: async () => state.page,
  getPublicIdentity: async () => state.identity,
  getPrimaryDomain: async () => state.domain,
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

const CARTA = {
  id: "p-1",
  slug: "carta",
  title: "Carta",
  seoTitle: null,
  seoDescription: null,
  ogImagePath: null,
  updatedAt: "2026-08-01T00:00:00.000Z",
};

async function load() {
  vi.resetModules();
  return (await import("@/modules/seo/server/page-metadata")).buildPageMetadata;
}

afterEach(() => {
  state.site = null;
  state.page = null;
  state.domain = null;
  state.seo = { ...state.seo, siteTitle: null, siteDescription: null, robotsIndex: true };
});

describe("buildPageMetadata", () => {
  it("canonicalises over the primary domain, not the hostname that was used", async () => {
    state.site = ACTIVE_SITE;
    state.page = CARTA;
    // The request arrived on the system subdomain; the canonical must still be
    // the business's own domain, or the two hostnames compete in the index.
    state.domain = "sugurolls.com";

    const metadata = await (await load())("carta");
    expect(metadata.alternates?.canonical).toBe("https://sugurolls.com/sitio/carta");
  });

  it("lets the layout template append the business name to a derived title", async () => {
    state.site = ACTIVE_SITE;
    state.page = CARTA;

    const metadata = await (await load())("carta");
    // A plain string, so `%s · Sugu Rolls` applies: "Carta · Sugu Rolls".
    expect(metadata.title).toBe("Carta");
  });

  it("emits an explicit page title verbatim, without the suffix", async () => {
    state.site = ACTIVE_SITE;
    state.page = { ...CARTA, seoTitle: "Carta de makis, rolls y bowls" };

    const metadata = await (await load())("carta");
    expect(metadata.title).toEqual({ absolute: "Carta de makis, rolls y bowls" });
  });

  it("does not repeat the business name on the home page", async () => {
    state.site = ACTIVE_SITE;
    state.page = { ...CARTA, slug: "inicio", title: "Inicio" };
    state.seo = { ...state.seo, siteTitle: "Sugu Rolls" };

    const metadata = await (await load())("inicio");
    // Without `absolute` this would render "Inicio · Sugu Rolls" on a page
    // whose whole job is to be the business.
    expect(metadata.title).toEqual({ absolute: "Inicio" });
    expect(metadata.alternates?.canonical).toBe("https://sugurolls.clovercodeapp.com/sitio");
  });

  it("signs the social image instead of linking a private object", async () => {
    state.site = ACTIVE_SITE;
    state.page = { ...CARTA, ogImagePath: "tenants/t-a/banners/carta.png" };

    const metadata = await (await load())("carta");
    const images = metadata.openGraph?.images as { url: string }[] | undefined;
    expect(images?.[0]?.url).toBe("https://signed.example/tenants/t-a/banners/carta.png");
    // `Metadata["twitter"]` is a union whose members do not all carry `card`,
    // so the narrowing happens here rather than in the code under test.
    expect((metadata.twitter as { card?: string } | null)?.card).toBe("summary_large_image");
  });

  it("says noindex for a suspended business", async () => {
    state.site = { ...ACTIVE_SITE, isServing: false };
    state.page = CARTA;

    const metadata = await (await load())("carta");
    expect(metadata.robots).toMatchObject({ index: false, follow: false });
  });

  it("still returns metadata for a slug that resolves to no page", async () => {
    state.site = ACTIVE_SITE;
    state.seo = { ...state.seo, siteTitle: "Sugu Rolls Miraflores" };

    // Next.js calls generateMetadata BEFORE the page decides on a 404, so
    // throwing here would turn a missing page into a 500.
    const metadata = await (await load())("no-existe");
    expect(metadata.title).toBe("Sugu Rolls Miraflores");
  });

  it("returns a neutral answer on a hostname no tenant owns", async () => {
    const metadata = await (await load())("carta");
    expect(metadata.robots).toMatchObject({ index: false });
  });
});
