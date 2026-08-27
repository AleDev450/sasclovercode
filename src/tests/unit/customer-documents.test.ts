import { describe, expect, it } from "vitest";
import {
  checkDocument,
  escapeLikePattern,
  isDocType,
  isValidRuc,
  normalizeDocument,
  normalizePhone,
} from "@/modules/customers/documents";

/**
 * Phase 12 - Peruvian documents, as pure logic.
 *
 * The RUC cases are real numbers on purpose. A check-digit algorithm tested
 * only against numbers the test itself generated proves that the function
 * agrees with itself; two RUCs anybody can verify prove it agrees with SUNAT.
 */

describe("normalizeDocument (TEST-1201)", () => {
  it("strips the separators people actually type", () => {
    expect(normalizeDocument("45.678.912")).toBe("45678912");
    expect(normalizeDocument("45 678 912")).toBe("45678912");
    expect(normalizeDocument(" 45678912 ")).toBe("45678912");
  });

  it("uppercases a carne de extranjeria", () => {
    expect(normalizeDocument("abc123456")).toBe("ABC123456");
  });

  it("caps the length at what the column accepts", () => {
    expect(normalizeDocument("1".repeat(30))).toHaveLength(12);
  });
});

describe("DNI (TEST-1202)", () => {
  it("accepts exactly eight digits", () => {
    expect(checkDocument("dni", "45678912").ok).toBe(true);
  });

  it("rejects seven, nine, and anything with a letter", () => {
    for (const bad of ["4567891", "456789123", "4567891a"]) {
      expect(checkDocument("dni", bad).ok, bad).toBe(false);
    }
  });

  it("explains the fix rather than the rule", () => {
    expect(checkDocument("dni", "123").reason).toContain("8 digitos");
  });
});

describe("RUC check digit (TEST-1203, TEST-1204, TEST-1205)", () => {
  it("accepts real RUCs (TEST-1203)", () => {
    // SUNAT itself, and Banco de Crédito del Perú.
    expect(isValidRuc("20131312955")).toBe(true);
    expect(isValidRuc("20100047218")).toBe(true);
  });

  it("rejects the same RUCs with the check digit changed (TEST-1204)", () => {
    expect(isValidRuc("20131312954")).toBe(false);
    expect(isValidRuc("20100047219")).toBe(false);
  });

  it("rejects an impossible taxpayer prefix (TEST-1205)", () => {
    // Correct length, wrong kind of taxpayer.
    expect(isValidRuc("12345678901")).toBe(false);
    expect(isValidRuc("99131312955")).toBe(false);
  });

  it("rejects anything that is not eleven digits", () => {
    for (const bad of ["2013131295", "201313129551", "2013131295a", ""]) {
      expect(isValidRuc(bad), bad).toBe(false);
    }
  });

  it("names the last digit when that is what is wrong", () => {
    expect(checkDocument("ruc", "20131312954").reason).toContain("ultimo digito");
  });

  it("distinguishes a wrong length from a wrong check digit", () => {
    expect(checkDocument("ruc", "201313129").reason).toContain("11 digitos");
  });
});

describe("carne de extranjeria (TEST-1206)", () => {
  it("accepts eight to twelve alphanumeric characters", () => {
    expect(checkDocument("ce", "ABC123456").ok).toBe(true);
    expect(checkDocument("ce", "001234567890").ok).toBe(true);
  });

  it("rejects too short and anything with a symbol", () => {
    expect(checkDocument("ce", "ABC1234").ok).toBe(false);
    expect(checkDocument("ce", "ABC-123456").ok).toBe(false);
  });
});

describe("normalizePhone (TEST-1207)", () => {
  it("keeps the country prefix and drops everything else", () => {
    expect(normalizePhone("+51 987 654 321")).toBe("+51987654321");
    expect(normalizePhone("987-654-321")).toBe("987654321");
    expect(normalizePhone(" 987654321 ")).toBe("987654321");
  });

  it("returns empty for something with no digits at all", () => {
    expect(normalizePhone("no tengo")).toBe("");
    expect(normalizePhone("")).toBe("");
  });
});

describe("isDocType", () => {
  it("accepts the three of master section 33 and nothing else", () => {
    expect(isDocType("dni")).toBe(true);
    expect(isDocType("ruc")).toBe(true);
    expect(isDocType("ce")).toBe(true);
    expect(isDocType("pasaporte")).toBe(false);
  });
});

describe("escapeLikePattern (EC-1210)", () => {
  /*
   * Without this a search for "%" lists the whole customer book, which is the
   * one query this phase exists to make hard.
   */
  it("neutralises the ILIKE wildcards", () => {
    expect(escapeLikePattern("%")).toBe("\\%");
    expect(escapeLikePattern("_")).toBe("\\_");
    expect(escapeLikePattern("50%_off")).toBe("50\\%\\_off");
  });

  it("escapes the escape character itself", () => {
    expect(escapeLikePattern("a\\b")).toBe("a\\\\b");
  });

  it("leaves ordinary text alone", () => {
    expect(escapeLikePattern("Ana Quispe")).toBe("Ana Quispe");
  });
});
