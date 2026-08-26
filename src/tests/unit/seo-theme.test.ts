import { describe, expect, it } from "vitest";
import { THEME_DEFAULTS, themeCssVariables } from "@/modules/seo/theme";

/**
 * The theme finally reaching the page (KL-708), and the injection surface that
 * comes with it.
 *
 * The database CHECK already constrains every colour to `^#[0-9a-f]{6}$`, so
 * these tests cover the second layer: what this code does with a value that
 * somehow is not one. The reason to have a second layer at all is that the
 * value has crossed PostgREST, JSON and a type assertion since the CHECK ran,
 * and validating six characters costs nothing.
 */

const VALID = {
  primaryColor: "#16a34a",
  accentColor: "#0ea5e9",
  backgroundColor: "#ffffff",
  fontFamily: "poppins",
  borderRadius: "lg",
};

describe("themeCssVariables", () => {
  it("passes a stored theme through as custom properties", () => {
    const vars = themeCssVariables(VALID) as unknown as Record<string, string>;
    expect(vars["--site-primary"]).toBe("#16a34a");
    expect(vars["--site-accent"]).toBe("#0ea5e9");
    expect(vars["--site-background"]).toBe("#ffffff");
    expect(vars["--site-font"]).toContain("Poppins");
    expect(vars["--site-radius"]).toBe("1rem");
  });

  it("prefixes every property so a tenant theme cannot repaint the dashboard", () => {
    const vars = themeCssVariables(VALID) as unknown as Record<string, string>;
    for (const key of Object.keys(vars)) {
      expect(key.startsWith("--site-")).toBe(true);
    }
  });

  /*
   * AB-802. The value below is what a CSS injection looks like: close the
   * declaration, open a rule, and load a remote URL that carries data out.
   *
   * It cannot be stored - the CHECK rejects it - and it cannot be rendered
   * either: React serialises a style OBJECT, escaping what it writes, and this
   * function refuses the value before that. Two layers, and the test asserts
   * the second one on its own.
   */
  it("refuses a colour that is not a colour (AB-802)", () => {
    const vars = themeCssVariables({
      ...VALID,
      primaryColor: "red; background: url(https://evil.example/x)",
    }) as unknown as Record<string, string>;

    expect(vars["--site-primary"]).toBe(THEME_DEFAULTS.primaryColor);
    expect(vars["--site-primary"]).not.toContain("url(");
    expect(vars["--site-primary"]).not.toContain(";");
  });

  it.each([
    ["uppercase hex", "#FFFFFF"],
    ["three-digit hex", "#fff"],
    ["a named colour", "green"],
    ["an empty string", ""],
  ])("falls back to the default for %s", (_label, value) => {
    const vars = themeCssVariables({ ...VALID, primaryColor: value }) as unknown as Record<
      string,
      string
    >;
    expect(vars["--site-primary"]).toBe(THEME_DEFAULTS.primaryColor);
  });

  it("falls back to a known stack for an unknown font", () => {
    const vars = themeCssVariables({
      ...VALID,
      fontFamily: "'; content: 'x",
    }) as unknown as Record<string, string>;
    expect(vars["--site-font"]).toContain("system-ui");
    expect(vars["--site-font"]).not.toContain("content:");
  });

  it("falls back to a known length for an unknown radius", () => {
    const vars = themeCssVariables({ ...VALID, borderRadius: "enormous" }) as unknown as Record<
      string,
      string
    >;
    expect(vars["--site-radius"]).toBe("0.5rem");
  });

  it("uses the same defaults the database column defaults use", () => {
    // If these drift, a tenant that never opened the theme editor renders one
    // way on the site and another way in the preview.
    expect(THEME_DEFAULTS.primaryColor).toBe("#16a34a");
    expect(THEME_DEFAULTS.accentColor).toBe("#0ea5e9");
    expect(THEME_DEFAULTS.backgroundColor).toBe("#ffffff");
    expect(THEME_DEFAULTS.fontFamily).toBe("system");
    expect(THEME_DEFAULTS.borderRadius).toBe("md");
  });
});
