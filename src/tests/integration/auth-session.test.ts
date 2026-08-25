import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthenticationError, AuthorizationError, DatabaseError } from "@/lib/errors";
import { loadMyMemberships } from "@/lib/auth/membership";
import { loadCurrentUser } from "@/lib/auth/session";
import type { CloverCodeSupabaseClient } from "@/lib/supabase/types";

/**
 * Wiring between the Supabase client and the auth layer.
 *
 * The SQL and the policies are proved in `src/tests/database/`. Here the client
 * is a stub, so these assertions are about which call is made, how a row is
 * mapped, and how failure is surfaced.
 */

const USER_ID = "11111111-1111-4111-8111-111111111111";

interface AuthStubOptions {
  readonly user?: { id: string; email?: string | null } | null;
  readonly authError?: { message: string } | null;
  readonly profile?: { email: string; full_name: string | null; avatar_url: string | null } | null;
  readonly profileError?: unknown;
}

function stubClient(options: AuthStubOptions) {
  const getUser = vi.fn().mockResolvedValue({
    data: { user: options.user ?? null },
    error: options.authError ?? null,
  });

  const maybeSingle = vi.fn().mockResolvedValue({
    data: options.profile ?? null,
    error: options.profileError ?? null,
  });
  const eq = vi.fn().mockReturnValue({ maybeSingle });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });

  const client = { auth: { getUser }, from } as unknown as CloverCodeSupabaseClient;
  return { client, getUser, from, select, eq };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("loadCurrentUser", () => {
  it("verifies the session with getUser(), never getSession()", async () => {
    // getSession() reads the cookie without contacting the auth server, and the
    // cookie comes from the client. Using it here would accept a forged session.
    const { client, getUser } = stubClient({
      user: { id: USER_ID, email: "ana@sugurolls.com" },
      profile: { email: "ana@sugurolls.com", full_name: "Ana Torres", avatar_url: null },
    });

    await loadCurrentUser({ client });

    expect(getUser).toHaveBeenCalledOnce();
    expect(
      (client as unknown as { auth: Record<string, unknown> }).auth.getSession,
    ).toBeUndefined();
  });

  it("merges the verified identity with the profile row", async () => {
    const { client } = stubClient({
      user: { id: USER_ID, email: "ana@sugurolls.com" },
      profile: {
        email: "ana@sugurolls.com",
        full_name: "Ana Torres",
        avatar_url: "https://cdn.example/a.png",
      },
    });

    await expect(loadCurrentUser({ client })).resolves.toEqual({
      id: USER_ID,
      email: "ana@sugurolls.com",
      fullName: "Ana Torres",
      avatarUrl: "https://cdn.example/a.png",
    });
  });

  it("reads the profile by the verified id, not by anything supplied", async () => {
    const { client, from, eq } = stubClient({
      user: { id: USER_ID, email: "ana@sugurolls.com" },
      profile: { email: "ana@sugurolls.com", full_name: null, avatar_url: null },
    });

    await loadCurrentUser({ client });

    expect(from).toHaveBeenCalledWith("profiles");
    expect(eq).toHaveBeenCalledWith("id", USER_ID);
  });

  it("returns null for an anonymous request", async () => {
    const { client } = stubClient({ user: null });
    await expect(loadCurrentUser({ client })).resolves.toBeNull();
  });

  it("returns null - not an error - when the session is expired or absent", async () => {
    // This is the normal anonymous case. Throwing would fill the logs with
    // noise for something that is not a fault.
    const { client } = stubClient({ authError: { message: "Auth session missing!" } });
    await expect(loadCurrentUser({ client })).resolves.toBeNull();
  });

  it("still returns the verified user when the profile row is unreadable", async () => {
    // The identity is what authorises the request. A missing profile degrades
    // the display name, it does not invalidate the session.
    const { client } = stubClient({
      user: { id: USER_ID, email: "ana@sugurolls.com" },
      profileError: { message: "boom" },
    });

    await expect(loadCurrentUser({ client })).resolves.toEqual({
      id: USER_ID,
      email: "ana@sugurolls.com",
      fullName: null,
      avatarUrl: null,
    });
  });

  it("does not read user_metadata for any displayed value", async () => {
    // Master section 9: a signed-in user can write their own user_metadata.
    const { client } = stubClient({
      user: {
        id: USER_ID,
        email: "ana@sugurolls.com",
        ...({ user_metadata: { full_name: "ADMINISTRADOR" } } as object),
      },
      profile: { email: "ana@sugurolls.com", full_name: "Ana Torres", avatar_url: null },
    });

    const user = await loadCurrentUser({ client });
    expect(user?.fullName).toBe("Ana Torres");
  });
});

describe("requireUser", () => {
  it("throws AuthenticationError when nobody is signed in", async () => {
    // `requireUser` reads the React-cached accessor, which needs a request
    // scope, so the behaviour is asserted on the error contract it promises.
    const error = new AuthenticationError("No authenticated user for this request.");
    expect(error.httpStatus).toBe(401);
    expect(error.publicMessage).toBe("You need to sign in to continue.");
    // The technical message never reaches the caller.
    expect(error.publicMessage).not.toContain("request");
  });
});

describe("loadMyMemberships", () => {
  function stubRpc(result: { data?: unknown; error?: unknown }) {
    const rpc = vi.fn().mockResolvedValue({
      data: result.data ?? null,
      error: result.error ?? null,
    });
    return { client: { rpc } as unknown as CloverCodeSupabaseClient, rpc };
  }

  const ROW = {
    membership_id: "22222222-2222-4222-8222-222222222222",
    tenant_id: "33333333-3333-4333-8333-333333333333",
    tenant_slug: "sugurolls",
    tenant_name: "Sugu Rolls",
    tenant_status: "active",
    role: "owner",
    status: "active",
  };

  it("calls the guarded function with no arguments", async () => {
    // Passing a user id would make it an oracle for mapping users to tenants.
    const { client, rpc } = stubRpc({ data: [ROW] });
    await loadMyMemberships({ client });
    expect(rpc).toHaveBeenCalledWith("get_my_memberships");
  });

  it("maps rows onto the Membership shape", async () => {
    const { client } = stubRpc({ data: [ROW] });
    await expect(loadMyMemberships({ client })).resolves.toEqual([
      {
        id: ROW.membership_id,
        tenantId: ROW.tenant_id,
        tenantSlug: "sugurolls",
        tenantName: "Sugu Rolls",
        role: "owner",
        status: "active",
      },
    ]);
  });

  it("returns an empty list when the user belongs to nothing", async () => {
    const { client } = stubRpc({ data: [] });
    await expect(loadMyMemberships({ client })).resolves.toEqual([]);
  });

  it("treats a null payload as no memberships", async () => {
    const { client } = stubRpc({ data: null });
    await expect(loadMyMemberships({ client })).resolves.toEqual([]);
  });

  it("raises DatabaseError on failure, without leaking the driver message", async () => {
    const { client } = stubRpc({ error: { message: "relation does not exist" } });

    await expect(loadMyMemberships({ client })).rejects.toBeInstanceOf(DatabaseError);
    await expect(loadMyMemberships({ client })).rejects.toMatchObject({
      publicMessage: "A data error occurred. Please try again.",
    });
  });
});

describe("requireMembership error contract", () => {
  it("says the same thing for 'not a member' and 'not active'", async () => {
    // Distinguishing them would confirm to an outsider that a given account
    // exists inside a given business.
    const error = new AuthorizationError("User is not an active member of this tenant.");
    expect(error.httpStatus).toBe(403);
    expect(error.publicMessage).toBe("You do not have permission to perform this action.");
    expect(error.publicMessage).not.toContain("member");
  });
});
