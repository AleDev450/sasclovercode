# Architecture Decision Records

SPECs describe **what** each phase must do. ADRs record **how** and **why** an
architectural decision was made (`CLOVERCODE_MASTER.md` section 59).

Each ADR contains: Context, Decision, Alternatives considered, Consequences,
Status.

| ADR | Title                                                                          | Status   | Phase |
| --- | ------------------------------------------------------------------------------ | -------- | ----- |
| 001 | [Single-database multi-tenancy](./001-single-database-multitenancy.md)         | ACCEPTED | 00    |
| 002 | [Toolchain version pinning](./002-toolchain-version-pinning.md)                | ACCEPTED | 00    |
| 003 | [Error handling and structured logging](./003-error-handling-and-logging.md)   | ACCEPTED | 00    |
| 004 | [Lazy environment validation](./004-environment-validation.md)                 | ACCEPTED | 00    |
| 005 | [Testing strategy](./005-testing-strategy.md)                                  | ACCEPTED | 00    |
| 006 | [Tenant resolution](./006-tenant-resolution.md)                                | ACCEPTED | 01    |
| 007 | [SQL testing without Docker](./007-sql-testing-without-docker.md)              | ACCEPTED | 01    |
| 008 | [SSR sessions and route protection](./008-session-and-route-protection.md)     | ACCEPTED | 02    |
| 009 | [Profiles and membership](./009-profiles-and-membership.md)                    | ACCEPTED | 02    |
| 010 | [RBAC authorization](./010-rbac-authorization.md)                              | ACCEPTED | 03    |
| 011 | [Platform identity](./011-platform-identity.md)                                | ACCEPTED | 04    |
| 012 | [Structured data and public reads](./012-structured-data-and-public-reads.md)  | ACCEPTED | 08    |
| 013 | [Domain verification and provider](./013-domain-verification-and-provider.md)  | ACCEPTED | 09    |
| 014 | [Locations as operational anchor](./014-locations-as-operational-anchor.md)    | ACCEPTED | 10    |
| 015 | [Money as integers in the minor unit](./015-money-as-minor-units.md)           | ACCEPTED | 11    |
| 016 | [Personal data minimization](./016-personal-data-minimization.md)              | ACCEPTED | 12    |
| 017 | [Order snapshots and state machine](./017-order-snapshot-and-state-machine.md) | ACCEPTED | 13    |
| 018 | [Payment voiding and the cash ledger](./018-payment-void-and-cash-ledger.md)   | ACCEPTED | 14    |

## Planned

Decisions the master document calls out that belong to a later phase:

| Topic                        | Phase                         |
| ---------------------------- | ----------------------------- |
| RBAC authorization strategy  | 03                            |
| RLS policy shape             | 03                            |
| Vercel provider adapter      | when a token exists (ADR-013) |
| Billing provider abstraction | 17                            |

A relevant architectural change without an ADR makes the phase incomplete
(section 61).
