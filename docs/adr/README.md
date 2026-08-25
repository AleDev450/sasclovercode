# Architecture Decision Records

SPECs describe **what** each phase must do. ADRs record **how** and **why** an
architectural decision was made (`CLOVERCODE_MASTER.md` section 59).

Each ADR contains: Context, Decision, Alternatives considered, Consequences,
Status.

| ADR | Title                                                                        | Status   | Phase |
| --- | ---------------------------------------------------------------------------- | -------- | ----- |
| 001 | [Single-database multi-tenancy](./001-single-database-multitenancy.md)       | ACCEPTED | 00    |
| 002 | [Toolchain version pinning](./002-toolchain-version-pinning.md)              | ACCEPTED | 00    |
| 003 | [Error handling and structured logging](./003-error-handling-and-logging.md) | ACCEPTED | 00    |
| 004 | [Lazy environment validation](./004-environment-validation.md)               | ACCEPTED | 00    |
| 005 | [Testing strategy](./005-testing-strategy.md)                                | ACCEPTED | 00    |

## Planned

Decisions the master document calls out that belong to a later phase:

| Topic                        | Phase |
| ---------------------------- | ----- |
| Tenant resolution strategy   | 01    |
| RBAC authorization strategy  | 03    |
| RLS policy shape             | 03    |
| Vercel multi-domain handling | 09    |
| Money representation         | 13/14 |
| Billing provider abstraction | 17    |

A relevant architectural change without an ADR makes the phase incomplete
(section 61).
