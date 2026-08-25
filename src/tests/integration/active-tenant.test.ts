import { afterEach, describe, expect, it, vi } from "vitest";
import type { NotFoundError } from "@/lib/errors";

/**
 * The URL segment is client input, and it decides which business a dashboard
 * request works in. These assertions are about the one rule that matters: the
 * slug looks a membership up, it never grants one.
 */

const memberships = vi.hoisted(() => ({ current: [] as unknown[] }));

vi.mock("@/lib/auth/membership", () => ({
  getMyMemberships: async () => memberships.current,
}));

const ACTIVE = {
  id: "m-1",
  tenantId: "t-a",
  tenantSlug: "sugurolls",
  tenantName: "Sugu Rolls",
  tenantStatus: "active" as const,
  role: "owner" as const,
  status: "active" as const,
};

/**
 * Loads the module under test with a fresh registry, so React's `cache()` does
 * not carry an answer from one case into the next.
 *
 * The error class comes back from the SAME registry on purpose: after
 * `resetModules`, a class imported at the top of this file is a different
 * object from the one the reloaded module throws, and `instanceof` would fail
 * on an error that is otherwise perfectly correct.
 */
async function load() {
  vi.resetModules();
  const [active, errors] = await Promise.all([
    import("@/lib/tenant/active"),
    import("@/lib/errors"),
  ]);
  return { ...active, NotFoundError: errors.NotFoundError };
}

afterEach(() => {
  memberships.current = [];
  vi.restoreAllMocks();
});

describe("requireActiveTenant (TEST-504)", () => {
  it("resolves the tenant for an active member", async () => {
    memberships.current = [ACTIVE];
    const { requireActiveTenant } = await load();

    const tenant = await requireActiveTenant("sugurolls");

    expect(tenant).toEqual({
      id: "t-a",
      slug: "sugurolls",
      name: "Sugu Rolls",
      status: "active",
      role: "owner",
      membershipId: "m-1",
    });
  });

  it("normalises case and surrounding whitespace in the slug (EC-503)", async () => {
    memberships.current = [ACTIVE];
    const { requireActiveTenant } = await load();
    await expect(requireActiveTenant("  SuguRolls  ")).resolves.toMatchObject({
      slug: "sugurolls",
    });
  });

  it("carries the tenant status so a suspended business can be flagged", async () => {
    memberships.current = [{ ...ACTIVE, tenantStatus: "suspended" }];
    const { requireActiveTenant } = await load();
    await expect(requireActiveTenant("sugurolls")).resolves.toMatchObject({
      status: "suspended",
    });
  });
});

describe("requireActiveTenant refuses (TEST-505, TEST-506)", () => {
  it("throws NotFound for a tenant the user does not belong to", async () => {
    memberships.current = [ACTIVE];
    const { requireActiveTenant, NotFoundError } = await load();

    await expect(requireActiveTenant("polleria-el-rey")).rejects.toThrow(NotFoundError);
  });

  it.each(["invited", "suspended"] as const)(
    "throws NotFound for a %s membership",
    async (status) => {
      memberships.current = [{ ...ACTIVE, status }];
      const { requireActiveTenant, NotFoundError } = await load();

      await expect(requireActiveTenant("sugurolls")).rejects.toThrow(NotFoundError);
    },
  );

  it("throws NotFound when the user belongs to nothing", async () => {
    memberships.current = [];
    const { requireActiveTenant, NotFoundError } = await load();
    await expect(requireActiveTenant("sugurolls")).rejects.toThrow(NotFoundError);
  });

  it.each(["", "   "])("throws NotFound for the empty slug %j", async (slug) => {
    memberships.current = [ACTIVE];
    const { requireActiveTenant, NotFoundError } = await load();
    await expect(requireActiveTenant(slug)).rejects.toThrow(NotFoundError);
  });

  it("answers 404, never 403 (AB-502)", async () => {
    // A 403 would separate "does not exist" from "exists but is not yours",
    // which is an oracle for enumerating CloverCode's customers.
    memberships.current = [ACTIVE];
    const { requireActiveTenant } = await load();

    try {
      await requireActiveTenant("polleria-el-rey");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as NotFoundError).httpStatus).toBe(404);
    }
  });

  it("gives the same answer for a foreign tenant and one that does not exist", async () => {
    memberships.current = [ACTIVE];
    const { requireActiveTenant } = await load();

    const foreign = await requireActiveTenant("polleria-el-rey").catch((e: NotFoundError) => e);
    const missing = await requireActiveTenant("no-existe-jamas").catch((e: NotFoundError) => e);

    expect((foreign as NotFoundError).publicMessage).toBe((missing as NotFoundError).publicMessage);
    expect((foreign as NotFoundError).httpStatus).toBe((missing as NotFoundError).httpStatus);
  });
});

describe("getActiveTenant", () => {
  it("returns null instead of throwing, for callers that can cope", async () => {
    memberships.current = [ACTIVE];
    const { getActiveTenant } = await load();

    await expect(getActiveTenant("polleria-el-rey")).resolves.toBeNull();
    await expect(getActiveTenant("sugurolls")).resolves.not.toBeNull();
  });

  it("picks the right membership when the user belongs to several", async () => {
    memberships.current = [
      ACTIVE,
      {
        id: "m-2",
        tenantId: "t-b",
        tenantSlug: "polleria-el-rey",
        tenantName: "Pollería El Rey",
        tenantStatus: "active",
        role: "accountant",
        status: "active",
      },
    ];
    const { getActiveTenant } = await load();

    await expect(getActiveTenant("polleria-el-rey")).resolves.toMatchObject({
      id: "t-b",
      role: "accountant",
    });
    await expect(getActiveTenant("sugurolls")).resolves.toMatchObject({
      id: "t-a",
      role: "owner",
    });
  });
});
