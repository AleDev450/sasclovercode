# ADR-001 — Single-database multi-tenancy with a modular monolith

```text
Status: ACCEPTED
Date:   2026-08-24
Phase:  00 — Foundation
```

## Context

CloverCode must serve many independent businesses (tenants) from one product.
The first customers are a handful of restaurants and shops in Peru, but the
architecture has to hold at 5, 50 and 500 tenants and evolve towards thousands
without a rewrite.

Three isolation strategies were on the table:

1. **One database per tenant.** Strongest isolation, but every migration has to
   run N times, connection pooling degrades quickly, and cross-tenant reporting
   (which the Super Admin area needs) becomes a distributed query problem.
2. **One PostgreSQL schema per tenant.** Better than N databases, still N
   migrations, and Supabase's tooling (generated types, RLS, Realtime) is built
   around a stable `public` schema.
3. **One database, one schema, `tenant_id` on every business row, isolation
   enforced by Row Level Security.**

Deployment is Vercel + Supabase. Supabase gives us Postgres RLS evaluated by the
database itself, which means isolation does not depend on application code being
correct at every call site.

## Decision

CloverCode uses **one PostgreSQL database, one schema, one codebase**, with:

- a `tenants` table as the root entity;
- `tenant_id UUID NOT NULL` on every business table;
- **Row Level Security on every table holding private data**, with explicit
  policies derived from `auth.uid()` and `tenant_members`;
- tenant-aware constraints throughout: `UNIQUE(tenant_id, slug)`, never
  `UNIQUE(slug)`;
- the application organised as a **modular monolith** (`src/modules/<domain>`),
  not as microservices.

Isolation is enforced at two levels: the application resolves and validates the
tenant, and the database refuses cross-tenant rows regardless of what the
application asks for.

## Alternatives considered

| Alternative         | Why rejected                                                                                                          |
| ------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Database per tenant | N migrations, N connection pools, no practical cross-tenant reporting, provisioning latency on tenant creation.       |
| Schema per tenant   | Still N migrations; fights Supabase's generated types and RLS model; complicates Realtime subscriptions.              |
| Microservices       | No measured problem justifies the operational cost (CLOVERCODE_MASTER.md section 47). Premature at any current scale. |
| App-only filtering  | One forgotten `.eq("tenant_id", ...)` leaks another tenant's data. Unacceptable; this is exactly what RLS prevents.   |

## Consequences

**Positive**

- One migration set, one type generation, one deployment.
- Cross-tenant queries for the Super Admin area are ordinary SQL.
- Isolation survives application bugs, because the database enforces it.
- New tenant provisioning is an `INSERT`, not an infrastructure operation.

**Negative / risks**

- A missing or wrong RLS policy is a data breach, not a bug. Mitigation:
  RLS policies are part of every migration and of every phase's Definition of
  Done, and cross-tenant isolation tests are mandatory from Phase 03 onward.
- One noisy tenant shares resources with the rest. Mitigation: index every
  `tenant_id` access path (CLOVERCODE_MASTER.md section 8) and revisit only if a
  measured problem appears.
- A destructive migration affects all tenants at once. Mitigation: migrations
  are versioned, never edited after use, and each phase documents its rollback.

## Follow-up

- Tenant resolution strategy: ADR to be written in Phase 01.
- RBAC and RLS policy shape: ADR to be written in Phase 03.
- Money representation: ADR to be written in Phase 13/14.
