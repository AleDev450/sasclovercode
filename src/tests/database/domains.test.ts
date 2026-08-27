import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SYSTEM_DOMAIN } from "@/config/app";
import {
  createTestDatabase,
  insertDomain,
  insertTenant,
  type TestDatabase,
} from "../helpers/database";

/**
 * Phase 09 at the database level.
 *
 * A domain is global identity (master section 27: a domain belongs to exactly
 * one tenant), so a mistake here does not leak rows - it hands one business's
 * TRAFFIC to another. These tests are written from that angle: most of them are
 * an attempt to reach `active` from a tenant session, or to take a name that
 * belongs to somebody else.
 */

let db: TestDatabase;

let tenantA: string;
let tenantB: string;

let ownerA: string;
let cashierA: string;
let ownerB: string;

async function createUser(email: string): Promise<string> {
  const rows = await db.query<{ id: string }>(
    "insert into auth.users (email) values ($1) returning id",
    [email],
  );
  return rows[0]!.id;
}

async function addMember(tenantId: string, userId: string, role: string): Promise<void> {
  await db.query(
    `insert into public.tenant_members (tenant_id, user_id, role)
     values ($1, $2, $3::public.tenant_role)`,
    [tenantId, userId, role],
  );
}

/** Calls `claim_domain` as `userId` and returns the new row's id. */
async function claim(userId: string, tenantId: string, domain: string): Promise<string> {
  const rows = await db.asUser(userId, () =>
    db.query<{ id: string }>("select public.claim_domain($1, $2) as id", [tenantId, domain]),
  );
  return rows[0]!.id;
}

async function statusOf(domainId: string): Promise<string> {
  const rows = await db.query<{ verification_status: string }>(
    "select verification_status from public.tenant_domains where id = $1",
    [domainId],
  );
  return rows[0]!.verification_status;
}

beforeAll(async () => {
  db = await createTestDatabase();

  tenantA = await insertTenant(db, { slug: "sugurolls", name: "Sugu Rolls" });
  tenantB = await insertTenant(db, { slug: "polleria-el-rey", name: "Pollería El Rey" });

  ownerA = await createUser("owner@sugurolls.com");
  cashierA = await createUser("cashier@sugurolls.com");
  ownerB = await createUser("owner@polleria.pe");

  await addMember(tenantA, ownerA, "owner");
  await addMember(tenantA, cashierA, "cashier");
  await addMember(tenantB, ownerB, "owner");
});

afterAll(async () => {
  await db.close();
});

describe("catalogue and schema (TEST-901 to TEST-905)", () => {
  it("registers domains.view and domains.manage for owner and admin (TEST-901)", async () => {
    const rows = await db.query<{ role: string; permission: string }>(
      `select role, permission from public.role_permissions
       where permission like 'domains.%' order by role, permission`,
    );
    expect(rows).toEqual([
      { role: "owner", permission: "domains.manage" },
      { role: "owner", permission: "domains.view" },
      { role: "admin", permission: "domains.manage" },
      { role: "admin", permission: "domains.view" },
    ]);
  });

  it("does not give a manager or a cashier any domain permission", async () => {
    const rows = await db.query<{ c: string }>(
      `select count(*)::text c from public.role_permissions
       where permission like 'domains.%' and role not in ('owner', 'admin')`,
    );
    expect(Number(rows[0]?.c)).toBe(0);
  });

  it("rejects a custom domain with no verification token (TEST-903)", async () => {
    await expect(
      db.query(
        `insert into public.tenant_domains (tenant_id, domain, type)
         values ($1, 'sin-token.com', 'custom')`,
        [tenantA],
      ),
    ).rejects.toThrow(/tenant_domains_token_matches_type/);
  });

  it("rejects a system domain that carries a token (TEST-904)", async () => {
    await expect(
      db.query(
        `insert into public.tenant_domains (tenant_id, domain, type, verification_token)
         values ($1, $2, 'system', 'clovercode-site-verification=abc')`,
        [tenantA, `con-token.${SYSTEM_DOMAIN}`],
      ),
    ).rejects.toThrow(/tenant_domains_token_matches_type/);
  });

  it("keeps verification tokens globally unique (TEST-905)", async () => {
    const token = "clovercode-site-verification=deadbeefdeadbeefdeadbeefdeadbeef";
    await db.query(
      `insert into public.tenant_domains (tenant_id, domain, type, verification_token)
       values ($1, 'token-uno.com', 'custom', $2)`,
      [tenantA, token],
    );
    await expect(
      db.query(
        `insert into public.tenant_domains (tenant_id, domain, type, verification_token)
         values ($1, 'token-dos.com', 'custom', $2)`,
        [tenantB, token],
      ),
    ).rejects.toThrow(/tenant_domains_verification_token_key/);
  });

  it("starts a domain with no provider knowledge at all", async () => {
    const id = await claim(ownerA, tenantA, "provider-default.com");
    const rows = await db.query<{ provider_status: string; provider_synced_at: string | null }>(
      "select provider_status, provider_synced_at from public.tenant_domains where id = $1",
      [id],
    );
    // `unknown` is the honest default: nobody has looked yet. Anything else
    // would be the row claiming something about a system it has never contacted.
    expect(rows[0]?.provider_status).toBe("unknown");
    expect(rows[0]?.provider_synced_at).toBeNull();
  });
});

describe("claim_domain (TEST-906 to TEST-913)", () => {
  it("creates a pending domain with a token (TEST-906)", async () => {
    const id = await claim(ownerA, tenantA, "sugurolls.com");
    const rows = await db.query<{
      verification_status: string;
      verification_token: string | null;
      is_primary: boolean;
      type: string;
    }>(
      "select verification_status, verification_token, is_primary, type from public.tenant_domains where id = $1",
      [id],
    );
    expect(rows[0]?.verification_status).toBe("pending");
    expect(rows[0]?.type).toBe("custom");
    expect(rows[0]?.verification_token).toMatch(/^clovercode-site-verification=[0-9a-f]{32}$/);
    // Never primary on arrival: Phase 08 builds the canonical URL from the
    // primary domain, and this one serves nothing yet.
    expect(rows[0]?.is_primary).toBe(false);
  });

  it("is idempotent for the same tenant (TEST-907)", async () => {
    const first = await claim(ownerA, tenantA, "repetido.com");
    const second = await claim(ownerA, tenantA, "repetido.com");
    expect(second).toBe(first);
  });

  it.each([
    ["  SuguRolls.COM  ", "sugurolls.com.pe"],
    ["https://con-esquema.com/ruta", "con-esquema.com"],
    ["con-punto.com.", "con-punto.com"],
  ])("normalises %s before storing", async (input, expected) => {
    // The shapes people actually paste. Each is normalised INSIDE the function,
    // because a caller that skipped the application layer would otherwise store
    // a domain that never resolves.
    const raw = input === "  SuguRolls.COM  " ? "  SuguRolls.COM.PE  " : input;
    const id = await claim(ownerA, tenantA, raw);
    const rows = await db.query<{ domain: string }>(
      "select domain from public.tenant_domains where id = $1",
      [id],
    );
    expect(rows[0]?.domain).toBe(expected);
  });

  /*
   * TEST-908 - the hijack this closes is not obvious.
   *
   * Claiming `otro-negocio.clovercodeapp.com` would take the system subdomain
   * of a business that does not exist yet. When that business was provisioned,
   * the insert of its system domain would collide - and before the fix in
   * 20260825190400 it collided SILENTLY, leaving a tenant that resolved
   * nowhere.
   */
  it("refuses any domain inside the platform namespace (TEST-908)", async () => {
    for (const domain of [SYSTEM_DOMAIN, `futuro-negocio.${SYSTEM_DOMAIN}`]) {
      await expect(claim(ownerA, tenantA, domain), domain).rejects.toThrow(
        /belongs to the platform/,
      );
    }
  });

  it("refuses a live domain of another tenant (TEST-909)", async () => {
    await insertDomain(db, {
      tenantId: tenantB,
      domain: "ocupado-vivo.com",
      verificationStatus: "active",
    });
    await expect(claim(ownerA, tenantA, "ocupado-vivo.com")).rejects.toThrow(/not available/);
  });

  /*
   * TEST-910 - the message is the security control.
   *
   * "Already connected to Polleria El Rey" would turn this function into a way
   * to ask, one name at a time, which of your competitors is a CloverCode
   * customer. Same reasoning as 404-never-403 elsewhere in the system.
   */
  it("never names the tenant that holds a domain (TEST-910)", async () => {
    await insertDomain(db, {
      tenantId: tenantB,
      domain: "secreto.com",
      verificationStatus: "active",
    });

    let message = "";
    try {
      await claim(ownerA, tenantA, "secreto.com");
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain("not available");
    expect(message).not.toContain("polleria");
    expect(message).not.toContain(tenantB);
  });

  it("releases an unverified claim older than seven days (TEST-911)", async () => {
    const stale = await insertDomain(db, {
      tenantId: tenantB,
      domain: "abandonado.com",
      verificationStatus: "pending",
    });
    await db.query(
      "update public.tenant_domains set created_at = now() - interval '8 days' where id = $1",
      [stale],
    );

    const claimed = await claim(ownerA, tenantA, "abandonado.com");
    const rows = await db.query<{ tenant_id: string }>(
      "select tenant_id from public.tenant_domains where id = $1",
      [claimed],
    );
    expect(rows[0]?.tenant_id).toBe(tenantA);
    // The old row is gone rather than orphaned.
    expect(claimed).not.toBe(stale);
  });

  it("does NOT release a fresh claim of another tenant (TEST-912)", async () => {
    await insertDomain(db, {
      tenantId: tenantB,
      domain: "reciente.com",
      verificationStatus: "pending",
    });
    await expect(claim(ownerA, tenantA, "reciente.com")).rejects.toThrow(/not available/);
  });

  it("does not release a VERIFIED claim, however old", async () => {
    const old = await insertDomain(db, {
      tenantId: tenantB,
      domain: "viejo-pero-vivo.com",
      verificationStatus: "active",
    });
    await db.query(
      "update public.tenant_domains set created_at = now() - interval '400 days' where id = $1",
      [old],
    );
    await expect(claim(ownerA, tenantA, "viejo-pero-vivo.com")).rejects.toThrow(/not available/);
  });

  it("refuses a caller without domains.manage (TEST-913)", async () => {
    await expect(claim(cashierA, tenantA, "cajero.com")).rejects.toThrow(/Not allowed/);
  });

  it("refuses an owner claiming for a tenant that is not theirs", async () => {
    await expect(claim(ownerA, tenantB, "cruzado.com")).rejects.toThrow(/Not allowed/);
  });

  it.each(["no-tld", "-mal.com", "espacios .com", "x.c"])(
    "refuses the malformed domain %s",
    async (domain) => {
      await expect(claim(ownerA, tenantA, domain)).rejects.toThrow(/not a valid domain/);
    },
  );
});

describe("record_domain_ownership_check (TEST-914 to TEST-918)", () => {
  async function check(userId: string, domainId: string, ok: boolean, error?: string) {
    return db.asUser(userId, () =>
      db.query<{ s: string }>("select public.record_domain_ownership_check($1, $2, $3) as s", [
        domainId,
        ok,
        error ?? null,
      ]),
    );
  }

  it("moves a pending domain to verifying on success (TEST-914)", async () => {
    const id = await claim(ownerA, tenantA, "verificable.com");
    await check(ownerA, id, true);
    expect(await statusOf(id)).toBe("verifying");
  });

  /*
   * TEST-915 - THE test of this phase.
   *
   * The caller supplies the result of the DNS check, so a tenant can always
   * claim it passed. What stops that from being a domain takeover is that the
   * best outcome reachable here is `verifying`, and
   * `resolve_tenant_by_domain` serves only `active`. A forged pass buys a place
   * in an operator's queue and nothing else.
   */
  it("can NEVER reach active, however the caller lies (TEST-915)", async () => {
    const id = await claim(ownerA, tenantA, "intento-de-secuestro.com");

    for (let i = 0; i < 5; i += 1) {
      await check(ownerA, id, true);
    }

    expect(await statusOf(id)).toBe("verifying");

    const rows = await db.query<{ verified_at: string | null }>(
      "select verified_at from public.tenant_domains where id = $1",
      [id],
    );
    expect(rows[0]?.verified_at).toBeNull();
  });

  it("records the reason when the check fails (TEST-916)", async () => {
    const id = await claim(ownerA, tenantA, "fallida.com");
    await check(ownerA, id, false, "No hay ningun registro TXT.");

    const rows = await db.query<{ verification_status: string; last_error: string | null }>(
      "select verification_status, last_error from public.tenant_domains where id = $1",
      [id],
    );
    expect(rows[0]?.verification_status).toBe("failed");
    expect(rows[0]?.last_error).toBe("No hay ningun registro TXT.");
  });

  it("truncates an over-long reason rather than failing the write", async () => {
    const id = await claim(ownerA, tenantA, "error-largo.com");
    await check(ownerA, id, false, "x".repeat(500));
    const rows = await db.query<{ last_error: string | null }>(
      "select last_error from public.tenant_domains where id = $1",
      [id],
    );
    expect(rows[0]?.last_error?.length).toBe(300);
  });

  /*
   * TEST-917. DNS fails transiently all the time. Letting one failed lookup
   * take a working site off the air would be a self-inflicted outage, and one
   * a tenant could trigger on their own domain by accident.
   */
  it("does not demote a live domain (TEST-917)", async () => {
    const id = await insertDomain(db, {
      tenantId: tenantA,
      domain: "ya-publicado.com",
      verificationStatus: "active",
    });
    await check(ownerA, id, false, "se cayo el dns");
    expect(await statusOf(id)).toBe("active");
  });

  it("refuses a caller without domains.manage (TEST-918)", async () => {
    const id = await claim(ownerA, tenantA, "sin-permiso-check.com");
    await expect(check(cashierA, id, true)).rejects.toThrow(/not found/i);
    expect(await statusOf(id)).toBe("pending");
  });

  it("gives the same answer for another tenant's domain as for a missing one", async () => {
    const id = await claim(ownerB, tenantB, "de-otro.com");
    // Not "forbidden": that would confirm the id exists.
    await expect(check(ownerA, id, true)).rejects.toThrow(/not found/i);
  });

  it("refuses to verify a system domain", async () => {
    const id = await insertDomain(db, {
      tenantId: tenantA,
      domain: `sugurolls.${SYSTEM_DOMAIN}`,
      type: "system",
      verificationStatus: "active",
    });
    await expect(check(ownerA, id, true)).rejects.toThrow(/nothing to verify/);
  });
});

describe("set_primary_domain (TEST-919 to TEST-921)", () => {
  it("moves the primary flag atomically (TEST-919)", async () => {
    const tenant = await insertTenant(db, { slug: "primario", name: "Primario" });
    const owner = await createUser("owner@primario.pe");
    await addMember(tenant, owner, "owner");

    const system = await insertDomain(db, {
      tenantId: tenant,
      domain: `primario.${SYSTEM_DOMAIN}`,
      type: "system",
      isPrimary: true,
      verificationStatus: "active",
    });
    const custom = await insertDomain(db, {
      tenantId: tenant,
      domain: "primario.com",
      verificationStatus: "active",
    });

    await db.asUser(owner, () => db.query("select public.set_primary_domain($1)", [custom]));

    const rows = await db.query<{ id: string; is_primary: boolean }>(
      "select id, is_primary from public.tenant_domains where tenant_id = $1",
      [tenant],
    );
    const primaries = rows.filter((row) => row.is_primary);
    expect(primaries).toHaveLength(1);
    expect(primaries[0]?.id).toBe(custom);
    expect(rows.find((row) => row.id === system)?.is_primary).toBe(false);
  });

  /*
   * TEST-920. Phase 08 builds the canonical URL from the primary domain, so a
   * primary that does not resolve would point every search engine at an
   * address that answers nothing.
   */
  it("refuses a domain that is not active (TEST-920)", async () => {
    const id = await claim(ownerA, tenantA, "no-verificado-primario.com");
    await expect(
      db.asUser(ownerA, () => db.query("select public.set_primary_domain($1)", [id])),
    ).rejects.toThrow(/verified domain/);
  });

  it("refuses a caller without domains.manage", async () => {
    const id = await insertDomain(db, {
      tenantId: tenantA,
      domain: "primario-sin-permiso.com",
      verificationStatus: "active",
    });
    await expect(
      db.asUser(cashierA, () => db.query("select public.set_primary_domain($1)", [id])),
    ).rejects.toThrow(/not found/i);
  });

  it("never allows two primaries in one tenant (TEST-921)", async () => {
    const rows = await db.query<{ tenant_id: string; c: string }>(
      `select tenant_id, count(*)::text c from public.tenant_domains
       where is_primary group by tenant_id having count(*) > 1`,
    );
    expect(rows).toEqual([]);
  });
});

describe("RLS (TEST-922 to TEST-928)", () => {
  it("lets a member with domains.view read their own domains (TEST-922)", async () => {
    const rows = await db.asUser(ownerA, () =>
      db.query("select id from public.tenant_domains where tenant_id = $1", [tenantA]),
    );
    expect(rows.length).toBeGreaterThan(0);
  });

  it("shows nothing of another tenant (TEST-923)", async () => {
    const rows = await db.asUser(ownerA, () =>
      db.query("select id from public.tenant_domains where tenant_id = $1", [tenantB]),
    );
    expect(rows).toEqual([]);
  });

  it("shows a member without domains.view nothing at all", async () => {
    const rows = await db.asUser(cashierA, () => db.query("select id from public.tenant_domains"));
    expect(rows).toEqual([]);
  });

  it("shows an anonymous caller nothing (TEST-924)", async () => {
    const rows = await db.asRole("anon", () => db.query("select id from public.tenant_domains"));
    expect(rows).toEqual([]);
  });

  /*
   * TEST-925 - the absence that holds the phase together.
   *
   * RLS is row-level. A policy permissive enough to let a business set
   * `is_primary` would also let it write `verification_status = 'active'`,
   * which is the state that serves traffic. So there is no tenant UPDATE
   * policy, and the legitimate changes go through functions that decide for
   * themselves what they are willing to write.
   */
  it("has no tenant-side UPDATE policy (TEST-925)", async () => {
    const rows = await db.query<{ policyname: string; qual: string | null }>(
      `select policyname, qual from pg_policies
       where schemaname = 'public' and tablename = 'tenant_domains' and cmd = 'UPDATE'`,
    );
    for (const row of rows) {
      expect(row.qual ?? "", row.policyname).toContain("is_platform_admin");
    }
  });

  it("refuses a direct UPDATE from an owner", async () => {
    const id = await claim(ownerA, tenantA, "update-directo.com");
    await db.asUser(ownerA, () =>
      db.query(
        "update public.tenant_domains set verification_status = 'active', verified_at = now() where id = $1",
        [id],
      ),
    );
    // No policy matched, so the update affected no rows - silently, which is
    // how PostgreSQL reports a write RLS refuses.
    expect(await statusOf(id)).toBe("pending");
  });

  it("deletes a custom domain that is not primary (TEST-926)", async () => {
    const id = await claim(ownerA, tenantA, "para-borrar.com");
    await db.asUser(ownerA, () =>
      db.query("delete from public.tenant_domains where id = $1", [id]),
    );
    const rows = await db.query("select id from public.tenant_domains where id = $1", [id]);
    expect(rows).toEqual([]);
  });

  it("refuses to delete a system domain (TEST-927)", async () => {
    // A tenant of its own: the partial unique index allows one system domain
    // per tenant, and this file already gave tenantA one.
    const tenant = await insertTenant(db, { slug: "no-borrable", name: "No borrable" });
    const owner = await createUser("owner@no-borrable.pe");
    await addMember(tenant, owner, "owner");
    const id = await insertDomain(db, {
      tenantId: tenant,
      domain: `no-borrable.${SYSTEM_DOMAIN}`,
      type: "system",
      verificationStatus: "active",
    });
    await db.asUser(owner, () => db.query("delete from public.tenant_domains where id = $1", [id]));
    const rows = await db.query("select id from public.tenant_domains where id = $1", [id]);
    expect(rows).toHaveLength(1);
  });

  it("refuses to delete the primary domain (TEST-928)", async () => {
    const tenant = await insertTenant(db, { slug: "borrar-primario", name: "Borrar" });
    const owner = await createUser("owner@borrar.pe");
    await addMember(tenant, owner, "owner");
    const id = await insertDomain(db, {
      tenantId: tenant,
      domain: "es-primario.com",
      isPrimary: true,
      verificationStatus: "active",
    });

    await db.asUser(owner, () => db.query("delete from public.tenant_domains where id = $1", [id]));
    const rows = await db.query("select id from public.tenant_domains where id = $1", [id]);
    expect(rows).toHaveLength(1);
  });

  it("refuses to delete another tenant's domain", async () => {
    const id = await insertDomain(db, { tenantId: tenantB, domain: "ajeno-borrar.com" });
    await db.asUser(ownerA, () =>
      db.query("delete from public.tenant_domains where id = $1", [id]),
    );
    const rows = await db.query("select id from public.tenant_domains where id = $1", [id]);
    expect(rows).toHaveLength(1);
  });
});

/**
 * TEST-929 - the defect the migration note describes.
 *
 * `provision_tenant` inserted the system domain with `on conflict do nothing`.
 * When the domain already belonged to somebody else, the clause swallowed it
 * and the function returned success: a tenant existed with no domain, resolved
 * nowhere, and looked like a routing bug weeks later.
 */
describe("provisioning and the system domain (TEST-929)", () => {
  it("fails loudly when the system domain belongs to another tenant", async () => {
    const squatter = await insertTenant(db, { slug: "okupa", name: "Okupa" });
    const operator = await createUser("operator@clovercode.pe");
    await db.query("insert into public.platform_admins (user_id, status) values ($1, 'active')", [
      operator,
    ]);
    await createUser("nuevo-owner@example.com");

    // The contested system domain, parked on an unrelated tenant.
    await insertDomain(db, {
      tenantId: squatter,
      domain: `contested-slug.${SYSTEM_DOMAIN}`,
      type: "system",
      verificationStatus: "active",
    });

    await expect(
      db.asUser(operator, () =>
        db.query("select public.provision_tenant($1, $2, $3)", [
          "Contested",
          "contested-slug",
          "nuevo-owner@example.com",
        ]),
      ),
    ).rejects.toThrow(/belongs to another tenant/);

    // And the half-built tenant is not left behind: the exception rolled the
    // whole function back, which is the other half of the fix being right.
    const rows = await db.query("select id from public.tenants where slug = 'contested-slug'");
    expect(rows).toEqual([]);
  });

  it("is still idempotent for a genuine retry", async () => {
    const operator = await createUser("operator2@clovercode.pe");
    await db.query("insert into public.platform_admins (user_id, status) values ($1, 'active')", [
      operator,
    ]);
    await createUser("retry-owner@example.com");

    const first = await db.asUser(operator, () =>
      db.query<{ provision_tenant: string }>("select public.provision_tenant($1, $2, $3)", [
        "Retry",
        "retry-tenant",
        "retry-owner@example.com",
      ]),
    );
    const second = await db.asUser(operator, () =>
      db.query<{ provision_tenant: string }>("select public.provision_tenant($1, $2, $3)", [
        "Retry",
        "retry-tenant",
        "retry-owner@example.com",
      ]),
    );

    expect(second[0]?.provision_tenant).toBe(first[0]?.provision_tenant);
  });
});
