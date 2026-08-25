import type { MembershipStatus, TenantRole } from "@/types/database";

export type { MembershipStatus, TenantRole };

/**
 * The authenticated user, as the application knows them.
 *
 * Deliberately narrow. In particular it carries NO credential material and no
 * raw token: everything here is safe to pass into a Server Component tree.
 */
export interface AuthenticatedUser {
  readonly id: string;
  readonly email: string;
  /** From the profile row, not from `user_metadata`. */
  readonly fullName: string | null;
  readonly avatarUrl: string | null;
}

/** One tenant the current user belongs to. */
export interface Membership {
  readonly id: string;
  readonly tenantId: string;
  readonly tenantSlug: string;
  readonly tenantName: string;
  readonly role: TenantRole;
  readonly status: MembershipStatus;
}

/**
 * True when the membership currently grants access.
 *
 * `invited` means the person was offered access and has not accepted;
 * `suspended` means it was taken away. Neither is access.
 */
export function isActiveMembership(membership: Membership): boolean {
  return membership.status === "active";
}
