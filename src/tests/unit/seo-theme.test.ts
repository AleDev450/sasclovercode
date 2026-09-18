import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  SITE_STYLES,
  THEME_DEFAULTS,
  themeCssVariables,
  type ThemeValues,
} from "@/modules/seo/theme";
import { LEGACY_PRESETS, THEME_PRESETS } from "@/modules/settings/theme-presets";

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

const VALID: ThemeValues = {
  primaryColor: "#16a34a",
  accentColor: "#0ea5e9",
  backgroundColor: "#ffffff",
  fontFamily: "jost",
  borderRadius: "lg",
  style: "marea",
};

describe("themeCssVariables", () => {
  it("passes a stored theme through as custom properties", () => {
    const vars = themeCssVariables(VALID) as unknown as Record<string, string>;
    expect(vars["--site-primary"]).toBe("#16a34a");
    expect(vars["--site-accent"]).toBe("#0ea5e9");
    expect(vars["--site-background"]).toBe("#ffffff");
    expect(vars["--site-font"]).toContain("--font-jost");
    expect(vars["--site-radius"]).toBe("1rem");
    // The chip radius is derived from the same key, never stored beside it.
    expect(vars["--site-radius-chip"]).toBe("0.5rem");
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
    // way on the site and another way in the preview. They are the "Carbon"
    // theme, set by migration 20260919120000.
    expect(THEME_DEFAULTS.primaryColor).toBe("#e36626");
    expect(THEME_DEFAULTS.accentColor).toBe("#f2b23e");
    expect(THEME_DEFAULTS.backgroundColor).toBe("#120b07");
    expect(THEME_DEFAULTS.fontFamily).toBe("inter");
    expect(THEME_DEFAULTS.borderRadius).toBe("lg");
    expect(THEME_DEFAULTS.style).toBe("carbon");
  });

  /*
   * The style is the other half of a theme, and it reaches the page the same
   * way the colours do: as custom properties whose values are literals in
   * `SITE_STYLES`. These assert that half behaves like the first - a key from
   * the closed list resolves, and anything else falls back rather than reaching
   * the DOM.
   */
  it("emits the display face and rhythm of the named style", () => {
    const vars = themeCssVariables({ ...VALID, style: "atelier" }) as unknown as Record<
      string,
      string
    >;
    expect(vars["--site-display-font"]).toContain("--font-cormorant");
    expect(vars["--site-eyebrow-transform"]).toBe("uppercase");
    expect(vars["--site-media-ratio"]).toBe("4 / 5");
    expect(vars["--site-hero-columns"]).toBe("1fr");
  });

  it("falls back to the default style for an unknown one", () => {
    const vars = themeCssVariables({
      ...VALID,
      style: "'; content: 'x",
    }) as unknown as Record<string, string>;

    const atelier = themeCssVariables({ ...VALID, style: "atelier" }) as unknown as Record<
      string,
      string
    >;
    expect(vars["--site-display-font"]).toBe(atelier["--site-display-font"]);
    expect(vars["--site-media-ratio"]).not.toContain("content:");
  });

  /*
   * A DARK PAGE GETS NO SHADOW, which is a rule `shadowFor` holds and nothing
   * else in the product knows about. A drop shadow darkens what is behind it,
   * so on a near-black background the same CSS costs a paint and changes
   * nothing; dark surfaces separate by getting LIGHTER, which `--site-surface`
   * already does because it is a tint of the foreground.
   */
  it("drops shadows on a dark background and keeps the surface lift", () => {
    const dark = themeCssVariables({
      ...VALID,
      backgroundColor: "#121214",
      style: "brasa",
    }) as unknown as Record<string, string>;

    expect(dark["--site-shadow"]).toBe("none");
    // A near-white lift, because the foreground flipped to the light end
    // against this page. `pageInk` warms it, so it is not literally 255s.
    expect(dark["--site-surface"]).toMatch(/rgb\(2\d\d 2\d\d 2\d\d \/ 0.035\)/);

    const light = themeCssVariables({
      ...VALID,
      backgroundColor: "#ffffff",
      style: "brasa",
    }) as unknown as Record<string, string>;
    expect(light["--site-shadow"]).not.toBe("none");
  });

  /*
   * The scrim is the one token assembled by concatenation, so it gets its own
   * assertion that the colour inside it went through `safeColor` first.
   */
  it("builds the image scrim from a validated colour only", () => {
    const vars = themeCssVariables({
      ...VALID,
      backgroundColor: "red; background: url(https://evil.example/x)",
      accentColor: "red; background: url(https://evil.example/y)",
    }) as unknown as Record<string, string>;

    for (const token of ["--site-scrim", "--site-hero-wash"]) {
      expect(vars[token]).not.toContain("url(");
      expect(vars[token]).toContain("linear-gradient");
    }
  });
});

/**
 * The fonts are declared in one file and referenced in another, and
 * `next/font` will not let them share a constant - it needs literal options so
 * it can resolve the files during the build. So the two are checked against
 * each other here instead.
 *
 * WHAT BREAKS WITHOUT THIS. Rename `--font-cormorant` in `fonts.ts` and every
 * Atelier heading silently falls back to Georgia: nothing throws, no test
 * fails, and the only symptom is that the flagship theme stops being the
 * flagship theme on production.
 */
describe("font declarations match the stacks that use them (TEST-0815)", () => {
  const read = (relative: string): string =>
    readFileSync(join(process.cwd(), "src", "modules", "seo", relative), "utf8");

  const DECLARED = /variable:\s*"(--font-[a-z-]+)"/g;
  const USED = /var\((--font-[a-z-]+)\)/g;

  it("references every declared font variable from a stack", () => {
    const declared = [...read("fonts.ts").matchAll(DECLARED)].map((match) => match[1]!);
    const theme = read("theme.ts");

    expect(declared.length).toBeGreaterThanOrEqual(6);
    for (const variable of declared) {
      expect(theme, `${variable} is declared but no stack uses it`).toContain(`var(${variable})`);
    }
  });

  it("declares every font variable a stack asks for", () => {
    const used = [...read("theme.ts").matchAll(USED)].map((match) => match[1]!);
    const fonts = read("fonts.ts");

    expect(used.length).toBeGreaterThanOrEqual(6);
    for (const variable of new Set(used)) {
      expect(fonts, `${variable} is used but never declared`).toContain(`"${variable}"`);
    }
  });

  it("puts every style's display face in the stack table", () => {
    const theme = read("theme.ts");
    for (const style of Object.values(SITE_STYLES)) {
      expect(theme, `${style.id} names a display font nothing declares`).toContain(
        `${style.displayFont}:`,
      );
    }
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

  /**
   * What the measurements below run over: the gallery AND the palettes it
   * stopped offering.
   *
   * Retiring a preset from the gallery does not retire it from the businesses
   * already running it, so dropping the legacy three from these assertions
   * would quietly stop measuring the contrast of most of the live sites. The
   * count above stays on the gallery alone, which is the decision being made.
   */
  const ALL_PALETTES = [...THEME_PRESETS, ...LEGACY_PRESETS];

  it("has presets to measure", () => {
    // One now, and the number is still asserted rather than floored, for the
    // reason it always was: how many finished looks this product offers is a
    // decision somebody takes on purpose. Nine half-designs became three, and
    // three became the one that does not lose next to a site built by hand.
    // The other three live on in `LEGACY_PRESETS` and in `SITE_STYLES`, which
    // the assertions below still cover through the tenants running them.
    expect(THEME_PRESETS).toHaveLength(1);
  });

  it("gives every preset a style that exists", () => {
    for (const preset of ALL_PALETTES) {
      expect(SITE_STYLES[preset.style], preset.id).toBeDefined();
    }
  });

  it("keeps every button and badge label above 4.5:1", () => {
    const failures: string[] = [];

    for (const preset of ALL_PALETTES) {
      const onPrimary = readFrom(preset, "--site-on-primary");
      const onAccent = readFrom(preset, "--site-on-accent");

      const checks: [string, number][] = [
        ["boton principal", ratio(preset.primaryColor, onPrimary)],
        ["badge de acento", ratio(preset.accentColor, onAccent)],
        // `primary` also sets prices and headings directly on the background.
        ["precio sobre el fondo", ratio(preset.primaryColor, preset.backgroundColor)],
        // `accent` sets the overline above every heading, which is type on the
        // page rather than a fill. It was never measured before.
        ["cintillo sobre el fondo", ratio(preset.accentColor, preset.backgroundColor)],
      ];

      for (const [what, value] of checks) {
        if (value < 4.5) failures.push(`${preset.id} — ${what}: ${value.toFixed(2)}:1`);
      }
    }

    expect(failures, `contrasts below 4.5:1:\n${failures.join("\n")}`).toEqual([]);
  });

  it("keeps body text readable on every background, light or dark", () => {
    for (const preset of ALL_PALETTES) {
      const foreground = readFrom(preset, "--site-foreground");
      expect(ratio(foreground, preset.backgroundColor), preset.id).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("covers a dark background, so the derived tokens are exercised", () => {
    // Every `--site-*` value beyond the three stored colours is computed from
    // the background. A gallery of light-only presets would let somebody
    // hard-code `text-black/60` again and never see it break.
    const dark = ALL_PALETTES.filter((preset) => luminance(preset.backgroundColor) < 0.2);
    expect(dark.length).toBeGreaterThanOrEqual(1);

    for (const preset of dark) {
      // Near-white rather than exactly white: `pageInk` mixes a tenth of the
      // page into the ink so the two agree, which on a dark theme takes the
      // glare off. What matters is that it flipped to the light end at all.
      expect(luminance(readFrom(preset, "--site-foreground")), preset.id).toBeGreaterThan(0.7);
    }
  });
});
