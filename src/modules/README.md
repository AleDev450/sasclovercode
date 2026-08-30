# `src/modules`

Business domains live here, one folder per domain, following the layout in
`CLOVERCODE_MASTER.md` section 13.

Phase 00 created **no** modules on purpose: section 51 forbids building future
functionality ahead of its phase. This file documents the convention that every
phase must follow so the structure stays uniform.

## Modules and owning phase

| Module      | Phase | Status                                                                                                                             |
| ----------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `tenants`   | 01    | Not created. Phase 01 delivered `src/lib/tenant` only, with no UI or actions to own.                                               |
| `auth`      | 02    | Created.                                                                                                                           |
| `roles`     | 03    | Not created. Phase 03 delivered `src/lib/permissions` and the SQL catalogue; the UI that administers roles is part of `dashboard`. |
| `platform`  | 04    | Created. Named for what it governs — the platform — rather than `users`, which Phase 04 turned out not to be about.                |
| `dashboard` | 05    | Created.                                                                                                                           |
| `settings`  | 06    | Created.                                                                                                                           |
| `cms`       | 07    | Created. Planned as `website`; the name follows what it does — pages, sections and navigation.                                     |
| `seo`       | 08    | Created.                                                                                                                           |
| `domains`   | 09    | Created.                                                                                                                           |
| `locations` | 10    | Created.                                                                                                                           |
| `catalog`   | 11    | Created.                                                                                                                           |
| `customers` | 12    | Created.                                                                                                                           |
| `orders`    | 13    | Created.                                                                                                                           |
| `payments`  | 14    | Created.                                                                                                                           |
| `pos`       | 15    | Created.                                                                                                                           |
| `kitchen`   | 16    | Created. The KDS board; planned under no name, since master calls the phase "Kitchen / KDS".                                       |
| `billing`   | 17    | Created.                                                                                                                           |
| `inventory` | 18    | Created.                                                                                                                           |
| `delivery`  | 19    | Created.                                                                                                                           |
| `loyalty`   | 20    | Created. Covers promotions AND points: they share `order_promotions`, the same checkout screen, and one SaaS module.               |
| `reports`   | 23    | Planned.                                                                                                                           |

Phase 21 created no module of its own: the plan model is governed by the Super
Admin, so its actions live in `platform` and its evaluation layer in
`src/lib/features` — the same shape Phase 03 used for `src/lib/permissions`.

This table was corrected in Phase 12. It still said "Planned" for modules that
had existed for several phases; `dashboard`, `settings`, `seo` and `domains`
were missing from it entirely; and two rows named modules that were built under
a different name (`users` became `platform`, `website` became `cms`).

It drifted the same way again and was corrected in Phase 19: `pos`, `billing`
and `inventory` still read "Planned" several phases after they were built, and
`payments` (14) and `kitchen` (16) had never been added at all. The lesson the
Phase 12 note drew still applies — a table nobody updates is worse than no
table, so updating this row is part of a phase's Definition of Done, not an
afterthought.

## Anatomy of a module

```text
src/modules/<domain>/
├── components/     UI specific to this domain
├── server/         data access and server actions (server-only)
├── schemas/        Zod schemas for this domain's inputs
├── types.ts        domain types
└── index.ts        the module's public surface
```

## Rules

1. A module may import from `src/lib`, `src/config`, `src/types` and
   `src/components`. It must **not** import from another module's internals -
   only from that module's `index.ts`.
2. `src/lib` must never import from a module. The dependency direction is
   `app -> modules -> lib`.
3. Every query that touches tenant data resolves the tenant from server context
   (`src/lib/tenant`, Phase 01). A `tenant_id` supplied by the client is never
   trusted (section 42).
4. Authorization is checked on the server in `server/`, never in `components/`.
   Hiding a button is not security (section 45).
