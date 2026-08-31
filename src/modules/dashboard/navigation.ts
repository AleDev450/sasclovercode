/**
 * Dashboard navigation, derived from permissions.
 *
 * Pure and free of I/O so the rules can be asserted directly. Master section 45
 * is the thing to keep in mind while reading this file: **hiding an entry is
 * not access control**. This decides what is DRAWN. Every page it points at
 * checks its own permission again, because a URL can be typed.
 */

import type { Module } from "@/lib/features";
import { MODULES } from "@/lib/features";
import type { Permission } from "@/lib/permissions";
import { PERMISSIONS } from "@/lib/permissions";

export interface NavItem {
  readonly key: string;
  readonly label: string;
  /** Appended to `/dashboard/{slug}`. Empty string is the tenant home. */
  readonly segment: string;
  /** Omitted means every member sees it. */
  readonly permission?: Permission;
  /**
   * Omitted means every plan includes it (Phase 21).
   *
   * A permission and a module are different questions: the permission asks
   * whether THIS PERSON may, the module asks whether THIS BUSINESS bought it.
   * An entry needs both to be drawn, and the page it points at re-checks both,
   * because hiding is not access control (master section 45).
   */
  readonly module?: Module;
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
    module: MODULES.CATALOG,
  },
  {
    key: "content",
    label: "Contenido",
    segment: "/contenido",
    permission: PERMISSIONS.CONTENT_MANAGE,
    module: MODULES.WEBSITE,
  },
  {
    key: "navigation",
    label: "Navegacion",
    segment: "/navegacion",
    permission: PERMISSIONS.CONTENT_MANAGE,
    module: MODULES.WEBSITE,
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
    module: MODULES.ORDERS,
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
    module: MODULES.POS,
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
    module: MODULES.ORDERS,
  },
  /*
   * Next to the kitchen board and for the same reason: both are screens
   * somebody watches during service. `deliveries.view` and not
   * `delivery_zones.view` - the price list is configuration and lives under
   * Configuracion, the way domains and payment methods already do.
   */
  {
    key: "delivery",
    label: "Delivery",
    segment: "/delivery",
    permission: PERMISSIONS.DELIVERIES_VIEW,
    module: MODULES.DELIVERY,
  },
  {
    key: "customers",
    label: "Clientes",
    segment: "/clientes",
    permission: PERMISSIONS.CUSTOMERS_VIEW,
  },
  /*
   * Next to customers, because that is what both are about: the promotions
   * screen is where a business decides what to give away, and fidelizacion is
   * who it has given it to. Both sit above the back-office configuration for
   * the same reason orders does - a cashier opens them during service.
   */
  {
    key: "promotions",
    label: "Promociones",
    segment: "/promociones",
    permission: PERMISSIONS.PROMOTIONS_VIEW,
    module: MODULES.LOYALTY,
  },
  {
    key: "loyalty",
    label: "Fidelizacion",
    segment: "/fidelizacion",
    permission: PERMISSIONS.LOYALTY_VIEW,
    module: MODULES.LOYALTY,
  },
  {
    key: "cash",
    label: "Caja",
    segment: "/caja",
    permission: PERMISSIONS.CASH_VIEW,
    module: MODULES.ORDERS,
  },
  /*
   * Above the back-office configuration and below the operational screens: a
   * report is something a manager opens once a day, not once a service.
   * `reports.view` has existed since Phase 03 and governs something for the
   * first time here.
   */
  {
    key: "reports",
    label: "Reportes",
    segment: "/reportes",
    permission: PERMISSIONS.REPORTS_VIEW,
    module: MODULES.REPORTS,
  },
  {
    key: "billing",
    label: "Facturacion",
    segment: "/facturacion",
    permission: PERMISSIONS.BILLING_VIEW,
    module: MODULES.BILLING,
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
    module: MODULES.INVENTORY,
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
    module: MODULES.ORDERS,
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
    module: MODULES.BILLING,
  },
  /*
   * Same shape again: `delivery_zones.view` reaches cashier and the rider,
   * neither of whom holds `settings.manage`, so the price list needs its own
   * entry rather than a link inside a page they cannot open.
   */
  {
    key: "delivery-zones",
    label: "Zonas de reparto",
    segment: "/configuracion/delivery",
    permission: PERMISSIONS.DELIVERY_ZONES_VIEW,
    module: MODULES.DELIVERY,
  },
  {
    key: "settings",
    label: "Configuracion",
    segment: "/configuracion",
    permission: PERMISSIONS.SETTINGS_MANAGE,
  },
  /*
   * No module of its own, deliberately: a business must always be able to see
   * what it has contracted, including when what it has contracted is very
   * little. Gating the plan page behind a plan would be a locked door with the
   * key inside.
   */
  {
    key: "plan",
    label: "Plan",
    segment: "/configuracion/plan",
    permission: PERMISSIONS.SETTINGS_MANAGE,
  },
  /*
   * Last, and with no module either - for a different reason than the plan
   * page above. Auditing is not a capability CloverCode sells: master section
   * 33 names exactly ten modules in Phase 21, and paywalling a compliance
   * record would be both outside that list and the wrong thing to charge for.
   *
   * `audit.view` reaches owner, admin and accountant only. Notably NOT
   * manager, who holds `products.update` and `orders.cancel` and is therefore
   * one of the main subjects of this log (ADR-028 decision 7).
   */
  {
    key: "audit",
    label: "Auditoria",
    segment: "/auditoria",
    permission: PERMISSIONS.AUDIT_VIEW,
  },
];

/** The entries a holder of `permissions` in a tenant with `modules` may see. */
export function visibleNavItems(
  permissions: ReadonlySet<Permission>,
  modules: ReadonlySet<Module>,
): readonly NavItem[] {
  return NAV_ITEMS.filter(
    (item) =>
      (item.permission === undefined || permissions.has(item.permission)) &&
      (item.module === undefined || modules.has(item.module)),
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
