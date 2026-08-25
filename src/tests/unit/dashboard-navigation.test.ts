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
