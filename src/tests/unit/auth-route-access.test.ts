import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { isAnonymousOnlyPath, isPublicPath, requiresAuthentication } from "@/lib/auth/route-access";

/**
 * TEST-202 - the route protection rules.
 *
 * The property that matters most is the DEFAULT: an unknown path must require
 * authentication. A route added by a later phase is then protected from the
 * moment it exists, rather than from the moment somebody remembers to list it.
 */
describe("route access: closed by default", () => {
  it.each([
    "/dashboard",
    "/dashboard/orders",
    "/admin",
    "/settings/billing",
    "/api/orders",
    "/some-route-no-phase-has-written-yet",
  ])("requires authentication for %j", (pathname) => {
    expect(requiresAuthentication(pathname)).toBe(true);
    expect(isPublicPath(pathname)).toBe(false);
  });
});

describe("route access: the public surface", () => {
  it.each(["/", "/login", "/forgot-password", "/reset-password", "/auth/confirm", "/api/health"])(
    "serves %j without a session",
    (pathname) => {
      expect(isPublicPath(pathname)).toBe(true);
      expect(requiresAuthentication(pathname)).toBe(false);
    },
  );

  it("treats the landing page as an EXACT match only", () => {
    // If "/" were a prefix match, every path in the application would be public.
    expect(isPublicPath("/")).toBe(true);
    expect(isPublicPath("/dashboard")).toBe(false);
    expect(isPublicPath("/anything")).toBe(false);
  });

  it("does not let a lookalike prefix through", () => {
    expect(isPublicPath("/login-as-admin")).toBe(false);
    expect(isPublicPath("/api/healthcheck-internal")).toBe(false);
    expect(isPublicPath("/authorize")).toBe(false);
  });

  it("covers nested paths under a public prefix", () => {
    expect(isPublicPath("/auth/confirm")).toBe(true);
    expect(isPublicPath("/auth/callback")).toBe(true);
  });
});

describe("route access: the liveness probe", () => {
  it("is public in the rules AND excluded from the proxy matcher", async () => {
    // Two independent reasons, both required.
    //
    // Public in the rules: a probe must never be redirected to a sign-in page.
    //
    // Excluded from the matcher: the probe reports that THIS process is up and
    // deliberately checks no dependency. Running it through the proxy would
    // make every probe call Supabase Auth, so an auth outage would report the
    // application as down while it is serving perfectly well.
    expect(isPublicPath("/api/health")).toBe(true);

    const proxySource = await readFile(new URL("../../proxy.ts", import.meta.url), "utf8");
    const matcher = proxySource.slice(proxySource.indexOf("matcher:"));
    expect(matcher).toContain("api/health");
  });
});

describe("route access: anonymous-only paths", () => {
  it.each(["/login", "/forgot-password"])("moves a signed-in user off %j", (pathname) => {
    expect(isAnonymousOnlyPath(pathname)).toBe(true);
  });

  it("lets a signed-in user change their password", () => {
    // Reachable both from a recovery link and from inside the application.
    expect(isAnonymousOnlyPath("/reset-password")).toBe(false);
  });

  it("does not bounce a signed-in user away from the application", () => {
    expect(isAnonymousOnlyPath("/dashboard")).toBe(false);
    expect(isAnonymousOnlyPath("/")).toBe(false);
  });
});
