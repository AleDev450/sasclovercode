import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MODULES } from "@/lib/features";
import { PERMISSIONS } from "@/lib/permissions";
import { NAV_ITEMS } from "@/modules/dashboard/navigation";
import { buildContentSecurityPolicy, generateNonce } from "@/lib/security/csp";

/**
 * Phase 25 — the audit, made executable.
 *
 * CLOVERCODE_MASTER.md section 33 (Phase 25) asks for a complete review. A
 * review that exists only as prose is true on the day it is written and expires
 * with the next commit: nothing stops Phase 26 adding a Server Action with no
 * permission gate, and nobody would notice.
 *
 * So the verdicts that CAN be executed are executed. These are structural
 * tests: they read the source and assert a property of it. They cost almost
 * nothing and they keep this audit's conclusion true in Phase 28, which is when
 * somebody will ask it again (ADR-029 decision 5).
 */

const MODULES_DIR = join(process.cwd(), "src", "modules");
const DASHBOARD_DIR = join(process.cwd(), "src", "app", "(app)", "dashboard", "[tenantSlug]");

// ---------------------------------------------------------------------------
// Content Security Policy
// ---------------------------------------------------------------------------

describe("the Content-Security-Policy (TEST-2501 to TEST-2506)", () => {
  const nonce = "TESTNONCE123456789=";

  it("never allows inline script in production", async () => {
    // The whole reason a static CSP in next.config.ts was not enough. With
    // 'unsafe-inline' the policy does not stop the attack it exists to stop.
    const policy = buildContentSecurityPolicy(nonce, false);
    const scriptSrc = policy.split("; ").find((d) => d.startsWith("script-src"));

    expect(scriptSrc).toBeDefined();
    expect(scriptSrc).not.toContain("unsafe-inline");
    expect(scriptSrc).not.toContain("unsafe-eval");
  });

  it("carries the nonce it was given", async () => {
    const policy = buildContentSecurityPolicy(nonce, false);
    expect(policy).toContain(`'nonce-${nonce}'`);
  });

  it("mints a different nonce every time", async () => {
    // Predictable would be worse than absent: an attacker who can guess it can
    // sign their own injected script.
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) seen.add(generateNonce());
    expect(seen.size).toBe(50);
  });

  it("mints a nonce long enough to be unguessable", async () => {
    const value = generateNonce();
    expect(value.length).toBeGreaterThanOrEqual(32);
    expect(value).toMatch(/^[A-Za-z0-9+/=]+$/);
  });

  it("forbids plugins and framing", async () => {
    const policy = buildContentSecurityPolicy(nonce, false);
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("base-uri 'self'");
    expect(policy).toContain("form-action 'self'");
  });

  it("allows 'unsafe-eval' in development only", async () => {
    // React needs it in development to rebuild server error stacks in the
    // browser. Next.js documents that it is not needed in production, and this
    // is what stops the development branch leaking into a deploy.
    expect(buildContentSecurityPolicy(nonce, true)).toContain("'unsafe-eval'");
    expect(buildContentSecurityPolicy(nonce, false)).not.toContain("'unsafe-eval'");
  });
});

// ---------------------------------------------------------------------------
// Every Server Action reaches a gate
// ---------------------------------------------------------------------------

/** Calls that constitute an authorization gate. */
const GATE_CALLS = ["requirePermission", "requireFeature", "requirePlatformAdmin"];

/**
 * Actions that legitimately have no permission gate, each with its reason.
 *
 * An allow list rather than a looser rule: a NEW ungated action has to be
 * argued into this array by whoever writes it, which is the point. A rule
 * loose enough to admit them silently would admit the next one too.
 */
const REVIEWED_UNGATED_ACTIONS: Readonly<Record<string, string>> = {
  // Phase 02. All four run BEFORE there is a session, so there is no tenant to
  // hold a permission in. They are the surface the Phase 25 rate limiter
  // protects instead.
  "auth/server/actions.ts:signInAction": "runs before a session exists",
  "auth/server/actions.ts:signOutAction": "ending your own session needs no permission",
  "auth/server/actions.ts:requestPasswordResetAction": "runs before a session exists",
  "auth/server/actions.ts:updatePasswordAction": "authorised by the recovery token, not a role",
  "auth/server/actions.ts:changePasswordAction":
    "your own credentials, authorised by the current password and rate limited",

  // The landing page contact form. Anonymous by definition - the person filling
  // it in has no account, which is why they are writing to us - so there is no
  // role to require and no tenant to require it in. What guards it instead: the
  // `marketing.contact` rate limit, a honeypot field, and `submit_lead()` being
  // the only writer of a table with no insert policy at all.
  "marketing/server/actions.ts:submitContactAction": "runs before an account exists",
};

/**
 * Modules whose actions may appear above.
 *
 * The exception list is only defensible while every entry on it is genuinely
 * PRE-SESSION. These two are: `auth` is how a session begins, and `marketing`
 * is the commercial surface somebody reaches before they have an account. An
 * action in any other module has a tenant, and therefore has a permission to
 * check.
 *
 * `marketing/server/lead-actions.ts` is deliberately NOT here: triaging a lead
 * happens inside the operator console and calls `requirePlatformAdmin()` like
 * everything else there.
 */
const PRE_SESSION_MODULES = ["auth/", "marketing/"] as const;

interface ExportedFunction {
  readonly name: string;
  readonly body: string;
}

/** Strips comments so a guard NAMED in prose cannot pass for a guard CALLED. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/**
 * Top-level function bodies, by brace matching.
 *
 * A real parser would be better and would be a dependency; brace matching is
 * enough for a file that is a flat list of `async function` declarations, which
 * every `actions.ts` in this project is.
 */
function readFunctions(source: string, exportedOnly: boolean): readonly ExportedFunction[] {
  const clean = stripComments(source);
  const pattern = exportedOnly
    ? /export\s+async\s+function\s+(\w+)/g
    : /(?:^|\n)\s*(?:async\s+)?function\s+(\w+)/g;

  const found: ExportedFunction[] = [];

  for (const match of clean.matchAll(pattern)) {
    const name = match[1]!;
    const open = clean.indexOf("{", match.index! + match[0].length);
    if (open === -1) continue;

    let depth = 0;
    let end = open;
    for (let i = open; i < clean.length; i++) {
      if (clean[i] === "{") depth += 1;
      else if (clean[i] === "}") {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }

    found.push({ name, body: clean.slice(open, end + 1) });
  }

  return found;
}

async function findActionFiles(): Promise<readonly string[]> {
  const modules = await readdir(MODULES_DIR, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of modules) {
    if (!entry.isDirectory()) continue;
    const candidate = join(MODULES_DIR, entry.name, "server", "actions.ts");
    try {
      await readFile(candidate, "utf8");
      files.push(`${entry.name}/server/actions.ts`);
    } catch {
      // The module has no Server Actions. `reports` and `audit` are read-only
      // by design, and that absence is itself a Phase 23/24 decision.
    }
  }

  return files;
}

describe("every Server Action passes a gate (TEST-2507)", () => {
  it("finds the action files at all", async () => {
    // The generated-test failure mode: discover nothing, loop zero times, pass.
    const files = await findActionFiles();
    expect(files.length).toBeGreaterThanOrEqual(15);
  });

  it("reaches requirePermission, requireFeature or requirePlatformAdmin", async () => {
    const ungated: string[] = [];

    for (const relative of await findActionFiles()) {
      const source = await readFile(join(MODULES_DIR, relative), "utf8");

      // Most modules gate through a small local helper - `requireCatalogAccess`,
      // `requireOrderAccess` - so a direct search for the guard would report
      // every action in the project as ungated. Collect the helpers first.
      const gateBearingHelpers = new Set(
        readFunctions(source, false)
          .filter((fn) => GATE_CALLS.some((call) => fn.body.includes(`${call}(`)))
          .map((fn) => fn.name),
      );

      for (const action of readFunctions(source, true)) {
        const key = `${relative}:${action.name}`;
        if (key in REVIEWED_UNGATED_ACTIONS) continue;

        const gated =
          GATE_CALLS.some((call) => action.body.includes(`${call}(`)) ||
          [...gateBearingHelpers].some((helper) => action.body.includes(`${helper}(`));

        if (!gated) ungated.push(key);
      }
    }

    // Named, so a failure says which action forgot its gate.
    expect(ungated).toEqual([]);
  });

  it("keeps the list of reviewed exceptions to the pre-session surface", async () => {
    // If this ever grows past the pre-session modules, somebody has waved
    // through an action that does touch tenant data.
    for (const key of Object.keys(REVIEWED_UNGATED_ACTIONS)) {
      expect(PRE_SESSION_MODULES.some((module) => key.startsWith(module))).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Every gated nav entry has a page that checks the same thing
// ---------------------------------------------------------------------------

/** Turns a nav segment into the page file that serves it. */
function pageFileFor(segment: string): string {
  return join(DASHBOARD_DIR, segment.replace(/^\//, ""), "page.tsx");
}

function constantNameFor(bag: Readonly<Record<string, string>>, value: string): string {
  const entry = Object.entries(bag).find(([, v]) => v === value);
  if (entry === undefined) throw new Error(`No constant for ${value}`);
  return entry[0];
}

describe("navigation and pages agree (TEST-2508, TEST-2509)", () => {
  it("gives every module-gated entry a page that checks THAT module", async () => {
    // Exactly what Phase 21 asked this phase to verify: "comprobar que ninguna
    // pagina de modulo se olvido su requireFeature". Verified once, and from
    // now on verified always.
    const missing: string[] = [];

    for (const item of NAV_ITEMS) {
      if (item.module === undefined) continue;

      const source = await readFile(pageFileFor(item.segment), "utf8");
      const expected = `MODULES.${constantNameFor(MODULES, item.module)}`;

      if (!source.includes(expected) || !/hasFeature|requireFeature/.test(source)) {
        missing.push(`${item.key} -> ${expected}`);
      }
    }

    expect(missing).toEqual([]);
  });

  it("gives every permission-gated entry a page that checks THAT permission", async () => {
    // Hiding a nav entry is not access control (master section 45). The page
    // behind it has to refuse on its own.
    const missing: string[] = [];

    for (const item of NAV_ITEMS) {
      if (item.permission === undefined) continue;

      const source = await readFile(pageFileFor(item.segment), "utf8");
      const expected = `PERMISSIONS.${constantNameFor(PERMISSIONS, item.permission)}`;

      if (!source.includes(expected) || !/hasPermission|requirePermission/.test(source)) {
        missing.push(`${item.key} -> ${expected}`);
      }
    }

    expect(missing).toEqual([]);
  });

  it("checks a meaningful number of entries", async () => {
    expect(NAV_ITEMS.filter((i) => i.module !== undefined).length).toBeGreaterThanOrEqual(15);
    expect(NAV_ITEMS.filter((i) => i.permission !== undefined).length).toBeGreaterThanOrEqual(20);
  });
});

// ---------------------------------------------------------------------------
// The rest of the posture
// ---------------------------------------------------------------------------

async function walk(dir: string, extensions: readonly string[]): Promise<readonly string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(full, extensions)));
    } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
      files.push(full);
    }
  }

  return files;
}

describe("the service role key never appears (TEST-2512)", () => {
  it("is absent from every application source file", async () => {
    // Master section 9: never expose `service_role` to the browser. Every
    // privileged DATABASE write goes through a narrow SECURITY DEFINER function
    // (ADR-011). The one exception, creating an owner's auth account, uses the
    // secret key in a single module - see "the secret key is confined" below.
    //
    // `src/tests` is excluded and the exclusion is not a loophole: the PGlite
    // harness has to CREATE the role for the migrations' GRANTs to resolve, the
    // Phase 00 logger test asserts that the word is redacted, and this file
    // contains the literal it is searching for. None of that ships.
    const offenders: string[] = [];
    let scanned = 0;

    for (const file of await walk(join(process.cwd(), "src"), [".ts", ".tsx"])) {
      if (file.includes(join("src", "tests"))) continue;

      scanned += 1;
      const source = stripComments(await readFile(file, "utf8"));
      if (/SERVICE_ROLE|service_role/.test(source)) {
        offenders.push(file.replace(process.cwd(), ""));
      }
    }

    expect(offenders).toEqual([]);
    // Not vacuous: it really did read the application.
    expect(scanned).toBeGreaterThan(100);
  });
});

describe("the secret key is confined", () => {
  const ALLOWED = [join("src", "config", "env.ts"), join("src", "lib", "supabase", "admin.ts")];

  it("is named only by the env schema and the admin module", async () => {
    const offenders: string[] = [];

    for (const file of await walk(join(process.cwd(), "src"), [".ts", ".tsx"])) {
      if (file.includes(join("src", "tests"))) continue;
      if (ALLOWED.some((allowed) => file.endsWith(allowed))) continue;

      const source = stripComments(await readFile(file, "utf8"));
      if (/SUPABASE_SECRET_KEY/.test(source)) {
        offenders.push(file.replace(process.cwd(), ""));
      }
    }

    expect(offenders).toEqual([]);
  });

  it("keeps the admin module server-only and clientless", async () => {
    const source = await readFile(
      join(process.cwd(), "src", "lib", "supabase", "admin.ts"),
      "utf8",
    );
    expect(source).toMatch(/^import "server-only";/);
    // It exports operations, never the client itself.
    expect(source).not.toMatch(/export\s+(async\s+)?function\s+\w*[Cc]lient/);
  });
});

describe("server-only modules stay on the server (TEST-2511)", () => {
  it("keeps the server Supabase client out of every client component", async () => {
    // `import "server-only"` already makes this a build error. This test says
    // WHICH file, instead of a stack trace from the bundler.
    const offenders: string[] = [];

    for (const file of await walk(join(process.cwd(), "src"), [".tsx", ".ts"])) {
      if (file.includes(`${join("src", "tests")}`)) continue;

      const source = await readFile(file, "utf8");
      const isClient = /^\s*["']use client["']/m.test(source);
      if (!isClient) continue;

      if (
        /@\/lib\/supabase\/(server|admin)|@\/lib\/permissions\/check|@\/lib\/features\/check/.test(
          source,
        )
      ) {
        offenders.push(file.replace(process.cwd(), ""));
      }
    }

    expect(offenders).toEqual([]);
  });

  it("finds client components at all, so the check is not vacuous", async () => {
    let clientFiles = 0;

    for (const file of await walk(join(process.cwd(), "src"), [".tsx"])) {
      const source = await readFile(file, "utf8");
      if (/^\s*["']use client["']/m.test(source)) clientFiles += 1;
    }

    expect(clientFiles).toBeGreaterThan(10);
  });
});
