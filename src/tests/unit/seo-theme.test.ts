import { describe, expect, it } from "vitest";
import { THEME_DEFAULTS, themeCssVariables, type ThemeValues } from "@/modules/seo/theme";
import { THEME_PRESETS } from "@/modules/settings/theme-presets";

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
    // way on the site and another way in the preview. They are the "Clover"
    // preset, set by migration 20260914140000 - before it, the column defaults
    // were a palette that appeared nowhere in the product.
    expect(THEME_DEFAULTS.primaryColor).toBe("#0f766e");
    expect(THEME_DEFAULTS.accentColor).toBe("#14b8a6");
    expect(THEME_DEFAULTS.backgroundColor).toBe("#ffffff");
    expect(THEME_DEFAULTS.fontFamily).toBe("inter");
    expect(THEME_DEFAULTS.borderRadius).toBe("lg");
  });
});

/**
 * The palettes, measured rather than admired.
 *
 * WHY THIS TEST EXISTS. The preset file used to claim in a comment that "every
 * combination below was checked for contrast", and six of its eight entries had
 * accent badges between 2.1:1 and 3.1:1 - well under the 4.5:1 floor. A comment
 * cannot fail, so it drifted from the truth and nobody found out. This can
 * fail, and it re-derives the ratios from the same function the renderer uses,
 * so a tenth preset added next year is measured on the way in.
 *
 * WHAT IT DOES NOT CHECK: whether a palette is nice. That is the gallery's job
 * and a person's. This only refuses the ones that are unreadable.
 */
describe("preset contrast (TEST-806)", () => {
  const channel = (value: number): number => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };

  const luminance = (hex: string): number =>
    0.2126 * channel(Number.parseInt(hex.slice(1, 3), 16)) +
    0.7152 * channel(Number.parseInt(hex.slice(3, 5), 16)) +
    0.0722 * channel(Number.parseInt(hex.slice(5, 7), 16));

  const ratio = (a: string, b: string): number => {
    const one = luminance(a);
    const two = luminance(b);
    const [lighter, darker] = one > two ? [one, two] : [two, one];
    return (lighter + 0.05) / (darker + 0.05);
  };

  /** Reads the value the renderer actually emits, never a second copy of it. */
  const readFrom = (theme: ThemeValues, name: string): string =>
    (themeCssVariables(theme) as unknown as Record<string, string>)[name]!;

  it("has presets to measure", () => {
    expect(THEME_PRESETS.length).toBeGreaterThanOrEqual(8);
  });

  it("keeps every button and badge label above 4.5:1", () => {
    const failures: string[] = [];

    for (const preset of THEME_PRESETS) {
      const onPrimary = readFrom(preset, "--site-on-primary");
      const onAccent = readFrom(preset, "--site-on-accent");

      const checks: [string, number][] = [
        ["boton principal", ratio(preset.primaryColor, onPrimary)],
        ["badge de acento", ratio(preset.accentColor, onAccent)],
        // `primary` also sets prices and headings directly on the background.
        ["precio sobre el fondo", ratio(preset.primaryColor, preset.backgroundColor)],
      ];

      for (const [what, value] of checks) {
        if (value < 4.5) failures.push(`${preset.id} — ${what}: ${value.toFixed(2)}:1`);
      }
    }

    expect(failures, `contrasts below 4.5:1:\n${failures.join("\n")}`).toEqual([]);
  });

  it("keeps body text readable on every background, light or dark", () => {
    for (const preset of THEME_PRESETS) {
      const foreground = readFrom(preset, "--site-foreground");
      expect(ratio(foreground, preset.backgroundColor), preset.id).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("covers a dark background, so the derived tokens are exercised", () => {
    // Every `--site-*` value beyond the three stored colours is computed from
    // the background. A gallery of light-only presets would let somebody
    // hard-code `text-black/60` again and never see it break.
    const dark = THEME_PRESETS.filter((preset) => luminance(preset.backgroundColor) < 0.2);
    expect(dark.length).toBeGreaterThanOrEqual(1);

    for (const preset of dark) {
      expect(readFrom(preset, "--site-foreground")).toBe("#ffffff");
    }
  });
});
