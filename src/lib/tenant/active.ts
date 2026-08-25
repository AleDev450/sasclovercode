import "server-only";

/**
 * The active tenant of a dashboard request.
 *
 * The dashboard lives on ONE hostname (master section 28), so the hostname
 * resolver of Phase 01 cannot answer "which business am I working in". The
 * answer comes from the URL segment instead.
 *
 * That segment is client input. It is used to LOOK UP a membership, never to
 * authorise one: `requireActiveTenant` matches the slug against the caller's
 * own memberships, which the database resolved from `auth.uid()`. A slug the
 * caller does not belong to simply finds nothing.
 */

import { notFound } from "next/navigation";
import { cache } from "react";
import { getMyMemberships } from "@/lib/auth/membership";
import type { Membership } from "@/lib/auth/types";
import { logger } from "@/lib/logger";

/** The tenant a dashboard request is scoped to. */
export interface ActiveTenant {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly status: Membership["tenantStatus"];
  readonly role: Membership["role"];
  readonly membershipId: string;
}

function toActiveTenant(membership: Membership): ActiveTenant {
  return {
    id: membership.tenantId,
    slug: membership.tenantSlug,
    name: membership.tenantName,
    status: membership.tenantStatus,
    role: membership.role,
    membershipId: membership.id,
  };
}

/**
 * Resolves a slug to the caller's own membership, or `null`.
 *
 * Memoised per request so a layout and its page share one lookup.
 */
export const getActiveTenant = cache(async (slug: string): Promise<ActiveTenant | null> => {
  const normalised = slug.trim().toLowerCase();
  if (normalised.length === 0) return null;

  const memberships = await getMyMemberships();
  const match = memberships.find((m) => m.tenantSlug === normalised);

  // Only an ACTIVE membership grants access. `invited` was never accepted and
  // `suspended` was taken away; neither is access.
  if (match === undefined || match.status !== "active") return null;

  return toActiveTenant(match);
});

/**
 * Same, but ends the request when there is no access.
 *
 * Calls Next's `notFound()` rather than throwing our own `NotFoundError`.
 *
 * `notFound()` is the documented way for a Server Component to produce a 404;
 * it throws a sentinel the framework recognises. Throwing a domain error and
 * expecting Next to infer HTTP semantics from the class name would be relying
 * on behaviour nobody promised - it might work today and stop working on the
 * next minor. The Phase 05 audit could not establish what the current
 * behaviour actually was, which is itself the argument for being explicit.
 *
 * 404 and never 403: a 403 separates "this business does not exist" from "it
 * exists and is not yours", and that distinction lets anyone enumerate
 * CloverCode's customers by trying slugs.
 *
 * `NotFoundError` is still the right thing for Route Handlers and Server
 * Actions, where `toErrorResponse()` maps it to a status.
 */
export async function requireActiveTenant(slug: string): Promise<ActiveTenant> {
  const tenant = await getActiveTenant(slug);

  if (tenant === null) {
    logger.warn("dashboard.tenant.access_denied", { slug });
    notFound();
  }

  return tenant;
}
