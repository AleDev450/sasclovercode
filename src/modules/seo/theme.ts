/**
 * A tenant theme, expressed as CSS custom properties.
 *
 * Phase 06 stored the theme and Phase 07 rendered sites that ignored it
 * (KL-708). This is where it finally reaches the page, and HOW it reaches the
 * page is the security-relevant part.
 *
 * Values become custom properties on a `style` attribute of one wrapper
 * element. They are NOT concatenated into a `<style>` block, which is the
 * obvious implementation and the wrong one: a stylesheet built by string
 * concatenation is a stylesheet an author can inject into, and CSS injection is
 * not harmless (`background: url(...)` exfiltrates, and a full-viewport overlay
 * is a workable clickjacking primitive). React serialises a style object by
 * escaping it, so no value can end an attribute or start a rule.
 *
 * Two layers hold the guarantee. The database CHECK constrains every colour to
 * `^#[0-9a-f]{6}$` (Phase 06, AB-606), and the guard below re-checks it here.
 * The second check is not redundant paranoia: this value has crossed PostgREST,
 * a JSON boundary and a type assertion since the CHECK ran, and the cost of
 * verifying a six-character string is nothing.
 */

import type { CSSProperties } from "react";

export interface ThemeValues {
  readonly primaryColor: string;
  readonly accentColor: string;
  readonly backgroundColor: string;
  readonly fontFamily: string;
  readonly borderRadius: string;
}

/**
 * Same defaults as the `tenant_themes` column defaults, which are the "Clover"
 * preset (migration 20260914140000).
 *
 * They have to match. This is the fallback the renderer uses when the theme row
 * cannot be read, so a drift shows up as a business whose site changes colour
 * for the duration of a database hiccup.
 */
export const THEME_DEFAULTS: ThemeValues = {
  primaryColor: "#0f766e",
  accentColor: "#14b8a6",
  backgroundColor: "#ffffff",
  fontFamily: "inter",
  borderRadius: "lg",
};

const HEX = /^#[0-9a-f]{6}$/;

/**
 * Font STACKS, not font downloads.
 *
 * A tenant choosing "poppins" selects a stack that prefers it if the visitor
 * has it. Fetching a webfont would add a third-party request to every tenant
 * page - a performance cost and a privacy leak the business did not ask for -
 * and self-hosting the five families belongs to a phase that is about
 * performance, not this one.
 */
const FONT_STACKS: Record<string, string> = {
  system: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  inter: "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  poppins: "Poppins, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  lora: "Lora, Georgia, 'Times New Roman', serif",
  roboto: "Roboto, system-ui, -apple-system, 'Segoe UI', sans-serif",
};

const RADII: Record<string, string> = {
  none: "0px",
  sm: "0.25rem",
  md: "0.5rem",
  lg: "1rem",
  full: "9999px",
};

/** The stored colour if it is one, otherwise the default. Never arbitrary text. */
function safeColor(value: string, fallback: string): string {
  return HEX.test(value) ? value : fallback;
}

/** `#rrggbb` to its three channels. Only ever called on a HEX-validated value. */
function channels(hex: string): [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

/** WCAG relative luminance. 0 is black, 1 is white. */
function luminance(hex: string): number {
  const linear = channels(hex).map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
  }) as [number, number, number];

  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

/** WCAG contrast ratio between two colours. 1 is identical, 21 is black on white. */
function contrast(a: string, b: string): number {
  const one = luminance(a);
  const two = luminance(b);
  const [lighter, darker] = one > two ? [one, two] : [two, one];
  return (lighter + 0.05) / (darker + 0.05);
}

/** The near-black this design system uses for text. Never pure #000. */
const INK = "#111827";

/**
 * Black or white, whichever is readable ON `hex`.
 *
 * WHY THIS IS COMPUTED AND NOT STORED. A business picks three colours; it does
 * not pick "the colour of text on top of my button", and asking it to would be
 * asking it to solve a contrast problem it cannot see.
 *
 * WHY IT MEASURES INSTEAD OF THRESHOLDING. It used to be
 * `luminance(hex) > 0.45 ? ink : white`, and 0.45 is far above the point where
 * the two actually cross over - which for WCAG is a luminance near 0.18. Every
 * mid-tone therefore got WHITE text when black would have been far more
 * readable, and mid-tones are exactly what a brand accent is. Measured across
 * the preset gallery the old rule produced accent badges at 2.1:1 to 3.1:1 -
 * all of them below the 4.5:1 floor, on a value the palette was chosen for.
 * The same nine palettes under this rule land between 4.8:1 and 12.2:1.
 *
 * Asking which of the two candidates wins, rather than guessing from a
 * constant, also means there is no threshold left to be wrong for a colour
 * nobody anticipated - and a business typing its own hex into the custom editor
 * is precisely that case.
 */
function readableOn(hex: string): string {
  return contrast(hex, INK) >= contrast(hex, "#ffffff") ? INK : "#ffffff";
}

/** `rgb(r g b / alpha)` from a hex. For tints that must sit on any background. */
function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = channels(hex);
  return `rgb(${r} ${g} ${b} / ${alpha})`;
}

/**
 * The custom properties a tenant page sets on its wrapper element.
 *
 * Prefixed `--site-` so they cannot collide with the design tokens the
 * dashboard uses: a tenant theme must never repaint the platform's own UI.
 *
 * FIVE ARE STORED, THE REST ARE DERIVED. A theme row holds three colours, a
 * font and a radius. A page needs more than that to look finished - body text,
 * secondary text, hairlines, a panel tint, and a readable label on top of each
 * brand colour - and every one of those is a function of the five.
 *
 * Deriving them rather than storing them is what makes ANY palette safe. When
 * the renderer hard-codes `text-black/60` it is betting that every business
 * picks a light background; when it uses `--site-muted` the bet disappears,
 * because a business that picks a dark background gets light text without
 * anybody having thought about that case.
 */
export function themeCssVariables(theme: ThemeValues): CSSProperties {
  const primary = safeColor(theme.primaryColor, THEME_DEFAULTS.primaryColor);
  const accent = safeColor(theme.accentColor, THEME_DEFAULTS.accentColor);
  const background = safeColor(theme.backgroundColor, THEME_DEFAULTS.backgroundColor);

  // Everything readable is measured against the BACKGROUND, so a dark theme
  // flips the whole page rather than half of it.
  const foreground = readableOn(background);

  const variables: Record<string, string> = {
    "--site-primary": primary,
    "--site-accent": accent,
    "--site-background": background,
    "--site-font": FONT_STACKS[theme.fontFamily] ?? FONT_STACKS.system!,
    "--site-radius": RADII[theme.borderRadius] ?? RADII.md!,

    /** Text that sits on `--site-primary` / `--site-accent`. */
    "--site-on-primary": readableOn(primary),
    "--site-on-accent": readableOn(accent),

    /** Body copy, secondary copy, and the faintest legible step. */
    "--site-foreground": foreground,
    "--site-muted": withAlpha(foreground, 0.65),
    "--site-subtle": withAlpha(foreground, 0.45),

    /** Hairlines and panels, as a tint of the text colour so they always show. */
    "--site-border": withAlpha(foreground, 0.12),
    "--site-surface": withAlpha(foreground, 0.035),

    /** Brand tints, for section bands and badges. */
    "--site-primary-soft": withAlpha(primary, 0.1),
    "--site-accent-soft": withAlpha(accent, 0.12),
  };

  // The cast is to `CSSProperties`, which has no index signature for custom
  // properties. React accepts them at runtime; the type simply predates them.
  return variables as CSSProperties;
}
