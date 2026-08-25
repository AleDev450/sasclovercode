import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "../helpers/database";

/**
 * Keeps the reserved-slug list honest as the dashboard grows.
 *
 * `/dashboard/{slug}` resolves a tenant from a URL segment, and Next.js
 * resolves a STATIC segment before a dynamic one. So every static route placed
 * next to `[tenantSlug]` quietly removes that word from the tenant namespace.
 *
 * Rather than trusting whoever adds the next route to remember, this test reads
 * the routes off the filesystem and fails if one of them is still an allowed
 * slug. It is the check that will still work in Phase 12.
 */

const DASHBOARD_DIR = join(process.cwd(), "src", "app", "(app)", "dashboard");

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase();
});

afterAll(async () => {
  await db.close();
});

/** Static folder names that sit beside the `[tenantSlug]` segment. */
async function staticDashboardSegments(): Promise<string[]> {
  const entries = await readdir(DASHBOARD_DIR, { withFileTypes: true });
  return (
    entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      // Dynamic segments, route groups and private folders are not static routes.
      .filter((name) => !name.startsWith("[") && !name.startsWith("(") && !name.startsWith("_"))
  );
}

describe("reserved slugs cover the dashboard's own routes", () => {
  it("finds the static segments on disk", async () => {
    const segments = await staticDashboardSegments();
    // If this ever becomes empty the test would pass vacuously.
    expect(segments.length).toBeGreaterThan(0);
    expect(segments).toContain("perfil");
  });

  it("rejects a tenant whose slug is any static dashboard route", async () => {
    // Looped inside the test rather than `it.each`, because the segment list
    // comes from an async filesystem read and a `describe` callback is sync.
    const segments = await staticDashboardSegments();

    for (const segment of segments) {
      await expect(
        db.query("insert into public.tenants (slug, name) values ($1, 'X')", [segment]),
        `the dashboard route "${segment}" is still an allowed tenant slug`,
      ).rejects.toThrow(/tenants_slug_not_reserved|tenants_slug_length/);
    }
  });

  it("still accepts an ordinary slug", async () => {
    await expect(
      db.query("insert into public.tenants (slug, name) values ('sugurolls', 'Sugu Rolls')"),
    ).resolves.toBeDefined();
  });

  it("still rejects the platform hosts reserved in Phase 01", async () => {
    for (const slug of ["www", "api", "admin", "clovercode"]) {
      await expect(
        db.query("insert into public.tenants (slug, name) values ($1, 'X')", [slug]),
      ).rejects.toThrow(/tenants_slug_not_reserved/);
    }
  });
});
