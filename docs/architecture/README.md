# Architecture documentation

The goal of this folder is that a new developer can understand CloverCode
without relying on historical conversations (`CLOVERCODE_MASTER.md` section 60).

| Document                                 | Covers                                   | Status             |
| ---------------------------------------- | ---------------------------------------- | ------------------ |
| [overview.md](./overview.md)             | System shape, layers, current state      | Current (Phase 00) |
| [database.md](./database.md)             | Schema conventions, indexes, constraints | Current (Phase 01) |
| [multitenancy.md](./multitenancy.md)     | Tenant resolution, isolation, RLS model  | Current (Phase 01) |
| [authentication.md](./authentication.md) | Supabase Auth, SSR sessions, cookies     | Current (Phase 02) |
| `authorization.md`                       | RBAC, permissions, policy design         | Phase 03           |
| `domains.md`                             | System subdomains and custom domains     | Phase 09           |
| `security.md`                            | Consolidated threat model and controls   | Phase 25           |
| `deployment.md`                          | Environments, releases, rollback         | Phase 28           |

Documents are written by the phase that first makes them meaningful rather than
created empty, so that everything present here is accurate.
