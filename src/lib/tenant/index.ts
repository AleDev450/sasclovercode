/**
 * Public surface of the tenant layer.
 *
 * `resolve.ts` and `context.ts` are server-only, so they are NOT re-exported
 * here: a barrel that pulled them in would drag `server-only` into every client
 * bundle that wanted the pure helpers. Import them explicitly:
 *
 *   import { getCurrentTenant } from "@/lib/tenant/context";
 *   import { resolveTenantByHostname } from "@/lib/tenant/resolve";
 */
export { normalizeHostname, toLookupDomain } from "./hostname";
export type { LookupOptions } from "./hostname";
export { isTenantServing } from "./types";
export type {
  DomainVerificationStatus,
  ResolvedTenant,
  TenantDomainType,
  TenantStatus,
} from "./types";
