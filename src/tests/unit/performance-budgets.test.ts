import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LIST_CAP, MAX_PAGE_SIZE } from "@/config/app";

/**
 * TEST-2601 to TEST-2603, TEST-2618 — the budgets, enforced.
 *
 * Master section 33, Phase 26 asks for "objetivos de rendimiento". A budget
 * nothing checks is a wish, so each number in `docs/performance-budgets.md` has
 * an assertion here that fails when it is exceeded.
 *
 * The budgets are set slightly above what was measured, not at a round number
 * somebody liked. A budget below the current value is a broken build on day
 * one; a budget far above it never fires. Both are ways of not having a budget.
 */

const ROOT = process.cwd();

async function collectFiles(dir: string, match: RegExp): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await collectFiles(full, match)));
    else if (match.test(entry.name)) files.push(full);
  }
  return files;
}

describe("the budget document (TEST-2601)", () => {
  it("exists and states numbers rather than adjectives", async () => {
    const doc = await readFile(join(ROOT, "docs", "performance-budgets.md"), "utf8");

    // Every budget this file enforces has to appear in the document, or the
    // document and the tests are two different sets of objectives.
    //
    // Case-insensitive: the document is written in Spanish prose and a heading
    // is capitalised. What matters is that the budget is described, not how the
    // sentence began.
    const lower = doc.toLowerCase();
    for (const marker of ["list_cap", "max_page_size", "client components", "bundle"]) {
      expect(lower, `budget doc does not mention ${marker}`).toContain(marker);
    }
    // A number, not "fast".
    expect(/\d/.test(doc)).toBe(true);
  });
});

/**
 * TEST-2618 — no list read may be unbounded.
 *
 * Master section 18 forbids "consultas sin límite" and this is what keeps it
 * true. The measurement that opened Phase 26 found twenty-six reads with no
 * bound; the fix was mechanical and would be undone just as mechanically by the
 * next phase that adds a list, so the rule lives here rather than in a habit.
 *
 * A single-row read is bounded by definition and is not counted.
 */
describe("bounded reads (TEST-2618)", () => {
  it("gives every list query a limit", async () => {
    const files = await collectFiles(join(ROOT, "src", "modules"), /^queries\.ts$/);
    expect(files.length).toBeGreaterThan(0);

    const unbounded: string[] = [];

    for (const file of files) {
      const source = await readFile(file, "utf8");
      const parts = source.split(/\n(?=export (?:async function|const) )/);

      for (const part of parts) {
        const name = /export (?:async function|const) (\w+)/.exec(part)?.[1];
        if (name === undefined) continue;
        if (!part.includes(".from(")) continue;
        // `maybeSingle()` and `single()` return at most one row.
        if (/maybeSingle\(|\.single\(/.test(part)) continue;
        if (/\.limit\(|\.range\(/.test(part)) continue;

        unbounded.push(`${file.replace(ROOT, "").replace(/\\/g, "/")} → ${name}`);
      }
    }

    expect(
      unbounded,
      `these list queries can return an entire table:\n${unbounded.join("\n")}`,
    ).toEqual([]);
  });

  it("keeps the ceiling above the page size, and both finite", () => {
    // A ceiling below a page would silently truncate a page, which is worse
    // than slow: the screen would look complete and be wrong.
    expect(LIST_CAP).toBeGreaterThan(MAX_PAGE_SIZE);
    expect(Number.isFinite(LIST_CAP)).toBe(true);
    expect(Number.isFinite(MAX_PAGE_SIZE)).toBe(true);
  });
});

/**
 * TEST-2603 — client components.
 *
 * Master section 18: "client components innecesarios" and "JS innecesario".
 * Every `"use client"` is JavaScript shipped to a phone on a Peruvian mobile
 * connection, so the count is worth watching even though no single one is
 * wrong.
 *
 * Measured at the start of Phase 26: 52 of 140 components.
 */
describe("client component budget (TEST-2603)", () => {
  it("does not ship more client components than the budget allows", async () => {
    const files = await collectFiles(join(ROOT, "src"), /\.tsx$/);
    const clientFiles: string[] = [];

    for (const file of files) {
      const source = await readFile(file, "utf8");
      // The directive has to be at the very top to count for React.
      if (/^\s*("use client"|'use client')/.test(source)) clientFiles.push(file);
    }

    const ratio = clientFiles.length / files.length;

    // 60 against 52 measured: room for the phases still to come, tight enough
    // that turning a page tree into client components trips it.
    expect(
      clientFiles.length,
      `client components: ${clientFiles.length} of ${files.length} (${Math.round(ratio * 100)}%)`,
    ).toBeLessThanOrEqual(60);
  });

  it("keeps server components the default", async () => {
    const files = await collectFiles(join(ROOT, "src"), /\.tsx$/);
    let clientCount = 0;
    for (const file of files) {
      const source = await readFile(file, "utf8");
      if (/^\s*("use client"|'use client')/.test(source)) clientCount += 1;
    }
    // Section 18: "Utilizar Server Components cuando aporten beneficios."
    expect(clientCount / files.length).toBeLessThan(0.5);
  });
});

/**
 * TEST-2602 — the built bundle.
 *
 * Skipped when `.next` is absent, because `npm run test` runs without a build
 * and a test that fails for lack of a build teaches people to ignore it. CI
 * runs the build before the tests, so there it measures.
 */
describe("bundle budget (TEST-2602)", () => {
  it("keeps the client bundle under budget", async () => {
    const staticDir = join(ROOT, ".next", "static");

    try {
      await stat(staticDir);
    } catch {
      // No build in this working tree; nothing to measure.
      return;
    }

    const files = await collectFiles(staticDir, /\.js$/);
    let total = 0;
    for (const file of files) {
      total += (await stat(file)).size;
    }

    const megabytes = total / (1024 * 1024);
    // 3 MB against 1.6 measured at the start of Phase 26.
    expect(megabytes, `client JavaScript: ${megabytes.toFixed(2)} MB`).toBeLessThan(3);
  });
});
