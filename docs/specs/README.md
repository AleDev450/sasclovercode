# Phase specifications

Every phase has exactly one SPEC. Implementation may not begin before its SPEC
exists (`CLOVERCODE_MASTER.md` section 56), and no phase may be declared
`COMPLETED` while its SPEC is out of date (section 61).

Statuses: `DRAFT` | `APPROVED` | `IN_PROGRESS` | `COMPLETED` | `BLOCKED` | `DEPRECATED`

| Phase | Name                       | SPEC                                                                         | Status    |
| ----- | -------------------------- | ---------------------------------------------------------------------------- | --------- |
| 00    | Foundation                 | [phase-00-foundation.md](./phase-00-foundation.md)                           | COMPLETED |
| 01    | Multi-Tenancy Core         | [phase-01-multitenancy.md](./phase-01-multitenancy.md)                       | COMPLETED |
| 02    | Authentication             | [phase-02-authentication.md](./phase-02-authentication.md)                   | COMPLETED |
| 03    | Authorization + RLS        | [phase-03-authorization-rls.md](./phase-03-authorization-rls.md)             | COMPLETED |
| 04    | Super Admin                | [phase-04-super-admin.md](./phase-04-super-admin.md)                         | COMPLETED |
| 05    | Tenant Dashboard           | [phase-05-tenant-dashboard.md](./phase-05-tenant-dashboard.md)               | COMPLETED |
| 06    | Business Settings/Theme    | [phase-06-business-settings-theme.md](./phase-06-business-settings-theme.md) | COMPLETED |
| 07    | Navigation + CMS           | [phase-07-navigation-cms.md](./phase-07-navigation-cms.md)                   | COMPLETED |
| 08    | SEO + Metadata             | [phase-08-seo-metadata.md](./phase-08-seo-metadata.md)                       | COMPLETED |
| 09    | Custom Domains             | [phase-09-custom-domains.md](./phase-09-custom-domains.md)                   | COMPLETED |
| 10    | Locations                  | [phase-10-locations.md](./phase-10-locations.md)                             | COMPLETED |
| 11    | Catalog                    | [phase-11-catalog.md](./phase-11-catalog.md)                                 | COMPLETED |
| 12    | Customers                  | [phase-12-customers.md](./phase-12-customers.md)                             | COMPLETED |
| 13    | Orders Core                | [phase-13-orders-core.md](./phase-13-orders-core.md)                         | COMPLETED |
| 14    | Payments + Cash            | [phase-14-payments-cash.md](./phase-14-payments-cash.md)                     | COMPLETED |
| 15    | POS                        | [phase-15-pos.md](./phase-15-pos.md)                                         | COMPLETED |
| 16    | Kitchen / KDS              | [phase-16-kitchen-kds.md](./phase-16-kitchen-kds.md)                         | COMPLETED |
| 17    | Electronic Billing / SUNAT | [phase-17-billing-sunat.md](./phase-17-billing-sunat.md)                     | COMPLETED |
| 18    | Inventory                  | [phase-18-inventory.md](./phase-18-inventory.md)                             | COMPLETED |
| 19    | Delivery                   | [phase-19-delivery.md](./phase-19-delivery.md)                               | COMPLETED |
| 20    | Loyalty + Promotions       | [phase-20-loyalty-promotions.md](./phase-20-loyalty-promotions.md)           | COMPLETED |
| 21    | SaaS Modules + Plans       | [phase-21-saas-modules-plans.md](./phase-21-saas-modules-plans.md)           | COMPLETED |
| 22    | CloverCode Billing         | [phase-22-clovercode-billing.md](./phase-22-clovercode-billing.md)           | COMPLETED |
| 23    | Reports + Analytics        | [phase-23-reports-analytics.md](./phase-23-reports-analytics.md)             | COMPLETED |
| 24-28 | see master document        | _not written_                                                                | -         |

## Required contents

Each SPEC covers the 22 sections listed in `CLOVERCODE_MASTER.md` section 55,
including — non-negotiably — **Tenant Isolation** (section 10 of the SPEC) and a
phase-specific **Definition of Done** (section 22).

A phase with no multi-tenant impact still has to say so explicitly:

```text
Tenant Isolation Impact: NONE
```
