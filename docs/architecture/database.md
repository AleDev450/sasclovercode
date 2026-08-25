# Database

> Current as of Phase 03.

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

Current history:

| File                                          | Adds                                                |
| --------------------------------------------- | --------------------------------------------------- |
| `20260824120000_create_tenants.sql`           | `tenant_status`, `set_updated_at()`, `tenants`, RLS |
| `20260824120100_create_tenant_domains.sql`    | domain enums, `tenant_domains`, indexes, RLS        |
| `20260824120200_create_tenant_resolution.sql` | `resolve_tenant_by_domain()` SECURITY DEFINER       |

## Conventions

| Concern      | Convention                                                              |
| ------------ | ----------------------------------------------------------------------- |
| Primary keys | `uuid` with `gen_random_uuid()` (master section 6)                      |
| Timestamps   | `timestamptz not null default now()`, UTC                               |
| `updated_at` | Maintained by the `set_updated_at()` trigger, never by the application  |
| Tenant scope | `tenant_id uuid not null` on every business table (from Phase 10)       |
| Uniqueness   | `UNIQUE(tenant_id, ...)`, never bare `UNIQUE(...)` — see the exceptions |
| Deletes      | Business and auditable data is archived by status, not deleted          |
| Enums        | PostgreSQL enums for closed, slow-moving sets                           |
| JSONB        | Only for genuinely dynamic configuration, never instead of a relation   |

### Deliberate exceptions to tenant-scoped uniqueness

`tenants.slug` and `tenant_domains.domain` are globally unique, because both are
public identities on the internet. See
[multitenancy.md](./multitenancy.md#two-globally-unique-namespaces).

## Indexes

Each index answers a real query pattern (master section 8). Over-indexing is
treated as a defect.

| Index                                   | Serves                                         |
| --------------------------------------- | ---------------------------------------------- |
| `tenants_slug_key`                      | Slug lookup and uniqueness                     |
| `tenant_domains_domain_key`             | **The** resolution query, one per request      |
| `tenant_domains_tenant_id_idx`          | Listing a tenant's domains; FK checks; cascade |
| `tenant_domains_one_system_per_tenant`  | At most one system domain per tenant           |
| `tenant_domains_one_primary_per_tenant` | At most one primary domain per tenant          |

`tenants.status` is **not** indexed on purpose: three values over a small table
means a sequential scan wins. A test asserts the index stays absent, so the
decision cannot be reverted by accident.

## Row Level Security

RLS is enabled on every table holding private data, and is never disabled
(master sections 10 and 51).

| Table              | RLS     | Policies | Effective access                                                         |
| ------------------ | ------- | -------- | ------------------------------------------------------------------------ |
| `tenants`          | enabled | 1 SELECT | members of that tenant only                                              |
| `tenant_domains`   | enabled | none     | denied; only the guarded resolver reads                                  |
| `profiles`         | enabled | own row  | a user sees and edits only themselves                                    |
| `tenant_members`   | enabled | 4        | own row always; roster with `members.view`; writes with `members.manage` |
| `roles`            | enabled | 1 SELECT | read-only catalogue, authenticated only                                  |
| `permissions`      | enabled | 1 SELECT | read-only catalogue, authenticated only                                  |
| `role_permissions` | enabled | 1 SELECT | read-only catalogue, authenticated only                                  |

The three catalogue tables use `using (true)`, and that does **not** contradict
master section 10: they hold no tenant data, only the product's capability list.
A test asserts the exception stays read-only and that nothing else uses it.

Authorization is resolved by `has_permission(tenant_id, permission)`, which both
the policies and the application call. See
[ADR-010](../adr/010-rbac-authorization.md).

`using (true)` on a private table is forbidden, and a test asserts no table
outside the catalogue uses it.

### SECURITY DEFINER functions

Any such function must `SET search_path = ''` and fully qualify every name,
otherwise a caller can point it at objects they control. A test asserts this for
`resolve_tenant_by_domain`.

## Types

`src/types/database.ts` is the TypeScript contract. It is hand-maintained today
because generating it needs Docker, and kept honest by
`src/tests/database/schema-contract.test.ts`, which compares it against the
introspected live schema in both directions.

When a Supabase stack is available, regenerate rather than hand-edit:

```bash
npm run db:types
```

## Testing

Migrations run against a real PostgreSQL inside the test process, so
constraints, indexes, triggers and RLS are executed rather than reviewed.
Rationale and fidelity gaps: [ADR-007](../adr/007-sql-testing-without-docker.md).

```bash
npm run test -- --project node   # includes src/tests/database/
```
