# ADR-004 — Lazy, memoised environment validation

```text
Status: ACCEPTED
Date:   2026-08-24
Phase:  00 — Foundation
```

## Context

`CLOVERCODE_MASTER.md` section 24 requires sensitive variables to live outside
the repository and a `.env.example` to document the contract. Section 9 forbids
trusting unvalidated input, and configuration is input.

The usual pattern — validate at module import so the process refuses to start
when misconfigured — conflicts with how this application is actually built and
deployed:

- `next build` executes application modules to prerender pages. On CI and on
  Vercel preview builds, the build step legitimately has **no** Supabase
  credentials. Import-time validation would fail every one of those builds.
- Next.js substitutes `NEXT_PUBLIC_*` variables **statically at build time**. A
  dynamic lookup (`process.env[name]`) is not substituted and silently resolves
  to `undefined` in the browser bundle.

## Decision

### 1. Validation is lazy and memoised

`getPublicEnv()` and `getServerEnv()` validate on first call and cache. Nothing
is validated at import time. A missing variable fails at first use, loudly, with
the exact list of offending keys.

### 2. `NEXT_PUBLIC_*` variables are read as literal references

`readPublicEnv()` lists every public variable as a verbatim
`process.env.NEXT_PUBLIC_X` expression. Any new public variable must be added
there or it will be `undefined` in the browser.

### 3. Empty strings are treated as absent

`NEXT_PUBLIC_SUPABASE_URL=""` is a misconfiguration, not a valid empty value.
Every string field is trimmed and an empty result becomes `undefined`.

### 4. Configuration failures name keys, never values

`ConfigurationError` lists the failing keys and their messages. Printing a value
would move a credential into the logs — precisely what section 9 forbids.

### 5. `ConfigurationError` is non-operational

A misconfigured deployment is a defect, not a user outcome. It logs at `error`
and reaches the caller as a generic `500`.

### 6. Callers that run at build time bypass the layer deliberately

`app/layout.tsx` reads `process.env.NEXT_PUBLIC_APP_URL` directly with a literal
fallback, because `metadata` is evaluated during `next build`. That exception is
commented at the call site.

### 7. Supabase's public key is not a secret

`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` ship to
the browser by design: in Supabase, access control comes from Row Level
Security, not from key secrecy. The `service_role` / secret key is a different
matter entirely and is introduced in Phase 04 behind a `server-only` guard.

## Alternatives considered

| Alternative                                  | Why rejected                                                                                 |
| -------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Eager validation at import                   | Breaks `next build` wherever secrets are absent — CI and preview deployments.                |
| Eager validation + `SKIP_ENV_VALIDATION=1`   | An escape hatch that inevitably ends up set in production, disabling the check entirely.     |
| `@t3-oss/env-nextjs`                         | A dependency for roughly 80 lines of code, and it defaults to the eager model we rejected.   |
| Read `process.env` ad hoc at each call site  | No validation, no single list of required variables, and public variables break silently.    |
| Ship a `.env` with placeholder values for CI | Trains everyone to expect a committed env file. One careless edit later it holds a real key. |

## Consequences

**Positive**

- `npm run build` succeeds with zero credentials — verified in CI as a
  regression guard (SPEC EC-02).
- One list of required variables, mirrored by `.env.example`.
- A misconfiguration produces an actionable message naming the exact keys.

**Negative**

- Failure surfaces at first use rather than at boot. Mitigated by
  `assertEnvIsValid()`, available for an explicit startup or smoke check.
- `readPublicEnv()` must be updated by hand for each new public variable.
  Mitigated by the comment at the top of the file; the alternative (dynamic
  access) does not work at all.

## Follow-up

- Phase 02 adds auth-related variables.
- Phase 04 adds the server-only Supabase secret key and its `server-only` guard.
- Phase 09 adds Vercel Domains API credentials.
