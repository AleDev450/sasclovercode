import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestDatabase,
  insertDomain,
  insertTenant,
  listMigrationFiles,
  type TestDatabase,
} from "../helpers/database";

/**
 * Schema, constraints and indexes, verified against a real PostgreSQL with the
 * project's own migration files applied.
 *
 * Master section 22: migrations must run consistently. These tests are what
 * make that claim checkable on every push.
 */

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase();
});

afterAll(async () => {
  await db.close();
});

async function expectRejection(sql: string, params: unknown[], constraint: string) {
  await expect(db.query(sql, params)).rejects.toThrow(new RegExp(constraint));
}

/**
 * PGlite returns `timestamptz` as a JS `Date`, not a string. Going through
 * `String(date)` would drop the milliseconds and make two distinct timestamps
 * compare equal, so convert explicitly.
 */
function toEpochMs(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  return new Date(String(value)).getTime();
}

describe("migrations (TEST-117, TEST-118)", () => {
  it("apply cleanly and in lexicographic order", async () => {
    const files = await listMigrationFiles();
    expect(files).toEqual([
      // Phase 01
      "20260824120000_create_tenants.sql",
      "20260824120100_create_tenant_domains.sql",
      "20260824120200_create_tenant_resolution.sql",
      // Phase 02
      "20260825120000_create_profiles.sql",
      "20260825120100_create_tenant_members.sql",
      "20260825120200_create_membership_access.sql",
      // Phase 03
      "20260825130000_create_authorization_catalog.sql",
      "20260825130100_create_authorization_functions.sql",
      "20260825130200_create_authorization_policies.sql",
      "20260825130300_create_tenant_roster.sql",
      // Phase 04
      "20260825140000_create_platform_admins.sql",
      "20260825140100_create_platform_policies.sql",
      "20260825140200_create_tenant_provisioning.sql",
      // Phase 05
      "20260825150000_reserve_dashboard_segments.sql",
      // Phase 06
      "20260825160000_create_tenant_settings.sql",
      "20260825160100_create_tenant_storage.sql",
      "20260825160200_extend_provisioning.sql",
      // Phase 07
      "20260825170000_create_cms_permissions.sql",
      "20260825170100_create_pages.sql",
      "20260825170200_create_navigation.sql",
      "20260825170300_create_public_read.sql",
      // Phase 08
      "20260825180000_create_tenant_seo.sql",
      "20260825180100_add_page_seo.sql",
      "20260825180200_create_public_site_reads.sql",
      // Phase 09
      "20260825190000_create_domain_permissions.sql",
      "20260825190100_extend_tenant_domains.sql",
      "20260825190200_create_domain_functions.sql",
      "20260825190300_create_domain_policies.sql",
      "20260825190400_fix_provisioning_domain.sql",
      // Phase 10
      "20260825200000_create_location_permissions.sql",
      "20260825200100_create_locations.sql",
      "20260825200200_create_location_hours.sql",
      "20260825200400_extend_tenant_defaults_location.sql",
      // Phase 11
      "20260825210000_create_categories.sql",
      "20260825210100_create_products.sql",
      "20260825210200_create_product_children.sql",
      "20260825210300_extend_public_identity_currency.sql",
      // Phase 12
      "20260827120000_create_customer_documents.sql",
      "20260827120100_create_customers.sql",
      "20260827120200_create_customer_addresses.sql",
      // Phase 13
      "20260827130000_create_order_enums.sql",
      "20260827130100_create_orders.sql",
      "20260827130200_create_order_items.sql",
      "20260827130300_create_order_status_history.sql",
      // Phase 14
      "20260827140000_create_payment_permissions.sql",
      "20260827140100_create_payment_methods.sql",
      "20260827140200_create_cash_registers.sql",
      "20260827140300_create_cash_sessions.sql",
      "20260827140400_create_payments_and_movements.sql",
      "20260827140500_extend_orders_paid_cents.sql",
      // Phase 16
      "20260827160000_extend_categories_kitchen_station.sql",
      "20260827160100_extend_order_items_station.sql",
      "20260827160200_enable_kds_realtime.sql",
    ]);
    // The timestamp prefix must order the files the same way PostgreSQL will
    // see them. A migration that sorts before one it depends on fails to apply.
    expect([...files].sort()).toEqual(files);
  });

  it("creates every table and enum of the phases applied so far", async () => {
    const tables = await db.query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname = 'public' order by tablename",
    );
    expect(tables.map((t) => t.tablename)).toEqual([
      "cash_movements",
      "cash_registers",
      "cash_sessions",
      "categories",
      "customer_addresses",
      "customers",
      "location_hours",
      "locations",
      "navigation_items",
      "order_items",
      "order_status_history",
      "order_transitions",
      "orders",
      "page_sections",
      "pages",
      "payment_methods",
      "payments",
      "permissions",
      "platform_admins",
      "product_images",
      "product_options",
      "product_variants",
      "products",
      "profiles",
      "role_permissions",
      "roles",
      "tenant_domains",
      "tenant_members",
      "tenant_seo",
      "tenant_settings",
      "tenant_social_links",
      "tenant_themes",
      "tenants",
    ]);

    const enums = await db.query<{ typname: string }>(
      `select t.typname from pg_type t
       join pg_namespace n on n.oid = t.typnamespace
       where n.nspname = 'public' and t.typtype = 'e' order by t.typname`,
    );
    expect(enums.map((e) => e.typname)).toEqual([
      "cash_movement_type",
      "customer_doc_type",
      "domain_provider_status",
      "domain_verification_status",
      "kitchen_station",
      "membership_status",
      "nav_link_type",
      "order_source",
      "order_status",
      "page_status",
      "payment_method_type",
      "platform_admin_status",
      "product_status",
      "section_type",
      "social_platform",
      "tenant_domain_type",
      "tenant_role",
      "tenant_status",
    ]);
  });

  it("declares the documented enum values", async () => {
    const values = await db.query<{ typname: string; label: string }>(
      `select t.typname, e.enumlabel as label
       from pg_enum e join pg_type t on t.oid = e.enumtypid
       order by t.typname, e.enumsortorder`,
    );
    const grouped = values.reduce<Record<string, string[]>>((acc, row) => {
      (acc[row.typname] ??= []).push(row.label);
      return acc;
    }, {});

    expect(grouped.tenant_status).toEqual(["active", "suspended", "archived"]);
    expect(grouped.tenant_domain_type).toEqual(["system", "custom"]);
    expect(grouped.domain_verification_status).toEqual([
      "pending",
      "verifying",
      "active",
      "failed",
    ]);
    // Master section 12. Order is part of the contract: enum sort order decides
    // how `order by role` behaves, and renumbering it would silently reorder
    // every listing built on it.
    expect(grouped.tenant_role).toEqual([
      "owner",
      "admin",
      "manager",
      "cashier",
      "waiter",
      "kitchen",
      "delivery",
      "accountant",
    ]);
    expect(grouped.membership_status).toEqual(["active", "invited", "suspended"]);
  });
});

describe("tenants constraints (TEST-119 to TEST-122)", () => {
  it("accepts a well-formed slug", async () => {
    const id = await insertTenant(db, { slug: "sugu-rolls", name: "Sugu Rolls" });
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it.each([
    ["uppercase", "SuguRolls"],
    ["a space", "sugu rolls"],
    ["a leading hyphen", "-sugurolls"],
    ["a trailing hyphen", "sugurolls-"],
    ["a dot", "sugu.rolls"],
    ["an underscore", "sugu_rolls"],
  ])("rejects a slug with %s", async (_label, slug) => {
    await expectRejection(
      "insert into public.tenants (slug, name) values ($1, 'X')",
      [slug],
      "tenants_slug_format",
    );
  });

  it("rejects a slug shorter than 3 characters", async () => {
    await expectRejection(
      "insert into public.tenants (slug, name) values ($1, 'X')",
      ["ab"],
      "tenants_slug_length",
    );
  });

  it("rejects a slug longer than 63 characters", async () => {
    await expectRejection(
      "insert into public.tenants (slug, name) values ($1, 'X')",
      ["a".repeat(64)],
      "tenants_slug_length",
    );
  });

  it.each(["www", "api", "admin", "app", "clovercode", "superadmin"])(
    "rejects the reserved slug %s",
    async (slug) => {
      await expectRejection(
        "insert into public.tenants (slug, name) values ($1, 'X')",
        [slug],
        "tenants_slug_not_reserved",
      );
    },
  );

  it("rejects a duplicate slug", async () => {
    await insertTenant(db, { slug: "duplicated-slug" });
    await expectRejection(
      "insert into public.tenants (slug, name) values ($1, 'Other')",
      ["duplicated-slug"],
      "tenants_slug_key",
    );
  });

  it("rejects a blank name", async () => {
    await expectRejection(
      "insert into public.tenants (slug, name) values ('blank-name', $1)",
      ["   "],
      "tenants_name_not_blank",
    );
  });

  it("defaults status to active", async () => {
    const id = await insertTenant(db, { slug: "default-status" });
    const rows = await db.query<{ status: string }>(
      "select status from public.tenants where id = $1",
      [id],
    );
    expect(rows[0]?.status).toBe("active");
  });
});

describe("tenant_domains constraints (TEST-123, TEST-124, TEST-127)", () => {
  it("rejects the same domain for two different tenants (TEST-123)", async () => {
    const a = await insertTenant(db, { slug: "owner-a" });
    const b = await insertTenant(db, { slug: "owner-b" });
    await insertDomain(db, { tenantId: a, domain: "contested.com" });

    await expect(insertDomain(db, { tenantId: b, domain: "contested.com" })).rejects.toThrow(
      /tenant_domains_domain_key/,
    );
  });

  it.each([
    ["uppercase", "Sugurolls.COM"],
    ["a port", "sugurolls.com:3000"],
    ["a scheme", "https://sugurolls.com"],
    ["a trailing dot", "sugurolls.com."],
    ["a single label", "localhost"],
    ["a path", "sugurolls.com/x"],
  ])("rejects a domain with %s", async (_label, domain) => {
    const tenant = await insertTenant(db, {
      slug: `fmt-${Math.random().toString(36).slice(2, 8)}`,
    });
    await expect(insertDomain(db, { tenantId: tenant, domain })).rejects.toThrow(
      /tenant_domains_domain_(format|length)/,
    );
  });

  it("requires verified_at exactly when the status is active (TEST-127)", async () => {
    const tenant = await insertTenant(db, { slug: "verified-at" });

    // The token is supplied because Phase 09 made it mandatory for a custom
    // domain; without it these would fail on the wrong constraint and the test
    // would pass while proving nothing about `verified_at`.

    // active without verified_at
    await expectRejection(
      `insert into public.tenant_domains
         (tenant_id, domain, type, verification_status, verified_at, verification_token)
       values ($1, 'no-stamp.com', 'custom', 'active', null,
               public.new_domain_verification_token())`,
      [tenant],
      "tenant_domains_verified_at_consistency",
    );

    // pending WITH verified_at
    await expectRejection(
      `insert into public.tenant_domains
         (tenant_id, domain, type, verification_status, verified_at, verification_token)
       values ($1, 'early-stamp.com', 'custom', 'pending', now(),
               public.new_domain_verification_token())`,
      [tenant],
      "tenant_domains_verified_at_consistency",
    );
  });
});

describe("partial unique indexes (TEST-125, TEST-126)", () => {
  it("allows only one system domain per tenant", async () => {
    const tenant = await insertTenant(db, { slug: "one-system" });
    await insertDomain(db, {
      tenantId: tenant,
      domain: "one-system.clovercodeapp.com",
      type: "system",
    });

    await expect(
      insertDomain(db, {
        tenantId: tenant,
        domain: "another-system.clovercodeapp.com",
        type: "system",
      }),
    ).rejects.toThrow(/tenant_domains_one_system_per_tenant/);
  });

  it("allows many custom domains per tenant", async () => {
    const tenant = await insertTenant(db, { slug: "many-custom" });
    await insertDomain(db, { tenantId: tenant, domain: "first.com" });
    await insertDomain(db, { tenantId: tenant, domain: "second.com" });

    const rows = await db.query<{ count: string }>(
      "select count(*) as count from public.tenant_domains where tenant_id = $1",
      [tenant],
    );
    expect(Number(rows[0]?.count)).toBe(2);
  });

  it("allows only one primary domain per tenant", async () => {
    const tenant = await insertTenant(db, { slug: "one-primary" });
    await insertDomain(db, { tenantId: tenant, domain: "primary-a.com", isPrimary: true });

    await expect(
      insertDomain(db, { tenantId: tenant, domain: "primary-b.com", isPrimary: true }),
    ).rejects.toThrow(/tenant_domains_one_primary_per_tenant/);
  });

  it("lets two different tenants each have a primary domain", async () => {
    const a = await insertTenant(db, { slug: "primary-tenant-a" });
    const b = await insertTenant(db, { slug: "primary-tenant-b" });
    await insertDomain(db, { tenantId: a, domain: "pa.com", isPrimary: true });
    await expect(
      insertDomain(db, { tenantId: b, domain: "pb.com", isPrimary: true }),
    ).resolves.toBeDefined();
  });
});

describe("referential integrity (TEST-128)", () => {
  it("cascades the delete of a tenant to its domains", async () => {
    const tenant = await insertTenant(db, { slug: "cascade-me" });
    await insertDomain(db, { tenantId: tenant, domain: "cascade-me.com" });

    await db.query("delete from public.tenants where id = $1", [tenant]);

    const rows = await db.query<{ count: string }>(
      "select count(*) as count from public.tenant_domains where tenant_id = $1",
      [tenant],
    );
    expect(Number(rows[0]?.count)).toBe(0);
  });

  it("rejects a domain pointing at a tenant that does not exist", async () => {
    await expect(
      insertDomain(db, {
        tenantId: "00000000-0000-0000-0000-000000000000",
        domain: "orphan.com",
      }),
    ).rejects.toThrow(/tenant_domains_tenant_id_fkey/);
  });
});

describe("updated_at trigger (TEST-129)", () => {
  it("advances updated_at on UPDATE and leaves created_at alone", async () => {
    const id = await insertTenant(db, { slug: "touch-me" });
    const before = await db.query<{ created_at: unknown; updated_at: unknown }>(
      "select created_at, updated_at from public.tenants where id = $1",
      [id],
    );

    await db.query("select pg_sleep(0.02)");
    await db.query("update public.tenants set name = 'Renamed' where id = $1", [id]);

    const after = await db.query<{ created_at: unknown; updated_at: unknown }>(
      "select created_at, updated_at from public.tenants where id = $1",
      [id],
    );

    expect(toEpochMs(after[0]?.created_at)).toBe(toEpochMs(before[0]?.created_at));
    expect(toEpochMs(after[0]?.updated_at)).toBeGreaterThan(toEpochMs(before[0]?.updated_at));
  });

  it("also applies to tenant_domains", async () => {
    const tenant = await insertTenant(db, { slug: "touch-domain" });
    const domainId = await insertDomain(db, { tenantId: tenant, domain: "touch-domain.com" });

    const before = await db.query<{ updated_at: unknown }>(
      "select updated_at from public.tenant_domains where id = $1",
      [domainId],
    );
    await db.query("select pg_sleep(0.02)");
    await db.query("update public.tenant_domains set is_primary = true where id = $1", [domainId]);
    const after = await db.query<{ updated_at: unknown }>(
      "select updated_at from public.tenant_domains where id = $1",
      [domainId],
    );

    expect(toEpochMs(after[0]?.updated_at)).toBeGreaterThan(toEpochMs(before[0]?.updated_at));
  });
});

describe("indexes (TEST-130)", () => {
  it("creates every index the SPEC documents", async () => {
    const rows = await db.query<{ indexname: string }>(
      `select indexname from pg_indexes
       where schemaname = 'public' order by indexname`,
    );
    const names = rows.map((r) => r.indexname);

    for (const expected of [
      "tenants_pkey",
      "tenants_slug_key",
      "tenant_domains_pkey",
      "tenant_domains_domain_key",
      "tenant_domains_tenant_id_idx",
      "tenant_domains_one_system_per_tenant",
      "tenant_domains_one_primary_per_tenant",
    ]) {
      expect(names).toContain(expected);
    }
  });

  it("does not index tenants.status, which the SPEC rules out deliberately", async () => {
    const rows = await db.query<{ indexdef: string }>(
      "select indexdef from pg_indexes where schemaname = 'public' and tablename = 'tenants'",
    );
    expect(rows.some((r) => r.indexdef.includes("(status)"))).toBe(false);
  });
});
