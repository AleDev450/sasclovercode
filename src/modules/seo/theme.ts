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

/** Same defaults as the `tenant_themes` column defaults. */
export const THEME_DEFAULTS: ThemeValues = {
  primaryColor: "#16a34a",
  accentColor: "#0ea5e9",
  backgroundColor: "#ffffff",
  fontFamily: "system",
  borderRadius: "md",
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

/**
 * The custom properties a tenant page sets on its wrapper element.
 *
 * Prefixed `--site-` so they cannot collide with the design tokens the
 * dashboard uses: a tenant theme must never repaint the platform's own UI.
 */
export function themeCssVariables(theme: ThemeValues): CSSProperties {
  const variables: Record<string, string> = {
    "--site-primary": safeColor(theme.primaryColor, THEME_DEFAULTS.primaryColor),
    "--site-accent": safeColor(theme.accentColor, THEME_DEFAULTS.accentColor),
    "--site-background": safeColor(theme.backgroundColor, THEME_DEFAULTS.backgroundColor),
    "--site-font": FONT_STACKS[theme.fontFamily] ?? FONT_STACKS.system!,
    "--site-radius": RADII[theme.borderRadius] ?? RADII.md!,
  };

  // The cast is to `CSSProperties`, which has no index signature for custom
  // properties. React accepts them at runtime; the type simply predates them.
  return variables as CSSProperties;
}
