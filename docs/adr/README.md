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
| 006 | [Tenant resolution](./006-tenant-resolution.md)                              | ACCEPTED | 01    |
| 007 | [SQL testing without Docker](./007-sql-testing-without-docker.md)            | ACCEPTED | 01    |
| 008 | [SSR sessions and route protection](./008-session-and-route-protection.md)   | ACCEPTED | 02    |
| 009 | [Profiles and membership](./009-profiles-and-membership.md)                  | ACCEPTED | 02    |
| 010 | [RBAC authorization](./010-rbac-authorization.md)                            | ACCEPTED | 03    |
| 011 | [Platform identity](./011-platform-identity.md)                              | ACCEPTED | 04    |

## Planned

Decisions the master document calls out that belong to a later phase:

| Topic                        | Phase |
| ---------------------------- | ----- |
| RBAC authorization strategy  | 03    |
| RLS policy shape             | 03    |
| Vercel multi-domain handling | 09    |
| Money representation         | 13/14 |
| Billing provider abstraction | 17    |

A relevant architectural change without an ADR makes the phase incomplete
(section 61).
