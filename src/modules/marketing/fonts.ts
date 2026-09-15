/**
 * The two faces the commercial page is set in.
 *
 * WHY THE LANDING GETS ITS OWN TYPE and the dashboard does not. A dashboard is
 * read all day by somebody who already bought the product; its job is to be
 * invisible, and the system UI face is the right answer there. A landing page
 * is read once, for about four seconds, by somebody deciding whether this looks
 * like software a real company makes. Those are opposite jobs, and the second
 * one is won or lost on the headline.
 *
 * DM Serif Display for the headlines, Inter for everything else. The pairing is
 * a high-contrast Didone-ish serif over a neutral grotesk, which is the grammar
 * of an editorial page rather than of an admin panel - and it is what separates
 * "premium SaaS" from "bootstrap template" far more reliably than any amount of
 * gradient.
 *
 * Self-hosted at build time by `next/font`, like the tenant site faces in
 * `modules/seo/fonts.ts`: no request reaches Google, no cookie crosses to a
 * third party, and `font-src 'self'` in the CSP stays untouched.
 *
 * These PRELOAD, unlike the tenant faces. This is the most-visited anonymous
 * page in the product and the headline is the first thing painted, so the cost
 * of two font files is exactly what is being bought.
 */

import { DM_Serif_Display, Inter } from "next/font/google";

/*
 * The variable names are deliberately NOT `--font-inter`, which is what
 * `modules/seo/fonts.ts` calls its own copy. The two never render on the same
 * page - one is the platform's commercial surface, the other is a tenant's
 * website - but naming them the same would mean that on the day something did
 * put both on a page, one would silently win.
 */

const display = DM_Serif_Display({
  subsets: ["latin"],
  // The family ships one weight. Stating it is required, not decorative.
  weight: "400",
  variable: "--font-marketing-display",
  display: "swap",
});

const body = Inter({
  subsets: ["latin"],
  variable: "--font-marketing-body",
  display: "swap",
});

/**
 * Put this on the element that wraps the commercial pages.
 *
 * `body.className` rather than only its variable, so Inter is the inherited
 * default for the whole subtree and every heading opts INTO the serif with
 * `.type-display` (see `globals.css`). The other way round - a serif default
 * with sans opt-outs - is how a stray paragraph ends up in Georgia.
 */
export const MARKETING_FONT_CLASSNAME = [display.variable, body.variable, body.className].join(" ");
