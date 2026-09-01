import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests.
 *
 * CLOVERCODE_MASTER.md §33, Phase 28 lists `E2E PASS` in the production
 * checklist. Twenty-seven phases deferred it — the SPECs of Phases 00 and 05
 * both say "Owner: Fase 28" — so this is where it gets built.
 *
 * ---------------------------------------------------------------------------
 * WHAT RUNS WITHOUT A DATABASE, AND WHAT DOES NOT
 * ---------------------------------------------------------------------------
 *
 * Almost every route in this product goes through the proxy, and the proxy's
 * first act is `supabase.auth.getUser()` — a network call. Without a reachable
 * Supabase there is no dashboard, no login and no tenant site to test.
 *
 * The exceptions are the routes the proxy matcher excludes on purpose, and of
 * those only `/api/health` checks no dependency at all (Phase 00 designed it
 * that way so an auth outage would not report the application as down).
 *
 * So the suite is split by what it needs:
 *
 *   @standalone   runs against a built app with no Supabase. Proves the harness
 *                 works and the server boots and serves.
 *   @stack        needs `supabase start` plus real credentials. Skipped with a
 *                 reason when they are absent, never silently.
 *
 * A spec that is skipped says so. A spec that never ran is a spec that does not
 * work and nobody has found out yet, which is the thing this file exists to
 * stop being true of the whole suite.
 */

const PORT = Number(process.env.E2E_PORT ?? 3100);
const BASE_URL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  // The dashboard is a multi-tenant app; a test that leaks state into the next
  // one would be indistinguishable from a tenant isolation bug.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI !== undefined ? 1 : 0,
  reporter: process.env.CI !== undefined ? "list" : [["list"], ["html", { open: "never" }]],

  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  /*
   * The app under test, started by Playwright itself.
   *
   * `npm start` and not `npm run dev`: production is what the checklist is
   * about, and the development server differs from it in exactly the places an
   * E2E test is supposed to catch — the proxy, the CSP nonce, and dynamic
   * rendering.
   *
   * `reuseExistingServer` locally so a developer can leave one running.
   */
  webServer: {
    command: `npx next start --port ${PORT}`,
    /*
     * Waits for the PORT, not for a healthy response.
     *
     * Readiness here means "the server accepts connections", which is the only
     * thing true without a database. Waiting on `/api/health` would wait for a
     * dependency the standalone suite deliberately does not have, and did:
     * the first version of this file timed out after two minutes against a
     * server that was up and answering perfectly well.
     */
    port: PORT,
    reuseExistingServer: process.env.CI === undefined,
    timeout: 120_000,
    // The app logs a structured line per request. Useful when a test fails and
    // deafening when one does not.
    stdout: "ignore",
    stderr: "pipe",
  },
});
