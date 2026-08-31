# Architecture Decision Records

SPECs describe **what** each phase must do. ADRs record **how** and **why** an
architectural decision was made (`CLOVERCODE_MASTER.md` section 59).

Each ADR contains: Context, Decision, Alternatives considered, Consequences,
Status.

| ADR | Title                                                                                                                             | Status   | Phase |
| --- | --------------------------------------------------------------------------------------------------------------------------------- | -------- | ----- |
| 001 | [Single-database multi-tenancy](./001-single-database-multitenancy.md)                                                            | ACCEPTED | 00    |
| 002 | [Toolchain version pinning](./002-toolchain-version-pinning.md)                                                                   | ACCEPTED | 00    |
| 003 | [Error handling and structured logging](./003-error-handling-and-logging.md)                                                      | ACCEPTED | 00    |
| 004 | [Lazy environment validation](./004-environment-validation.md)                                                                    | ACCEPTED | 00    |
| 005 | [Testing strategy](./005-testing-strategy.md)                                                                                     | ACCEPTED | 00    |
| 006 | [Tenant resolution](./006-tenant-resolution.md)                                                                                   | ACCEPTED | 01    |
| 007 | [SQL testing without Docker](./007-sql-testing-without-docker.md)                                                                 | ACCEPTED | 01    |
| 008 | [SSR sessions and route protection](./008-session-and-route-protection.md)                                                        | ACCEPTED | 02    |
| 009 | [Profiles and membership](./009-profiles-and-membership.md)                                                                       | ACCEPTED | 02    |
| 010 | [RBAC authorization](./010-rbac-authorization.md)                                                                                 | ACCEPTED | 03    |
| 011 | [Platform identity](./011-platform-identity.md)                                                                                   | ACCEPTED | 04    |
| 012 | [Structured data and public reads](./012-structured-data-and-public-reads.md)                                                     | ACCEPTED | 08    |
| 013 | [Domain verification and provider](./013-domain-verification-and-provider.md)                                                     | ACCEPTED | 09    |
| 014 | [Locations as operational anchor](./014-locations-as-operational-anchor.md)                                                       | ACCEPTED | 10    |
| 015 | [Money as integers in the minor unit](./015-money-as-minor-units.md)                                                              | ACCEPTED | 11    |
| 016 | [Personal data minimization](./016-personal-data-minimization.md)                                                                 | ACCEPTED | 12    |
| 017 | [Order snapshots and state machine](./017-order-snapshot-and-state-machine.md)                                                    | ACCEPTED | 13    |
| 018 | [Payment voiding and the cash ledger](./018-payment-void-and-cash-ledger.md)                                                      | ACCEPTED | 14    |
| 019 | [POS actions as RPC, ephemeral cart](./019-pos-actions-as-rpc-and-ephemeral-cart.md)                                              | ACCEPTED | 15    |
| 020 | [KDS station snapshot and Realtime as refetch](./020-kds-station-snapshot-and-realtime-as-refetch.md)                             | ACCEPTED | 16    |
| 021 | [Billing provider abstraction and Vault credentials](./021-billing-provider-abstraction-and-vault-credentials.md)                 | ACCEPTED | 17    |
| 022 | [Derived stock and completion-triggered consumption](./022-derived-stock-and-completion-triggered-consumption.md)                 | ACCEPTED | 18    |
| 023 | [Delivery zone/rate split and decoupled lifecycle](./023-delivery-zone-rate-split-and-decoupled-lifecycle.md)                     | ACCEPTED | 19    |
| 024 | [Discount as a ledger entry; derived point balance](./024-discount-as-ledger-entry-and-derived-point-balance.md)                  | ACCEPTED | 20    |
| 025 | [Central module resolution and non-destructive provisioning](./025-central-module-resolution-and-non-destructive-provisioning.md) | ACCEPTED | 21    |
| 026 | [SaaS charge as a single row; idempotent billing cycle](./026-saas-charge-as-single-row-and-idempotent-billing-cycle.md)          | ACCEPTED | 22    |
| 027 | [Aggregate functions; no materialised views yet](./027-aggregate-functions-and-no-materialised-views-yet.md)                      | ACCEPTED | 23    |

## Planned

Decisions the master document calls out that belong to a later phase:

| Topic                                                          | Phase                                          |
| -------------------------------------------------------------- | ---------------------------------------------- |
| Vercel provider adapter                                        | when a token exists (ADR-013)                  |
| A real BillingProvider (Nubefact, Efact, SUNAT API)            | when real credentials exist (ADR-021)          |
| A real DeliveryProvider (Rappi, PedidosYa, Uber Direct)        | when an integration is contracted (ADR-023)    |
| A payment gateway for the subscription (Culqi, Izipay, Stripe) | when one is contracted (ADR-026)               |
| Expiring loyalty points on a schedule                          | when a scheduler exists (ADR-024)              |
| Running the billing cycle on a schedule                        | when a scheduler exists (ADR-026)              |
| A materialised view for reports                                | when Phase 26 measures the threshold (ADR-027) |
| Charging for a plan, and advancing its period                  | Phase 22 (ADR-025)                             |
| Expiring loyalty points on a schedule                          | when a scheduler exists (ADR-024)              |

A relevant architectural change without an ADR makes the phase incomplete
(section 61).
