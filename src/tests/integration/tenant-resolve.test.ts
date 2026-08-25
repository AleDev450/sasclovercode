import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "@/config/env";
import { DatabaseError } from "@/lib/errors";
import type { CloverCodeSupabaseClient } from "@/lib/supabase/types";
import { resolveTenantByHostname } from "@/lib/tenant/resolve";

/**
 * Wiring between the pure hostname layer and the database call.
 *
 * The SQL itself is proved in `src/tests/database/`. Here the client is a stub,
 * so these assertions are about which domain gets looked up, how a row is
 * mapped, and how failure is surfaced.
 */

const SYSTEM = "clovercodeapp.com";

interface RpcRow {
  tenant_id: string;
  slug: string;
  name: string;
  status: "active" | "suspended" | "archived";
  domain: string;
  domain_type: "system" | "custom";
  is_primary: boolean;
}

function stubClient(result: { data?: RpcRow[] | null; error?: unknown }) {
  const rpc = vi.fn().mockResolvedValue({
    data: result.data ?? null,
    error: result.error ?? null,
  });
  return { client: { rpc } as unknown as CloverCodeSupabaseClient, rpc };
}

const ROW: RpcRow = {
  tenant_id: "11111111-1111-4111-8111-111111111111",
  slug: "sugurolls",
  name: "Sugu Rolls",
  status: "active",
  domain: "sugurolls.com",
  domain_type: "custom",
  is_primary: true,
};

beforeEach(() => {
  resetEnvCache();
});

afterEach(() => {
  vi.restoreAllMocks();
  resetEnvCache();
});

describe("resolveTenantByHostname (TEST-112)", () => {
  it("looks up the canonical domain for a custom host", async () => {
    const { client, rpc } = stubClient({ data: [ROW] });

    await resolveTenantByHostname("SuguRolls.com:443", {
      client,
      isProduction: true,
      systemDomain: SYSTEM,
    });

    expect(rpc).toHaveBeenCalledWith("resolve_tenant_by_domain", {
      p_hostname: "sugurolls.com",
    });
  });

  it("translates a local development host into the production domain", async () => {
    const { client, rpc } = stubClient({ data: [ROW] });

    await resolveTenantByHostname("sugurolls.localhost:3000", {
      client,
      isProduction: false,
      systemDomain: SYSTEM,
    });

    expect(rpc).toHaveBeenCalledWith("resolve_tenant_by_domain", {
      p_hostname: "sugurolls.clovercodeapp.com",
    });
  });

  it("uses DEV_TENANT_SLUG for bare localhost", async () => {
    const { client, rpc } = stubClient({ data: [ROW] });

    await resolveTenantByHostname("localhost:3000", {
      client,
      isProduction: false,
      systemDomain: SYSTEM,
      devTenantSlug: "sugurolls",
    });

    expect(rpc).toHaveBeenCalledWith("resolve_tenant_by_domain", {
      p_hostname: "sugurolls.clovercodeapp.com",
    });
  });
});

describe("resolveTenantByHostname short-circuits (TEST-113)", () => {
  it.each([
    ["null", null],
    ["an empty host", ""],
    ["the bare platform domain", "clovercodeapp.com"],
    ["a nested subdomain", "a.b.clovercodeapp.com"],
    ["an IP address", "127.0.0.1"],
    ["a control character", "evil\r\n.com"],
  ])("does not touch the database for %s", async (_label, host) => {
    const { client, rpc } = stubClient({ data: [ROW] });

    const result = await resolveTenantByHostname(host, {
      client,
      isProduction: true,
      systemDomain: SYSTEM,
    });

    expect(result).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("does not touch the database for a local host in production", async () => {
    const { client, rpc } = stubClient({ data: [ROW] });

    const result = await resolveTenantByHostname("sugurolls.localhost", {
      client,
      isProduction: true,
      systemDomain: SYSTEM,
      devTenantSlug: "sugurolls",
    });

    expect(result).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("row mapping (TEST-114)", () => {
  it("maps the database row to ResolvedTenant", async () => {
    const { client } = stubClient({ data: [ROW] });

    const tenant = await resolveTenantByHostname("sugurolls.com", {
      client,
      isProduction: true,
      systemDomain: SYSTEM,
    });

    expect(tenant).toEqual({
      id: ROW.tenant_id,
      slug: "sugurolls",
      name: "Sugu Rolls",
      status: "active",
      domain: "sugurolls.com",
      domainType: "custom",
      isPrimary: true,
    });
  });

  it("returns null when the query matches nothing", async () => {
    const { client } = stubClient({ data: [] });

    await expect(
      resolveTenantByHostname("unknown-host.com", {
        client,
        isProduction: true,
        systemDomain: SYSTEM,
      }),
    ).resolves.toBeNull();
  });

  it("returns null when the driver returns null data", async () => {
    const { client } = stubClient({ data: null });

    await expect(
      resolveTenantByHostname("unknown-host.com", {
        client,
        isProduction: true,
        systemDomain: SYSTEM,
      }),
    ).resolves.toBeNull();
  });

  it("surfaces a suspended tenant with its status (EC-111)", async () => {
    const { client } = stubClient({ data: [{ ...ROW, status: "suspended" }] });

    const tenant = await resolveTenantByHostname("sugurolls.com", {
      client,
      isProduction: true,
      systemDomain: SYSTEM,
    });

    expect(tenant?.status).toBe("suspended");
  });

  it("takes only the first row if the driver ever returns several", async () => {
    const other: RpcRow = { ...ROW, tenant_id: "22222222-2222-4222-8222-222222222222" };
    const { client } = stubClient({ data: [ROW, other] });

    const tenant = await resolveTenantByHostname("sugurolls.com", {
      client,
      isProduction: true,
      systemDomain: SYSTEM,
    });

    expect(tenant?.id).toBe(ROW.tenant_id);
  });
});

describe("failure handling (TEST-115)", () => {
  it("converts a query error into a DatabaseError", async () => {
    const { client } = stubClient({
      error: { message: "permission denied for table tenants", code: "42501" },
    });

    await expect(
      resolveTenantByHostname("sugurolls.com", {
        client,
        isProduction: true,
        systemDomain: SYSTEM,
      }),
    ).rejects.toThrow(DatabaseError);
  });

  it("does not leak the database message to the caller", async () => {
    const { client } = stubClient({
      error: { message: 'relation "tenants" does not exist', code: "42P01" },
    });

    try {
      await resolveTenantByHostname("sugurolls.com", {
        client,
        isProduction: true,
        systemDomain: SYSTEM,
      });
      expect.unreachable("should have thrown");
    } catch (error) {
      const dbError = error as DatabaseError;
      expect(dbError.publicMessage).not.toContain("tenants");
      expect(dbError.publicMessage).toBe("A data error occurred. Please try again.");
    }
  });
});
