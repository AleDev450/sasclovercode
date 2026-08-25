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

/** Default IANA timezone for a newly provisioned tenant (Phase 06 overrides). */
export const DEFAULT_TIMEZONE = "America/Lima";

/** Default ISO 4217 currency for a newly provisioned tenant. */
export const DEFAULT_CURRENCY = "PEN";

/** Default page size for every paginated listing (section 18: always paginate). */
export const DEFAULT_PAGE_SIZE = 25;

/** Hard upper bound a client may request, so a caller cannot ask for everything. */
export const MAX_PAGE_SIZE = 100;
