# ADR-006 — Tenant resolution: one canonical domain, one guarded function

```text
Status: ACCEPTED
Date:   2026-08-24
Phase:  01 — Multi-Tenancy Core
```

## Context

`CLOVERCODE_MASTER.md` section 27 requires `hostname -> tenant` resolution that
works for `{slug}.clovercodeapp.com`, for customer-owned domains, and on
`localhost`. Section 42 forbids trusting a `tenant_id` supplied by the client.

Two problems have to be solved at once:

1. **Shape.** Three host families with different structures must produce one
   tenant lookup.
2. **Exposure.** A public tenant website has to resolve _before_ any session
   exists, so the reader is anonymous. Any RLS policy permissive enough to let
   an anonymous client find its own tenant would also let it `SELECT` every
   other row — handing anyone the full customer list of CloverCode.

## Decision

### 1. Every host is mapped to one canonical lookup domain

`toLookupDomain()` converts each supported shape into the domain stored in
`tenant_domains`:

```text
sugurolls.clovercodeapp.com  -> sugurolls.clovercodeapp.com
sugurolls.com                -> sugurolls.com
sugurolls.localhost:3000     -> sugurolls.clovercodeapp.com   (dev only)
localhost:3000               -> {DEV_TENANT_SLUG}.clovercodeapp.com (dev only)
```

There is therefore **one** query, and local development exercises the same code
path as production instead of a parallel one that can rot.

### 2. Reads go through a SECURITY DEFINER function, not through RLS policies

`tenants` and `tenant_domains` have RLS enabled and **no policies**: denied for
`anon` and `authenticated`. The only read path is:

```sql
public.resolve_tenant_by_domain(p_hostname text)
```

It takes one hostname and returns at most one row, with only the columns a
request needs. There is no query shape that yields more than a single tenant, so
enumeration is impossible by construction rather than by policy wording.

`SET search_path = ''` is mandatory on it, with every name fully qualified.

### 3. Only verified domains resolve

`verification_status = 'active'` is part of the WHERE clause. Registering
`banco-conocido.com` against your own tenant does nothing until it is verified
(Phase 09). Registering is not owning.

### 4. Suspended resolves, archived does not

A suspended tenant resolves and carries its `status`, so the application can
render a notice. An archived tenant is gone. Encoding this in SQL keeps the two
outcomes from drifting apart across call sites.

### 5. `www.` is never stripped

`www.sugurolls.com` does not resolve unless registered. Auto-stripping would
serve a host nobody claimed. Phase 09 lets a tenant register both.

### 6. The local-development door is bolted shut in production

`{slug}.localhost` and `DEV_TENANT_SLUG` are ignored whenever `NODE_ENV` is
production. The check is in the pure function and covered by tests, not left to
a deployment convention.

### 7. Per-request memoisation only

`getCurrentTenant()` is wrapped in React `cache()`. No cross-request cache: a
stale entry would serve the wrong tenant's site, which is the worst failure this
system can have. Revisit only with measurements (master section 26).

### 8. `host`, not `x-forwarded-host`

On Vercel, `host` already carries the public hostname. `x-forwarded-host` can be
set by a client reaching the app directly, which would let a visitor pick their
own tenant.

## Alternatives considered

| Alternative                                             | Why rejected                                                                                             |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| RLS policy granting `anon` SELECT on active rows        | Solves resolution and hands over the customer list at the same time. Enumeration is the whole risk here. |
| Resolving by slug for system hosts, by domain otherwise | Two lookup paths, two sets of bugs, and local development stops resembling production.                   |
| Parsing the slug and skipping `tenant_domains`          | Custom domains have no slug in the host. The domain table has to be authoritative anyway.                |
| A middleware that injects `x-tenant-id`                 | A header is client-controllable unless every entry point is proven to overwrite it. Master section 42.   |
| Caching resolutions in memory across requests           | A domain change would keep serving the previous tenant. Wrong-tenant beats slow.                         |
| Stripping `www.` automatically                          | Serves a hostname nobody registered.                                                                     |

## Consequences

**Positive**

- The tenant list cannot be enumerated with the publishable key.
- One query, one index (`tenant_domains_domain_key`), one code path.
- Host handling is pure and exhaustively testable.
- Local development is high fidelity by construction.

**Negative**

- Every new read of tenant data needs either a new SECURITY DEFINER function or
  the Phase 03 policies. That friction is intentional.
- `www.` must be registered explicitly until Phase 09 automates it.
- Punycode only: an IDN must be supplied already encoded (`xn--...`).

## Follow-up

- **Phase 03** adds `tenant_members` and the per-user policies. The deny-by-
  default posture set here is what those policies open up, deliberately.
- **Phase 09** owns real domain verification and the Vercel Domains API.
