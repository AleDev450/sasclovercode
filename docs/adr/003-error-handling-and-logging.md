# ADR-003 — Error handling and structured logging

```text
Status: ACCEPTED
Date:   2026-08-24
Phase:  00 — Foundation
```

## Context

`CLOVERCODE_MASTER.md` section 15 requires a consistent error strategy where the
user gets an understandable message and the logs get the technical detail, and
section 9 forbids returning sensitive stack traces or logging tokens and
passwords.

In a multi-tenant system these are not stylistic concerns. A leaked constraint
name (`tenants_slug_key`) tells an attacker another tenant's slug exists. A
logged refresh token is a session takeover. Both are easy to introduce
accidentally if every module invents its own error shape.

## Decision

### 1. Three distinct pieces of information per error

Every error carries `message` (technical, logs only), `publicMessage` (safe for
an end user) and `code` (stable identifier). They are never conflated.

### 2. A closed hierarchy rooted at `AppError`

The eight subclasses named in section 15, plus `ConfigurationError`. Each fixes
its own `httpStatus` and a safe default `publicMessage`.

### 3. `isOperational` separates outcomes from defects

`true` means "an expected outcome" (not found, forbidden, conflict) and logs at
`warn`. Anything else — including a non-operational `AppError` such as
`ConfigurationError` — is a defect: it logs at `error` and is reported to the
caller as a generic `500` with code `INTERNAL_ERROR`.

### 4. One serialisation boundary

`serializeError()` is pure and is the only function that decides what leaves the
process. It emits exactly `{ code, message, requestId }`, plus `details` for
`ValidationError` only. `toErrorResponse()` wraps it, logs, and returns a
`Response` with `Cache-Control: no-store`.

### 5. Cross-tenant reads surface as `NotFoundError`, not `AuthorizationError`

A `403` confirms that a record exists. Probing with `404` yields nothing.

### 6. Redaction is central, not per call site

The logger deep-copies its context and replaces values whose key matches a
sensitive pattern. Over-redaction is accepted; a missed credential is not.

### 7. The logger reads `process.env` directly

It does **not** go through `@/config/env`. The env layer reports failures
_through_ the logger, so the reverse dependency would make a misconfiguration
unreportable.

### 8. The logger never throws

Emission is wrapped in `try/catch`, and redaction handles circular references,
`BigInt` and depth limits. A logger that can crash a request is worse than none.

## Alternatives considered

| Alternative                               | Why rejected                                                                                                                                                  |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plain `Error` + string matching           | Not type-safe, not exhaustive, and the HTTP status ends up duplicated at every call site.                                                                     |
| Returning `Result<T, E>` everywhere       | Fights `async`/`await`, Server Actions and React error boundaries, which are all throw-based.                                                                 |
| `pino` / `winston`                        | Both assume a long-lived Node process. Vercel's serverless runtime wants stdout JSON, which is 60 lines of code. Revisit if a real need appears (section 47). |
| Redact at each call site                  | One forgotten call is a credential in the logs forever.                                                                                                       |
| Return the real error in development only | Two code paths means the safe one is the untested one.                                                                                                        |

## Consequences

**Positive**

- One error shape across every route handler and server action.
- Leak prevention is tested once (`serializeError`) rather than reviewed forever.
- `requestId` ties a user-visible reference to a server log line.
- Swapping the transport in tests makes logging assertions trivial.

**Negative**

- Over-redaction can hide a harmless field (`keyword` is safe, `apiKeyword`
  is not — the latter is redacted). Accepted.
- The generic `500` message means a developer must consult the logs. That is
  the intended trade-off.

## Follow-up

- Phase 24 adds an external error tracker behind the same boundary and wires
  `app.error.boundary` on the client.
- Phase 24 adds `audit_logs`; the same redaction policy applies, and section 17
  forbids storing secrets there.
