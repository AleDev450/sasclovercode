import { describe, expect, it } from "vitest";
import { ValidationError } from "@/lib/errors";
import { validateAsset } from "@/lib/storage/assets";
import { businessSettingsSchema, isKnownTimezone, themeSchema } from "@/modules/settings/schemas";

const TENANT = "11111111-1111-4111-8111-111111111111";
const png = { size: 1024, type: "image/png" };

describe("validateAsset (TEST-622, TEST-623)", () => {
  it("builds a tenant-scoped path", () => {
    const asset = validateAsset({
      tenantId: TENANT,
      folder: "branding",
      basename: "logo",
      file: png,
    });
    expect(asset.path).toBe(`tenants/${TENANT}/branding/logo.png`);
  });

  it("takes the extension from the MIME type, not from any filename", () => {
    const asset = validateAsset({
      tenantId: TENANT,
      folder: "branding",
      // A filename is attacker-controlled; the extension must not come from it.
      basename: "logo.php",
      file: { size: 1024, type: "image/webp" },
    });
    expect(asset.path.endsWith(".webp")).toBe(true);
    expect(asset.path).not.toContain(".php");
  });

  it.each([
    ["a traversal", "../../etc/passwd"],
    ["a separator", "a/b"],
    ["a backslash", "a\b"],
    ["a null byte", "logo\u0000"],
  ])("strips %s from the basename", (_label, basename) => {
    const asset = validateAsset({ tenantId: TENANT, folder: "branding", basename, file: png });
    const suffix = asset.path.slice(`tenants/${TENANT}/branding/`.length);
    expect(suffix).not.toContain("/");
    expect(suffix).not.toContain("\\");
    expect(suffix).not.toContain("..");
  });

  it("rejects a basename that sanitises to nothing", () => {
    expect(() =>
      validateAsset({ tenantId: TENANT, folder: "branding", basename: "///", file: png }),
    ).toThrow(ValidationError);
  });

  it.each([
    ["a script", "application/javascript"],
    ["an executable", "application/x-msdownload"],
    ["an SVG, which can carry script", "image/svg+xml"],
    ["a PDF in the branding folder", "application/pdf"],
  ])("rejects %s", (_label, type) => {
    expect(() =>
      validateAsset({
        tenantId: TENANT,
        folder: "branding",
        basename: "logo",
        file: { size: 1024, type },
      }),
    ).toThrow(ValidationError);
  });

  it("rejects a file over the folder limit", () => {
    expect(() =>
      validateAsset({
        tenantId: TENANT,
        folder: "branding",
        basename: "logo",
        file: { size: 3 * 1024 * 1024, type: "image/png" },
      }),
    ).toThrow(ValidationError);
  });

  it("rejects an empty file", () => {
    expect(() =>
      validateAsset({
        tenantId: TENANT,
        folder: "branding",
        basename: "logo",
        file: { size: 0, type: "image/png" },
      }),
    ).toThrow(ValidationError);
  });

  it("refuses to build a path from a tenant id that is not a uuid", () => {
    expect(() =>
      validateAsset({ tenantId: "../other", folder: "branding", basename: "logo", file: png }),
    ).toThrow(ValidationError);
  });

  it("allows a PDF in documents but not an image type it does not accept", () => {
    expect(
      validateAsset({
        tenantId: TENANT,
        folder: "documents",
        basename: "factura",
        file: { size: 2048, type: "application/pdf" },
      }).path,
    ).toContain("/documents/factura.pdf");
  });
});

describe("settings schema (TEST-621)", () => {
  const base = {
    legalName: "",
    tradeName: "Sugu Rolls",
    taxId: "",
    contactEmail: "",
    phone: "",
    whatsapp: "",
    addressLine: "",
    district: "",
    city: "",
    currency: "PEN",
    timezone: "America/Lima",
  };

  it("accepts a complete, valid form", () => {
    expect(businessSettingsSchema.safeParse(base).success).toBe(true);
  });

  it("turns blank optional fields into null, not empty strings", () => {
    const parsed = businessSettingsSchema.parse(base);
    expect(parsed.legalName).toBeNull();
    expect(parsed.taxId).toBeNull();
  });

  it.each(["123", "abcdefghijk", "2051234567"])("rejects the RUC %j", (taxId) => {
    expect(businessSettingsSchema.safeParse({ ...base, taxId }).success).toBe(false);
  });

  it("accepts a valid RUC", () => {
    expect(businessSettingsSchema.safeParse({ ...base, taxId: "20512345678" }).success).toBe(true);
  });

  it("uppercases the currency and rejects a bad one", () => {
    expect(businessSettingsSchema.parse({ ...base, currency: "pen" }).currency).toBe("PEN");
    expect(businessSettingsSchema.safeParse({ ...base, currency: "PENN" }).success).toBe(false);
  });

  it("rejects a timezone the runtime does not know", () => {
    expect(isKnownTimezone("America/Lima")).toBe(true);
    expect(isKnownTimezone("Mars/Olympus")).toBe(false);
    expect(businessSettingsSchema.safeParse({ ...base, timezone: "Mars/Olympus" }).success).toBe(
      false,
    );
  });
});

describe("theme schema (TEST-621)", () => {
  const base = {
    primaryColor: "#16a34a",
    accentColor: "#0ea5e9",
    backgroundColor: "#ffffff",
    fontFamily: "system",
    borderRadius: "md",
  };

  it("accepts valid values", () => {
    expect(themeSchema.safeParse(base).success).toBe(true);
  });

  it("lowercases a colour so it matches the database CHECK", () => {
    expect(themeSchema.parse({ ...base, primaryColor: "#AABBCC" }).primaryColor).toBe("#aabbcc");
  });

  it.each(["red", "#FFF", "#12345", "rgb(0,0,0)", "javascript:alert(1)"])(
    "rejects the colour %j",
    (colour) => {
      expect(themeSchema.safeParse({ ...base, primaryColor: colour }).success).toBe(false);
    },
  );

  it("rejects a font or radius outside the allowed set", () => {
    expect(themeSchema.safeParse({ ...base, fontFamily: "comic-sans" }).success).toBe(false);
    expect(themeSchema.safeParse({ ...base, borderRadius: "huge" }).success).toBe(false);
  });
});
