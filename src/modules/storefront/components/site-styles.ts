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
  // The width axis travels with the face everywhere it is used - a product
  // name in the cart is set in the same condensed cut as the headline above it.
  // The CAPITALS do not: those belong to headlines, and a dish name in caps
  // reads as shouting. See `headlineStyle`.
  fontStretch: "var(--site-display-stretch)",
  letterSpacing: "var(--site-display-tracking)",
  lineHeight: "var(--site-display-leading)",
};

/** The display face at headline scale: `displayStyle` plus the style's case. */
export const headlineStyle: CSSProperties = {
  ...displayStyle,
  textTransform: "var(--site-display-transform)" as "uppercase",
};

export const eyebrowStyle: CSSProperties = {
  color: "var(--site-accent)",
  letterSpacing: "var(--site-eyebrow-tracking)",
  textTransform: "var(--site-eyebrow-transform)" as "uppercase",
};

export const mutedStyle: CSSProperties = { color: "var(--site-muted)" };
export const subtleStyle: CSSProperties = { color: "var(--site-subtle)" };

/**
 * Geometry of every call to action. Colour arrives in the style objects below.
 *
 * It is the same button the CMS sections draw (`section-renderer.tsx`), and it
 * grew for the same reason: this is the control a restaurant's entire site
 * exists to get pressed, and it was the height and the type size of a form
 * field. The lift on hover and the press on click are two classes and the whole
 * of the difference between a control that answers a cursor and one that sits
 * there.
 */
export const buttonClass =
  "inline-flex h-13 items-center justify-center gap-2.5 px-8 text-[0.92rem] font-bold transition-[translate,scale,transform,box-shadow,filter] duration-500 hover:-translate-y-0.5 hover:brightness-110 hover:[--btn-glow:var(--site-glow-strong)] active:translate-y-0 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2";

export const primaryButtonStyle: CSSProperties = {
  background: "var(--site-button-fill)",
  color: "var(--site-button-ink)",
  borderRadius: "var(--site-button-radius)",
  letterSpacing: "var(--site-button-tracking)",
  textTransform: "var(--site-button-transform)" as "uppercase",
  // Through `--btn-glow` so a hover class can raise it: an inline style
  // beats every class, so the shadow itself cannot be the thing the hover sets.
  boxShadow: "var(--btn-glow, var(--site-glow))",
  outlineColor: "var(--site-primary)",
};

export const outlineButtonStyle: CSSProperties = {
  background: "transparent",
  color: "var(--site-foreground)",
  border: "1px solid var(--site-border-strong)",
  borderRadius: "var(--site-button-radius)",
  letterSpacing: "var(--site-button-tracking)",
  textTransform: "var(--site-button-transform)" as "uppercase",
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
