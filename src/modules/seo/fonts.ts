/**
 * The typefaces a tenant website is actually allowed to be set in.
 *
 * WHY THIS FILE EXISTS AT ALL. `theme.ts` used to hand out stacks like
 * `"Lora, Georgia, serif"` with a comment explaining that fetching a webfont
 * "would add a third-party request to every tenant page - a performance cost
 * and a privacy leak the business did not ask for". The reasoning was right and
 * the consequence was not examined: almost nobody has Lora installed, so a
 * business that chose it got Georgia, a business that chose Poppins got
 * whatever `system-ui` resolves to, and every site in the product came out set
 * in the same operating-system sans. Typography is most of what separates a
 * restaurant site that looks expensive from one that looks like a form, and the
 * product was shipping one font with five names on it.
 *
 * `next/font/google` removes the dilemma rather than splitting it. The files
 * are downloaded AT BUILD TIME and served from this origin, so a visitor makes
 * no request to Google, no cookie crosses to a third party, and `font-src
 * 'self'` in the CSP (`lib/security/csp.ts`) stays exactly as strict as it is.
 * The privacy argument the old comment made is satisfied; what is dropped is
 * only the assumption that self-hosting was impossible.
 *
 * WHY `preload: false` ON EVERY FAMILY. These are for tenant WEBSITES. The
 * dashboard - which is most of this application's routes and all of its
 * authenticated traffic - is set in the platform's own type and must not pay
 * for six families it never draws. With preloading off the `@font-face` rules
 * still ship, and the browser fetches a file the moment a page actually uses
 * it, which is exactly the set of pages that render `SiteChrome` or a theme
 * preview.
 *
 * `display: "swap"` for the same reason: a menu that is readable in a fallback
 * face immediately beats one that is invisible for 300ms, and the metric
 * overrides Next.js derives from the fallback keep the reflow small.
 */

import {
  Archivo,
  Cormorant_Garamond,
  DM_Sans,
  Fraunces,
  Inter,
  Jost,
  Playfair_Display,
} from "next/font/google";

/*
 * The `variable` names below are the contract with `FONT_STACKS` in `theme.ts`,
 * which spells them out as `var(--font-...)`. They cannot be shared through a
 * constant - `next/font` requires literal options so it can resolve the files
 * during the build - so `src/tests/unit/seo-theme.test.ts` reads both files and
 * fails if a name declared here stops being referenced there.
 */

/** Atelier's display face. A high-contrast old-style serif; set it large. */
const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  variable: "--font-cormorant",
  display: "swap",
  preload: false,
});

/** Atelier's body face. Geometric, quiet, and narrow enough to stay elegant. */
const jost = Jost({
  subsets: ["latin"],
  variable: "--font-jost",
  display: "swap",
  preload: false,
});

/** Brasa's display face. A soft serif with enough weight to carry a grill. */
const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
  preload: false,
  // Fraunces is a variable font with an optical-size and a "softness" axis.
  // `SOFT` is what keeps the heavy weights from reading as a slab, which is the
  // difference between a parrilla and a hardware shop.
  axes: ["SOFT", "WONK", "opsz"],
});

/** Marea's display face. Editorial, the face of a printed menu. */
const playfair = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-playfair",
  display: "swap",
  preload: false,
});

/** Marea's body face. Open and neutral, so the serif does the talking. */
const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
  display: "swap",
  preload: false,
});

/**
 * Kept because it is the body face of the theme every existing tenant is on.
 *
 * Before this file, `inter` in a theme row meant "Inter if the visitor happens
 * to have it", which on a phone is never. It now means Inter.
 */
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
  preload: false,
});

/**
 * Carbon's display face, condensed.
 *
 * Loaded with its WIDTH axis, because the look is Archivo at 78% width and a
 * static instance of the family only ships at 100%. That is what
 * `--site-display-stretch` drives; without the axis the property would
 * silently do nothing and the caps would come out a third wider than designed.
 * Variable weight too - no `weight` list - which `next/font` requires when an
 * axis is requested.
 */
const archivo = Archivo({
  subsets: ["latin"],
  variable: "--font-archivo",
  display: "swap",
  preload: false,
  axes: ["wdth"],
});

/**
 * Put this on the element that also carries the `--site-*` custom properties.
 *
 * Every element that renders tenant markup needs it - `SiteChrome` for the real
 * site and the preview route, and `ThemePreview` for the miniatures in the
 * dashboard - because a theme is not its palette alone and a preview set in the
 * wrong face is a preview of a different website.
 */
export const SITE_FONT_CLASSNAME = [
  cormorant.variable,
  jost.variable,
  fraunces.variable,
  playfair.variable,
  dmSans.variable,
  inter.variable,
  archivo.variable,
].join(" ");
