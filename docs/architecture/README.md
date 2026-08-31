# Architecture documentation

The goal of this folder is that a new developer can understand CloverCode
without relying on historical conversations (`CLOVERCODE_MASTER.md` section 60).

| Document                                 | Covers                                        | Status                                         |
| ---------------------------------------- | --------------------------------------------- | ---------------------------------------------- |
| [overview.md](./overview.md)             | System shape, layers, current state           | Current (Phase 25)                             |
| [database.md](./database.md)             | Migration history, conventions, RLS inventory | Current (Phase 25)                             |
| [multitenancy.md](./multitenancy.md)     | Tenant resolution, isolation, RLS model       | Current (Phase 25)                             |
| [authentication.md](./authentication.md) | Supabase Auth, SSR sessions, cookies          | Current (Phase 02) — mechanics unchanged since |
| [authorization.md](./authorization.md)   | RBAC, permission catalogue, policy design     | Current (Phase 25)                             |
| [domains.md](./domains.md)               | Custom domain verification and state machine  | Current (Phase 14), written in Phase 14        |
| [security.md](./security.md)             | Consolidated threat model and controls        | Current (Phase 25), written in Phase 25        |
| `deployment.md`                          | Environments, releases, rollback              | Phase 28                                       |

Documents are written by the phase that first makes them meaningful rather than
created empty, so that everything present here is accurate.

`authorization.md` and `domains.md` were overdue since Phases 03 and 09
respectively, and the other three had drifted since Phase 03 — a gap noticed
and closed in Phase 14. Every phase from here on updates whichever of these
its own changes touch, alongside its SPEC and any ADR (master section 61).
