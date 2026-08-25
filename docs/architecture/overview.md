# CloverCode — Architecture overview

> Scope note: this document reflects what exists **today** (end of Phase 01).
> Sections describing later phases are marked as such and are stated as intent,
> not as implemented behaviour. It is updated at the end of every phase.

## What CloverCode is

A multi-tenant SaaS platform from which one operator administers many
independent businesses — their public website, catalogue, orders, point of sale,
inventory and electronic invoicing — on one codebase and one database.

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
src/modules/     business domains                     (empty until Phase 04)
src/components/  shared UI
src/lib/         cross-cutting capabilities
src/config/      environment and constants
src/types/       type contracts, including the database
src/tests/       unit / integration / (later) authorization
```

Dependency direction is one-way:

```text
app  ->  modules  ->  lib  ->  config / types
```

`lib` never imports from `modules` or `app`. A module never reaches into another
module's internals — only its `index.ts`.

## What exists after Phase 01

| Capability         | Module               | Notes                                             |
| ------------------ | -------------------- | ------------------------------------------------- |
| Domain errors      | `src/lib/errors`     | 9 types, one serialisation boundary               |
| Structured logging | `src/lib/logger`     | JSON records, redaction, `requestId`              |
| Input validation   | `src/lib/validation` | Zod, `parseOrThrow` -> `ValidationError`          |
| Supabase access    | `src/lib/supabase`   | browser + server factories, typed with `Database` |
| Configuration      | `src/config/env`     | lazy, memoised, Zod-validated                     |
| UI primitives      | `src/components/ui`  | 9 accessible components with explicit states      |
| Health probe       | `src/app/api/health` | liveness only; dependency checks are Phase 24     |

## Multi-tenancy (implemented in Phase 01)

The decision is recorded in [ADR-001](../adr/001-single-database-multitenancy.md):
one database, one schema, `tenant_id` on every business row, isolation enforced
by Row Level Security.

Implemented request flow:

```text
Request
   |
hostname
   |
tenant_domains  ({slug}.clovercodeapp.com | custom domain)
   |
tenant
   |
render website / dashboard / POS
```

**Nothing in Phase 00 assumes a single tenant**, and no module-scope variable
holds tenant state — that would leak between requests on a shared server.

## Identity model (implemented from Phase 02/03)

```text
auth.users
     |
profiles
     |
tenant_members
     |
     +--------> tenants
     |
     +--------> roles
```

One user may belong to several tenants with a different role in each. The system
is never designed as one user = one tenant.

`SUPER_ADMIN` (CloverCode staff) is a different concept from `OWNER` (a tenant's
owner) and must never be conflated.

## Security posture after Phase 01

| Control                        | Status                                                             |
| ------------------------------ | ------------------------------------------------------------------ |
| Security headers               | Active on every route (HSTS, nosniff, DENY, Referrer, Permissions) |
| `X-Powered-By`                 | Disabled                                                           |
| Secrets in the repository      | None; `.env*` ignored except `.env.example`                        |
| `service_role` key             | Not referenced anywhere yet (arrives in Phase 04)                  |
| Error detail leakage           | Blocked at `serializeError()`, covered by tests                    |
| Credential leakage into logs   | Blocked by central redaction, covered by tests                     |
| Content Security Policy        | **Deferred to Phase 25** — needs per-request nonces                |
| Authentication / authorization | **Not implemented** — Phases 02 and 03                             |
| Row Level Security             | **Not implemented** — no tables exist yet                          |

## Verification

The same four commands run locally and in CI:

```bash
npm run lint       # ESLint; Next.js 16 no longer lints during build
npm run typecheck  # next typegen && tsc --noEmit
npm run test       # Vitest, two projects
npm run build      # must succeed with no credentials present
```

## Where to read more

- Phase specifications: [`docs/specs/`](../specs/)
- Architecture decisions: [`docs/adr/`](../adr/)
- Master specification: [`CLOVERCODE_MASTER.md`](../../CLOVERCODE_MASTER.md)

## Documents planned for later phases

Section 60 of the master document lists the architecture documents to maintain.
Each is written by the phase that first makes it meaningful, rather than created
empty now:

| Document            | Written in phase |
| ------------------- | ---------------- |
| `authentication.md` | 02               |
| `authorization.md`  | 03               |
| `domains.md`        | 09               |
| `deployment.md`     | 28               |
| `security.md`       | 25               |
