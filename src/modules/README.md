# `src/modules`

Business domains live here, one folder per domain, following the layout in
`CLOVERCODE_MASTER.md` section 13.

Phase 00 creates **no** modules on purpose: section 51 forbids building future
functionality ahead of its phase. This file documents the convention that later
phases must follow so the structure stays uniform.

## Planned modules and owning phase

| Module      | Phase |
| ----------- | ----- |
| `tenants`   | 01    |
| `auth`      | 02    |
| `users`     | 02    |
| `roles`     | 03    |
| `locations` | 10    |
| `catalog`   | 11    |
| `customers` | 12    |
| `orders`    | 13    |
| `pos`       | 15    |
| `billing`   | 17    |
| `inventory` | 18    |
| `website`   | 07    |
| `reports`   | 23    |

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
