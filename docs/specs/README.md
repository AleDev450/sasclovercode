# Phase specifications

Every phase has exactly one SPEC. Implementation may not begin before its SPEC
exists (`CLOVERCODE_MASTER.md` section 56), and no phase may be declared
`COMPLETED` while its SPEC is out of date (section 61).

Statuses: `DRAFT` | `APPROVED` | `IN_PROGRESS` | `COMPLETED` | `BLOCKED` | `DEPRECATED`

| Phase | Name                    | SPEC                                                                         | Status    |
| ----- | ----------------------- | ---------------------------------------------------------------------------- | --------- |
| 00    | Foundation              | [phase-00-foundation.md](./phase-00-foundation.md)                           | COMPLETED |
| 01    | Multi-Tenancy Core      | [phase-01-multitenancy.md](./phase-01-multitenancy.md)                       | COMPLETED |
| 02    | Authentication          | [phase-02-authentication.md](./phase-02-authentication.md)                   | COMPLETED |
| 03    | Authorization + RLS     | [phase-03-authorization-rls.md](./phase-03-authorization-rls.md)             | COMPLETED |
| 04    | Super Admin             | [phase-04-super-admin.md](./phase-04-super-admin.md)                         | COMPLETED |
| 05    | Tenant Dashboard        | [phase-05-tenant-dashboard.md](./phase-05-tenant-dashboard.md)               | COMPLETED |
| 06    | Business Settings/Theme | [phase-06-business-settings-theme.md](./phase-06-business-settings-theme.md) | COMPLETED |
| 07    | Navigation + CMS        | _not written_                                                                | -         |
| 08    | SEO + Metadata          | _not written_                                                                | -         |
| 09    | Custom Domains          | _not written_                                                                | -         |
| 10-28 | see master document     | _not written_                                                                | -         |

## Required contents

Each SPEC covers the 22 sections listed in `CLOVERCODE_MASTER.md` section 55,
including — non-negotiably — **Tenant Isolation** (section 10 of the SPEC) and a
phase-specific **Definition of Done** (section 22).

A phase with no multi-tenant impact still has to say so explicitly:

```text
Tenant Isolation Impact: NONE
```
