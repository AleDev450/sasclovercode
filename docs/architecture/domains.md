# Domains

> Current as of Phase 14 (last touched in Phase 09).

How a business connects its own address (`polleriaelrey.pe`) to its
CloverCode site, alongside the system subdomain every tenant already has
(`{slug}.clovercodeapp.com`).

Full rationale: [ADR-013](../adr/013-domain-verification-and-provider.md).
Hostname → tenant resolution itself (shared by system and custom domains
alike) is covered in
[multitenancy.md](./multitenancy.md#resolution) and is not repeated here.

## The governing sentence

Master section 33 (Phase 9), textual:

> Nunca asumir que agregar un registro a nuestra BD configura Vercel
> automáticamente.

A domain is global identity (`tenant_domains.domain` is one of only two
globally-unique values in the whole schema — see
[multitenancy.md](./multitenancy.md#two-globally-unique-namespaces)). Every
other isolation failure in this system leaks rows; getting this wrong hands
one business's **traffic** — its customers, its orders, its brand — to
another, with no way for the victim to tell.

## Three independent facts, not one status

```text
verification_status   do we believe this business owns the name (DNS)
(implicit: DNS itself) does the name actually point at the platform
provider_status        does the host currently serve TLS for it
```

Collapsing these into one "is it working" badge is the mistake the master
document warns about: the UI would say `active` while a visitor gets a
certificate error, and nobody could tell which of the three steps was
missing. The dashboard shows all three as separate lines for exactly this
reason.

## The state machine, and who may reach each state

```text
pending    claim_domain()                    the business
verifying  record_domain_ownership_check()   the business
failed     record_domain_ownership_check()   the business, or an operator
active     an operator, and nobody else
```

`resolve_tenant_by_domain()` — the one read path that serves live traffic —
matches only `active` domains. That makes the state that carries traffic
**unreachable from a tenant session**, which is the entire security property
this phase provides: the DNS check runs on the server, but its _result_ is
reported by the caller, and a caller can lie. A forged `record_domain_ownership_check(id, true)`
only reaches `verifying`, which serves nothing — it buys a place in a queue
an operator is already looking at, not a live domain.

Publishing (`active`) is a manual operator action from `/super-admin`, backed
by `src/modules/platform/server/actions.ts`, and stays that way deliberately —
see [Not yet: a Vercel API client](#not-yet-a-vercel-api-client) below.

## Schema

```text
tenant_domains
──────────────────
id                        UUID PK
tenant_id                 UUID NOT NULL -> tenants(id)
domain                    TEXT UNIQUE (globally, not per tenant)
type                      tenant_domain_type   'system' | 'custom'
is_primary                BOOLEAN               at most one per tenant
verification_status       domain_verification_status
                          'pending' | 'verifying' | 'active' | 'failed'
verification_token        TEXT   NULL for system, required for custom
verification_checked_at   TIMESTAMPTZ
last_error                TEXT   a sentence, not a stack trace (<=300 chars)
provider_status           domain_provider_status
                          'unknown' | 'requested' | 'ready' | 'error'
provider_synced_at        TIMESTAMPTZ
```

`provider_status` defaults to `unknown`, deliberately — `pending` would
already be a claim that somebody had asked the provider for something.

The system subdomain is issued by CloverCode itself (`clovercodeapp.com` is
owned by the platform) and needs no proof, so
`tenant_domains_token_matches_type` requires a token for `custom` and
forbids one for `system`.

## The three functions

Same posture as every privileged write in this codebase since ADR-011: no
`service_role`, a narrow `SECURITY DEFINER` function per legitimate change,
each deciding for itself what it is willing to write. There is **no UPDATE
policy** on `tenant_domains` at all — RLS is row-level, not column-level, so
a policy permissive enough to let a tenant set `is_primary` would also be
permissive enough to let it set `verification_status = 'active'`.

| Function                                               | Does                         | Notably                                                                                                                                                                                                     |
| ------------------------------------------------------ | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `claim_domain(tenant_id, domain)`                      | Reserves a domain, `pending` | Rejects the platform's own namespace; refuses a live domain of another tenant **without saying whose** (same 404-never-403 reasoning as elsewhere); releases another tenant's unverified claim after 7 days |
| `record_domain_ownership_check(domain_id, ok, error?)` | Records a DNS lookup result  | Can reach `verifying` or `failed`, never `active` — a forged `true` costs nothing but a queue slot                                                                                                          |
| `set_primary_domain(domain_id)`                        | Moves the primary flag       | Only a `verified` domain may become primary (Phase 08 builds the canonical URL from it); the flag move is one transaction so a tenant is never briefly primary-less or double-primary                       |

## RLS

| Table            | Policy                          | Effect                                                          |
| ---------------- | ------------------------------- | --------------------------------------------------------------- |
| `tenant_domains` | `tenant_domains_select_member`  | Read own tenant's rows, with `domains.view`                     |
| `tenant_domains` | `tenant_domains_delete_manager` | Delete own **custom, non-primary** rows, with `domains.manage`  |
| `tenant_domains` | _(no INSERT policy)_            | Only `claim_domain()` can create a row                          |
| `tenant_domains` | _(no UPDATE policy)_            | Only the three functions above can change one                   |
| `tenant_domains` | `tenant_domains_platform_*`     | Operator (`platform_admins`) full read/write, added in Phase 04 |

Deleting the primary domain, or the system domain, is refused by the policy
itself (not by application logic): the system subdomain is the address that
always works, and the primary is what Phase 08 builds the canonical URL from.

## Not yet: a Vercel API client

No API token exists in any environment, so nothing written against one could
run or be tested — not in the PGlite harness, not in CI. An untested
integration that reports "domain registered" would be strictly worse than an
operator ticking a box, because it makes the same claim with less behind it.

`provider_status`/`provider_synced_at` model the provider's state as an
explicit fact, set by hand today. When a token exists, an adapter fills the
same two columns and nothing else in the system needs to change — that
separation is the reason the columns exist as facts rather than being
inferred.

The DNS targets a business is told to point at live as constants in
`src/config/app.ts`. When a real provider integration changes them, that is a
reviewed commit, not an environment variable edited at midnight.

## Where it's used

- `src/modules/domains/` — the tenant-facing screen: claim, check DNS,
  delete, set primary. `/dashboard/{slug}/configuracion/dominios`, gated by
  `domains.view` / `domains.manage` — its own top-level nav entry rather than
  a link inside Configuración, because `admin` holds `domains.manage` but not
  `settings.manage` and cannot open the page that would hold that link. The
  same shape Phase 14 reused for `payment_methods.manage` — see
  [authorization.md](./authorization.md).
- `src/modules/platform/` — the operator's side: reviewing a domain and
  publishing it to `active` from `/super-admin`.

## Where to read more

- [ADR-013](../adr/013-domain-verification-and-provider.md) — the full
  argument, including alternatives rejected (letting a tenant reach `active`
  directly; a narrowly-scoped signed JWT instead of the state machine; HTTP
  file verification instead of DNS TXT; scheduled re-verification).
- [multitenancy.md](./multitenancy.md) — hostname resolution, which serves
  system and custom domains identically once a domain is `active`.
- `src/tests/database/domains.test.ts` — the state machine and its guards,
  executed.
