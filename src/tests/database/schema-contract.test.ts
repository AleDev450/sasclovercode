import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/types/database";
import { createTestDatabase, type TestDatabase } from "../helpers/database";

/**
 * TEST-141 - keeps `src/types/database.ts` honest.
 *
 * `src/types/database.ts` is hand-maintained, because generating it needs a
 * running Supabase stack and therefore Docker, which CI does not have. That is
 * only acceptable if drift is impossible to miss, which is what this file does,
 * in two directions that meet in the middle:
 *
 *   real schema  <->  EXPECTED_COLUMNS   checked at run time, against PostgreSQL
 *   EXPECTED_COLUMNS  <->  Database      checked at compile time, by tsc
 *
 * Change the schema without updating the types (or the reverse) and one of the
 * two halves fails.
 */

// --- Compile-time half ------------------------------------------------------

type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;

type Expect<T extends true> = T;

type TenantRow = Database["public"]["Tables"]["tenants"]["Row"];
type TenantDomainRow = Database["public"]["Tables"]["tenant_domains"]["Row"];
type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];
type TenantMemberRow = Database["public"]["Tables"]["tenant_members"]["Row"];
type TenantSeoRow = Database["public"]["Tables"]["tenant_seo"]["Row"];
type CustomerRow = Database["public"]["Tables"]["customers"]["Row"];
type CustomerAddressRow = Database["public"]["Tables"]["customer_addresses"]["Row"];
type OrderRow = Database["public"]["Tables"]["orders"]["Row"];
type OrderItemRow = Database["public"]["Tables"]["order_items"]["Row"];
type OrderStatusHistoryRow = Database["public"]["Tables"]["order_status_history"]["Row"];
type PaymentMethodRow = Database["public"]["Tables"]["payment_methods"]["Row"];
type CashRegisterRow = Database["public"]["Tables"]["cash_registers"]["Row"];
type CashSessionRow = Database["public"]["Tables"]["cash_sessions"]["Row"];
type PaymentRow = Database["public"]["Tables"]["payments"]["Row"];
type CashMovementRow = Database["public"]["Tables"]["cash_movements"]["Row"];

// If a column is added to or removed from the declared types without updating
// EXPECTED_COLUMNS below, `npm run typecheck` fails here.
export type _TenantKeys = Expect<
  Equal<keyof TenantRow, "id" | "name" | "slug" | "status" | "created_at" | "updated_at">
>;
export type _TenantDomainKeys = Expect<
  Equal<
    keyof TenantDomainRow,
    | "id"
    | "tenant_id"
    | "domain"
    | "type"
    | "is_primary"
    | "verification_status"
    | "verified_at"
    | "verification_token"
    | "verification_checked_at"
    | "last_error"
    | "provider_status"
    | "provider_synced_at"
    | "created_at"
    | "updated_at"
  >
>;

export type _ProfileKeys = Expect<
  Equal<keyof ProfileRow, "id" | "email" | "full_name" | "avatar_url" | "created_at" | "updated_at">
>;

export type _CustomerKeys = Expect<
  Equal<
    keyof CustomerRow,
    | "id"
    | "tenant_id"
    | "name"
    | "doc_type"
    | "doc_number"
    | "email"
    | "phone"
    | "is_active"
    | "created_at"
    | "updated_at"
  >
>;

export type _CustomerAddressKeys = Expect<
  Equal<
    keyof CustomerAddressRow,
    | "id"
    | "customer_id"
    | "tenant_id"
    | "label"
    | "address_line"
    | "district"
    | "city"
    | "reference"
    | "is_default"
    | "created_at"
    | "updated_at"
  >
>;

/*
 * Phase 12 keeps NO personal data beyond what an operation needs (ADR-016), and
 * this is the place a column added later would have to pass through. A `notes`
 * or `birth_date` on a customer fails here before anybody has to notice it in a
 * migration.
 */
export type _OrderKeys = Expect<
  Equal<
    keyof OrderRow,
    | "id"
    | "tenant_id"
    | "location_id"
    | "customer_id"
    | "number"
    | "status"
    | "source"
    | "notes"
    | "subtotal_cents"
    | "discount_cents"
    | "tax_cents"
    | "shipping_cents"
    | "total_cents"
    | "paid_cents"
    | "placed_at"
    | "completed_at"
    | "cancelled_at"
    | "cancel_reason"
    | "created_by"
    | "created_at"
    | "updated_at"
  >
>;

export type _OrderItemKeys = Expect<
  Equal<
    keyof OrderItemRow,
    | "id"
    | "order_id"
    | "tenant_id"
    | "product_id"
    | "variant_id"
    | "name_snapshot"
    | "variant_snapshot"
    | "unit_price_cents"
    | "quantity"
    | "discount_cents"
    | "tax_cents"
    | "total_cents"
    | "notes"
    | "position"
    | "station"
    | "created_at"
    | "updated_at"
  >
>;

export type _OrderStatusHistoryKeys = Expect<
  Equal<
    keyof OrderStatusHistoryRow,
    | "id"
    | "order_id"
    | "tenant_id"
    | "from_status"
    | "to_status"
    | "reason"
    | "changed_by"
    | "created_at"
  >
>;

export type _PaymentMethodKeys = Expect<
  Equal<
    keyof PaymentMethodRow,
    "id" | "tenant_id" | "type" | "name" | "reference" | "is_active" | "position"
    | "created_at" | "updated_at"
  >
>;

export type _CashRegisterKeys = Expect<
  Equal<
    keyof CashRegisterRow,
    "id" | "tenant_id" | "location_id" | "name" | "is_active" | "created_at" | "updated_at"
  >
>;

export type _CashSessionKeys = Expect<
  Equal<
    keyof CashSessionRow,
    | "id"
    | "tenant_id"
    | "cash_register_id"
    | "opened_by"
    | "closed_by"
    | "opening_cents"
    | "closing_cents"
    | "expected_cents"
    | "difference_cents"
    | "notes"
    | "opened_at"
    | "closed_at"
    | "updated_at"
  >
>;

/*
 * ADR-018: voiding is a nullable pair, not a status enum - a payment has one
 * possible edge, unlike Phase 13's eight-edge order lifecycle. Losing either
 * column would not fail anywhere else, so it is asserted as a presence.
 */
export type _PaymentKeys = Expect<
  Equal<
    keyof PaymentRow,
    | "id"
    | "tenant_id"
    | "order_id"
    | "payment_method_id"
    | "cash_session_id"
    | "amount_cents"
    | "reference"
    | "notes"
    | "voided_at"
    | "void_reason"
    | "created_by"
    | "created_at"
    | "updated_at"
  >
>;

export type _CashMovementKeys = Expect<
  Equal<
    keyof CashMovementRow,
    | "id"
    | "tenant_id"
    | "cash_session_id"
    | "type"
    | "amount_cents"
    | "payment_id"
    | "reason"
    | "created_by"
    | "created_at"
  >
>;

/*
 * Master section 33 (Phase 13) names the five fields an order line must keep as
 * a snapshot. Losing one would not fail anywhere else - the line would simply
 * stop recording something - so it is asserted as a presence.
 */
export type _OrderItemKeepsTheSnapshot = Expect<
  Equal<
    Extract<
      keyof OrderItemRow,
      "unit_price_cents" | "quantity" | "discount_cents" | "tax_cents" | "total_cents"
    >,
    "unit_price_cents" | "quantity" | "discount_cents" | "tax_cents" | "total_cents"
  >
>;

export type _CustomerHasNoSurplusPersonalData = Expect<
  Equal<Extract<keyof CustomerRow, "notes" | "birth_date" | "gender" | "address">, never>
>;
export type _TenantMemberKeys = Expect<
  Equal<
    keyof TenantMemberRow,
    "id" | "tenant_id" | "user_id" | "role" | "status" | "created_at" | "updated_at"
  >
>;

export type _TenantSeoKeys = Expect<
  Equal<
    keyof TenantSeoRow,
    | "tenant_id"
    | "site_title"
    | "site_description"
    | "og_title"
    | "og_description"
    | "og_image_path"
    | "twitter_image_path"
    | "robots_index"
    | "google_verification"
    | "created_at"
    | "updated_at"
  >
>;

// Every SEO text is optional and null means "inherit", which is a value the
// application reads. A non-nullable declaration here would let it stop checking.
export type _SeoTitleIsNullable = Expect<Equal<TenantSeoRow["site_title"], string | null>>;
export type _RobotsIndexIsNotNullable = Expect<Equal<TenantSeoRow["robots_index"], boolean>>;

// Nullability must match too: `verified_at` is the only nullable column.
export type _VerifiedAtIsNullable = Expect<Equal<TenantDomainRow["verified_at"], string | null>>;
export type _TenantIdIsNotNullable = Expect<Equal<TenantDomainRow["tenant_id"], string>>;
export type _FullNameIsNullable = Expect<Equal<ProfileRow["full_name"], string | null>>;
export type _ProfileEmailIsNotNullable = Expect<Equal<ProfileRow["email"], string>>;

/**
 * A profile must never gain a credential column. This is not a style
 * preference: master section 33 (Phase 2) states that a password is never
 * stored outside Supabase Auth, and a type-level assertion is the cheapest
 * place to catch somebody adding one.
 */
export type _ProfileHasNoCredentials = Expect<
  Equal<Extract<keyof ProfileRow, "password" | "password_hash" | "encrypted_password">, never>
>;

// --- Run-time half ----------------------------------------------------------

interface ColumnSpec {
  readonly dataType: string;
  readonly nullable: boolean;
}

const EXPECTED_COLUMNS: Record<string, Record<string, ColumnSpec>> = {
  orders: {
    id: { dataType: "uuid", nullable: false },
    tenant_id: { dataType: "uuid", nullable: false },
    location_id: { dataType: "uuid", nullable: false },
    customer_id: { dataType: "uuid", nullable: true },
    number: { dataType: "integer", nullable: false },
    status: { dataType: "USER-DEFINED", nullable: false },
    source: { dataType: "USER-DEFINED", nullable: false },
    notes: { dataType: "text", nullable: true },
    subtotal_cents: { dataType: "bigint", nullable: false },
    discount_cents: { dataType: "bigint", nullable: false },
    tax_cents: { dataType: "bigint", nullable: false },
    shipping_cents: { dataType: "bigint", nullable: false },
    total_cents: { dataType: "bigint", nullable: false },
    paid_cents: { dataType: "bigint", nullable: false },
    placed_at: { dataType: "timestamp with time zone", nullable: false },
    completed_at: { dataType: "timestamp with time zone", nullable: true },
    cancelled_at: { dataType: "timestamp with time zone", nullable: true },
    cancel_reason: { dataType: "text", nullable: true },
    created_by: { dataType: "uuid", nullable: true },
    created_at: { dataType: "timestamp with time zone", nullable: false },
    updated_at: { dataType: "timestamp with time zone", nullable: false },
  },
  order_items: {
    id: { dataType: "uuid", nullable: false },
    order_id: { dataType: "uuid", nullable: false },
    tenant_id: { dataType: "uuid", nullable: false },
    product_id: { dataType: "uuid", nullable: true },
    variant_id: { dataType: "uuid", nullable: true },
    name_snapshot: { dataType: "text", nullable: false },
    variant_snapshot: { dataType: "text", nullable: true },
    unit_price_cents: { dataType: "bigint", nullable: false },
    quantity: { dataType: "numeric", nullable: false },
    discount_cents: { dataType: "bigint", nullable: false },
    tax_cents: { dataType: "bigint", nullable: false },
    total_cents: { dataType: "bigint", nullable: false },
    notes: { dataType: "text", nullable: true },
    position: { dataType: "smallint", nullable: false },
    station: { dataType: "USER-DEFINED", nullable: false },
    created_at: { dataType: "timestamp with time zone", nullable: false },
    updated_at: { dataType: "timestamp with time zone", nullable: false },
  },
  order_status_history: {
    id: { dataType: "uuid", nullable: false },
    order_id: { dataType: "uuid", nullable: false },
    tenant_id: { dataType: "uuid", nullable: false },
    from_status: { dataType: "USER-DEFINED", nullable: true },
    to_status: { dataType: "USER-DEFINED", nullable: false },
    reason: { dataType: "text", nullable: true },
    changed_by: { dataType: "uuid", nullable: true },
    created_at: { dataType: "timestamp with time zone", nullable: false },
  },
  order_transitions: {
    from_status: { dataType: "USER-DEFINED", nullable: false },
    to_status: { dataType: "USER-DEFINED", nullable: false },
  },
  payment_methods: {
    id: { dataType: "uuid", nullable: false },
    tenant_id: { dataType: "uuid", nullable: false },
    type: { dataType: "USER-DEFINED", nullable: false },
    name: { dataType: "text", nullable: false },
    reference: { dataType: "text", nullable: true },
    is_active: { dataType: "boolean", nullable: false },
    position: { dataType: "smallint", nullable: false },
    created_at: { dataType: "timestamp with time zone", nullable: false },
    updated_at: { dataType: "timestamp with time zone", nullable: false },
  },
  cash_registers: {
    id: { dataType: "uuid", nullable: false },
    tenant_id: { dataType: "uuid", nullable: false },
    location_id: { dataType: "uuid", nullable: false },
    name: { dataType: "text", nullable: false },
    is_active: { dataType: "boolean", nullable: false },
    created_at: { dataType: "timestamp with time zone", nullable: false },
    updated_at: { dataType: "timestamp with time zone", nullable: false },
  },
  cash_sessions: {
    id: { dataType: "uuid", nullable: false },
    tenant_id: { dataType: "uuid", nullable: false },
    cash_register_id: { dataType: "uuid", nullable: false },
    opened_by: { dataType: "uuid", nullable: true },
    closed_by: { dataType: "uuid", nullable: true },
    opening_cents: { dataType: "bigint", nullable: false },
    closing_cents: { dataType: "bigint", nullable: true },
    expected_cents: { dataType: "bigint", nullable: true },
    difference_cents: { dataType: "bigint", nullable: true },
    notes: { dataType: "text", nullable: true },
    opened_at: { dataType: "timestamp with time zone", nullable: false },
    closed_at: { dataType: "timestamp with time zone", nullable: true },
    updated_at: { dataType: "timestamp with time zone", nullable: false },
  },
  payments: {
    id: { dataType: "uuid", nullable: false },
    tenant_id: { dataType: "uuid", nullable: false },
    order_id: { dataType: "uuid", nullable: false },
    payment_method_id: { dataType: "uuid", nullable: false },
    cash_session_id: { dataType: "uuid", nullable: true },
    amount_cents: { dataType: "bigint", nullable: false },
    reference: { dataType: "text", nullable: true },
    notes: { dataType: "text", nullable: true },
    voided_at: { dataType: "timestamp with time zone", nullable: true },
    void_reason: { dataType: "text", nullable: true },
    created_by: { dataType: "uuid", nullable: true },
    created_at: { dataType: "timestamp with time zone", nullable: false },
    updated_at: { dataType: "timestamp with time zone", nullable: false },
  },
  cash_movements: {
    id: { dataType: "uuid", nullable: false },
    tenant_id: { dataType: "uuid", nullable: false },
    cash_session_id: { dataType: "uuid", nullable: false },
    type: { dataType: "USER-DEFINED", nullable: false },
    amount_cents: { dataType: "bigint", nullable: false },
    payment_id: { dataType: "uuid", nullable: true },
    reason: { dataType: "text", nullable: true },
    created_by: { dataType: "uuid", nullable: true },
    created_at: { dataType: "timestamp with time zone", nullable: false },
  },
  customers: {
    id: { dataType: "uuid", nullable: false },
    tenant_id: { dataType: "uuid", nullable: false },
    name: { dataType: "text", nullable: false },
    doc_type: { dataType: "USER-DEFINED", nullable: true },
    doc_number: { dataType: "text", nullable: true },
    email: { dataType: "text", nullable: true },
    phone: { dataType: "text", nullable: true },
    is_active: { dataType: "boolean", nullable: false },
    created_at: { dataType: "timestamp with time zone", nullable: false },
    updated_at: { dataType: "timestamp with time zone", nullable: false },
  },
  customer_addresses: {
    id: { dataType: "uuid", nullable: false },
    customer_id: { dataType: "uuid", nullable: false },
    tenant_id: { dataType: "uuid", nullable: false },
    label: { dataType: "text", nullable: false },
    address_line: { dataType: "text", nullable: false },
    district: { dataType: "text", nullable: true },
    city: { dataType: "text", nullable: true },
    reference: { dataType: "text", nullable: true },
    is_default: { dataType: "boolean", nullable: false },
    created_at: { dataType: "timestamp with time zone", nullable: false },
    updated_at: { dataType: "timestamp with time zone", nullable: false },
  },
  tenants: {
    id: { dataType: "uuid", nullable: false },
    name: { dataType: "text", nullable: false },
    slug: { dataType: "text", nullable: false },
    status: { dataType: "USER-DEFINED", nullable: false },
    created_at: { dataType: "timestamp with time zone", nullable: false },
    updated_at: { dataType: "timestamp with time zone", nullable: false },
  },
  tenant_domains: {
    id: { dataType: "uuid", nullable: false },
    tenant_id: { dataType: "uuid", nullable: false },
    domain: { dataType: "text", nullable: false },
    type: { dataType: "USER-DEFINED", nullable: false },
    is_primary: { dataType: "boolean", nullable: false },
    verification_status: { dataType: "USER-DEFINED", nullable: false },
    verified_at: { dataType: "timestamp with time zone", nullable: true },
    verification_token: { dataType: "text", nullable: true },
    verification_checked_at: { dataType: "timestamp with time zone", nullable: true },
    last_error: { dataType: "text", nullable: true },
    provider_status: { dataType: "USER-DEFINED", nullable: false },
    provider_synced_at: { dataType: "timestamp with time zone", nullable: true },
    created_at: { dataType: "timestamp with time zone", nullable: false },
    updated_at: { dataType: "timestamp with time zone", nullable: false },
  },
  profiles: {
    id: { dataType: "uuid", nullable: false },
    email: { dataType: "text", nullable: false },
    full_name: { dataType: "text", nullable: true },
    avatar_url: { dataType: "text", nullable: true },
    created_at: { dataType: "timestamp with time zone", nullable: false },
    updated_at: { dataType: "timestamp with time zone", nullable: false },
  },
  tenant_members: {
    id: { dataType: "uuid", nullable: false },
    tenant_id: { dataType: "uuid", nullable: false },
    user_id: { dataType: "uuid", nullable: false },
    role: { dataType: "USER-DEFINED", nullable: false },
    status: { dataType: "USER-DEFINED", nullable: false },
    created_at: { dataType: "timestamp with time zone", nullable: false },
    updated_at: { dataType: "timestamp with time zone", nullable: false },
  },
  tenant_seo: {
    tenant_id: { dataType: "uuid", nullable: false },
    site_title: { dataType: "text", nullable: true },
    site_description: { dataType: "text", nullable: true },
    og_title: { dataType: "text", nullable: true },
    og_description: { dataType: "text", nullable: true },
    og_image_path: { dataType: "text", nullable: true },
    twitter_image_path: { dataType: "text", nullable: true },
    robots_index: { dataType: "boolean", nullable: false },
    google_verification: { dataType: "text", nullable: true },
    created_at: { dataType: "timestamp with time zone", nullable: false },
    updated_at: { dataType: "timestamp with time zone", nullable: false },
  },
};

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase();
});

afterAll(async () => {
  await db.close();
});

describe("TEST-141: declared types match the real schema", () => {
  // Phase 12 added `customers` and `customer_addresses` here rather than to the
  // exempt list below (TEST-1224): `src/types/database.ts` is hand-maintained,
  // and this phase hand-wrote 76 lines of it.
  it.each(Object.keys(EXPECTED_COLUMNS))("%s has exactly the declared columns", async (table) => {
    const rows = await db.query<{
      column_name: string;
      data_type: string;
      is_nullable: string;
    }>(
      `select column_name, data_type, is_nullable
       from information_schema.columns
       where table_schema = 'public' and table_name = $1
       order by column_name`,
      [table],
    );

    const actual = Object.fromEntries(
      rows.map((row) => [
        row.column_name,
        { dataType: row.data_type, nullable: row.is_nullable === "YES" },
      ]),
    );

    const expected = EXPECTED_COLUMNS[table];
    expect(Object.keys(actual).sort()).toEqual(Object.keys(expected ?? {}).sort());
    expect(actual).toEqual(expected);
  });

  it("declares the same enum values as the database", async () => {
    const rows = await db.query<{ typname: string; label: string }>(
      `select t.typname, e.enumlabel as label
       from pg_enum e join pg_type t on t.oid = e.enumtypid
       order by t.typname, e.enumsortorder`,
    );
    const grouped = rows.reduce<Record<string, string[]>>((acc, row) => {
      (acc[row.typname] ??= []).push(row.label);
      return acc;
    }, {});

    // These literals mirror the union types exported from src/types/database.ts.
    const declared: Record<string, string[]> = {
      tenant_status: ["active", "suspended", "archived"],
      tenant_domain_type: ["system", "custom"],
      domain_verification_status: ["pending", "verifying", "active", "failed"],
      // Exactly the three of master section 33 (Phase 12). A fourth added
      // without a phase asking for it fails here.
      customer_doc_type: ["dni", "ruc", "ce"],
      // The six of master section 33 (Phase 13), in its order.
      order_status: ["pending", "confirmed", "preparing", "ready", "completed", "cancelled"],
      order_source: ["web", "pos", "manual", "whatsapp", "delivery"],
    };

    for (const [name, values] of Object.entries(declared)) {
      expect([...(grouped[name] ?? [])].sort()).toEqual([...values].sort());
    }
  });

  it("declares the resolve_tenant_by_domain return shape correctly", async () => {
    const rows = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'tenants' limit 0`,
    );
    expect(rows).toEqual([]);

    // The function's output columns, straight from the catalog.
    const args = await db.query<{ proargnames: string[] | null }>(
      "select proargnames from pg_proc where proname = 'resolve_tenant_by_domain'",
    );

    type FunctionReturn =
      Database["public"]["Functions"]["resolve_tenant_by_domain"]["Returns"][number];
    const declaredKeys: (keyof FunctionReturn)[] = [
      "tenant_id",
      "slug",
      "name",
      "status",
      "domain",
      "domain_type",
      "is_primary",
    ];

    // proargnames holds the input argument followed by the OUT columns.
    const actual = (args[0]?.proargnames ?? []).filter((n) => !n.startsWith("p_"));
    expect(actual.sort()).toEqual([...declaredKeys].sort());
  });

  it("has no table outside the declared contract (TEST-1225)", async () => {
    const rows = await db.query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname = 'public' order by tablename",
    );
    // The Phase 03 catalogue tables are contract-checked in
    // `authorization-schema.test.ts`, against the TypeScript constants that
    // mirror them, so they are listed here rather than duplicated column by
    // column.
    const catalogueTables = [
      "roles",
      "permissions",
      "role_permissions",
      "platform_admins",
      "tenant_settings",
      "tenant_themes",
      "tenant_social_links",
      "pages",
      "page_sections",
      "navigation_items",
      "locations",
      "location_hours",
      "categories",
      "products",
      "product_images",
      "product_variants",
      "product_options",
    ];
    expect(rows.map((r) => r.tablename).sort()).toEqual(
      [...Object.keys(EXPECTED_COLUMNS), ...catalogueTables].sort(),
    );
  });
});
