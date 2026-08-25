# ADR-005 — Testing strategy: Vitest with two projects

```text
Status: ACCEPTED
Date:   2026-08-24
Phase:  00 — Foundation
```

## Context

`CLOVERCODE_MASTER.md` section 21 defines four test categories — unit,
integration, authorization (especially multi-tenant isolation) and E2E — and
states that a critical feature is never finished without authorization tests.

Phase 00 has no data and no permissions, so it must set up the runner such that
the authorization and E2E suites can be added later without reorganising
anything.

## Decision

### 1. Vitest as the single runner

Vitest 4 shares Vite's transform pipeline, so TypeScript, JSX and the `@/*` path
alias work without a separate compilation step.

### 2. Two projects instead of one config

```text
node   src/tests/unit/**, src/tests/integration/**   environment: node
dom    src/tests/components/**                       environment: jsdom
```

Logic tests must prove they work without a DOM — server code has none. Component
tests need jsdom and Testing Library's cleanup hook. One shared config would
force jsdom onto everything, hiding accidental DOM dependencies in server code.

### 3. Tests live in `src/tests/`, mirroring section 13

Not colocated. Section 13 of the master document places `tests/` inside `src/`,
and the folder split matches the categories in section 21, which makes "run only
the authorization suite" a directory selection.

### 4. `server-only` is aliased to an inert stub in tests

The real package throws unless resolved through React's `react-server` export
condition, which Vitest does not apply. Aliasing it lets a server module be
imported directly by tests while the production build keeps the real guard.

### 5. `globals: false`

`describe` / `it` / `expect` are imported explicitly. Implicit globals hide where
a helper comes from and require a tsconfig `types` entry.

### 6. Coverage is measured but not gated in Phase 00

A percentage threshold on a foundation phase measures nothing useful. Phase 03
introduces the gate that matters: cross-tenant isolation tests must exist and
must pass.

### 7. E2E is deferred to Phase 05

There is no user flow to exercise until there is a login and a dashboard.
Playwright arrives with them.

## Alternatives considered

| Alternative                     | Why rejected                                                                                             |
| ------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Jest                            | Needs its own TS/ESM transform setup; slower here and duplicates the Vite pipeline the app already uses. |
| `node:test`                     | No component testing story, weaker mocking, no coverage integration.                                     |
| One Vitest config with jsdom    | Server code would silently pass while depending on DOM globals it will not have in production.           |
| Colocated `*.test.ts` files     | Diverges from section 13 and makes the section 21 categories invisible.                                  |
| Coverage threshold from day one | Encourages tests written to move a number instead of tests that assert behaviour.                        |

## Consequences

**Positive**

- Fast feedback: the full suite runs in ~1.3s.
- Server code is proven to work without a DOM.
- Adding Phase 03's `src/tests/authorization/` is one entry in the config.
- Swappable transports and cookie adapters make the logger and the Supabase
  clients testable without network or framework context.

**Negative**

- Two projects mean the resolve aliases are declared per project. Accepted; the
  duplication is small and explicit.
- Non-colocated tests mean a rename touches two directories.

## Follow-up

- **Phase 03** adds `src/tests/authorization/`, running against a real Postgres
  with RLS enabled, proving `Tenant A != Tenant B` at the database level. This is
  the suite the whole product depends on.
- **Phase 05** adds Playwright for E2E.
- **Phase 25** re-runs the isolation suite as part of the security audit.
