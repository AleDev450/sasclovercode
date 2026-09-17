/**
 * The storefront's shared visual vocabulary, as `--site-*` references.
 *
 * Every colour, face and radius here is a custom property that `SiteChrome` sets
 * from the tenant's theme (`modules/seo/theme.ts`). Nothing is a literal colour,
 * which is what lets the same header be Atelier's gold on near-black and Brasa's
 * ember on bone without a branch anywhere.
 *
 * Objects rather than class names because the values are custom properties, and
 * because the section renderer already speaks this dialect: one vocabulary for
 * the CMS sections and the storefront means a restaurant's cart looks like it
 * belongs to the page around it.
 */

import type { CSSProperties } from "react";

export const displayStyle: CSSProperties = {
  color: "var(--site-foreground)",
  fontFamily: "var(--site-display-font)",
  fontWeight: "var(--site-display-weight)",
  letterSpacing: "var(--site-display-tracking)",
  lineHeight: "var(--site-display-leading)",
};

export const eyebrowStyle: CSSProperties = {
  color: "var(--site-accent)",
  letterSpacing: "var(--site-eyebrow-tracking)",
  textTransform: "var(--site-eyebrow-transform)" as "uppercase",
};

export const mutedStyle: CSSProperties = { color: "var(--site-muted)" };
export const subtleStyle: CSSProperties = { color: "var(--site-subtle)" };

/** Geometry of every call to action. Colour arrives in the style objects below. */
export const buttonClass =
  "inline-flex h-12 items-center justify-center gap-2 px-6 text-xs font-semibold transition-[opacity,transform] hover:opacity-90 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2";

export const primaryButtonStyle: CSSProperties = {
  background: "var(--site-primary)",
  color: "var(--site-on-primary)",
  borderRadius: "var(--site-radius-chip)",
  letterSpacing: "var(--site-eyebrow-tracking)",
  textTransform: "var(--site-eyebrow-transform)" as "uppercase",
  boxShadow: "var(--site-shadow)",
  outlineColor: "var(--site-primary)",
};

export const outlineButtonStyle: CSSProperties = {
  background: "transparent",
  color: "var(--site-foreground)",
  border: "1px solid var(--site-border-strong)",
  borderRadius: "var(--site-radius-chip)",
  letterSpacing: "var(--site-eyebrow-tracking)",
  textTransform: "var(--site-eyebrow-transform)" as "uppercase",
  outlineColor: "var(--site-primary)",
};

/** A raised surface: the cart drawer, a dialog, a checkout card. */
export const panelStyle: CSSProperties = {
  background: "var(--site-background)",
  color: "var(--site-foreground)",
  border: "1px solid var(--site-border)",
  borderRadius: "var(--site-radius)",
};

/** A form control on the public site. */
export const fieldClass =
  "h-12 w-full px-4 text-sm outline-none transition-[border-color,box-shadow] focus:ring-2";

export const fieldStyle: CSSProperties = {
  background: "var(--site-surface)",
  color: "var(--site-foreground)",
  border: "1px solid var(--site-border-strong)",
  borderRadius: "var(--site-radius-chip)",
  // The focus ring is the brand colour, via Tailwind's ring colour variable.
  ["--tw-ring-color" as string]: "var(--site-primary-line)",
};

/** Break a block out of the page's max-width container to the viewport edges. */
export const fullBleedClass = "relative left-1/2 w-screen max-w-none -translate-x-1/2";
