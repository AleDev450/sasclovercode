# Phase specifications

Every phase has exactly one SPEC. Implementation may not begin before its SPEC
exists (`CLOVERCODE_MASTER.md` section 56), and no phase may be declared
`COMPLETED` while its SPEC is out of date (section 61).

Statuses: `DRAFT` | `APPROVED` | `IN_PROGRESS` | `COMPLETED` | `BLOCKED` | `DEPRECATED`

| Phase | Name                    | SPEC                                               | Status    |
| ----- | ----------------------- | -------------------------------------------------- | --------- |
| 00    | Foundation              | [phase-00-foundation.md](./phase-00-foundation.md) | COMPLETED |
| 01    | Multi-Tenancy Core      | _not written_                                      | -         |
| 02    | Authentication          | _not written_                                      | -         |
| 03    | Authorization + RLS     | _not written_                                      | -         |
| 04    | Super Admin             | _not written_                                      | -         |
| 05    | Tenant Dashboard        | _not written_                                      | -         |
| 06    | Business Settings/Theme | _not written_                                      | -         |
| 07    | Navigation + CMS        | _not written_                                      | -         |
| 08    | SEO + Metadata          | _not written_                                      | -         |
| 09    | Custom Domains          | _not written_                                      | -         |
| 10-28 | see master document     | _not written_                                      | -         |

## Required contents

Each SPEC covers the 22 sections listed in `CLOVERCODE_MASTER.md` section 55,
including — non-negotiably — **Tenant Isolation** (section 10 of the SPEC) and a
phase-specific **Definition of Done** (section 22).

A phase with no multi-tenant impact still has to say so explicitly:

```text
Tenant Isolation Impact: NONE
```
