import { describe, expect, it } from "vitest";
import {
  formatCurrency,
  formatMoney,
  isValidCents,
  MAX_CENTS,
  multiplyMoney,
  parseMoney,
  percentOfMoney,
  sumMoney,
} from "@/lib/money";

/**
 * TEST-1101 to TEST-1109 — money, which master section 39 says must never be a
 * float.
 *
 * The decision is integers in the minor unit (ADR-015), and the point of these
 * tests is to hold the property that follows from it: arithmetic here is exact,
 * not approximately right. The last test in the first block is the reason the
 * decision exists at all.
 */

describe("parseMoney (TEST-1101 to TEST-1104)", () => {
  it.each([
    ["24.90", 2490],
    ["24.9", 2490],
    ["24", 2400],
    ["0", 0],
    ["0.05", 5],
    ["  18.00  ", 1800],
    // A Peruvian keyboard and a Peruvian spreadsheet both produce this.
    ["24,90", 2490],
    ["-5.50", -550],
  ])("reads %s as %i cents", (input, expected) => {
    expect(parseMoney(input)).toMatchObject({ ok: true, cents: expected });
  });

  /*
   * TEST-1103. Three decimals is rejected rather than rounded.
   *
   * "24.905" is a typo or a misunderstanding about what a price is, and quietly
   * turning it into 24.91 hides both - the business would never learn that the
   * system cannot represent what they typed.
   */
  it("refuses three decimals rather than rounding them (TEST-1103)", () => {
    expect(parseMoney("24.905").ok).toBe(false);
  });

  it.each(["", "   ", "abc", "24.90.1", "S/ 24.90", "1e3", "24 90", "."])(
    "refuses %s (TEST-1104)",
    (input) => {
      expect(parseMoney(input).ok).toBe(false);
    },
  );

  it("refuses an amount beyond the accepted ceiling", () => {
    expect(parseMoney(`${MAX_CENTS}0.00`).ok).toBe(false);
  });

  it("explains why it refused, in words a person can act on", () => {
    const result = parseMoney("veinticuatro");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("24.90");
  });

  /*
   * The implementation splits the string; it never multiplies a parsed float by
   * 100. `Number("8.07") * 100` is 806.9999999999999, and this is the input
   * that catches a version that did.
   */
  it("is exact for the values that break the obvious implementation", () => {
    for (const [input, expected] of [
      ["8.07", 807],
      ["1.10", 110],
      ["1.15", 115],
      ["29.97", 2997],
      ["1234.56", 123456],
    ] as const) {
      expect(parseMoney(input), input).toMatchObject({ ok: true, cents: expected });
    }
  });
});

describe("formatMoney (TEST-1105, TEST-1106)", () => {
  it.each([
    [2490, "24.90"],
    [0, "0.00"],
    // TEST-1106: a lone cent still gets two decimals.
    [1, "0.01"],
    [5, "0.05"],
    [100, "1.00"],
    [-550, "-5.50"],
    [123456, "1234.56"],
  ])("writes %i as %s", (cents, expected) => {
    expect(formatMoney(cents)).toBe(expected);
  });

  /*
   * The round trip is what makes this usable in a form: the value a field shows
   * is the value it will read back, for every amount.
   */
  it("round-trips through parseMoney for every amount tried", () => {
    for (let cents = 0; cents < 2000; cents += 7) {
      expect(parseMoney(formatMoney(cents)).cents, String(cents)).toBe(cents);
    }
  });
});

describe("formatCurrency", () => {
  it("uses the symbol when it knows one", () => {
    expect(formatCurrency(2490, "PEN")).toBe("S/ 24.90");
    expect(formatCurrency(2490, "USD")).toBe("$ 24.90");
  });

  it("falls back to the ISO code rather than inventing a symbol", () => {
    expect(formatCurrency(500000, "CLP")).toBe("CLP 5000.00");
  });

  it("does not care how the code was typed", () => {
    expect(formatCurrency(100, " pen ")).toBe("S/ 1.00");
  });
});

describe("arithmetic (TEST-1107 to TEST-1109)", () => {
  it("multiplies by a whole quantity exactly (TEST-1107)", () => {
    expect(multiplyMoney(2490, 3)).toBe(7470);
  });

  it("rounds a fractional quantity to a whole cent", () => {
    // 0.75 kg at S/ 13.33 is 999.75 cents, which does not exist.
    expect(multiplyMoney(1333, 0.75)).toBe(1000);
  });

  it("never returns a fraction of a cent", () => {
    for (const quantity of [0.1, 0.333, 1.5, 2.25, 7.77]) {
      expect(Number.isInteger(multiplyMoney(1999, quantity)), String(quantity)).toBe(true);
    }
  });

  it("treats a non-finite quantity as zero rather than producing NaN", () => {
    expect(multiplyMoney(2490, Number.NaN)).toBe(0);
    expect(multiplyMoney(2490, Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("sums a long list exactly (TEST-1108)", () => {
    const amounts = Array.from({ length: 1000 }, () => 1999);
    expect(sumMoney(amounts)).toBe(1_999_000);
  });

  /*
   * TEST-1109 - the reason ADR-015 exists, in one line.
   *
   * In floating point, 0.1 + 0.2 is 0.30000000000000004. In cents it is 10 + 20
   * = 30, and there is nothing to round because there was never a fraction. A
   * till that is one cent out at the end of a shift is a real problem for a real
   * business, and this is the arithmetic that prevents it.
   */
  it("has no floating point error, by construction (TEST-1109)", () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(sumMoney([10, 20])).toBe(30);

    // A hundred items at S/ 0.07, which in floats drifts visibly.
    const floatTotal = Array.from({ length: 100 }, () => 0.07).reduce((a, b) => a + b, 0);
    expect(floatTotal).not.toBe(7);
    expect(sumMoney(Array.from({ length: 100 }, () => 7))).toBe(700);
  });

  it("computes a percentage the same way everywhere", () => {
    // 18% IGV on S/ 24.90 is 448.2 cents, which rounds to 448.
    expect(percentOfMoney(2490, 18)).toBe(448);
    expect(percentOfMoney(1000, 10)).toBe(100);
    expect(percentOfMoney(0, 18)).toBe(0);
  });
});

describe("isValidCents", () => {
  it.each([0, 1, 2490, MAX_CENTS, -100])("accepts %i", (value) => {
    expect(isValidCents(value)).toBe(true);
  });

  it.each([1.5, Number.NaN, Number.POSITIVE_INFINITY, MAX_CENTS + 1])("refuses %s", (value) => {
    expect(isValidCents(value)).toBe(false);
  });

  it("keeps the ceiling far below the point integers stop being exact", () => {
    // Thousands of maximum-sized amounts can be added without leaving the range
    // where a JavaScript integer is still an integer.
    expect(MAX_CENTS * 1000).toBeLessThan(Number.MAX_SAFE_INTEGER);
  });
});
