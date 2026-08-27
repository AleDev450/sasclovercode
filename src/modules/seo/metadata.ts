/**
 * The SEO cascade, as pure functions.
 *
 * No I/O, no Next.js types, no database. Everything here is "given these
 * values, what should the page say about itself", which is the part worth
 * testing exhaustively and the part most likely to be got subtly wrong.
 *
 * The rule, from SPEC phase-08 FR-811:
 *
 *     page value  ->  site value  ->  something derived from the business
 *
 * The last step is what makes this different from a normal fallback chain: it
 * never yields nothing. A business that has filled in no SEO at all still gets
 * a title with its own name in it, because the alternative - the platform's
 * name on a restaurant's website - contradicts the premise of the phase
 * (master section 33: each tenant is an independent site).
 */

/** Site-wide SEO, as stored. Every text is optional. */
export interface SiteSeo {
  readonly siteTitle: string | null;
  readonly siteDescription: string | null;
  readonly ogTitle: string | null;
  readonly ogDescription: string | null;
  readonly ogImagePath: string | null;
  readonly twitterImagePath: string | null;
  readonly robotsIndex: boolean;
  readonly googleVerification: string | null;
}

/** Per-page overrides. All null on a page nobody has touched. */
export interface PageSeo {
  readonly title: string;
  readonly seoTitle: string | null;
  readonly seoDescription: string | null;
  readonly ogImagePath: string | null;
}

export interface BusinessIdentity {
  /** Trade name if set, otherwise the tenant name. Never empty. */
  readonly name: string;
  readonly addressLine: string | null;
  readonly district: string | null;
  readonly city: string | null;
  readonly phone: string | null;
  /** ISO 4217 code the business's prices are in (Phase 06, read in Phase 11). */
  readonly currency: string;
}

export interface ResolvedSeo {
  readonly title: string;
  readonly description: string | null;
  readonly ogTitle: string;
  readonly ogDescription: string | null;
  readonly imagePath: string | null;
  readonly index: boolean;
  /**
   * True when the title is the one the business typed for THIS page.
   *
   * The renderer appends the business name to a derived title ("Carta ·
   * Sugurolls") but emits an explicit one verbatim: someone who took the
   * trouble to write a title meant that title, not that title plus a suffix.
   */
  readonly titleIsExplicit: boolean;
}

/** Emitted limits. Longer text is stored intact and trimmed on the way out. */
export const TITLE_LIMIT = 70;
export const DESCRIPTION_LIMIT = 160;

/**
 * A single line of text, or null.
 *
 * A description pasted from a document arrives with newlines in it. A meta
 * description is a single attribute value, so the newlines would either be
 * emitted raw or silently mangle the tag; collapsing them is the only sane
 * reading of what the author meant.
 */
export function singleLine(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed.length === 0 ? null : collapsed;
}

/**
 * Shortens to `limit` characters without cutting a word in half.
 *
 * Trimmed at EMIT time, never at write time: the business typed what it typed,
 * and a future channel may allow more than a meta tag does.
 */
export function truncate(value: string, limit: number): string {
  if (value.length <= limit) return value;
  const hard = value.slice(0, limit);
  const lastSpace = hard.lastIndexOf(" ");
  // A single word longer than the limit has no space to cut at; the hard slice
  // is then the only option.
  const cut = lastSpace > limit * 0.6 ? hard.slice(0, lastSpace) : hard;
  return `${cut.trimEnd()}…`;
}

/** First non-empty value of the chain, or null. */
function firstOf(...values: readonly (string | null | undefined)[]): string | null {
  for (const value of values) {
    const line = singleLine(value);
    if (line !== null) return line;
  }
  return null;
}

/**
 * Applies the cascade for one page.
 *
 * `page` is absent for a route that is not a CMS page (the home of a site with
 * no `inicio` page, for instance), in which case only the site level applies.
 */
export function resolveSeo(params: {
  site: SiteSeo;
  page?: PageSeo | null;
  business: BusinessIdentity;
  /** False for a suspended business, whatever its own setting says. */
  tenantIsServing: boolean;
}): ResolvedSeo {
  const { site, page, business, tenantIsServing } = params;

  // The page's own SEO title, then its heading, then the site title, then the
  // business name. The page HEADING sits above the site title on purpose: a
  // page called "Carta" should be titled "Carta", not the site's tagline.
  const title =
    firstOf(page?.seoTitle, page?.title, site.siteTitle, business.name) ?? business.name;

  const description = firstOf(page?.seoDescription, site.siteDescription);

  // The social variants fall back to the ordinary ones: a business that fills
  // in only the title and description gets a correct card for free.
  const ogTitle = firstOf(site.ogTitle) ?? title;
  const ogDescription = firstOf(site.ogDescription, description);

  return {
    title: truncate(title, TITLE_LIMIT),
    description: description === null ? null : truncate(description, DESCRIPTION_LIMIT),
    ogTitle: truncate(ogTitle, TITLE_LIMIT),
    ogDescription: ogDescription === null ? null : truncate(ogDescription, DESCRIPTION_LIMIT),
    imagePath: page?.ogImagePath ?? site.ogImagePath,
    titleIsExplicit: singleLine(page?.seoTitle) !== null,
    /*
     * Two independent reasons to say noindex, and the tenant's own preference
     * is only one of them.
     *
     * A suspended business serves no content (Phase 07), so there is nothing to
     * index and a crawler that indexed it anyway would keep showing a page that
     * no longer exists. Suspension has to reach the crawler, not just the
     * visitor.
     */
    index: tenantIsServing && site.robotsIndex,
  };
}

/**
 * The absolute URL a page canonicalises to.
 *
 * Built from the tenant's own primary domain, never from the Host header: a
 * site reachable on two hostnames must declare ONE canonical, otherwise the two
 * compete with each other in the index. `pathname` is expected to start with a
 * slash; anything else is treated as the site root rather than pasted blindly.
 */
export function canonicalUrl(domain: string, pathname: string): string {
  const path = pathname.startsWith("/") ? pathname : "/";
  return `https://${domain}${path === "/" ? "" : path}`;
}

/** The public path of a CMS page, matching the routes of Phase 07. */
export function sitePagePath(slug: string, homeSlug = "inicio"): string {
  return slug === homeSlug ? "/sitio" : `/sitio/${slug}`;
}
