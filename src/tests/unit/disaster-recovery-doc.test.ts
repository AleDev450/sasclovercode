import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * TEST-2718 to TEST-2720 — the recovery document says what §33 asks for.
 *
 * Master section 33, Phase 27 lists seven things to document. A runbook that
 * quietly loses one of them is a runbook that fails at the step nobody wrote
 * down, and prose has no compiler — so the checklist lives here.
 *
 * This checks COVERAGE, not quality. It cannot tell whether the procedure works;
 * `restore-drill.test.ts` does that. What it can tell is that nobody deleted the
 * section about rollback while tidying.
 */

const ROOT = process.cwd();

async function recoveryDoc(): Promise<string> {
  return readFile(join(ROOT, "docs", "disaster-recovery.md"), "utf8");
}

describe("the recovery document (TEST-2718, TEST-2719)", () => {
  it("covers the seven things section 33 lists (TEST-2719)", async () => {
    const doc = (await recoveryDoc()).toLowerCase();

    for (const topic of [
      "estrategia de backup",
      "restore",
      "rpo",
      "rto",
      "incident response",
      "rollback",
      "runbook de recuperación",
    ]) {
      expect(doc, `the recovery document does not cover: ${topic}`).toContain(topic);
    }
  });

  it("states RPO and RTO as numbers with a unit (TEST-2718)", async () => {
    const doc = await recoveryDoc();

    // "as soon as possible" is not an objective. A number and a unit are.
    expect(doc).toMatch(/RPO\s+objetivo\s+\d+\s*\w+/);
    expect(doc).toMatch(/RTO\s+objetivo\s+\d+\s*\w+/);
  });

  it("says what the backup does NOT cover", async () => {
    const doc = await recoveryDoc();
    // The gaps are the part somebody discovers during an incident if it is not
    // written here: Storage has no backup mechanism at all.
    expect(doc).toContain("Lo que el backup NO cubre");
    expect(doc).toContain("Storage");
  });

  it("carries the trigger warning that the drill discovered", async () => {
    const doc = await recoveryDoc();
    // The single most important line in the document: a restore with triggers
    // enabled does not degrade the data, it fails halfway through the load.
    expect(doc).toContain("session_replication_role");
    expect(doc).toContain("replica");
  });

  it("keeps the verification step, which is the one worth skipping under pressure", async () => {
    const doc = (await recoveryDoc()).toLowerCase();
    expect(doc).toContain("relrowsecurity");
  });
});

describe("the secret inventory (TEST-2720)", () => {
  it("lists every variable the environment template declares", async () => {
    const doc = await recoveryDoc();
    const template = await readFile(join(ROOT, ".env.example"), "utf8");

    const declared = [...template.matchAll(/^([A-Z][A-Z0-9_]+)=/gm)].map((match) => match[1]);
    expect(declared.length).toBeGreaterThan(0);

    // A secret nobody wrote down is a secret nobody rotates.
    const missing = declared.filter((name) => name !== undefined && !doc.includes(name));
    expect(missing, `secrets missing from the inventory: ${missing.join(", ")}`).toEqual([]);
  });

  it("records that no service_role key exists in this project", async () => {
    const doc = await recoveryDoc();
    // Three phases considered introducing one and declined (ADR-011, 013, 028).
    // The most dangerous secret a Supabase project can hold is absent, and the
    // inventory says so rather than leaving a reader to wonder.
    expect(doc).toContain("service_role");
  });
});
