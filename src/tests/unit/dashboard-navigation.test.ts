import { describe, expect, it } from "vitest";
import { PERMISSIONS, type Permission } from "@/lib/permissions";
import {
  NAV_ITEMS,
  activeNavKey,
  navItemHref,
  visibleNavItems,
} from "@/modules/dashboard/navigation";

const none = new Set<Permission>();
const withMembers = new Set<Permission>([PERMISSIONS.MEMBERS_VIEW]);

describe("visibleNavItems (TEST-501, TEST-503)", () => {
  it("always shows entries that need no permission", () => {
    const keys = visibleNavItems(none).map((i) => i.key);
    expect(keys).toContain("home");
  });

  it("hides an entry whose permission is missing", () => {
    expect(visibleNavItems(none).map((i) => i.key)).not.toContain("members");
  });

  it("shows it once the permission is held", () => {
    expect(visibleNavItems(withMembers).map((i) => i.key)).toContain("members");
  });

  it("never invents an entry that is not in the catalogue", () => {
    const all = new Set<Permission>(
      NAV_ITEMS.flatMap((i) => (i.permission === undefined ? [] : [i.permission])),
    );
    const keys = visibleNavItems(all).map((i) => i.key);
    expect(keys).toEqual(NAV_ITEMS.map((i) => i.key));
  });

  it("preserves display order", () => {
    const ordered = visibleNavItems(withMembers).map((i) => i.key);
    expect(ordered).toEqual(["home", "members"]);
  });
});

describe("the orders entry (Phase 13)", () => {
  const withOrders = new Set<Permission>([PERMISSIONS.ORDERS_VIEW]);

  it("appears for a holder of orders.view", () => {
    expect(visibleNavItems(withOrders).map((i) => i.key)).toContain("orders");
  });

  it("is hidden without it", () => {
    expect(visibleNavItems(none).map((i) => i.key)).not.toContain("orders");
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
    expect(visibleNavItems(withCustomers).map((i) => i.key)).toContain("customers");
  });

  it("is hidden without it", () => {
    expect(visibleNavItems(none).map((i) => i.key)).not.toContain("customers");
  });

  it("points at /clientes and is matched by activeNavKey", () => {
    const item = NAV_ITEMS.find((i) => i.key === "customers")!;
    expect(navItemHref("sugurolls", item)).toBe("/dashboard/sugurolls/clientes");
    expect(activeNavKey("sugurolls", "/dashboard/sugurolls/clientes/abc")).toBe("customers");
  });
});

describe("the cash entry (Phase 14)", () => {
  const withCash = new Set<Permission>([PERMISSIONS.CASH_VIEW]);

  it("appears for a holder of cash.view", () => {
    expect(visibleNavItems(withCash).map((i) => i.key)).toContain("cash");
  });

  it("is hidden without it", () => {
    expect(visibleNavItems(none).map((i) => i.key)).not.toContain("cash");
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
    expect(visibleNavItems(withMethods).map((i) => i.key)).toContain("payment-methods");
    expect(visibleNavItems(withMethods).map((i) => i.key)).not.toContain("settings");
  });

  it("points at /configuracion/pagos, distinct from /configuracion", () => {
    const item = NAV_ITEMS.find((i) => i.key === "payment-methods")!;
    expect(navItemHref("sugurolls", item)).toBe("/dashboard/sugurolls/configuracion/pagos");
    expect(activeNavKey("sugurolls", "/dashboard/sugurolls/configuracion/pagos")).toBe(
      "payment-methods",
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
