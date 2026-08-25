import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ALL_PERMISSIONS, ALL_ROLES } from "@/lib/permissions";
import { createTestDatabase, type TestDatabase } from "../helpers/database";

/**
 * TEST-308 - keeps the TypeScript catalogue and the database catalogue in step.
 *
 * `src/lib/permissions/permissions.ts` mirrors data that lives in a migration.
 * A mirror nobody checks is a mirror that drifts, and a permission code that
 * exists in code but not in the database resolves to `false` at run time - which
 * reads as "access denied" and is very hard to trace.
 */

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase();
});

afterAll(async () => {
  await db.close();
});

describe("catalogue contract", () => {
  it("declares exactly the permissions the database holds", async () => {
    const rows = await db.query<{ code: string }>(
      "select code from public.permissions order by code",
    );
    expect(rows.map((r) => r.code)).toEqual([...ALL_PERMISSIONS].sort());
  });

  it("declares exactly the roles the database holds", async () => {
    // `order by code` on an enum column sorts by DECLARATION order, not
    // alphabetically, so both sides are sorted in JS to compare sets.
    const rows = await db.query<{ code: string }>("select code from public.roles");
    expect(rows.map((r) => r.code).sort()).toEqual([...ALL_ROLES].sort());
  });

  it("orders roles by authority, matching the enum declaration order", async () => {
    const rows = await db.query<{ code: string }>("select code from public.roles order by rank");
    expect(rows.map((r) => r.code)).toEqual([...ALL_ROLES]);
  });

  it("has no role without at least one permission", async () => {
    const rows = await db.query<{ code: string }>(
      `select r.code from public.roles r
       left join public.role_permissions rp on rp.role = r.code
       group by r.code having count(rp.permission) = 0`,
    );
    expect(rows).toEqual([]);
  });

  it("has no permission granted to nobody", async () => {
    const rows = await db.query<{ code: string }>(
      `select p.code from public.permissions p
       left join public.role_permissions rp on rp.permission = p.code
       group by p.code having count(rp.role) = 0`,
    );
    expect(rows).toEqual([]);
  });

  it("grants settings.manage to the owner alone", async () => {
    const rows = await db.query<{ role: string }>(
      "select role from public.role_permissions where permission = 'settings.manage'",
    );
    expect(rows.map((r) => r.role)).toEqual(["owner"]);
  });

  it("keeps the three catalogue tables under RLS", async () => {
    const rows = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `select relname, relrowsecurity from pg_class
       where relname in ('roles','permissions','role_permissions') order by relname`,
    );
    expect(rows.every((r) => r.relrowsecurity)).toBe(true);
    expect(rows).toHaveLength(3);
  });

  it("gives the catalogue read-only policies", async () => {
    const rows = await db.query<{ tablename: string; cmd: string }>(
      `select tablename, cmd from pg_policies
       where schemaname = 'public'
         and tablename in ('roles','permissions','role_permissions')`,
    );
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.cmd === "SELECT")).toBe(true);
  });
});
