# ADR-007 — Testing SQL and RLS against real PostgreSQL, without Docker

```text
Status: ACCEPTED
Date:   2026-08-24
Phase:  01 — Multi-Tenancy Core
```

## Context

From Phase 01 onward the most security-critical logic in CloverCode lives in
SQL: constraints, partial unique indexes, RLS and a SECURITY DEFINER function.
Master section 21 makes tenant-isolation tests mandatory, and section 22 requires
migrations that run consistently everywhere.

The standard way to check that is `supabase start`, which needs Docker. On the
machine this phase was built on, Docker Desktop is installed but its daemon is
not running, and GitHub-hosted CI runners would need the whole Supabase stack
pulled and booted on every push.

Untested SQL is not an option. The isolation proof is the one thing the entire
product rests on.

## Decision

**Tests execute the project's own migration files against a real PostgreSQL
engine embedded in the test process**, using PGlite (PostgreSQL compiled to
WebAssembly).

`src/tests/helpers/database.ts` boots an instance, creates the Supabase roles
(`anon`, `authenticated`, `service_role`), applies every file in
`supabase/migrations/` in lexicographic order, and then applies **Supabase's
default table grants**.

That last step is the point. Without the grants, "anon sees zero rows" would
pass because a privilege was missing. Granting `SELECT` first and still seeing
zero rows is what proves RLS is doing the work.

`supabase start` against Docker remains the higher-fidelity check and stays
documented; this harness is what makes the check run on every push.

## Alternatives considered

| Alternative                          | Why rejected                                                                                                       |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Docker + `supabase start` in CI      | Highest fidelity, but pulls and boots the full stack per run. Kept as the manual, pre-release check instead.       |
| A hosted staging database for tests  | Shared mutable state across concurrent runs, credentials in CI, and cross-test interference.                       |
| Reviewing the SQL and not testing it | The isolation guarantee would rest on reading. Master section 21 forbids exactly this.                             |
| Mocking the database                 | Mocks cannot fail a CHECK constraint or enforce RLS. It would test the mock.                                       |
| `pg-mem`                             | A reimplementation of a subset of PostgreSQL, not PostgreSQL. It does not implement RLS, which is the whole point. |

## Consequences

**Positive**

- Constraints, partial unique indexes, triggers, RLS and SECURITY DEFINER
  behaviour are executed, not assumed.
- The isolation suite runs in CI with no service containers, in about a second.
- Each test file gets an isolated database, so tests cannot leak into each other.
- `src/types/database.ts` can be hand-maintained safely, because the schema
  contract test compares it against the introspected live schema.

**Negative — fidelity gaps, and how they are handled**

- **PostgreSQL 18 here, 17 in `supabase/config.toml`.** Everything used
  (enums, CHECK, partial unique indexes, RLS, SECURITY DEFINER) behaves
  identically. Re-check when a version-sensitive feature is introduced.
- **No Supabase `auth` schema and no `auth.uid()`.** Phase 01 needs neither.
  Phase 03 will, and extends the harness with a `auth.uid()` shim reading a GUC.
- **No PostgREST.** The SQL is tested directly and the TypeScript resolver is
  tested against a stubbed client. The seam between them is covered by neither,
  and that is stated plainly rather than papered over.
- **No Supabase-specific roles beyond the three created here.**

Because of these gaps, `supabase start` with Docker stays the release check
before anything reaches production.

## Follow-up

- **Phase 03** extends the harness with an `auth.uid()` shim and runs the
  cross-tenant policy suite through it.
- **Phase 28** adds a pre-release run against a real Supabase instance, closing
  the PostgREST seam.
