# Database

> Current as of Phase 18.

One PostgreSQL database, one `public` schema, one migration history, hosted on
Supabase. Rationale: [ADR-001](../adr/001-single-database-multitenancy.md).

## Migrations

Every schema change is a versioned file in `supabase/migrations/`, applied in
lexicographic order.

```bash
npm run db:start    # supabase start   (needs Docker)
npm run db:reset    # re-apply every migration from scratch
npm run db:diff     # capture manual changes as a migration
npm run db:types    # regenerate src/types/database.ts
```

Rules (master section 22):

- A migration already applied in production is **never** edited. Create a new one.
- Every migration states which RLS policies it created.
- Migrations must run identically in local, staging and production.

### Current history

66 files across 17 phases (Phase 15 added none — POS reuses `orders`' and
`payments`' existing tables and Server Actions). `src/tests/database/
schema.test.ts` asserts this exact list and order, so it cannot silently
drift from what is actually applied.

| Phase | File | Adds |
|---|---|---|
| 01 | `20260824120000_create_tenants.sql` | `tenant_status`, `set_updated_at()`, `tenants`, RLS |
| 01 | `20260824120100_create_tenant_domains.sql` | domain enums, `tenant_domains`, indexes, RLS |
| 01 | `20260824120200_create_tenant_resolution.sql` | `resolve_tenant_by_domain()` SECURITY DEFINER |
| 02 | `20260825120000_create_profiles.sql` | `profiles`, one row per Supabase Auth user |
| 02 | `20260825120100_create_tenant_members.sql` | `tenant_members`, who belongs to which tenant |
| 02 | `20260825120200_create_membership_access.sql` | The sanctioned "which tenants am I in" read path |
| 03 | `20260825130000_create_authorization_catalog.sql` | `roles`, `permissions`, `role_permissions`, seeded |
| 03 | `20260825130100_create_authorization_functions.sql` | `is_tenant_member`, `has_permission`, `my_permissions` |
| 03 | `20260825130200_create_authorization_policies.sql` | Opens the deny-by-default posture of Phases 01-02 |
| 03 | `20260825130300_create_tenant_roster.sql` | Makes `members.view` usable |
| 04 | `20260825140000_create_platform_admins.sql` | The platform operator identity — not a tenant role |
| 04 | `20260825140100_create_platform_policies.sql` | Platform-wide access, alongside Phase 03's policies |
| 04 | `20260825140200_create_tenant_provisioning.sql` | Tenant provisioning (master section 49) |
| 05 | `20260825150000_reserve_dashboard_segments.sql` | Reserves slugs the dashboard's own routes would shadow |
| 06 | `20260825160000_create_tenant_settings.sql` | Everything that makes a business look like itself |
| 06 | `20260825160100_create_tenant_storage.sql` | File isolation between businesses |
| 06 | `20260825160200_extend_provisioning.sql` | Provisioning creates settings + theme rows too |
| 07 | `20260825170000_create_cms_permissions.sql` | `content.view` / `content.manage` |
| 07 | `20260825170100_create_pages.sql` | Pages and their typed sections |
| 07 | `20260825170200_create_navigation.sql` | The administrable navbar, two-level |
| 07 | `20260825170300_create_public_read.sql` | Anonymous read of published content |
| 08 | `20260825180000_create_tenant_seo.sql` | Site-wide SEO / social metadata |
| 08 | `20260825180100_add_page_seo.sql` | Per-page overrides |
| 08 | `20260825180200_create_public_site_reads.sql` | What an anonymous visitor may read to render a full site |
| 09 | `20260825190000_create_domain_permissions.sql` | `domains.view` / `domains.manage` |
| 09 | `20260825190100_extend_tenant_domains.sql` | Verification token, provider status, as separate facts |
| 09 | `20260825190200_create_domain_functions.sql` | `claim_domain`, `record_domain_ownership_check`, `set_primary_domain` |
| 09 | `20260825190300_create_domain_policies.sql` | Read + delete-with-conditions; no INSERT/UPDATE policy |
| 09 | `20260825190400_fix_provisioning_domain.sql` | Provisioning stops swallowing a domain conflict |
| 10 | `20260825200000_create_location_permissions.sql` | `locations.view` / `locations.manage` |
| 10 | `20260825200100_create_locations.sql` | The branches a business operates from |
| 10 | `20260825200200_create_location_hours.sql` | When each branch is open |
| 10 | `20260825200400_extend_tenant_defaults_location.sql` | Every tenant gets a first branch automatically |
| 11 | `20260825210000_create_categories.sql` | How a business groups what it sells |
| 11 | `20260825210100_create_products.sql` | What the business sells |
| 11 | `20260825210200_create_product_children.sql` | Images, variants, options |
| 11 | `20260825210300_extend_public_identity_currency.sql` | Public identity function gains the currency |
| 12 | `20260827120000_create_customer_documents.sql` | Peruvian identity document types |
| 12 | `20260827120100_create_customers.sql` | Who a business sells to |
| 12 | `20260827120200_create_customer_addresses.sql` | Where a customer is |
| 13 | `20260827130000_create_order_enums.sql` | `order_status`, `order_source`, `order_transitions` (the FSM as data) |
| 13 | `20260827130100_create_orders.sql` | What was sold; per-tenant order number |
| 13 | `20260827130200_create_order_items.sql` | Lines, the price snapshot, computed totals |
| 13 | `20260827130300_create_order_status_history.sql` | Append-only audit trail of an order's lifecycle |
| 14 | `20260827140000_create_payment_permissions.sql` | `payments.*`, `payment_methods.*`, `cash.view`, `cash.manage` |
| 14 | `20260827140100_create_payment_methods.sql` | The rails a business accepts money through |
| 14 | `20260827140200_create_cash_registers.sql` | A till, tied to a location |
| 14 | `20260827140300_create_cash_sessions.sql` | One open-to-close cycle; close computes the diff |
| 14 | `20260827140400_create_payments_and_movements.sql` | Payments, capped at balance; the till's own ledger |
| 14 | `20260827140500_extend_orders_paid_cents.sql` | `orders.paid_cents`, kept in step by trigger |
| 16 | `20260827160000_extend_categories_kitchen_station.sql` | `kitchen_station` enum, `categories.kitchen_station` |
| 16 | `20260827160100_extend_order_items_station.sql` | `order_items.station`, snapshotted at insert |
| 16 | `20260827160200_enable_kds_realtime.sql` | `order_items`/`orders` added to the `supabase_realtime` publication |
| 17 | `20260827170000_create_billing_permissions.sql` | `billing.manage` (`billing.view`/`create`/`cancel` pre-seeded in 03) |
| 17 | `20260827170100_create_billing_documents.sql` | `billing_documents`, `billing_document_transitions` (the FSM as data) |
| 17 | `20260827170200_create_billing_document_items.sql` | Lines, the IGV split, computed totals |
| 17 | `20260827170300_create_billing_events.sql` | Append-only audit trail of a document's lifecycle |
| 17 | `20260827170400_create_billing_provider_configs.sql` | Provider/series config; Vault-backed credential functions |
| 18 | `20260827180000_create_inventory_permissions.sql` | `inventory.*`, `suppliers.*`, `purchases.*` |
| 18 | `20260827180100_create_units.sql` | Units of measure; `create_tenant_defaults()` seeds a starter set |
| 18 | `20260827180200_create_inventory_items.sql` | What a business buys and consumes, not what it sells |
| 18 | `20260827180300_create_suppliers.sql` | Who a business buys stock from |
| 18 | `20260827180400_create_purchases.sql` | An immutable receipt; no purchase-order workflow (ADR-022) |
| 18 | `20260827180500_create_stock_movements.sql` | The ledger; `inventory_stock_levels` (a VIEW, never a stored balance) |
| 18 | `20260827180600_create_recipes.sql` | What one unit of a product consumes, by inventory item |
| 18 | `20260827180700_extend_orders_stock_consumption.sql` | Writes `sale` movements when an order reaches `completed` |

## Conventions

| Concern      | Convention                                                              |
| ------------ | ------------------------------------------------------------------------ |
| Primary keys | `uuid` with `gen_random_uuid()` (master section 6)                      |
| Timestamps   | `timestamptz not null default now()`, UTC                               |
| `updated_at` | Maintained by the `set_updated_at()` trigger, never by the application  |
| Tenant scope | `tenant_id uuid not null` on every business table (from Phase 10)       |
| Uniqueness   | `UNIQUE(tenant_id, ...)`, never bare `UNIQUE(...)` — see the exceptions |
| Deletes      | Business and auditable data is archived by status, not deleted          |
| Enums        | PostgreSQL enums for closed, slow-moving sets                           |
| Money        | `bigint`, integer minor units — never `numeric`, never a float (ADR-015) |
| JSONB        | Only for genuinely dynamic configuration, never instead of a relation   |

Two further shapes recur from Phase 10 onward, both there to make an
invariant provable rather than conventional:

- **Derived tenant_id.** A child row (`order_items`, `payments`,
  `cash_movements`, …) does not accept `tenant_id` from its caller; a
  `BEFORE INSERT` trigger derives it from the parent (`order_id`,
  `cash_session_id`, …), so a policy check and the row's real owner can never
  disagree.
- **Cross-tenant reference guards.** Two foreign keys on the same row, each
  pointing at a table that itself carries `tenant_id` (an order's location and
  customer; a cash register's location; a payment's method and session), is a
  place a plain FK cannot stop from silently disagreeing — a `BEFORE
  INSERT OR UPDATE` trigger checks both against the row's own tenant. First
  closed in Phase 11 (product/category), repeated in every phase since.

### Deliberate exceptions to tenant-scoped uniqueness

`tenants.slug` and `tenant_domains.domain` are globally unique, because both are
public identities on the internet. See
[multitenancy.md](./multitenancy.md#two-globally-unique-namespaces).

## Indexes

Each index answers a real query pattern (master section 8); over-indexing is
treated as a defect. The full, current list for a given table lives in that
table's phase SPEC (§19 Performance considerations) — kept there rather than
duplicated here, where it would drift. A few structurally important examples:

| Index | Serves |
|---|---|
| `tenants_slug_key` | Slug lookup and uniqueness |
| `tenant_domains_domain_key` | **The** resolution query, one per request |
| `orders_tenant_number_key` (unique) | Per-tenant order numbering; the race is arbitrated by the index, not a lock |
| `cash_sessions_one_open_per_register` (unique, partial) | At most one open session per till, same arbitration-by-index move |
| `orders_tenant_location_placed_idx` | "Today, in this branch" — the query the dashboard runs all day |
| `order_items_tenant_product_idx` (partial) | "How many times did we sell this" without a full scan |
| `billing_documents_one_live_per_order_type` (unique, partial) | At most one live (`pending`/`sent`/`accepted`) document per order+type — idempotency arbitrated by the index, same move as the two rows above |

`tenants.status` is deliberately **not** indexed: three values over a small
table means a sequential scan wins, and a test asserts the index stays absent
so the decision cannot be reverted by accident.

## Row Level Security

RLS is enabled on every table holding private or business data, and is never
disabled (master sections 10 and 51). `src/tests/database/isolation.test.ts`
asserts this project-wide, table by table, against a real PostgreSQL with
every migration applied.

| Phase | Table | Policies | Effective access |
|---|---|---|---|
| 01 | `tenants` | select (member); platform full access (04) | Members read their own tenant; write is provisioning/platform only |
| 01 | `tenant_domains` | select, delete (09); platform full access (04) | No INSERT/UPDATE policy at all — only the three domain functions may write (see [domains.md](./domains.md)) |
| 02 | `profiles` | select own, update own | A user reads/edits only themselves |
| 02 | `tenant_members` | select own (02); roster/insert/update/delete (03); platform select (04) | Own row always; full roster with `members.view`; writes with `members.manage` |
| 03 | `roles`, `permissions`, `role_permissions` | select, `using (true)` | Read-only capability catalogue — no tenant data, so a blanket read is not an isolation hole. One of only two *exceptions* to `using (true)` being forbidden (see below) |
| 04 | `platform_admins` | select own | An operator sees their own admin row |
| 06 | `tenant_settings`, `tenant_themes`, `tenant_social_links` | select member, update manager; public select added in 08 | Configuration a tenant edits, and the public site later reads |
| 06 | `tenant_assets` (storage metadata) | select/insert/update/delete manager; public select (08) | Uploaded files, isolated per tenant |
| 07 | `pages`, `page_sections`, `navigation_items` | select member, write manager; public select (08) | CMS content, published subset readable by anyone |
| 08 | `tenant_seo` | select public, select member, update manager | SEO overrides, public because search engines read them |
| 10 | `locations` | select member, select public, insert/update manager | No DELETE — a branch is deactivated |
| 10 | `location_hours` | select member, select public, write manager | |
| 11 | `categories`, `products` | select member, select public, insert/update/**delete** manager | A hard DELETE — narrower business tables (`customer_addresses`, `tenant_members`, `tenant_domains`, `tenant_assets`, `order_items`) also permit one; `orders` and every Phase 14 table deliberately do not |
| 11 | `product_images`, `product_variants`, `product_options` | select member, select public, write manager | |
| 12 | `customers` | select member, insert/update manager | No public policy — a customer is private data (ADR-016) |
| 12 | `customer_addresses` | select/insert/update/delete manager | |
| 13 | `order_transitions` | select, `using (true)` | The state machine as data — the second (and, deliberately, last) `using (true)` exception; it is product data, not any tenant's |
| 13 | `orders` | select member, insert creator, update operator | No DELETE — an order is a sales record; `cancelled` is how one stops counting |
| 13 | `order_items` | select member, insert/update/delete operator | Deletable only while the parent order is still `pending` (trigger-enforced) |
| 13 | `order_status_history` | select member, insert operator | No UPDATE, no DELETE — an audit trail |
| 14 | `payment_methods` | select viewer, insert/update manager | No DELETE — deactivated, referenced payments RESTRICT against it |
| 14 | `cash_registers` | select viewer, insert/update manager | No DELETE |
| 14 | `cash_sessions` | select viewer, insert opener, update closer | No DELETE; UPDATE only ever closes a session (trigger-guarded) |
| 14 | `payments` | select viewer, insert operator, update voider | No DELETE; UPDATE only ever voids (trigger-guarded, ADR-018) |
| 14 | `cash_movements` | select viewer, insert manager (payout/deposit/adjustment only, no `sale`) | No UPDATE, no DELETE — append-only ledger; the `sale` row and a void's compensating row are written by a SECURITY DEFINER trigger, which bypasses this policy entirely |
| 17 | `billing_document_transitions` | select, `using (true)` | The document lifecycle as data — same shape and reasoning as `order_transitions`; product data, not any tenant's |
| 17 | `billing_documents` | select member, insert creator, update operator (`create` OR `cancel`) | No DELETE — a tax document is anulled, never removed |
| 17 | `billing_document_items` | select member | No INSERT/UPDATE/DELETE policy for a direct caller — only the SECURITY DEFINER trigger that populates them writes, bypassing this policy entirely |
| 17 | `billing_events` | select member, insert operator | No UPDATE, no DELETE — an audit trail |
| 17 | `billing_provider_configs` | select/update manager (`billing.manage`) | No INSERT policy — every tenant is provisioned a row automatically; no DELETE — a tenant reconfigures by updating |
| 18 | `units`, `inventory_items` | select member, insert/update manager (`inventory.manage`) | No DELETE — deactivated, referenced by `stock_movements`/`recipe_items` RESTRICT against it |
| 18 | `suppliers` | select viewer, insert/update manager (`suppliers.manage`) | No DELETE |
| 18 | `purchases` | select viewer, insert creator (`purchases.create`) | No UPDATE for a direct caller — `total_cost_cents` is trigger-only; no DELETE, ever — a receipt |
| 18 | `stock_movements` | select member, insert operator (split by type: `purchase` needs `purchases.create`; `adjustment`/`waste`/`return`/`transfer` need `inventory.manage`) | `sale` matches neither branch — refused for every direct caller, verified live; no UPDATE/DELETE, ever |
| 18 | `recipes`, `recipe_items` | select member, insert/update/**delete** manager (`inventory.manage`) | A hard DELETE, like `categories`/`products` (Phase 11) — a recipe is inventory data, not a financial ledger |

**`using (true)` on a table holding tenant data is forbidden**, and a test
(`isolation.test.ts`) asserts nothing outside `roles`/`permissions`/
`role_permissions`, `order_transitions` and `billing_document_transitions`
uses it — all four exceptions hold product-wide reference data, never a
business's own rows, and all four are read-only.

Authorization is resolved by `has_permission(tenant_id, permission)`, which
both the policies and the application call. Full model:
[authorization.md](./authorization.md), rationale:
[ADR-010](../adr/010-rbac-authorization.md).

### Views

`inventory_stock_levels` (Phase 18) is the first `VIEW` in this schema —
current stock, summed live from `stock_movements` rather than stored on a
row, because a (item, location) balance has no table of its own among
Phase 18's seven ([ADR-022](../adr/022-derived-stock-and-completion-triggered-consumption.md)).
It is declared `with (security_invoker = true)`, which is not the
default: without it, a view runs with its **owner's** privileges (the
migration role), not the querying user's, and would bypass every RLS
policy on the table it reads — silently returning every tenant's stock to
anyone. Verified live against a real Supabase instance that the flag
does what it claims.

### SECURITY DEFINER functions

Any such function must `SET search_path = ''` and fully qualify every name,
otherwise a caller can point it at objects they control. A test asserts this
for every `SECURITY DEFINER` function in the schema, not just
`resolve_tenant_by_domain`.

A `SECURITY DEFINER` trigger that writes into a table **other than** the one
it fired on also bypasses that other table's RLS (the owner-bypass applies to
every statement the function runs). This is deliberate and is how, for
example, `recompute_order_totals()` (Phase 13) updates `orders`,
`record_payment_cash_movement()` (Phase 14) inserts into `cash_movements`,
and `populate_billing_document_items()` (Phase 17) inserts into
`billing_document_items` — none of the three target tables needs a policy
that would let an ordinary caller do the same thing directly.

Phase 17 is also the first to hold a real external secret. Three narrow
`SECURITY DEFINER` functions (`set_billing_credentials`,
`has_billing_credentials`, `clear_billing_credentials`) are the *only* code
in the schema that touches Supabase Vault (`vault.create_secret`,
`vault.update_secret`, a direct `DELETE` from `vault.secrets` — this Vault
version ships no `delete_secret()` wrapper, confirmed against a real
Supabase stack). No function anywhere reads a stored credential back; see
[ADR-021](../adr/021-billing-provider-abstraction-and-vault-credentials.md).

## Types

`src/types/database.ts` is the TypeScript contract. It is hand-maintained today
because generating it needs Docker, and kept honest by
`src/tests/database/schema-contract.test.ts`, which compares it against the
introspected live schema in both directions — and, for the tables where it
matters most (a snapshot's required fields, a personal-data column that must
never appear), asserts specific shapes at compile time via `tsc`.

When a Supabase stack is available, regenerate rather than hand-edit:

```bash
npm run db:types
```

## Testing

Migrations run against a real PostgreSQL inside the test process (PGlite, no
Docker), so constraints, indexes, triggers and RLS are executed rather than
reviewed. Rationale and fidelity gaps — what this approach cannot exercise
(concurrent writers, real PostgREST embeds) — are recorded in
[ADR-007](../adr/007-sql-testing-without-docker.md) and, per phase, in each
SPEC's own Implementation notes.

```bash
npm run test -- --project node   # includes src/tests/database/
```
