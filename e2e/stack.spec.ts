import { expect, test } from "@playwright/test";

/**
 * The flows that need a real stack.
 *
 * `supabase start` plus credentials in the environment. Without them these are
 * SKIPPED with a reason printed, never silently passed — a suite that reports
 * green because it ran nothing is worse than one that reports honestly.
 *
 * ---------------------------------------------------------------------------
 * WHY THESE ARE WRITTEN BEFORE THEY CAN RUN
 * ---------------------------------------------------------------------------
 *
 * Phase 09 declined to write a Vercel adapter it could not test, on the grounds
 * that an untested integration which reports success is worse than none. These
 * specs are the opposite case and the distinction is worth stating: an
 * integration CLAIMS to do something, and a skipped test claims nothing. It
 * says "not run", visibly, and it is the thing somebody runs the day the stack
 * exists instead of starting from a blank file.
 *
 * What they are not is verified. Until they run against Supabase, they are a
 * plan (KL-2801).
 *
 * To run them:
 *   supabase start
 *   cp .env.example .env.local   and fill in what `supabase start` prints
 *   npm run build && npm run test:e2e
 */

const hasStack =
  process.env.NEXT_PUBLIC_SUPABASE_URL !== undefined &&
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY !== undefined;

test.describe("critical flows @stack", () => {
  test.skip(
    !hasStack,
    "needs Supabase: run `supabase start` and set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  );

  test("shows the sign-in page to a visitor with no session", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByLabel(/correo/i)).toBeVisible();
  });

  /*
   * The guard of Phase 02, end to end.
   *
   * Unit tests assert the proxy decides to redirect. Only this can confirm the
   * redirect actually happens in a browser, with cookies, through the real
   * middleware pipeline.
   */
  test("sends an anonymous visitor away from the dashboard", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });

  test("keeps the platform area away from an anonymous visitor", async ({ page }) => {
    const response = await page.goto("/super-admin");
    // 404, never 403: Phase 04 chose not to confirm the area exists to somebody
    // who has no business knowing (master section 45).
    expect([404, 307, 302]).toContain(response?.status() ?? 200);
  });

  test("serves robots.txt for a hostname no tenant owns", async ({ request }) => {
    const response = await request.get("/robots.txt");
    expect(response.status()).toBe(200);
    // Phase 08: an unregistered hostname disallows everything rather than
    // erroring, because a crawler asking a question we cannot answer is not a
    // fault.
    expect(await response.text()).toContain("Disallow: /");
  });

  test("serves a sitemap without failing on an unknown hostname", async ({ request }) => {
    const response = await request.get("/sitemap.xml");
    expect(response.status()).toBe(200);
  });

  /*
   * Accessibility in a real browser.
   *
   * The jsdom tests of Phase 28 cannot compute contrast because jsdom lays
   * nothing out. A real Chromium can, so this is where that last part of
   * section 19 becomes checkable (KL-2803).
   */
  test("has no keyboard traps on the sign-in form", async ({ page }) => {
    await page.goto("/login");

    const reachable: string[] = [];
    for (let i = 0; i < 10; i += 1) {
      await page.keyboard.press("Tab");
      const tag = await page.evaluate(() => document.activeElement?.tagName ?? "");
      reachable.push(tag);
    }

    // Tabbing must move through controls, not sit on one element forever.
    expect(new Set(reachable).size).toBeGreaterThan(1);
  });
});
