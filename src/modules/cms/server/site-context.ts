import "server-only";

/**
 * The tenant a public request belongs to.
 *
 * This is where the Phase 01 resolver finally gets used for what it was built
 * for. `getCurrentTenant()` reads the Host header and returns the tenant that
 * owns it - which is the only thing that decides whose website a visitor sees.
 */

import { cache } from "react";
import { SYSTEM_DOMAIN } from "@/config/app";
import { getActiveTenant } from "@/lib/tenant/active";
import { getCurrentTenant } from "@/lib/tenant/context";
import { getPrimaryDomain } from "@/modules/seo/server/queries";
import type { ResolvedTenant } from "@/lib/tenant/types";

export interface SiteContext {
  readonly tenant: ResolvedTenant;
  /** True when the business may show content at all. */
  readonly isServing: boolean;
}

/**
 * Resolves the site for this request, or null when no tenant owns the hostname.
 *
 * A suspended business resolves but does not serve: the caller renders a notice
 * instead of the site. That split is why this returns a flag rather than just
 * filtering suspended tenants out - a bare 404 would tell the owner nothing.
 */
export const getSiteContext = cache(async (): Promise<SiteContext | null> => {
  const tenant = await getCurrentTenant();
  if (tenant === null) return null;
  return { tenant, isServing: tenant.status === "active" };
});

/**
 * Signing moved to `lib/storage/sign.ts` when the admin side gained upload
 * controls that also have to display what is stored. Re-exported here so every
 * existing caller - the site layout, the page view, the SEO metadata builder,
 * and the tests that mock this module - is untouched by the move.
 */
export { signAssetPaths } from "@/lib/storage/sign";

/**
 * The site context for a PREVIEW, resolved from a slug instead of a hostname.
 *
 * WHY A PREVIEW EXISTS AT ALL. The dashboard lives on one hostname (master
 * section 28) and a tenant site lives on its own, so "see my website" from
 * inside the editor is a link to a different origin - which works in production
 * once DNS exists, and does not work at all on a preview deployment, where the
 * whole platform answers on a single `*.vercel.app` name that belongs to no
 * tenant. Until this existed, the only way to look at a newly created business
 * was to already have its domain serving.
 *
 * WHY IT IS NOT A HOLE. The tenant comes from `getActiveTenant`, which matches
 * the slug against the CALLER'S OWN memberships - the same function every
 * dashboard page uses, resolved from `auth.uid()` in the database. Somebody who
 * is not a member of the business gets nothing, exactly as if they had typed
 * its dashboard URL. Every query underneath still runs under that identity and
 * under the same policies; nothing here elevates anything.
 */
export const getPreviewSiteContext = cache(async (slug: string): Promise<SiteContext | null> => {
  const active = await getActiveTenant(slug);
  if (active === null) return null;

  const domain = await getPrimaryDomain(active.id);

  return {
    tenant: {
      id: active.id,
      slug: active.slug,
      name: active.name,
      status: active.status,
      // The domain a real visitor WOULD arrive on. Used for canonical URLs and
      // structured data, so a preview does not invent a different identity for
      // the same business.
      domain: domain ?? `${active.slug}.${SYSTEM_DOMAIN}`,
      domainType: "system",
      isPrimary: true,
    },
    isServing: active.status === "active",
  };
});
