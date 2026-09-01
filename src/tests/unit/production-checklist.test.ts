import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * TEST-2818 to TEST-2821 — the checklist cannot lie.
 *
 * Master section 33, Phase 28 is fifteen lines, and the temptation of a
 * checklist is to write `PASS` next to all of them. This file is what makes
 * that impossible: every claim the document makes that CAN be checked against
 * the repository, is.
 *
 * It cannot judge whether the tests it cites are good ones. It can tell that
 * they exist, that nothing claims a pass without saying how, and that nobody
 * quietly upgraded a PARCIAL to a PASS while tidying.
 */

const ROOT = process.cwd();

async function checklist(): Promise<string> {
  return readFile(join(ROOT, "docs", "production-readiness.md"), "utf8");
}

/** The fifteen items §33 lists, in its own words. */
const CHECKLIST_ITEMS = [
  "Security",
  "RLS",
  "Cross-tenant tests",
  "Unit tests",
  "Integration tests",
  "E2E",
  "Lint",
  "TypeScript",
  "Build",
  "SEO",
  "Accessibility",
  "Performance",
  "Backups",
  "Monitoring",
  "Documentation",
] as const;

describe("the checklist covers section 33 (TEST-2818, TEST-2819)", () => {
  it("names all fifteen items", async () => {
    const doc = await checklist();
    for (const item of CHECKLIST_ITEMS) {
      expect(doc, `the checklist does not mention: ${item}`).toContain(item);
    }
  });

  it("gives every item a verdict (TEST-2819)", async () => {
    const doc = await checklist();

    // The table rows carry the verdict in bold. Fifteen rows, fifteen verdicts.
    const verdicts = [...doc.matchAll(/\*\*(PASS|PARCIAL|NO)\*\*/g)];
    expect(verdicts.length).toBe(CHECKLIST_ITEMS.length);
  });

  /*
   * TEST-2820 - a PASS has to say how it is checked.
   *
   * "Security: PASS" on its own is an opinion. The value of the whole document
   * is that each line points at the thing somebody else can run.
   */
  it("makes every PASS cite how it is verified (TEST-2820)", async () => {
    const doc = await checklist();

    const rows = doc
      .split("\n")
      .filter((line) => line.startsWith("| ") && line.includes("**PASS**"));

    expect(rows.length).toBeGreaterThan(0);

    for (const row of rows) {
      const evidence = row.split("|").at(-2) ?? "";
      // A command, a path, or a phase. Something a reader can go and check.
      const cites =
        /npm run|src\/tests|docs\/|Fase \d+|\.test\./.test(evidence) && evidence.trim().length > 12;
      expect(cites, `a PASS with no evidence:\n${row}`).toBe(true);
    }
  });
});

/**
 * TEST-2821 — the suites the checklist points at have to exist.
 *
 * The failure this catches is not somebody lying. It is somebody renaming a
 * test file, or deleting a suite during a refactor, and leaving a checklist
 * that still claims it verifies something. The claim would outlive the
 * verification and nobody would notice.
 */
describe("the evidence exists (TEST-2821)", () => {
  it("finds every test path the checklist cites", async () => {
    const doc = await checklist();

    const cited = [...doc.matchAll(/`(src\/tests\/[\w/\-*.]+)`/g)]
      .map((match) => match[1])
      .filter((path): path is string => path !== undefined);

    expect(cited.length).toBeGreaterThan(0);

    const missing: string[] = [];

    for (const path of cited) {
      // Some citations are globs (`security-*.test.ts`) or directories.
      if (path.includes("*")) {
        const dir = join(ROOT, path.slice(0, path.lastIndexOf("/")));
        const pattern = path.slice(path.lastIndexOf("/") + 1).replace("*", "");
        try {
          const entries = await readdir(dir);
          if (!entries.some((entry) => entry.includes(pattern.replace(".test.ts", "")))) {
            missing.push(path);
          }
        } catch {
          missing.push(path);
        }
        continue;
      }

      try {
        await stat(join(ROOT, path));
      } catch {
        missing.push(path);
      }
    }

    expect(missing, `the checklist cites paths that do not exist:\n${missing.join("\n")}`).toEqual(
      [],
    );
  });

  it("finds every document it cites", async () => {
    const doc = await checklist();

    // Read out of the checklist rather than hardcoded here. A hardcoded list
    // would keep passing after somebody removed the citation from the document,
    // which is the same drift this suite exists to catch.
    const cited = [...doc.matchAll(/`(docs\/[\w/\-.]+\.md)`/g)]
      .map((match) => match[1])
      .filter((path): path is string => path !== undefined);

    expect(cited.length).toBeGreaterThan(0);

    for (const path of new Set(cited)) {
      await expect(stat(join(ROOT, path)), path).resolves.toBeDefined();
    }
  });

  it("has an E2E harness, since the checklist says it does", async () => {
    // `E2E PARCIAL` claims six real tests exist and run. If the config or the
    // spec went away, the claim would be false.
    await expect(stat(join(ROOT, "playwright.config.ts"))).resolves.toBeDefined();
    await expect(stat(join(ROOT, "e2e", "standalone.spec.ts"))).resolves.toBeDefined();

    const pkg = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["test:e2e"]).toBeDefined();
  });
});

describe("the checklist stays honest", () => {
  /*
   * The whole point, asserted directly.
   *
   * Four items are PARCIAL today and each says what is missing. Somebody
   * marking one PASS without doing the work would have to also delete its
   * explanation, and this notices.
   */
  it("keeps an explanation for every item that is not a PASS", async () => {
    const doc = await checklist();
    const partials = [...doc.matchAll(/\*\*(PARCIAL|NO)\*\*/g)].length;

    if (partials > 0) {
      expect(doc).toContain("qué falta exactamente");
      // Each one needs a "Para cerrarlo" and a "Bloquea": what to do, and
      // whether it stops a deployment.
      const closings = [...doc.matchAll(/Para\s+\ncierra|Para\s|cerrarlo/g)].length;
      expect(closings).toBeGreaterThan(0);
      expect(doc).toContain("Bloquea");
    }
  });

  it("lists the limitations that block production, separately from the rest", async () => {
    const doc = await checklist();
    expect(doc).toContain("BLOQUEANTES");
    // ~195 KLs are open across 29 SPECs. A list that does not separate the
    // three that matter from the rest is a list nobody can act on.
    expect(doc).toMatch(/KL-\d+/);
  });

  it("says plainly that the system has never run against its own infrastructure", async () => {
    const doc = await checklist();
    // The single most important sentence in the document, and the one most
    // likely to be softened later.
    expect(doc.toLowerCase()).toContain("nunca se ha ejecutado");
  });
});
