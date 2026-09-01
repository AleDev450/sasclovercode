import { describe, expect, it } from "vitest";
import { DEFAULT_PAGE_SIZE, LIST_CAP, MAX_PAGE_SIZE } from "@/config/app";
import { pageFromParam, pageInfo, probeRange, resolvePage, trimProbe } from "@/lib/pagination";

/**
 * TEST-2614 to TEST-2617 — bounded reads, as pure logic.
 *
 * The rule this file exists to hold: **an absent limit means the default, never
 * "no limit"**. Master section 18 forbids unbounded queries, and the way that
 * rule gets broken is not somebody writing `limit: Infinity` - it is somebody
 * calling a list function without arguments and the function obliging.
 */

describe("resolvePage (TEST-2614 to TEST-2616)", () => {
  it("defaults to a page, not to everything (TEST-2614)", () => {
    expect(resolvePage()).toMatchObject({ limit: DEFAULT_PAGE_SIZE, offset: 0 });
    expect(resolvePage({})).toMatchObject({ limit: DEFAULT_PAGE_SIZE });
  });

  /*
   * TEST-2615 - the ceiling is applied on the server.
   *
   * `?limit=1000000` in a URL is a denial of service written as a query
   * parameter. Clamping rather than rejecting is deliberate: the caller gets
   * the first hundred rows and a working page, which is what they would have
   * wanted anyway (SPEC AB-2602).
   */
  it("clamps a limit above the maximum (TEST-2615)", () => {
    expect(resolvePage({ limit: 1_000_000 }).limit).toBe(MAX_PAGE_SIZE);
    expect(resolvePage({ limit: MAX_PAGE_SIZE + 1 }).limit).toBe(MAX_PAGE_SIZE);
  });

  it("accepts a limit below the maximum", () => {
    expect(resolvePage({ limit: 10 }).limit).toBe(10);
  });

  it.each([0, -5, Number.NaN, Number.POSITIVE_INFINITY, 0.4])(
    "falls back to the default for a limit of %s (TEST-2616)",
    (limit) => {
      expect(resolvePage({ limit }).limit).toBe(DEFAULT_PAGE_SIZE);
    },
  );

  it("floors a fractional limit rather than passing it to SQL", () => {
    expect(resolvePage({ limit: 10.9 }).limit).toBe(10);
  });

  it.each([-1, Number.NaN, Number.NEGATIVE_INFINITY])(
    "treats an offset of %s as the first page",
    (offset) => {
      expect(resolvePage({ offset }).offset).toBe(0);
    },
  );

  it("produces inclusive bounds for range()", () => {
    // PostgREST's `.range()` is inclusive on both ends, so a 25-row page
    // starting at 0 ends at 24. An off-by-one here returns 26 rows.
    const page = resolvePage({ limit: 25, offset: 0 });
    expect(page.from).toBe(0);
    expect(page.to).toBe(24);

    const second = resolvePage({ limit: 25, offset: 25 });
    expect(second.from).toBe(25);
    expect(second.to).toBe(49);
  });
});

describe("pageFromParam", () => {
  it.each([undefined, "", "0", "1", "-3", "abc", "1.5"])("reads %s as the first page", (value) => {
    expect(pageFromParam(value, 25)).toBe(0);
  });

  it("converts a 1-based page to a 0-based offset", () => {
    expect(pageFromParam("2", 25)).toBe(25);
    expect(pageFromParam("4", 10)).toBe(30);
  });
});

describe("pageInfo and the probe row (TEST-2617)", () => {
  /*
   * No COUNT(*), on purpose.
   *
   * Counting every matching row on every page view is a second full read of
   * exactly the data the limit exists to avoid, and it buys a total nobody acts
   * on. Fetching one row more than the page answers the only question the UI
   * has: is there another page.
   */
  it("asks for one row more than the page", () => {
    const page = resolvePage({ limit: 25 });
    expect(probeRange(page)).toEqual({ from: 0, to: 25 });
  });

  it("knows there is a next page when the probe row arrives", () => {
    const page = resolvePage({ limit: 25 });
    expect(pageInfo(26, page).hasNext).toBe(true);
    expect(pageInfo(25, page).hasNext).toBe(false);
    expect(pageInfo(3, page).hasNext).toBe(false);
  });

  it("knows there is a previous page only past the first", () => {
    expect(pageInfo(10, resolvePage({ limit: 25, offset: 0 })).hasPrevious).toBe(false);
    expect(pageInfo(10, resolvePage({ limit: 25, offset: 25 })).hasPrevious).toBe(true);
  });

  it("reports a 1-based page number for a person to read", () => {
    expect(pageInfo(10, resolvePage({ limit: 25, offset: 0 })).page).toBe(1);
    expect(pageInfo(10, resolvePage({ limit: 25, offset: 50 })).page).toBe(3);
  });

  it("drops the probe row before anything renders it (TEST-2617)", () => {
    const page = resolvePage({ limit: 3 });
    const rows = [1, 2, 3, 4];
    // The fourth row exists to answer "is there more", and must never reach a
    // screen: a page of three that shows four is a page-size bug in disguise.
    expect(trimProbe(rows, page)).toEqual([1, 2, 3]);
  });

  it("leaves a short page alone", () => {
    const page = resolvePage({ limit: 25 });
    expect(trimProbe([1, 2], page)).toEqual([1, 2]);
  });

  it("does not repeat rows between consecutive pages", () => {
    const all = Array.from({ length: 60 }, (_, i) => i);
    const first = resolvePage({ limit: 25, offset: 0 });
    const second = resolvePage({ limit: 25, offset: 25 });

    const firstRows = all.slice(first.from, first.to + 1);
    const secondRows = all.slice(second.from, second.to + 1);

    expect(firstRows).toHaveLength(25);
    expect(secondRows).toHaveLength(25);
    expect(firstRows.filter((row) => secondRows.includes(row))).toEqual([]);
  });
});

describe("the constants agree with each other", () => {
  it("keeps a default page below the maximum, and both below the ceiling", () => {
    expect(DEFAULT_PAGE_SIZE).toBeLessThanOrEqual(MAX_PAGE_SIZE);
    expect(MAX_PAGE_SIZE).toBeLessThan(LIST_CAP);
  });
});
