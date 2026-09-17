/**
 * Dashboard navigation, derived from permissions.
 *
 * Pure and free of I/O so the rules can be asserted directly. Master section 45
 * is the thing to keep in mind while reading this file: **hiding an entry is
 * not access control**. This decides what is DRAWN. Every page it points at
 * checks its own permission again, because a URL can be typed.
 *
 * WHY ENTRIES CARRY A GROUP. The menu reached twenty-four entries, which is the
 * point at which a flat list stops being a menu and becomes an inventory: every
 * visit meant reading the whole column to find "Cocina", because nothing told
 * the eye where the operational screens ended and the configuration began. The
 * groups below are not new information - they are the structure that was always
 * implied by the ordering comments and was never visible to anybody using it.
 *
 * THE ICON IS A STRING, NOT A COMPONENT. This module is imported by unit tests
 * that assert the rules; keeping it free of JSX keeps it a data file. The
 * client component maps the key to a glyph.
 */

import type { Module } from "@/lib/features";
import { MODULES } from "@/lib/features";
import type { Permission } from "@/lib/permissions";
import { PERMISSIONS } from "@/lib/permissions";

/** The sections the menu is divided into, in display order. */
export const NAV_GROUPS = [
  /**
   * The only group with no heading: one entry, always visible, and a label
   * over a single item is furniture rather than structure.
   */
  { key: "principal", label: "" },
  { key: "ventas", label: "Ventas" },
  { key: "catalogo", label: "Catalogo" },
  { key: "clientes", label: "Clientes" },
  /*
   * The public website, gathered in one place for the first time.
   *
   * Contenido, Navegacion, Tema, SEO and Dominios were spread across the menu
   * and across /configuracion, which is why a business that wanted to change
   * its site had to already know where the five pieces lived.
   */
  { key: "web", label: "Mi web" },
  { key: "gestion", label: "Gestion" },
  { key: "ajustes", label: "Configuracion" },
] as const;

export type NavGroupKey = (typeof NAV_GROUPS)[number]["key"];

export interface NavItem {
  readonly key: string;
  readonly label: string;
  /** Appended to `/dashboard/{slug}`. Empty string is the tenant home. */
  readonly segment: string;
  /** Which section of the menu it is drawn under. */
  readonly group: NavGroupKey;
  /** Key into the glyph map in `dashboard-nav.tsx`. */
  readonly icon: string;
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
  { key: "home", label: "Inicio", segment: "", group: "principal", icon: "home" },

  /* ------------------------------------------------------------- ventas */
  /*
   * The screens somebody has open during service, and the reason this group
   * leads: from Phase 13 this is where the day happens, while the catalogue is
   * something they visit when a price changes.
   *
   * POS is gated on orders.create, not payments.create: building a sale is its
   * core loop, and checkout is one part of the screen that hides itself
   * (ADR-019) for whoever lacks payments.create.
   */
  {
    key: "pos",
    label: "Punto de venta",
    segment: "/pos",
    group: "ventas",
    icon: "pos",
    permission: PERMISSIONS.ORDERS_CREATE,
    module: MODULES.POS,
  },
  {
    key: "orders",
    label: "Pedidos",
    segment: "/pedidos",
    group: "ventas",
    icon: "orders",
    permission: PERMISSIONS.ORDERS_VIEW,
    module: MODULES.ORDERS,
  },
  /*
   * `orders.view` - the same permission the `kitchen` role has held since
   * Phase 03. A station is which board you are looking at, not a different
   * capability (ADR-020).
   */
  {
    key: "kitchen",
    label: "Cocina",
    segment: "/cocina",
    group: "ventas",
    icon: "kitchen",
    permission: PERMISSIONS.ORDERS_VIEW,
    module: MODULES.ORDERS,
  },
  {
    key: "delivery",
    label: "Delivery",
    segment: "/delivery",
    group: "ventas",
    icon: "delivery",
    permission: PERMISSIONS.DELIVERIES_VIEW,
    module: MODULES.DELIVERY,
  },
  {
    key: "cash",
    label: "Caja",
    segment: "/caja",
    group: "ventas",
    icon: "cash",
    permission: PERMISSIONS.CASH_VIEW,
    module: MODULES.ORDERS,
  },

  /* ----------------------------------------------------------- catalogo */
  /*
   * What the business sells and what it holds. Proveedores and compras are
   * reached as links from within inventory rather than as separate entries -
   * the same posture /pedidos/{id} already takes toward its detail routes.
   */
  {
    key: "catalog",
    label: "Catalogo",
    segment: "/catalogo",
    group: "catalogo",
    icon: "catalog",
    permission: PERMISSIONS.PRODUCTS_VIEW,
    module: MODULES.CATALOG,
  },
  {
    key: "inventory",
    label: "Inventario",
    segment: "/inventario",
    group: "catalogo",
    icon: "inventory",
    permission: PERMISSIONS.INVENTORY_VIEW,
    module: MODULES.INVENTORY,
  },
  {
    key: "promotions",
    label: "Promociones",
    segment: "/promociones",
    group: "catalogo",
    icon: "promotions",
    permission: PERMISSIONS.PROMOTIONS_VIEW,
    module: MODULES.LOYALTY,
  },

  /* ----------------------------------------------------------- clientes */
  {
    key: "customers",
    label: "Clientes",
    segment: "/clientes",
    group: "clientes",
    icon: "customers",
    permission: PERMISSIONS.CUSTOMERS_VIEW,
  },
  /*
   * Phase 30. Under Clientes because every sheet is a customer, and with no
   * module: keeping the Libro de Reclamaciones is an obligation of every
   * business that sells to consumers, not a feature somebody buys.
   */
  {
    key: "complaints",
    label: "Libro de reclamaciones",
    segment: "/reclamos",
    group: "clientes",
    icon: "complaints",
    permission: PERMISSIONS.COMPLAINTS_VIEW,
  },
  {
    key: "loyalty",
    label: "Fidelizacion",
    segment: "/fidelizacion",
    group: "clientes",
    icon: "loyalty",
    permission: PERMISSIONS.LOYALTY_VIEW,
    module: MODULES.LOYALTY,
  },

  /* ---------------------------------------------------------------- web */
  /*
   * Phase 29. First in the group because it is the switch that decides whether
   * the website sells at all: web orders on or off, open or closed, delivery or
   * pickup, WhatsApp. `settings.manage`, like the theme below it.
   */
  {
    key: "storefront",
    label: "Tienda online",
    segment: "/tienda",
    group: "web",
    icon: "storefront",
    permission: PERMISSIONS.SETTINGS_MANAGE,
    module: MODULES.WEBSITE,
  },
  {
    key: "content",
    label: "Paginas",
    segment: "/contenido",
    group: "web",
    icon: "content",
    permission: PERMISSIONS.CONTENT_MANAGE,
    module: MODULES.WEBSITE,
  },
  {
    key: "navigation",
    label: "Menu del sitio",
    segment: "/navegacion",
    group: "web",
    icon: "navigation",
    permission: PERMISSIONS.CONTENT_MANAGE,
    module: MODULES.WEBSITE,
  },
  /*
   * Reachable from the menu for the first time. It used to be a text link
   * inside /configuracion, which meant the screen that decides what a customer
   * sees was hidden behind the screen that holds the tax id.
   */
  {
    key: "theme",
    label: "Diseno y marca",
    segment: "/configuracion/tema",
    group: "web",
    icon: "theme",
    permission: PERMISSIONS.SETTINGS_MANAGE,
  },
  {
    key: "seo",
    label: "SEO",
    segment: "/contenido/seo",
    group: "web",
    icon: "seo",
    permission: PERMISSIONS.CONTENT_MANAGE,
    module: MODULES.WEBSITE,
  },
  /*
   * Its own entry rather than a link inside Configuracion, because the two are
   * not reachable by the same people: `admin` holds every permission except
   * `settings.manage`, so an admin can manage domains and cannot open the
   * settings page that would have held the link.
   */
  {
    key: "domains",
    label: "Dominios",
    segment: "/configuracion/dominios",
    group: "web",
    icon: "domains",
    permission: PERMISSIONS.DOMAINS_VIEW,
  },

  /* ------------------------------------------------------------ gestion */
  /*
   * Above the back-office configuration and below the operational screens: a
   * report is something a manager opens once a day, not once a service.
   */
  {
    key: "reports",
    label: "Reportes",
    segment: "/reportes",
    group: "gestion",
    icon: "reports",
    permission: PERMISSIONS.REPORTS_VIEW,
    module: MODULES.REPORTS,
  },
  {
    key: "billing",
    label: "Facturacion",
    segment: "/facturacion",
    group: "gestion",
    icon: "billing",
    permission: PERMISSIONS.BILLING_VIEW,
    module: MODULES.BILLING,
  },
  {
    key: "members",
    label: "Miembros",
    segment: "/miembros",
    group: "gestion",
    icon: "members",
    permission: PERMISSIONS.MEMBERS_VIEW,
  },
  {
    key: "locations",
    label: "Sedes",
    segment: "/sedes",
    group: "gestion",
    icon: "locations",
    permission: PERMISSIONS.LOCATIONS_VIEW,
  },
  /*
   * Last in this group, and with no module: auditing is not a capability
   * CloverCode sells, and paywalling a compliance record would be the wrong
   * thing to charge for. `audit.view` reaches owner, admin and accountant only
   * - notably NOT manager, who is one of the main subjects of this log
   * (ADR-028 decision 7).
   */
  {
    key: "audit",
    label: "Auditoria",
    segment: "/auditoria",
    group: "gestion",
    icon: "audit",
    permission: PERMISSIONS.AUDIT_VIEW,
  },

  /* ------------------------------------------------------------ ajustes */
  {
    key: "settings",
    label: "Datos del negocio",
    segment: "/configuracion",
    group: "ajustes",
    icon: "settings",
    permission: PERMISSIONS.SETTINGS_MANAGE,
  },
  /*
   * Same shape as domains above: `payment_methods.manage` and `billing.manage`
   * are granted to admin, who does not hold `settings.manage` (ADR-021), so
   * neither can be a link inside a page that person cannot open.
   */
  {
    key: "payment-methods",
    label: "Metodos de pago",
    segment: "/configuracion/pagos",
    group: "ajustes",
    icon: "payments",
    permission: PERMISSIONS.PAYMENT_METHODS_VIEW,
    module: MODULES.ORDERS,
  },
  {
    key: "billing-config",
    label: "Series y proveedor",
    segment: "/configuracion/facturacion",
    group: "ajustes",
    icon: "billing-config",
    permission: PERMISSIONS.BILLING_MANAGE,
    module: MODULES.BILLING,
  },
  /*
   * `delivery_zones.view` reaches cashier and the rider, neither of whom holds
   * `settings.manage`, so the price list needs its own entry too.
   */
  {
    key: "delivery-zones",
    label: "Zonas de reparto",
    segment: "/configuracion/delivery",
    group: "ajustes",
    icon: "zones",
    permission: PERMISSIONS.DELIVERY_ZONES_VIEW,
    module: MODULES.DELIVERY,
  },
  /*
   * No module of its own, deliberately: a business must always be able to see
   * what it has contracted, including when what it has contracted is very
   * little. Gating the plan page behind a plan would be a locked door with the
   * key inside.
   */
  {
    key: "plan",
    label: "Plan y suscripcion",
    segment: "/configuracion/plan",
    group: "ajustes",
    icon: "plan",
    permission: PERMISSIONS.SETTINGS_MANAGE,
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

export interface NavGroup {
  readonly key: NavGroupKey;
  readonly label: string;
  readonly items: readonly NavItem[];
}

/**
 * The visible entries, arranged into their sections.
 *
 * A group with nothing in it is dropped rather than rendered as a bare heading:
 * a business on a plan without the website module must not be shown an empty
 * "Mi web" label, which would advertise a door it cannot open while telling it
 * nothing about how to get one.
 */
export function visibleNavGroups(
  permissions: ReadonlySet<Permission>,
  modules: ReadonlySet<Module>,
): readonly NavGroup[] {
  const visible = visibleNavItems(permissions, modules);

  return NAV_GROUPS.map((group) => ({
    key: group.key,
    label: group.label,
    items: visible.filter((item) => item.group === group.key),
  })).filter((group) => group.items.length > 0);
}

/** Absolute path of an entry within a tenant. */
export function navItemHref(tenantSlug: string, item: NavItem): string {
  return `/dashboard/${tenantSlug}${item.segment}`;
}

/**
 * Which entry a pathname belongs to.
 *
 * Longest segment wins, so `/miembros` is not reported as the home entry just
 * because home's segment is a prefix of everything - and `/configuracion/tema`
 * reports the theme entry rather than the settings one.
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
