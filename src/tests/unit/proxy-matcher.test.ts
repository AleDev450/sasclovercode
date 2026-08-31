import { describe, expect, it } from "vitest";
import { isSessionFreePath, isPublicPath, requiresAuthentication } from "@/lib/auth/route-access";
import { config } from "@/proxy";

/**
 * The proxy matcher, asserted rather than eyeballed.
 *
 * A regex nobody tests is a regex that quietly stops excluding what it was
 * written to exclude. The Phase 07 audit changed it, and this is what makes the
 * change verifiable and keeps it from being undone by accident.
 *
 * PHASE 25 CHANGED IT AGAIN, and in the opposite direction: `/sitio` used to be
 * excluded and now is not. The exclusion existed to keep a Supabase Auth round
 * trip off the highest-traffic surface of the product - correct about the auth
 * call, and broader than it needed to be about the proxy. From Phase 25 the
 * proxy is also what emits the Content-Security-Policy, and `/sitio` is the one
 * surface that renders content written by a third party (the CMS), so leaving
 * it out meant protecting the admin panel and not the shop.
 *
 * The question is now split in two, and both halves are asserted below:
 *
 *   does this path need HEADERS?   -> the matcher (always, for a document)
 *   does this path need a SESSION? -> isSessionFreePath (no, for /sitio)
 */

const pattern = new RegExp(`^${String(config.matcher[0])}$`);

function runsProxy(pathname: string): boolean {
  return pattern.test(pathname);
}

describe("paths the proxy must skip", () => {
  it.each([
    // JSON, not a document: there is nothing for a CSP to protect. And keeping
    // the liveness probe on a path that shares no code with anything else is
    // itself a property worth having.
    ["the liveness probe", "/api/health"],
    ["a static chunk", "/_next/static/chunk.js"],
    ["an image", "/logo.png"],
    ["a font", "/font.woff2"],
  ])("skips %s", (_label, pathname) => {
    expect(runsProxy(pathname), pathname).toBe(false);
  });
});

describe("paths the proxy must handle", () => {
  it.each([
    ["the dashboard", "/dashboard"],
    ["a tenant dashboard", "/dashboard/sugurolls"],
    ["the platform area", "/super-admin/tenants"],
    ["sign in", "/login"],
    ["the landing page", "/"],
    // Phase 25: now matched, so it gets its CSP.
    ["the tenant public site", "/sitio"],
    ["a tenant public page", "/sitio/nosotros"],
  ])("runs on %s", (_label, pathname) => {
    expect(runsProxy(pathname), pathname).toBe(true);
  });
});

describe("the public site is served without touching Supabase Auth (Phase 25)", () => {
  it("is session-free, which is what the proxy short-circuits on", () => {
    // The property Phase 09 was defending: an auth outage must not take down a
    // restaurant's menu. It survives because the proxy returns for these paths
    // BEFORE creating the Supabase client, not because they are unmatched.
    expect(isSessionFreePath("/sitio")).toBe(true);
    expect(isSessionFreePath("/sitio/nosotros")).toBe(true);
  });

  it("is not session-free anywhere else", () => {
    // `/login` is public AND must redirect somebody already signed in, so the
    // proxy genuinely has to ask who they are. That is the distinction the two
    // predicates draw.
    expect(isSessionFreePath("/login")).toBe(false);
    expect(isSessionFreePath("/")).toBe(false);
    expect(isSessionFreePath("/dashboard/sugurolls")).toBe(false);
    expect(isSessionFreePath("/api/health")).toBe(false);
  });

  it("never lets a protected path be session-free", () => {
    // The dangerous mistake this predicate could enable: skipping authentication
    // for a path that needs it. `isSessionFreePath` requires `isPublicPath` too,
    // so the two cannot disagree.
    for (const path of ["/sitio", "/sitio/carta", "/dashboard", "/super-admin"]) {
      if (isSessionFreePath(path)) {
        expect(requiresAuthentication(path), path).toBe(false);
        expect(isPublicPath(path), path).toBe(true);
      }
    }
  });
});

describe("the exclusion is not broader than intended", () => {
  it("still protects a dashboard route whose name merely contains 'sitio'", () => {
    // Guards against the exclusion being read as a substring anywhere. It
    // mattered more when `/sitio` was in the matcher; it still matters for
    // `isSessionFreePath`, which is a prefix match.
    expect(runsProxy("/dashboard/sugurolls/sitios")).toBe(true);
    expect(isSessionFreePath("/dashboard/sugurolls/sitios")).toBe(false);
  });

  it("does not treat a path that merely starts with the letters as the site", () => {
    expect(isSessionFreePath("/sitioweb")).toBe(false);
  });
});
