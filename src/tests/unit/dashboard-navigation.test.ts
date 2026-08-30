import { describe, expect, it } from "vitest";
import { ALL_MODULES, MODULES, type Module } from "@/lib/features";
import { PERMISSIONS, type Permission } from "@/lib/permissions";
import {
  NAV_ITEMS,
  activeNavKey,
  navItemHref,
  visibleNavItems,
} from "@/modules/dashboard/navigation";

const none = new Set<Permission>();

/**
 * Every module, used by the cases that are about PERMISSIONS.
 *
 * Phase 21 gave `visibleNavItems` a second question to ask; the cases below
 * that predate it are still about the first one, so they run with a business
 * that has bought everything.
 */
const allModules = new Set<Module>(ALL_MODULES);
const withMembers = new Set<Permission>([PERMISSIONS.MEMBERS_VIEW]);

describe("visibleNavItems (TEST-501, TEST-503)", () => {
  it("always shows entries that need no permission", () => {
    const keys = visibleNavItems(none, allModules).map((i) => i.key);
    expect(keys).toContain("home");
  });

  it("hides an entry whose permission is missing", () => {
    expect(visibleNavItems(none, allModules).map((i) => i.key)).not.toContain("members");
  });

  it("shows it once the permission is held", () => {
    expect(visibleNavItems(withMembers, allModules).map((i) => i.key)).toContain("members");
  });

  it("never invents an entry that is not in the catalogue", () => {
    const all = new Set<Permission>(
      NAV_ITEMS.flatMap((i) => (i.permission === undefined ? [] : [i.permission])),
    );
    const keys = visibleNavItems(all, allModules).map((i) => i.key);
    expect(keys).toEqual(NAV_ITEMS.map((i) => i.key));
  });

  it("preserves display order", () => {
    const ordered = visibleNavItems(withMembers, allModules).map((i) => i.key);
    expect(ordered).toEqual(["home", "members"]);
  });
});

describe("the orders entry (Phase 13)", () => {
  const withOrders = new Set<Permission>([PERMISSIONS.ORDERS_VIEW]);

  it("appears for a holder of orders.view", () => {
    expect(visibleNavItems(withOrders, allModules).map((i) => i.key)).toContain("orders");
  });

  it("is hidden without it", () => {
    expect(visibleNavItems(none, allModules).map((i) => i.key)).not.toContain("orders");
  });

  it("points at /pedidos and matches its detail pages", () => {
    const item = NAV_ITEMS.find((i) => i.key === "orders")!;
    expect(navItemHref("sugurolls", item)).toBe("/dashboard/sugurolls/pedidos");
    expect(activeNavKey("sugurolls", "/dashboard/sugurolls/pedidos/abc")).toBe("orders");
  });
});

describe("the customers entry (TEST-1209)", () => {
  const withCustomers = new Set<Permission>([PERMISSIONS.CUSTOMERS_VIEW]);

  it("appears for a holder of customers.view", () => {
    expect(visibleNavItems(withCustomers, allModules).map((i) => i.key)).toContain("customers");
  });

  it("is hidden without it", () => {
    expect(visibleNavItems(none, allModules).map((i) => i.key)).not.toContain("customers");
  });

  it("points at /clientes and is matched by activeNavKey", () => {
    const item = NAV_ITEMS.find((i) => i.key === "customers")!;
    expect(navItemHref("sugurolls", item)).toBe("/dashboard/sugurolls/clientes");
    expect(activeNavKey("sugurolls", "/dashboard/sugurolls/clientes/abc")).toBe("customers");
  });
});

describe("the pos entry (Phase 15)", () => {
  const withOrdersCreate = new Set<Permission>([PERMISSIONS.ORDERS_CREATE]);

  it("appears for a holder of orders.create, not payments.create", () => {
    // Gated the same way the checkout section inside the page hides itself
    // (ADR-019): the nav entry tracks "can build a sale", not "can charge
    // for one".
    expect(visibleNavItems(withOrdersCreate, allModules).map((i) => i.key)).toContain("pos");
    expect(
      visibleNavItems(new Set<Permission>([PERMISSIONS.PAYMENTS_CREATE]), allModules).map(
        (i) => i.key,
      ),
    ).not.toContain("pos");
  });

  it("points at /pos", () => {
    const item = NAV_ITEMS.find((i) => i.key === "pos")!;
    expect(navItemHref("sugurolls", item)).toBe("/dashboard/sugurolls/pos");
    expect(activeNavKey("sugurolls", "/dashboard/sugurolls/pos")).toBe("pos");
  });
});

describe("the kitchen entry (Phase 16)", () => {
  const withOrdersView = new Set<Permission>([PERMISSIONS.ORDERS_VIEW]);

  it("appears for a holder of orders.view - the same permission the kitchen role already has", () => {
    expect(visibleNavItems(withOrdersView, allModules).map((i) => i.key)).toContain("kitchen");
  });

  it("is hidden without it", () => {
    expect(visibleNavItems(none, allModules).map((i) => i.key)).not.toContain("kitchen");
  });

  it("points at /cocina", () => {
    const item = NAV_ITEMS.find((i) => i.key === "kitchen")!;
    expect(navItemHref("sugurolls", item)).toBe("/dashboard/sugurolls/cocina");
    expect(activeNavKey("sugurolls", "/dashboard/sugurolls/cocina")).toBe("kitchen");
  });
});

describe("the cash entry (Phase 14)", () => {
  const withCash = new Set<Permission>([PERMISSIONS.CASH_VIEW]);

  it("appears for a holder of cash.view", () => {
    expect(visibleNavItems(withCash, allModules).map((i) => i.key)).toContain("cash");
  });

  it("is hidden without it", () => {
    expect(visibleNavItems(none, allModules).map((i) => i.key)).not.toContain("cash");
  });

  it("points at /caja", () => {
    const item = NAV_ITEMS.find((i) => i.key === "cash")!;
    expect(navItemHref("sugurolls", item)).toBe("/dashboard/sugurolls/caja");
    expect(activeNavKey("sugurolls", "/dashboard/sugurolls/caja/abc")).toBe("cash");
  });
});

describe("the payment methods entry (Phase 14)", () => {
  const withMethods = new Set<Permission>([PERMISSIONS.PAYMENT_METHODS_VIEW]);

  it("appears for a holder of payment_methods.view, independent of settings.manage", () => {
    // Same posture as domains (Phase 09): admin holds payment_methods.manage
    // but not settings.manage, so this must not depend on the settings entry.
    expect(visibleNavItems(withMethods, allModules).map((i) => i.key)).toContain("payment-methods");
    expect(visibleNavItems(withMethods, allModules).map((i) => i.key)).not.toContain("settings");
  });

  it("points at /configuracion/pagos, distinct from /configuracion", () => {
    const item = NAV_ITEMS.find((i) => i.key === "payment-methods")!;
    expect(navItemHref("sugurolls", item)).toBe("/dashboard/sugurolls/configuracion/pagos");
    expect(activeNavKey("sugurolls", "/dashboard/sugurolls/configuracion/pagos")).toBe(
      "payment-methods",
    );
  });
});

describe("the billing entry (Phase 17)", () => {
  const withBilling = new Set<Permission>([PERMISSIONS.BILLING_VIEW]);

  it("appears for a holder of billing.view", () => {
    expect(visibleNavItems(withBilling, allModules).map((i) => i.key)).toContain("billing");
  });

  it("is hidden without it", () => {
    expect(visibleNavItems(none, allModules).map((i) => i.key)).not.toContain("billing");
  });

  it("points at /facturacion", () => {
    const item = NAV_ITEMS.find((i) => i.key === "billing")!;
    expect(navItemHref("sugurolls", item)).toBe("/dashboard/sugurolls/facturacion");
    expect(activeNavKey("sugurolls", "/dashboard/sugurolls/facturacion")).toBe("billing");
  });
});

describe("the billing config entry (Phase 17)", () => {
  const withManage = new Set<Permission>([PERMISSIONS.BILLING_MANAGE]);

  it("appears for a holder of billing.manage, independent of settings.manage", () => {
    // Same posture as domains and payment-methods (Phase 09/14): admin holds
    // billing.manage but not settings.manage (ADR-021).
    expect(visibleNavItems(withManage, allModules).map((i) => i.key)).toContain("billing-config");
    expect(visibleNavItems(withManage, allModules).map((i) => i.key)).not.toContain("settings");
  });

  it("points at /configuracion/facturacion, distinct from /facturacion", () => {
    const item = NAV_ITEMS.find((i) => i.key === "billing-config")!;
    expect(navItemHref("sugurolls", item)).toBe("/dashboard/sugurolls/configuracion/facturacion");
    expect(activeNavKey("sugurolls", "/dashboard/sugurolls/configuracion/facturacion")).toBe(
      "billing-config",
    );
  });
});

describe("the inventory entry (Phase 18)", () => {
  const withInventory = new Set<Permission>([PERMISSIONS.INVENTORY_VIEW]);

  it("appears for a holder of inventory.view", () => {
    expect(visibleNavItems(withInventory, allModules).map((i) => i.key)).toContain("inventory");
  });

  it("is hidden without it", () => {
    expect(visibleNavItems(none, allModules).map((i) => i.key)).not.toContain("inventory");
  });

  it("points at /inventario", () => {
    const item = NAV_ITEMS.find((i) => i.key === "inventory")!;
    expect(navItemHref("sugurolls", item)).toBe("/dashboard/sugurolls/inventario");
    expect(activeNavKey("sugurolls", "/dashboard/sugurolls/inventario/proveedores")).toBe(
      "inventory",
    );
  });
});

describe("navItemHref", () => {
  it("builds a tenant-scoped path", () => {
    const home = NAV_ITEMS.find((i) => i.key === "home")!;
    const members = NAV_ITEMS.find((i) => i.key === "members")!;
    expect(navItemHref("sugurolls", home)).toBe("/dashboard/sugurolls");
    expect(navItemHref("sugurolls", members)).toBe("/dashboard/sugurolls/miembros");
  });
});

describe("activeNavKey (TEST-502)", () => {
  it("marks the home entry on the tenant root", () => {
    expect(activeNavKey("sugurolls", "/dashboard/sugurolls")).toBe("home");
  });

  it("marks the longest matching segment, not the prefix", () => {
    // The bug this guards: home's segment is "", which prefixes everything.
    expect(activeNavKey("sugurolls", "/dashboard/sugurolls/miembros")).toBe("members");
  });

  it("returns null outside the tenant", () => {
    expect(activeNavKey("sugurolls", "/dashboard/otra-empresa")).toBeNull();
    expect(activeNavKey("sugurolls", "/super-admin/tenants")).toBeNull();
  });
});

describe("module gating (TEST-2102, TEST-2103, TEST-2104)", () => {
  const everyPermission = new Set<Permission>(Object.values(PERMISSIONS));

  it("hides an entry whose module the business does not have (TEST-2102)", () => {
    const withoutPos = new Set<Module>(ALL_MODULES.filter((m) => m !== MODULES.POS));
    const keys = visibleNavItems(everyPermission, withoutPos).map((i) => i.key);

    expect(keys).not.toContain("pos");
    // The permission is held; only the module is missing.
    expect(everyPermission.has(PERMISSIONS.ORDERS_CREATE)).toBe(true);
  });

  it("hides an entry whose permission is missing even with the module (TEST-2103)", () => {
    const keys = visibleNavItems(none, allModules).map((i) => i.key);
    expect(keys).not.toContain("inventory");
  });

  it("draws an entry that declares no module whenever the permission is there (TEST-2104)", () => {
    const noModules = new Set<Module>();
    const keys = visibleNavItems(everyPermission, noModules).map((i) => i.key);

    // Home has neither; locations has a permission and deliberately no module,
    // because every tenant has a location and must be able to edit it
    // (ADR-025 decision 5).
    expect(keys).toContain("home");
    expect(keys).toContain("locations");
    expect(keys).toContain("members");
    expect(keys).toContain("customers");
  });

  it("takes every gated entry away from a business with no modules", () => {
    const keys = visibleNavItems(everyPermission, new Set<Module>()).map((i) => i.key);

    for (const gated of [
      "catalog",
      "orders",
      "pos",
      "inventory",
      "billing",
      "delivery",
      "loyalty",
    ]) {
      expect(keys, `${gated} should be hidden`).not.toContain(gated);
    }
  });

  it("declares only modules that exist in the catalogue", () => {
    for (const item of NAV_ITEMS) {
      if (item.module !== undefined) {
        expect(ALL_MODULES).toContain(item.module);
      }
    }
  });
});
