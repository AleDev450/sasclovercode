import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * `requireActiveTenant` ends the request with Next's `notFound()`, which throws
 * a sentinel the framework recognises and turns into a real 404. Asserting on
 * that sentinel is what proves the guard produces a 404 rather than merely
 * intending one - the Phase 05 audit changed the guard precisely because a
 * custom error class carried no such guarantee.
 */
const NEXT_NOT_FOUND = "NEXT_HTTP_ERROR_FALLBACK;404";

function isNextNotFound(error: unknown): boolean {
  return (error as { digest?: string } | null)?.digest === NEXT_NOT_FOUND;
}

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
 */
async function load() {
  vi.resetModules();
  return import("@/lib/tenant/active");
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
    const { requireActiveTenant } = await load();

    await expect(requireActiveTenant("polleria-el-rey")).rejects.toSatisfy(isNextNotFound);
  });

  it.each(["invited", "suspended"] as const)(
    "throws NotFound for a %s membership",
    async (status) => {
      memberships.current = [{ ...ACTIVE, status }];
      const { requireActiveTenant } = await load();

      await expect(requireActiveTenant("sugurolls")).rejects.toSatisfy(isNextNotFound);
    },
  );

  it("throws NotFound when the user belongs to nothing", async () => {
    memberships.current = [];
    const { requireActiveTenant } = await load();
    await expect(requireActiveTenant("sugurolls")).rejects.toSatisfy(isNextNotFound);
  });

  it.each(["", "   "])("throws NotFound for the empty slug %j", async (slug) => {
    memberships.current = [ACTIVE];
    const { requireActiveTenant } = await load();
    await expect(requireActiveTenant(slug)).rejects.toSatisfy(isNextNotFound);
  });

  it("produces a real 404, not merely an error meaning 404 (AB-502)", async () => {
    memberships.current = [ACTIVE];
    const { requireActiveTenant } = await load();

    try {
      await requireActiveTenant("polleria-el-rey");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as { digest?: string }).digest).toBe(NEXT_NOT_FOUND);
    }
  });

  it("gives the identical answer for a foreign tenant and one that does not exist", async () => {
    // Any difference between the two is an oracle for enumerating CloverCode's
    // customers by trying slugs.
    memberships.current = [ACTIVE];
    const { requireActiveTenant } = await load();

    const foreign = await requireActiveTenant("polleria-el-rey").catch((e: unknown) => e);
    const missing = await requireActiveTenant("no-existe-jamas").catch((e: unknown) => e);

    expect((foreign as { digest?: string }).digest).toBe((missing as { digest?: string }).digest);
    expect((foreign as Error).message).toBe((missing as Error).message);
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
