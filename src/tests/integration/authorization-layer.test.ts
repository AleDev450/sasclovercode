import { describe, expect, it, vi } from "vitest";
import { AuthorizationError, DatabaseError } from "@/lib/errors";
import { PERMISSIONS, ALL_PERMISSIONS, isPermission } from "@/lib/permissions";
import {
  hasPermission,
  isTenantMember,
  loadMyPermissions,
  requirePermission,
} from "@/lib/permissions/check";
import type { CloverCodeSupabaseClient } from "@/lib/supabase/types";

/**
 * The TypeScript authorization layer.
 *
 * The SQL is proved in `src/tests/database/authorization.test.ts`. Here the
 * client is a stub, so these assertions are about which function gets called
 * with which arguments, and how failure is surfaced.
 */

const TENANT = "11111111-1111-4111-8111-111111111111";

function stub(result: { data?: unknown; error?: unknown }) {
  const rpc = vi.fn().mockResolvedValue({
    data: result.data ?? null,
    error: result.error ?? null,
  });
  return { client: { rpc } as unknown as CloverCodeSupabaseClient, rpc };
}

describe("permission catalogue (TEST-301)", () => {
  /*
   * The count is derived rather than written down.
   *
   * A literal here has to be bumped by every phase that adds a permission, and
   * at that moment the assertion tests nothing but that somebody typed the new
   * number. What is worth asserting is the property: no duplicates. The
   * catalogue is checked NAME BY NAME against the database in
   * `authorization-schema.test.ts`, which is where a missing or extra
   * permission is actually caught.
   */
  it("exposes a catalogue with no duplicates", () => {
    expect(ALL_PERMISSIONS.length).toBeGreaterThan(0);
    expect(new Set(ALL_PERMISSIONS).size).toBe(ALL_PERMISSIONS.length);
  });

  it("uses the resource.action shape the database validates", () => {
    for (const permission of ALL_PERMISSIONS) {
      expect(permission).toMatch(/^[a-z_]+\.[a-z_]+$/);
    }
  });

  it("narrows an unknown code", () => {
    expect(isPermission("orders.cancel")).toBe(true);
    expect(isPermission("orders.obliterate")).toBe(false);
  });
});

describe("hasPermission (TEST-303)", () => {
  it("passes the tenant and permission through to the database", async () => {
    const { client, rpc } = stub({ data: true });

    const result = await hasPermission(TENANT, PERMISSIONS.ORDERS_CANCEL, { client });

    expect(result).toBe(true);
    expect(rpc).toHaveBeenCalledWith("has_permission", {
      p_tenant_id: TENANT,
      p_permission: "orders.cancel",
    });
  });

  it("returns false when the database says false", async () => {
    const { client } = stub({ data: false });
    await expect(hasPermission(TENANT, PERMISSIONS.SETTINGS_MANAGE, { client })).resolves.toBe(
      false,
    );
  });

  it("treats a null answer as denied, never as allowed", async () => {
    const { client } = stub({ data: null });
    await expect(hasPermission(TENANT, PERMISSIONS.ORDERS_VIEW, { client })).resolves.toBe(false);
  });
});

describe("requirePermission (TEST-304, TEST-305)", () => {
  it("returns quietly when the permission is held", async () => {
    const { client } = stub({ data: true });
    await expect(
      requirePermission(TENANT, PERMISSIONS.ORDERS_CREATE, { client }),
    ).resolves.toBeUndefined();
  });

  it("throws AuthorizationError when it is not", async () => {
    const { client } = stub({ data: false });
    await expect(requirePermission(TENANT, PERMISSIONS.ORDERS_CANCEL, { client })).rejects.toThrow(
      AuthorizationError,
    );
  });

  it("does not leak the tenant id or the permission to the caller", async () => {
    const { client } = stub({ data: false });
    try {
      await requirePermission(TENANT, PERMISSIONS.SETTINGS_MANAGE, { client });
      expect.unreachable("should have thrown");
    } catch (error) {
      const authError = error as AuthorizationError;
      // The technical message carries the detail for the logs...
      expect(authError.message).toContain("settings.manage");
      // ...but what reaches the user says nothing about either.
      expect(authError.publicMessage).not.toContain("settings.manage");
      expect(authError.publicMessage).not.toContain(TENANT);
      expect(authError.httpStatus).toBe(403);
    }
  });
});

describe("isTenantMember", () => {
  it("calls the membership function", async () => {
    const { client, rpc } = stub({ data: true });
    await expect(isTenantMember(TENANT, { client })).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith("is_tenant_member", { p_tenant_id: TENANT });
  });
});

describe("loadMyPermissions (TEST-306)", () => {
  it("returns the set of permissions", async () => {
    const { client } = stub({
      data: [{ permission: "orders.view" }, { permission: "cash.open" }],
    });

    const permissions = await loadMyPermissions(TENANT, { client });

    expect(permissions.has(PERMISSIONS.ORDERS_VIEW)).toBe(true);
    expect(permissions.has(PERMISSIONS.CASH_OPEN)).toBe(true);
    expect(permissions.has(PERMISSIONS.SETTINGS_MANAGE)).toBe(false);
    expect(permissions.size).toBe(2);
  });

  it("returns an empty set when the user has none", async () => {
    const { client } = stub({ data: [] });
    await expect(loadMyPermissions(TENANT, { client })).resolves.toEqual(new Set());
  });

  it("drops a code TypeScript does not know rather than widening the type", async () => {
    const { client } = stub({
      data: [{ permission: "orders.view" }, { permission: "future.permission" }],
    });

    const permissions = await loadMyPermissions(TENANT, { client });
    expect(permissions.size).toBe(1);
    expect(permissions.has(PERMISSIONS.ORDERS_VIEW)).toBe(true);
  });
});

describe("failure handling (TEST-307)", () => {
  it.each([
    ["hasPermission", () => hasPermission(TENANT, PERMISSIONS.ORDERS_VIEW, stubError().options)],
    ["isTenantMember", () => isTenantMember(TENANT, stubError().options)],
    ["loadMyPermissions", () => loadMyPermissions(TENANT, stubError().options)],
  ])("%s converts a query failure into DatabaseError", async (_label, run) => {
    await expect(run()).rejects.toThrow(DatabaseError);
  });

  it("does not leak the database message", async () => {
    const { options } = stubError();
    try {
      await hasPermission(TENANT, PERMISSIONS.ORDERS_VIEW, options);
      expect.unreachable("should have thrown");
    } catch (error) {
      const dbError = error as DatabaseError;
      expect(dbError.publicMessage).not.toContain("tenant_members");
      expect(dbError.publicMessage).toBe("A data error occurred. Please try again.");
    }
  });

  it("fails closed: an error never resolves to true", async () => {
    const { options } = stubError();
    await expect(hasPermission(TENANT, PERMISSIONS.SETTINGS_MANAGE, options)).rejects.toThrow();
  });
});

function stubError() {
  const { client } = stub({
    error: { message: "permission denied for table tenant_members", code: "42501" },
  });
  return { options: { client } };
}
