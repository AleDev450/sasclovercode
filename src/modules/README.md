# `src/modules`

Business domains live here, one folder per domain, following the layout in
`CLOVERCODE_MASTER.md` section 13.

Phase 00 created **no** modules on purpose: section 51 forbids building future
functionality ahead of its phase. This file documents the convention that every
phase must follow so the structure stays uniform.

## Modules and owning phase

| Module      | Phase | Status                                                                                                                                 |
| ----------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `tenants`   | 01    | Not created. Phase 01 delivered `src/lib/tenant` only, with no UI or actions to own.                                                   |
| `auth`      | 02    | Created.                                                                                                                               |
| `users`     | 04    | Planned. Profile and membership management is Phase 04, not Phase 02: this phase gives a user a session, it does not administer users. |
| `roles`     | 03    | Planned.                                                                                                                               |
| `website`   | 07    | Planned.                                                                                                                               |
| `locations` | 10    | Planned.                                                                                                                               |
| `catalog`   | 11    | Planned.                                                                                                                               |
| `customers` | 12    | Planned.                                                                                                                               |
| `orders`    | 13    | Planned.                                                                                                                               |
| `pos`       | 15    | Planned.                                                                                                                               |
| `billing`   | 17    | Planned.                                                                                                                               |
| `inventory` | 18    | Planned.                                                                                                                               |
| `reports`   | 23    | Planned.                                                                                                                               |

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
