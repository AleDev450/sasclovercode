# CloverCode — Architecture overview

> Scope note: this document reflects what exists **today** (end of Phase 18).
> Sections describing later phases are marked as such and are stated as intent,
> not as implemented behaviour. It is updated at the end of every phase.

## What CloverCode is

A multi-tenant SaaS platform from which one operator administers many
independent businesses — their public website, catalogue, orders, payments,
point of sale, inventory and electronic invoicing — on one codebase and one
database.

```text
                            CLOVERCODE
                                |
              +-----------------+------------------+
              |                                    |
           VERCEL                              SUPABASE
           Next.js                             PostgreSQL
              |                                    |
              |                              SINGLE DATABASE
              |                                    |
      +-------+--------+                  +--------+--------+
      |       |        |                  |        |        |
   Public    App      POS              Tenant A Tenant B Tenant C
   Website Dashboard
```

## Layers

```text
src/app/         routes, layouts, route handlers      (Next.js App Router)
src/modules/     business domains                     (see below)
src/components/  shared UI
src/lib/         cross-cutting capabilities
src/config/      environment and constants
src/types/       type contracts, including the database
src/tests/       unit / integration / database
```

Dependency direction is one-way:

```text
app  ->  modules  ->  lib  ->  config / types
```

`lib` never imports from `modules` or `app`. A module never reaches into another
module's internals — only its own `schemas.ts`, `lifecycle.ts`/`constants.ts`,
`server/actions.ts`, `server/queries.ts` and `components/`.

## Modules, as of Phase 18

```text
src/modules/
├── tenants/        resolution, active-tenant context (Phase 01)
├── auth/            sign-up, sign-in, session (Phase 02)
├── dashboard/        navigation, layout shell (Phase 05)
├── settings/          business settings, theme (Phase 06)
├── cms/                pages, sections, navigation (Phase 07)
├── seo/                 site + per-page metadata (Phase 08)
├── domains/              custom domain self-service (Phase 09)
├── locations/              branches and their hours (Phase 10)
├── catalog/                  categories, products, variants (Phase 11)
├── customers/                  who a business sells to (Phase 12)
├── orders/                      the sale itself (Phase 13)
├── payments/                     payments, cash registers/sessions (Phase 14)
├── pos/                            touch till over orders+payments (Phase 15)
├── kitchen/                         live board over orders+order_items (Phase 16)
├── billing/                          SUNAT documents, BillingProvider (Phase 17)
├── inventory/                          items, recipes, stock ledger (Phase 18)
└── platform/                              super-admin: operators, provisioning
```

Each holds `schemas.ts` (Zod), `server/actions.ts` (Server Actions,
`requirePermission` first), `server/queries.ts` (server-only reads), and
`components/`. A module with a small closed state machine also carries
`lifecycle.ts` (orders, billing) or documents why it doesn't need one
([ADR-018](../adr/018-payment-void-and-cash-ledger.md), payments). `pos` is
the first module with no `schemas.ts` of its own and no new database writes
at all — it calls `orders`' and `payments`' existing Server Actions directly
rather than through a `<form>` ([ADR-019](../adr/019-pos-actions-as-rpc-and-ephemeral-cart.md)),
and carries `cart.ts` in place of `lifecycle.ts`: pure client-side cart math,
not a state machine. `kitchen` is the first module to use Supabase Realtime
at all — one `postgres_changes` subscription per open board, triggering a
`router.refresh()` rather than carrying data itself
([ADR-020](../adr/020-kds-station-snapshot-and-realtime-as-refetch.md)); it
also has no `server/actions.ts` of its own, reusing `orders`' unmodified.
`billing` is the first module to hold a `provider.ts`: an interface
(`BillingProvider`) with a single shipped implementation
(`ManualBillingProvider`) rather than an integration against a real PSE —
no credentials or sandbox exist in this environment to build or verify one
against ([ADR-021](../adr/021-billing-provider-abstraction-and-vault-credentials.md),
the same posture [ADR-013](../adr/013-domain-verification-and-provider.md)
took toward an unverifiable Vercel integration). It is also the first
module to touch Supabase Vault, through three narrow functions that write
or check a credential and never read one back. `inventory` is the first
module to declare a database `VIEW` (`inventory_stock_levels`) rather
than a stored column for a derived value — with `security_invoker = true`
stated explicitly, since a view otherwise runs with its owner's
privileges, not the querying user's, and would bypass RLS
([ADR-022](../adr/022-derived-stock-and-completion-triggered-consumption.md)).

## What exists, by capability

| Capability | Module / location | Since |
| --- | --- | --- |
| Domain errors, one serialisation boundary | `src/lib/errors` | 00 |
| Structured logging, redaction | `src/lib/logger` | 00 |
| Input validation (Zod) | `src/lib/validation` | 00 |
| Supabase access (browser + server, typed) | `src/lib/supabase` | 00 |
| Multi-tenancy, hostname resolution | [multitenancy.md](./multitenancy.md) | 01 |
| Authentication, SSR sessions | [authentication.md](./authentication.md) | 02 |
| Authorization (RBAC, permissions in the DB) | [authorization.md](./authorization.md) | 03 |
| Platform operator identity, tenant provisioning | `src/modules/platform` | 04 |
| Tenant dashboard shell, permission-derived nav | `src/modules/dashboard` | 05 |
| Business settings, theme | `src/modules/settings` | 06 |
| CMS: pages, sections, navigation | `src/modules/cms` | 07 |
| SEO: site + per-page metadata | `src/modules/seo` | 08 |
| Custom domains | [domains.md](./domains.md) | 09 |
| Locations (branches, hours) | `src/modules/locations` | 10 |
| Catalogue (categories, products, variants) | `src/modules/catalog` | 11 |
| Customers, Peruvian identity documents | `src/modules/customers` | 12 |
| Orders (snapshot pricing, state machine) | `src/modules/orders` | 13 |
| Payments, cash registers/sessions | `src/modules/payments` | 14 |
| POS: touch till, no new writes of its own | `src/modules/pos` | 15 |
| Kitchen/KDS: live board, Realtime (first use) | `src/modules/kitchen` | 16 |
| Electronic billing: SUNAT documents, BillingProvider, Vault credentials (first use) | `src/modules/billing` | 17 |
| Inventory: items, suppliers, purchases, recipes, stock ledger + derived view (first use) | `src/modules/inventory` | 18 |
| Health probe (liveness only) | `src/app/api/health` | 00 |

Deeper reference for the database itself — every migration, every RLS policy,
every table — lives in [database.md](./database.md), not duplicated here.

## Multi-tenancy

The decision is recorded in [ADR-001](../adr/001-single-database-multitenancy.md):
one database, one schema, `tenant_id` on every business row (direct on a
top-level row, derived by trigger on a child of one), isolation enforced by
Row Level Security. Full model: [multitenancy.md](./multitenancy.md).

```text
Request
   |
hostname
   |
tenant_domains  ({slug}.clovercodeapp.com | custom domain, Phase 09)
   |
tenant
   |
render website / dashboard / (POS: Phase 15)
```

**Nothing assumes a single tenant anywhere in the codebase**, and no
module-scope variable holds tenant state — that would leak between requests on
a shared server.

## Identity and authorization model

```text
auth.users
     |
profiles
     |
tenant_members ──role──> roles ──> role_permissions ──> permissions
     |
     +--------> tenants
```

One user may belong to several tenants with a different role in each. The
system is never designed as one user = one tenant. Code asks for a
**permission**, never compares a **role** — see
[authorization.md](./authorization.md).

`SUPER_ADMIN` (CloverCode staff, `platform_admins`) is a different concept
from `OWNER` (a tenant's own owner role) and must never be conflated.

## Security posture

| Control                        | Status                                                              |
| ------------------------------- | -------------------------------------------------------------------- |
| Security headers                | Active on every route (HSTS, nosniff, DENY, Referrer, Permissions)  |
| `X-Powered-By`                  | Disabled                                                             |
| Secrets in the repository       | None; `.env*` ignored except `.env.example`                          |
| `service_role` key              | **Still not referenced anywhere.** Tenant provisioning (Phase 04) and every other privileged write use a narrow `SECURITY DEFINER` function instead (ADR-011) |
| Error detail leakage            | Blocked at `serializeError()`, covered by tests                      |
| Credential leakage into logs    | Blocked by central redaction, covered by tests                       |
| Content Security Policy         | **Deferred to Phase 25** — needs per-request nonces                  |
| Authentication                  | Implemented (Phase 02) — [authentication.md](./authentication.md)    |
| Authorization / RBAC            | Implemented (Phase 03) — [authorization.md](./authorization.md)      |
| Row Level Security              | Enabled on every business/private table, no exceptions besides two documented read-only, tenant-free catalogues — [database.md](./database.md#row-level-security) |
| Money as integer minor units, never a float | Implemented (Phase 11) — [ADR-015](../adr/015-money-as-minor-units.md) |
| Personal data minimization      | Implemented (Phase 12) — [ADR-016](../adr/016-personal-data-minimization.md) |

## Verification

The same four commands run locally and in CI:

```bash
npm run lint       # ESLint; Next.js 16 no longer lints during build
npm run typecheck  # next typegen && tsc --noEmit
npm run test       # Vitest, two projects
npm run build      # must succeed with no credentials present
```

## Where to read more

- Phase specifications: [`docs/specs/`](../specs/) — one SPEC per phase, the
  source of truth for what that phase actually does.
- Architecture decisions: [`docs/adr/`](../adr/) — why, not what.
- Master specification: [`CLOVERCODE_MASTER.md`](../../CLOVERCODE_MASTER.md).

## Documents planned for later phases

Section 60 of the master document lists the architecture documents to
maintain. Each is written by the phase that first makes it meaningful, rather
than created empty ahead of time — `authorization.md` and `domains.md` were
written well after their originating phases (03 and 09) and are caught up as
of Phase 14; the two below are still genuinely ahead of their phase.

| Document            | Written in phase |
| -------------------- | ----------------- |
| `deployment.md`      | 28                |
| `security.md`        | 25                |
