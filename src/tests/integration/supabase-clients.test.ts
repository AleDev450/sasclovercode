import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "@/config/env";

/**
 * Integration coverage for the Supabase client factories.
 *
 * No network is touched: the assertions are about wiring (env resolution,
 * cookie adapter, typing) rather than about Supabase itself.
 */

const cookieStore = {
  getAll: vi.fn<() => { name: string; value: string }[]>(() => []),
  set: vi.fn<(name: string, value: string, options?: unknown) => void>(),
};

vi.mock("next/headers", () => ({
  cookies: async () => cookieStore,
}));

const KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_APP_URL",
] as const;

const original: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of KEYS) original[key] = process.env[key];
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abcdefghijklmnop.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
  resetEnvCache();

  cookieStore.getAll.mockReset();
  cookieStore.getAll.mockReturnValue([]);
  cookieStore.set.mockReset();
});

afterEach(() => {
  for (const key of KEYS) {
    const value = original[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetEnvCache();
});

describe("createSupabaseBrowserClient (TEST-019)", () => {
  it("builds a client from the public environment without touching the network", async () => {
    const { createSupabaseBrowserClient } = await import("@/lib/supabase/client");
    const client = createSupabaseBrowserClient();

    expect(client).toBeDefined();
    expect(client.auth).toBeDefined();
    expect(typeof client.from).toBe("function");
  });

  it("fails loudly when the public environment is missing", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    resetEnvCache();

    const { createSupabaseBrowserClient } = await import("@/lib/supabase/client");
    expect(() => createSupabaseBrowserClient()).toThrow(/NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
  });
});

describe("createSupabaseServerClient (TEST-020)", () => {
  it("uses the supplied cookie adapter", async () => {
    const getAll = vi.fn(() => [{ name: "sb-access-token", value: "value" }]);
    const setAll = vi.fn();

    const { createSupabaseServerClient } = await import("@/lib/supabase/server");
    const client = await createSupabaseServerClient({ getAll, setAll });

    expect(client).toBeDefined();

    // Reading the session pulls from cookie storage; no session means no
    // network round trip.
    await client.auth.getSession();
    expect(getAll).toHaveBeenCalled();
  });

  it("returns a NEW client per call, never a shared one", async () => {
    const { createSupabaseServerClient } = await import("@/lib/supabase/server");
    const adapter = { getAll: () => [], setAll: () => undefined };

    const first = await createSupabaseServerClient(adapter);
    const second = await createSupabaseServerClient(adapter);

    expect(first).not.toBe(second);
  });

  it("defaults to the Next.js cookie store when no adapter is given", async () => {
    cookieStore.getAll.mockReturnValue([{ name: "sb-token", value: "abc" }]);

    const { createSupabaseServerClient } = await import("@/lib/supabase/server");
    const client = await createSupabaseServerClient();
    await client.auth.getSession();

    expect(cookieStore.getAll).toHaveBeenCalled();
  });
});

describe("read-only cookie store (TEST-021, EC-05)", () => {
  it("swallows the write that a Server Component is not allowed to perform", async () => {
    cookieStore.set.mockImplementation(() => {
      throw new Error("Cookies can only be modified in a Server Action or Route Handler");
    });

    const { createNextCookieAdapter } = await import("@/lib/supabase/server");
    const adapter = await createNextCookieAdapter();

    expect(() =>
      adapter.setAll?.(
        [{ name: "sb-access-token", value: "refreshed", options: { path: "/" } }],
        {},
      ),
    ).not.toThrow();

    expect(cookieStore.set).toHaveBeenCalled();
  });

  it("writes through when the store accepts mutations", async () => {
    const { createNextCookieAdapter } = await import("@/lib/supabase/server");
    const adapter = await createNextCookieAdapter();

    adapter.setAll?.([{ name: "sb-access-token", value: "refreshed", options: { path: "/" } }], {});

    expect(cookieStore.set).toHaveBeenCalledWith("sb-access-token", "refreshed", { path: "/" });
  });

  it("normalises the cookie shape handed to Supabase", async () => {
    cookieStore.getAll.mockReturnValue([
      { name: "a", value: "1", path: "/", extra: true },
    ] as never);

    const { createNextCookieAdapter } = await import("@/lib/supabase/server");
    const adapter = await createNextCookieAdapter();

    expect(adapter.getAll()).toEqual([{ name: "a", value: "1" }]);
  });
});
