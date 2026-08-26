import { describe, expect, it } from "vitest";
import {
  canonicalUrl,
  DESCRIPTION_LIMIT,
  resolveSeo,
  singleLine,
  sitePagePath,
  TITLE_LIMIT,
  truncate,
  type BusinessIdentity,
  type PageSeo,
  type SiteSeo,
} from "@/modules/seo/metadata";

/**
 * The cascade, which is the whole of Phase 08 that has no database in it.
 *
 * Worth testing this hard because every branch is a decision someone will
 * eventually question: why does the page heading beat the site title, why does
 * a suspended business get noindex even when it asked to be indexed, why does
 * an empty field mean "inherit" rather than "blank".
 */

const EMPTY_SITE: SiteSeo = {
  siteTitle: null,
  siteDescription: null,
  ogTitle: null,
  ogDescription: null,
  ogImagePath: null,
  twitterImagePath: null,
  robotsIndex: true,
  googleVerification: null,
};

const BUSINESS: BusinessIdentity = {
  name: "Sugu Rolls",
  addressLine: "Av. Larco 123",
  district: "Miraflores",
  city: "Lima",
  phone: "+51 987 654 321",
};

const PAGE: PageSeo = {
  title: "Carta",
  seoTitle: null,
  seoDescription: null,
  ogImagePath: null,
};

describe("singleLine", () => {
  it("collapses the newlines a pasted description arrives with (EC-802)", () => {
    expect(singleLine("Comida\njaponesa\n\nen Miraflores")).toBe("Comida japonesa en Miraflores");
  });

  it("treats whitespace-only text as absent, not as an empty title", () => {
    expect(singleLine("   \n  ")).toBeNull();
    expect(singleLine("")).toBeNull();
    expect(singleLine(null)).toBeNull();
    expect(singleLine(undefined)).toBeNull();
  });
});

describe("truncate (EC-805)", () => {
  it("leaves text that already fits", () => {
    expect(truncate("Carta", 70)).toBe("Carta");
  });

  it("cuts at a word boundary rather than mid-word", () => {
    const value = "Comida japonesa fresca preparada al momento en el corazon de Miraflores Lima";
    const result = truncate(value, 40);
    expect(result.length).toBeLessThanOrEqual(41);
    expect(result.endsWith("…")).toBe(true);
    expect(result).not.toMatch(/\s…$/);
  });

  it("falls back to a hard cut for a single very long word", () => {
    const result = truncate("a".repeat(100), 20);
    expect(result).toBe(`${"a".repeat(20)}…`);
  });
});

describe("the cascade (TEST-812 to TEST-815)", () => {
  it("prefers the page's own SEO title (TEST-812)", () => {
    const resolved = resolveSeo({
      site: { ...EMPTY_SITE, siteTitle: "Sugu Rolls Miraflores" },
      page: { ...PAGE, seoTitle: "Carta de makis y rolls" },
      business: BUSINESS,
      tenantIsServing: true,
    });
    expect(resolved.title).toBe("Carta de makis y rolls");
    expect(resolved.titleIsExplicit).toBe(true);
  });

  it("uses the page heading before the site title", () => {
    const resolved = resolveSeo({
      site: { ...EMPTY_SITE, siteTitle: "Sugu Rolls Miraflores" },
      page: PAGE,
      business: BUSINESS,
      tenantIsServing: true,
    });
    // A page called "Carta" is titled "Carta". The site title is what the HOME
    // page is called, not what every page is called.
    expect(resolved.title).toBe("Carta");
    expect(resolved.titleIsExplicit).toBe(false);
  });

  it("uses the site title when there is no page at all (TEST-813)", () => {
    const resolved = resolveSeo({
      site: { ...EMPTY_SITE, siteTitle: "Sugu Rolls Miraflores" },
      business: BUSINESS,
      tenantIsServing: true,
    });
    expect(resolved.title).toBe("Sugu Rolls Miraflores");
  });

  it("derives the title from the business when nothing is filled in (TEST-814)", () => {
    const resolved = resolveSeo({
      site: EMPTY_SITE,
      business: BUSINESS,
      tenantIsServing: true,
    });
    expect(resolved.title).toBe("Sugu Rolls");
  });

  /*
   * TEST-815 - the premise of the whole phase.
   *
   * Master section 33: each tenant is an independent site. A business that has
   * configured nothing must still not be advertising the platform that hosts
   * it. The root layout's title template is exactly that trap, which is why the
   * site layout overrides it and why this asserts on the resolved values.
   */
  it("never falls back to the platform's own identity (TEST-815)", () => {
    const resolved = resolveSeo({
      site: EMPTY_SITE,
      page: { title: "Inicio", seoTitle: null, seoDescription: null, ogImagePath: null },
      business: BUSINESS,
      tenantIsServing: true,
    });
    const emitted = [resolved.title, resolved.ogTitle, resolved.description ?? ""].join(" ");
    expect(emitted.toLowerCase()).not.toContain("clovercode");
  });

  it("falls back from page description to site description", () => {
    const resolved = resolveSeo({
      site: { ...EMPTY_SITE, siteDescription: "Comida japonesa en Miraflores." },
      page: PAGE,
      business: BUSINESS,
      tenantIsServing: true,
    });
    expect(resolved.description).toBe("Comida japonesa en Miraflores.");
  });

  it("leaves the description null rather than inventing one (EC-801)", () => {
    const resolved = resolveSeo({ site: EMPTY_SITE, business: BUSINESS, tenantIsServing: true });
    expect(resolved.description).toBeNull();
    // The title, however, is never null: that one always resolves.
    expect(resolved.title.length).toBeGreaterThan(0);
  });

  it("reuses the ordinary title and description for the social card", () => {
    const resolved = resolveSeo({
      site: { ...EMPTY_SITE, siteDescription: "Comida japonesa." },
      page: { ...PAGE, seoTitle: "Carta" },
      business: BUSINESS,
      tenantIsServing: true,
    });
    expect(resolved.ogTitle).toBe("Carta");
    expect(resolved.ogDescription).toBe("Comida japonesa.");
  });

  it("prefers the page image over the site image", () => {
    const resolved = resolveSeo({
      site: { ...EMPTY_SITE, ogImagePath: "tenants/x/branding/logo.png" },
      page: { ...PAGE, ogImagePath: "tenants/x/banners/carta.png" },
      business: BUSINESS,
      tenantIsServing: true,
    });
    expect(resolved.imagePath).toBe("tenants/x/banners/carta.png");
  });

  it("trims what it emits, without touching what was stored", () => {
    const long = "x".repeat(400);
    const resolved = resolveSeo({
      site: { ...EMPTY_SITE, siteTitle: long, siteDescription: long },
      business: BUSINESS,
      tenantIsServing: true,
    });
    expect(resolved.title.length).toBeLessThanOrEqual(TITLE_LIMIT + 1);
    expect(resolved.description?.length ?? 0).toBeLessThanOrEqual(DESCRIPTION_LIMIT + 1);
  });
});

describe("robots (TEST-816, TEST-817)", () => {
  it("says noindex when the business asked not to be indexed (TEST-816)", () => {
    const resolved = resolveSeo({
      site: { ...EMPTY_SITE, robotsIndex: false },
      business: BUSINESS,
      tenantIsServing: true,
    });
    expect(resolved.index).toBe(false);
  });

  /*
   * TEST-817 - suspension has to reach the crawler.
   *
   * A suspended business serves no content (Phase 07). If the crawler were
   * still told to index it, search results would keep pointing at a site that
   * shows a notice, for as long as it takes the index to catch up.
   */
  it("says noindex for a suspended business even when it asked to be indexed (TEST-817)", () => {
    const resolved = resolveSeo({
      site: { ...EMPTY_SITE, robotsIndex: true },
      business: BUSINESS,
      tenantIsServing: false,
    });
    expect(resolved.index).toBe(false);
  });

  it("says index for an active business that wants to be found", () => {
    const resolved = resolveSeo({ site: EMPTY_SITE, business: BUSINESS, tenantIsServing: true });
    expect(resolved.index).toBe(true);
  });
});

describe("canonical URLs", () => {
  it("is absolute over the tenant's own domain", () => {
    expect(canonicalUrl("sugurolls.com", "/sitio/carta")).toBe("https://sugurolls.com/sitio/carta");
  });

  it("has no trailing slash at the root", () => {
    expect(canonicalUrl("sugurolls.com", "/")).toBe("https://sugurolls.com");
  });

  it("refuses to paste a path that is not one", () => {
    // A value that does not start with "/" would otherwise concatenate into a
    // different HOST: "https://sugurolls.comevil.com".
    expect(canonicalUrl("sugurolls.com", "evil.com")).toBe("https://sugurolls.com");
  });

  it("maps the home slug to the site root and the rest below it", () => {
    expect(sitePagePath("inicio")).toBe("/sitio");
    expect(sitePagePath("carta")).toBe("/sitio/carta");
  });
});
