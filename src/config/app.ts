/**
 * Application-wide constants.
 *
 * Values that never vary per tenant, per environment or per request. Anything
 * that varies per tenant belongs to `tenant_settings` (Phase 06), not here.
 */

export const APP_NAME = "CloverCode";

export const APP_DESCRIPTION =
  "Plataforma SaaS multi-tenant para administrar catalogo, pedidos, punto de venta, inventario y facturacion.";

/**
 * Root domain from which every tenant receives a system subdomain
 * (`{slug}.clovercodeapp.com`). Consumed by the tenant resolver in Phase 01.
 */
export const SYSTEM_DOMAIN = "clovercodeapp.com";

/**
 * DNS targets a business points its own domain at (Phase 09).
 *
 * These are the hosting provider's published values, and they are the one place
 * in the codebase that has to change when the provider changes them. They are
 * constants rather than environment variables on purpose: a wrong value here
 * takes a tenant site off the air, and that should be a reviewed commit rather
 * than a variable somebody edits in a dashboard at midnight.
 *
 * An apex domain gets the A record - DNS forbids a CNAME at a zone apex - and a
 * subdomain gets the CNAME.
 *
 * Pointing DNS here does NOT make a domain work. The provider must also be told
 * to serve that hostname, which is a separate, explicitly tracked fact
 * (`tenant_domains.provider_status`). Master section 33 is emphatic about not
 * conflating the two.
 */
export const DNS_TARGET_IPV4 = "76.76.21.21";
export const DNS_TARGET_CNAME = "cname.vercel-dns.com";

/** Subdomain whose TXT record proves ownership: `_clovercode.sugurolls.com`. */
export const VERIFICATION_RECORD_PREFIX = "_clovercode";

/** Default IANA timezone for a newly provisioned tenant (Phase 06 overrides). */
export const DEFAULT_TIMEZONE = "America/Lima";

/** Default ISO 4217 currency for a newly provisioned tenant. */
export const DEFAULT_CURRENCY = "PEN";

/** Default page size for every paginated listing (section 18: always paginate). */
export const DEFAULT_PAGE_SIZE = 25;

/** Hard upper bound a client may request, so a caller cannot ask for everything. */
export const MAX_PAGE_SIZE = 100;

/**
 * The ceiling every list read carries, even one nobody paginates (Phase 26).
 *
 * Master section 18 forbids "consultas sin límite". The measurement that opened
 * Phase 26 found twenty-six reads with no bound at all - almost all of them over
 * configuration-shaped tables where a business has twelve rows and never a
 * thousand, which is exactly why nobody noticed.
 *
 * The number is deliberately far above what those tables hold. It is not a page
 * size and no screen pages against it: it is the ceiling that turns "this query
 * reads the table" into "this query reads at most this much", so a table that
 * unexpectedly grows degrades a screen instead of taking the request down.
 *
 * A list that can legitimately exceed this needs real pagination, not a bigger
 * ceiling. Raising this number to make a screen work is the wrong fix, and the
 * comment is here so that is obvious to whoever considers it.
 */
export const LIST_CAP = 500;
