import type { DomainVerificationStatus, TenantDomainType, TenantStatus } from "@/types/database";

export type { DomainVerificationStatus, TenantDomainType, TenantStatus };

/**
 * A tenant resolved from the request hostname.
 *
 * Deliberately narrow: only what a request needs in order to know whose site it
 * is serving. Settings, theme and billing belong to later phases and must not
 * be smuggled in here - this object is built on every request.
 */
export interface ResolvedTenant {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  /**
   * `suspended` still resolves, so the application can render a notice rather
   * than a 404. `archived` never resolves.
   */
  readonly status: TenantStatus;
  /** The domain that produced this resolution, as stored. */
  readonly domain: string;
  readonly domainType: TenantDomainType;
  readonly isPrimary: boolean;
}

/** True when the tenant may serve normal traffic. */
export function isTenantServing(tenant: ResolvedTenant): boolean {
  return tenant.status === "active";
}
