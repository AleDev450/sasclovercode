import { describe, expect, it } from "vitest";
import { customerFiltersSchema, customerSchema } from "@/modules/customers/schemas";

/**
 * Phase 12 - the form contract (TEST-1208).
 *
 * The document is validated as a PAIR. Every interesting case here is a
 * relationship between two fields rather than a property of one, which is why
 * the schema uses `superRefine` and why these tests exist separately from the
 * pure document tests.
 */

const base = { name: "Ana Quispe", docType: "", docNumber: "", email: "", phone: "" };

describe("the document pair (TEST-1208)", () => {
  it("accepts a customer with no document at all", () => {
    const result = customerSchema.safeParse(base);
    expect(result.success).toBe(true);
    expect(result.data?.docType).toBeNull();
    expect(result.data?.docNumber).toBeNull();
  });

  it("rejects a type with no number", () => {
    const result = customerSchema.safeParse({ ...base, docType: "dni" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["docNumber"]);
  });

  it("rejects a number with no type", () => {
    const result = customerSchema.safeParse({ ...base, docNumber: "45678912" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["docType"]);
  });

  it("normalises the number before validating it", () => {
    const result = customerSchema.safeParse({
      ...base,
      docType: "dni",
      docNumber: "45.678.912",
    });
    expect(result.success).toBe(true);
    expect(result.data?.docNumber).toBe("45678912");
  });

  it("rejects a RUC with a bad check digit, at the number field", () => {
    const result = customerSchema.safeParse({
      ...base,
      docType: "ruc",
      docNumber: "20131312954",
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["docNumber"]);
  });

  it("rejects a document type that is not one of the three", () => {
    const result = customerSchema.safeParse({
      ...base,
      docType: "pasaporte",
      docNumber: "AB123456",
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["docType"]);
  });
});

describe("contact fields", () => {
  it("lowercases the email, because the unique index is on lower(email)", () => {
    const result = customerSchema.safeParse({ ...base, email: "ANA@Example.PE" });
    expect(result.data?.email).toBe("ana@example.pe");
  });

  it("turns an empty email and phone into null, not an empty string", () => {
    const result = customerSchema.safeParse(base);
    expect(result.data?.email).toBeNull();
    expect(result.data?.phone).toBeNull();
  });

  it("normalises the phone", () => {
    const result = customerSchema.safeParse({ ...base, phone: "+51 987 654 321" });
    expect(result.data?.phone).toBe("+51987654321");
  });

  it("rejects a phone too short to be one", () => {
    const result = customerSchema.safeParse({ ...base, phone: "123" });
    expect(result.success).toBe(false);
  });

  it("requires a name", () => {
    const result = customerSchema.safeParse({ ...base, name: "   " });
    expect(result.success).toBe(false);
  });
});

describe("listing filters", () => {
  /*
   * These arrive from the query string, which is typed by hand and linked to
   * from elsewhere. Nothing here may throw.
   */
  it("defaults to page one, active only, no search", () => {
    const result = customerFiltersSchema.parse({});
    expect(result).toEqual({ search: null, includeInactive: false, page: 1 });
  });

  it("survives a nonsense page number", () => {
    for (const page of ["0", "-3", "abc", ""]) {
      expect(customerFiltersSchema.parse({ page }).page, page).toBe(1);
    }
  });

  it("treats only '1' as asking for inactive customers", () => {
    expect(customerFiltersSchema.parse({ includeInactive: "1" }).includeInactive).toBe(true);
    expect(customerFiltersSchema.parse({ includeInactive: "true" }).includeInactive).toBe(false);
  });

  it("turns a blank search into null", () => {
    expect(customerFiltersSchema.parse({ search: "   " }).search).toBeNull();
  });
});
