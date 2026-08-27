# ADR-013 — Domain verification, and not integrating with Vercel yet

```text
Status: ACCEPTED
Date:   2026-08-25
Phase:  09 — Custom Domains
```

## Context

Master section 27 says a domain belongs to exactly one tenant, and section 33
(Phase 9) adds one sentence that decides the shape of the whole phase:

> Nunca asumir que agregar un registro a nuestra BD configura Vercel
> automáticamente.

A domain is global identity. Every other isolation failure in this system leaks
rows; this one would hand one business's **traffic** to another — its customers,
its orders, its brand — and the victim would have no way to tell.

Two questions had to be answered, and the obvious answer to each was wrong.

## Decision

### 1. A tenant can prove ownership. Only an operator can publish.

The state machine is deliberately asymmetric about who can reach which state:

```text
pending    claim_domain()                    the business
verifying  record_domain_ownership_check()   the business
failed     record_domain_ownership_check()   the business, or an operator
active     an operator, and nobody else
```

`resolve_tenant_by_domain` serves only `active` domains, so the state that
carries traffic is unreachable from a tenant session.

This solves a problem that has no clean solution otherwise. The DNS lookup runs
on our server, but its **result** is passed to the database by the caller — and
a caller can lie. `record_domain_ownership_check(id, true)` is callable by any
member with `domains.manage`, with or without a TXT record existing.

What stops that from being a domain takeover is that a forged pass reaches
`verifying`, which serves nothing and puts the domain in front of an operator
who registers it with the hosting provider and looks. The lie buys a place in a
queue.

It also happens to match reality. The domain cannot work until somebody adds it
to the hosting provider — a step no tenant can perform — so an operator is in
the loop regardless. Gating `active` on them costs nothing that was ever
available to automate.

### 2. No `service_role`, again

The textbook fix for "the client can lie about the result" is a trusted writer:
a backend holding elevated credentials that performs the check and writes the
outcome under a privilege the browser never has.

ADR-011 declined to introduce `service_role` until "whatever phase demonstrates
a need the database cannot meet". This phase looked like that need and turned
out not to be, because the state machine meets it: the worst outcome of the
untrusted path is a state that does nothing.

A `service_role` key ignores RLS entirely, so introducing one makes every future
bug in the code holding it a total compromise rather than a scoped one. Not
spending that when a state transition does the job.

### 3. No Vercel API client in this phase

Master section 33 says to integrate with Vercel's APIs "cuando sea oportuno".
It is not yet, for reasons that are about verification rather than effort:

- there is no API token in any environment, so nothing written against it could
  be run
- it could not be tested — not in the PGlite harness, not in CI, and mocking an
  API nobody has called teaches nothing about how it actually behaves
- an untested integration that reports "domain registered" is strictly worse
  than an operator ticking a box, because it produces the same claim with less
  warrant behind it

So the provider state is modelled explicitly and set by hand:
`provider_status` (`unknown` / `requested` / `ready` / `error`) and
`provider_synced_at`. The default is `unknown`, which is the honest value before
anybody has looked — `pending` would already be a claim that somebody had asked
for something.

When a token exists, an adapter fills the same two columns and the rest of the
system does not change. That is the point of storing the provider's state as a
fact of its own rather than inferring it.

### 4. Three facts, three lines in the UI

The screen shows ownership, provider registration and serving as three separate
statements rather than one badge. A single status would have to pick one of them
to display, and a business whose DNS is perfect but whose provider entry is
missing would read "pendiente" with nothing to act on.

### 5. An unverified claim expires after seven days

`tenant_domains.domain` is globally unique, which is what makes host takeover
impossible — and also what makes squatting possible. Anyone could type
`mcdonalds.pe`, never verify it, and the real owner could never connect their
own name.

So `claim_domain` releases a `pending` or `failed` claim from another tenant
once it is older than seven days: long enough for a real business to get DNS
changed by whoever manages it, short enough that squatting is not a strategy. A
verified or live claim is never released, however old.

### 6. The rejection message says nothing

Claiming a domain another tenant holds returns "no está disponible", always, with
the reason in the server log. Naming the holder would turn the form into a way
to ask — one name at a time — which of your competitors is a CloverCode
customer. Same reasoning as 404-never-403 elsewhere in the system.

## Alternatives considered

**Let a tenant reach `active` after a successful DNS check.** Simplest flow, and
a domain takeover: the check result is supplied by the caller, so any tenant
could claim any name and start serving it.

**Sign a narrowly-privileged JWT for a "verifier" database role.** Genuinely
better than `service_role` — no RLS bypass, one function's worth of privilege.
Rejected for this phase: it needs the project's JWT signing secret in the
environment, it cannot be exercised in the harness, and the state machine
removes the need for any of it.

**HTTP file verification (`/.well-known/...`) instead of DNS TXT.** Easier for
users who cannot edit DNS. Rejected: the business has to edit DNS anyway to
point the domain at us, so a TXT record adds no new skill requirement — and file
verification proves control of whatever currently serves the domain, which
during a migration may not be them.

**Automatic re-verification on a schedule.** Would catch a domain whose DNS was
removed. Rejected here for a scope reason and a design one: it needs a scheduler
that belongs to Phase 24, and "retire a live domain automatically" is the same
self-inflicted-outage risk that `record_domain_ownership_check` already refuses
to take on a single failed lookup.

## Consequences

- A domain cannot start serving without a human at CloverCode. That is a real
  operational cost and the deliberate price of the guarantee.
- `provider_status` can be wrong — it says what an operator last said, not what
  Vercel currently holds. `provider_synced_at` records when the statement was
  made, which is the honest amount of confidence to offer.
- The DNS targets in `src/config/app.ts` are constants. When the provider
  changes them, that is a reviewed commit rather than an environment variable
  somebody edits at midnight.
- Tenants get no UPDATE path into `tenant_domains` at all. Any future field they
  should be able to edit needs a function, not a policy — which is more work and
  the right amount of it for this table.
