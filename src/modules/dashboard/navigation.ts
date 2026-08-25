/**
 * Dashboard navigation, derived from permissions.
 *
 * Pure and free of I/O so the rules can be asserted directly. Master section 45
 * is the thing to keep in mind while reading this file: **hiding an entry is
 * not access control**. This decides what is DRAWN. Every page it points at
 * checks its own permission again, because a URL can be typed.
 */

import type { Permission } from "@/lib/permissions";
import { PERMISSIONS } from "@/lib/permissions";

export interface NavItem {
  readonly key: string;
  readonly label: string;
  /** Appended to `/dashboard/{slug}`. Empty string is the tenant home. */
  readonly segment: string;
  /** Omitted means every member sees it. */
  readonly permission?: Permission;
}

/** Every entry the dashboard can show, in display order. */
export const NAV_ITEMS: readonly NavItem[] = [
  { key: "home", label: "Inicio", segment: "" },
  {
    key: "members",
    label: "Miembros",
    segment: "/miembros",
    permission: PERMISSIONS.MEMBERS_VIEW,
  },
  {
    key: "settings",
    label: "Configuracion",
    segment: "/configuracion",
    permission: PERMISSIONS.SETTINGS_MANAGE,
  },
];

/** The entries a holder of `permissions` may see. */
export function visibleNavItems(permissions: ReadonlySet<Permission>): readonly NavItem[] {
  return NAV_ITEMS.filter(
    (item) => item.permission === undefined || permissions.has(item.permission),
  );
}

/** Absolute path of an entry within a tenant. */
export function navItemHref(tenantSlug: string, item: NavItem): string {
  return `/dashboard/${tenantSlug}${item.segment}`;
}

/**
 * Which entry a pathname belongs to.
 *
 * Longest segment wins, so `/miembros` is not reported as the home entry just
 * because home's segment is a prefix of everything.
 */
export function activeNavKey(tenantSlug: string, pathname: string): string | null {
  const base = `/dashboard/${tenantSlug}`;
  if (!pathname.startsWith(base)) return null;

  const rest = pathname.slice(base.length);

  const match = [...NAV_ITEMS]
    .filter((item) => item.segment === "" || rest.startsWith(item.segment))
    .sort((a, b) => b.segment.length - a.segment.length)[0];

  return match?.key ?? null;
}
