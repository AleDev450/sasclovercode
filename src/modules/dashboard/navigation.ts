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
    key: "catalog",
    label: "Catalogo",
    segment: "/catalogo",
    permission: PERMISSIONS.PRODUCTS_VIEW,
  },
  {
    key: "content",
    label: "Contenido",
    segment: "/contenido",
    permission: PERMISSIONS.CONTENT_MANAGE,
  },
  {
    key: "navigation",
    label: "Navegacion",
    segment: "/navegacion",
    permission: PERMISSIONS.CONTENT_MANAGE,
  },
  /*
   * Orders sit above the reference data on purpose: from Phase 13 this is the
   * screen somebody has open all day, and the catalogue is something they visit
   * when a price changes.
   */
  {
    key: "orders",
    label: "Pedidos",
    segment: "/pedidos",
    permission: PERMISSIONS.ORDERS_VIEW,
  },
  /*
   * Gated on orders.create, not payments.create: building a sale is POS's
   * core loop, and checkout is one part of the screen that hides itself
   * (ADR-019) for whoever lacks payments.create, the same way the order
   * detail page already hides RecordPaymentForm.
   */
  {
    key: "pos",
    label: "Punto de venta",
    segment: "/pos",
    permission: PERMISSIONS.ORDERS_CREATE,
  },
  /*
   * `orders.view` - the same permission the `kitchen` role has held since
   * Phase 03. A station is which board you're looking at, not a different
   * capability (ADR-020).
   */
  {
    key: "kitchen",
    label: "Cocina",
    segment: "/cocina",
    permission: PERMISSIONS.ORDERS_VIEW,
  },
  {
    key: "customers",
    label: "Clientes",
    segment: "/clientes",
    permission: PERMISSIONS.CUSTOMERS_VIEW,
  },
  {
    key: "cash",
    label: "Caja",
    segment: "/caja",
    permission: PERMISSIONS.CASH_VIEW,
  },
  {
    key: "billing",
    label: "Facturacion",
    segment: "/facturacion",
    permission: PERMISSIONS.BILLING_VIEW,
  },
  {
    key: "locations",
    label: "Sedes",
    segment: "/sedes",
    permission: PERMISSIONS.LOCATIONS_VIEW,
  },
  /*
   * Proveedores and compras are reached as links from within this screen,
   * not separate nav entries - the same posture `/pedidos/{id}` and
   * `/caja/{sessionId}` already take toward their own detail routes.
   */
  {
    key: "inventory",
    label: "Inventario",
    segment: "/inventario",
    permission: PERMISSIONS.INVENTORY_VIEW,
  },
  /*
   * Its own entry rather than a link inside Configuracion, because the two are
   * not reachable by the same people: `admin` holds every permission except
   * `settings.manage`, so an admin can manage domains and cannot open the
   * settings page that would have held the link. Payment methods are the same
   * shape (Phase 14): `payment_methods.manage` is granted to admin too.
   */
  {
    key: "domains",
    label: "Dominios",
    segment: "/configuracion/dominios",
    permission: PERMISSIONS.DOMAINS_VIEW,
  },
  {
    key: "payment-methods",
    label: "Metodos de pago",
    segment: "/configuracion/pagos",
    permission: PERMISSIONS.PAYMENT_METHODS_VIEW,
  },
  /*
   * Same shape as domains/payment-methods above: `billing.manage` is granted
   * to owner and admin only (ADR-021), not folded into settings.manage, so
   * this needs its own entry too.
   */
  {
    key: "billing-config",
    label: "Series y proveedor",
    segment: "/configuracion/facturacion",
    permission: PERMISSIONS.BILLING_MANAGE,
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
