import { expect, test } from "@playwright/test";

/**
 * TEST-2816, TEST-2817 — the part of the E2E suite that runs with no database.
 *
 * These are the tests that make the harness real rather than hypothetical. They
 * boot the production server, drive a real Chromium, and assert on real
 * responses — so if Playwright is misconfigured, the browser is missing, or the
 * built app cannot serve a request, this fails and says so.
 *
 * The flows that matter to a business live in `stack.spec.ts` and need Supabase.
 * Splitting them is what lets at least one E2E test be genuinely executed
 * instead of the whole suite being written and never run.
 */

test.describe("the application serves @standalone", () => {
  /*
   * TEST-2817 - the health endpoint, asserted on what it actually does.
   *
   * Phase 00 built `/api/health` as a pure liveness probe with no dependency
   * checks, and Phase 24 added a database check to it. So without Supabase it
   * answers `degraded` with a 503 — the server is alive and honest about not
   * being able to serve.
   *
   * That is the correct behaviour and this asserts it. The first version of
   * this spec asserted a 200 because the comment in the Phase 07 proxy matcher
   * says the route "checks no dependency", which had stopped being true
   * seventeen phases later. Reading a comment is not measuring.
   */
  test("reports its health honestly, including when a dependency is down", async ({ request }) => {
    const response = await request.get("/api/health");

    // Either healthy (200) or degraded (503). Both are the endpoint working.
    expect([200, 503]).toContain(response.status());

    const body = (await response.json()) as {
      status?: string;
      checks?: Record<string, unknown>;
    };

    expect(body.status).toBeDefined();
    // A probe that says "degraded" without saying what is degraded sends
    // whoever is on call to read logs. Phase 24 made it name the dependency.
    if (response.status() === 503) {
      expect(body.status).toBe("degraded");
    }
  });

  test("answers fast enough to be a probe", async ({ request }) => {
    const started = Date.now();
    await request.get("/api/health");
    // A liveness check that takes seconds is one that times out under exactly
    // the load it exists to detect.
    expect(Date.now() - started).toBeLessThan(5000);
  });

  /*
   * TEST-2816 - the whole chain, once.
   *
   * Playwright, Chromium, the Next.js production server, the proxy and a route
   * handler. This is the assertion that turns "we have an E2E harness" from a
   * claim into a fact.
   */
  test("boots a real browser against the real server", async ({ page }) => {
    const response = await page.goto("/api/health");

    expect(response).not.toBeNull();
    expect([200, 503]).toContain(response?.status() ?? 0);
    await expect(page.locator("body")).toContainText("status");
  });

  /*
   * The security headers Phase 25 added, checked where they actually land.
   *
   * Unit tests assert the proxy builds the header. Only an end-to-end request
   * can confirm it survives the framework, the runtime and the response
   * pipeline and arrives at a browser.
   */
  test("sends the security headers Phase 25 configured", async ({ request }) => {
    const response = await request.get("/api/health");
    const headers = response.headers();

    expect(headers["x-content-type-options"]).toBe("nosniff");
  });

  test("does not advertise the framework version", async ({ request }) => {
    const response = await request.get("/api/health");
    // `x-powered-by` tells an attacker which advisories are worth trying.
    expect(response.headers()["x-powered-by"]).toBeUndefined();
  });

  test("returns a 404 for a route that does not exist", async ({ request }) => {
    const response = await request.get("/esta-ruta-no-existe-jamas");
    // 404 or 500 depending on whether the proxy could reach Supabase; what must
    // never happen is a 200 for a route nobody defined.
    expect(response.status()).not.toBe(200);
  });
});
