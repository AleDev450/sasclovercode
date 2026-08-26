import { describe, expect, it } from "vitest";
import { config } from "@/proxy";

/**
 * The proxy matcher, asserted rather than eyeballed.
 *
 * A regex nobody tests is a regex that quietly stops excluding what it was
 * written to exclude. The Phase 07 audit changed it, and this is what makes the
 * change verifiable and keeps it from being undone by accident.
 */

const pattern = new RegExp(`^${String(config.matcher[0])}$`);

function runsProxy(pathname: string): boolean {
  return pattern.test(pathname);
}

describe("paths the proxy must skip", () => {
  it.each([
    ["the liveness probe", "/api/health"],
    ["the tenant public site", "/sitio"],
    ["a tenant public page", "/sitio/nosotros"],
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
  ])("runs on %s", (_label, pathname) => {
    expect(runsProxy(pathname), pathname).toBe(true);
  });
});

describe("the exclusion is not broader than intended", () => {
  it("still protects a dashboard route whose name merely contains 'sitio'", () => {
    // Guards against the exclusion being read as a substring anywhere.
    expect(runsProxy("/dashboard/sugurolls/sitios")).toBe(true);
  });
});
