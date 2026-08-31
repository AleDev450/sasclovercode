# Security

> Current as of Phase 25.

The consolidated threat model and the controls that answer it. Written in Phase
25, which is the phase master section 33 sets aside for a complete audit.

Not a duplicate of the other documents: RLS lives in
[database.md](./database.md), the permission model in
[authorization.md](./authorization.md), sessions in
[authentication.md](./authentication.md), and tenant resolution in
[multitenancy.md](./multitenancy.md). This document says **what is being
defended against, by what, and what is knowingly not defended**.

The audit itself — seventeen areas with a verdict each — is section 26 of
[the Phase 25 SPEC](../specs/phase-25-security-hardening.md). This is the
reference; that is the record of the review.

## What is being protected

```text
1. One business's data from another business.        THE one that matters.
2. A business's data from the public internet.
3. A business's data from its own staff's roles.
4. Credentials, from logs, dumps and audit records.
5. The record of who did what, from being altered.
6. Availability, from being trivially exhausted.
```

Number 1 is first because it is the failure that ends the product. Every other
item here has a bad day attached; a cross-tenant leak has a different kind of
consequence, and it is why isolation is enforced in the database rather than in
the application.

## Where each control lives

```text
                      Browser
                         |
    Content-Security-Policy, HSTS, X-Frame-Options, nosniff,
    Referrer-Policy, Permissions-Policy
                         |
                      proxy.ts        nonce per request; session refresh;
                         |            route protection; no Auth call for /sitio
                         |
     Server Component / Server Action / Route Handler
                         |
    requireUser -> requirePermission -> requireFeature -> rate limit
                         |
                     PostgREST
                         |
    RLS on every table + has_permission(tenant, code) + has_module(tenant, code)
                         |
                     PostgreSQL       audit triggers, SECURITY DEFINER gates
```

**No layer is the only one.** A page hides a section it cannot use, the Server
Action behind it checks again, and the row-level policy under that checks a
third time. Master section 45 states the rule this implements: hiding a button
is not security.

## 1. One business from another

The control is **Row Level Security**, not application code. Every table
holding business data has it enabled, and every policy is predicated on
`has_permission(tenant_id, code)` — a `SECURITY DEFINER` function that resolves
membership and role in the database.

The reason to put it there rather than in query builders: a `WHERE tenant_id =`
that somebody forgets is a leak, and there is no way to prove nobody will forget.
A policy cannot be forgotten by a caller, because the caller does not get to
choose whether it applies.

```text
Never allowed              using (true) on a table holding tenant data
Enforced by                isolation.test.ts, over the whole schema
The eight exceptions       roles, permissions, role_permissions,
                           order_transitions, billing_document_transitions,
                           delivery_transitions, modules, plans, plan_modules -
                           product-wide reference data, read-only, no tenant's
                           rows in any of them
```

**Verified as a sweep, not as a sample.** `cross-tenant.test.ts` (Phase 25)
discovers every table with a `tenant_id` from `information_schema` and, as the
owner of business A, tries all four operations against business B's rows:
`SELECT` returns nothing, `UPDATE` and `DELETE` affect nothing, `INSERT` is
refused. Generated rather than written out, so a table added in a later phase is
covered because it exists (ADR-029 decision 4).

The tenant itself is **never taken from the client** (master section 42). It is
resolved server-side from the hostname or the route, and `hostname.ts` treats
the `Host` header as untrusted input — it reads `host` and not
`x-forwarded-host`, which a client can set.

## 2. A business from the public internet

Twelve tables have a deliberate public `SELECT` policy, because they **are** the
public website: a menu nobody can read without signing in is not a menu.

```text
categories        pages             product_options    tenant_seo
location_hours    page_sections     product_variants   tenant_themes
locations         product_images    products
navigation_items
```

Two properties make that safe, and both are asserted:

- **Every one of them is predicated on `is_tenant_public(tenant_id)`**, so a
  suspended or archived business stops serving its shop window immediately.
- **The list is exactly twelve.** It is enumerated in the test rather than
  discovered, precisely so that a thirteenth public policy has to be typed into
  a security test by whoever adds it.

`tenant_settings` is **not** on the list, although the public footer shows the
trade name, the address and the RUC. RLS filters rows, not columns, so a public
policy there would have exposed the contact email and everything else too. The
site reads those fields through `get_public_business_identity()`, a
`SECURITY DEFINER` function that returns the public-facing columns and nothing
else.

## 3. A business from its own staff

Code never compares a role (`if (role === "admin")` is forbidden by master
section 12 and appears nowhere). It asks for a permission, and a permission is a
row in a migration.

From Phase 21 a capability needs **two** answers:

```text
has_permission(tenant, 'orders.create')   may THIS PERSON?
has_module(tenant, 'pos')                 did THIS BUSINESS buy it?
```

Both fail **closed**. A tenant with no subscription has no modules, so the
paywall is not decorative (ADR-025).

**Made executable in Phase 25.** Three structural tests now fail the build
rather than waiting for a review:

```text
Every exported Server Action reaches a gate            TEST-2507
Every module-gated nav entry's page checks THAT module TEST-2508
Every permission-gated entry's page checks THAT one    TEST-2509
```

The only ungated actions are the four in `auth`, which run before a session
exists, and they are listed by name with their reason.

## 4. Credentials

```text
service_role      Not referenced ANYWHERE in the application. Every privileged
                  write goes through a narrow SECURITY DEFINER function
                  (ADR-011). A test scans every application file (TEST-2512).
Billing provider  Supabase Vault. Three narrow functions write or check a
                  credential; NONE reads one back (ADR-021).
In the repo       None. `.env*` is ignored except `.env.example`.
In logs           Redacted centrally by key NAME, over nineteen patterns
                  (`src/lib/logger/redact.ts`, Phase 00).
In the audit      The same policy, in SQL (`audit_redact`, Phase 24). A test
                  feeds both implementations the same list of names and fails
                  if they ever disagree.
Rate limiter      Stores sha256 of the identifier, never the address.
```

Redaction is **by pattern on the key name**, not by a list of forbidden columns.
A list is correct today and fails the day somebody adds `stripe_api_key` without
remembering to update it — which is the failure mode this project designs away
everywhere else. Master section 17 is unambiguous: never store passwords, tokens
or secrets in audit logs.

## 5. The record of what happened

Three tables have RLS enabled and **no write policy at all** — not for a member,
not for a platform admin:

```text
subscription_events   Phase 22   five SECURITY DEFINER triggers write it
audit_logs            Phase 24   fifteen triggers write it
rate_limit_counters   Phase 25   one SECURITY DEFINER function touches it
```

A record somebody can write is a record somebody can fabricate, and one somebody
can delete is one where the incriminating row goes first.

`audit_logs` covers the nine sensitive actions master section 17 names, and
records who (`auth.uid()`, which cannot be forged), from where (IP and user
agent, forwarded from the request), and under which `request_id` — the same
value that appears in the application log for that request. `user_id` carries
**no foreign key**, deliberately: deleting a user must not erase or blank the
record of what they did (ADR-028).

## 6. Availability

```text
Rate limiting     PostgreSQL-backed, on the surface without a session
                  (`consume_rate_limit`). In-memory would be per instance in a
                  serverless deployment - it would allow N x limit and not know
                  it (ADR-029 decision 3).
Counted by        the CALLER's address, not the account being addressed. By
                  email would let anyone lock out anyone else's account.
On failure        ALLOWS. It is a second line - Supabase Auth has its own -
                  and a limiter that fails closed turns a problem with an
                  auxiliary table into "nobody can sign in".
Report caps       A report range is capped at 366 days (Phase 23), so no
                  single request can ask the database for everything.
```

Not covered here: WAF, DDoS mitigation and bot protection. Those are properties
of the hosting platform, not of this application (master section 47).

## Headers

Set on every response by `next.config.ts` (Phase 00) except the CSP, which the
proxy emits per request (Phase 25).

```text
Content-Security-Policy   nonce per request; no 'unsafe-inline' in script-src
Strict-Transport-Security max-age=63072000; includeSubDomains; preload
X-Frame-Options           DENY            (frame-ancestors 'none' repeats it)
X-Content-Type-Options    nosniff
Referrer-Policy           strict-origin-when-cross-origin
Permissions-Policy        camera=(), microphone=(), geolocation=(),
                          browsing-topics=()
X-Powered-By              disabled
```

The CSP has to come from the proxy because a nonce must be generated per
request, and a nonce is the only way to have a CSP without `'unsafe-inline'` —
which is the thing a CSP exists to forbid. The cost is that **nothing in the
application is prerendered**: a page built at build time has no nonce, so its
inline bootstrap script would be blocked by its own policy. That is declared
once, in the root layout, with the reasoning.

## Uploads

```text
Where            Supabase Storage, bucket `tenant-assets`
Isolation        The policy reads the tenant out of the object PATH
                 (`storage.foldername`), and the path is built server-side from
                 an already-resolved tenant id
MIME             Allow list per folder. A deny list is a promise to have
                 thought of every dangerous type, which nobody can keep
Extension        Taken from the VALIDATED MIME type, never from the uploaded
                 filename - which is how a `.php` ends up in a bucket
Size             A ceiling per folder, all below the bucket's own limit
SVG              Deliberately NOT allowed: an SVG is a document that can carry
                 script, and serving one from the tenant's own origin would be
                 stored XSS
```

## What is knowingly not covered

Stated rather than implied, because a threat model that lists only its successes
is not one.

```text
No pentest, no automated scan            KL-2501, owner Phase 28. Both need a
                                          deployed environment with data.
Nothing verified against a real browser  KL-2505. The CSP is asserted as a
                                          string; no browser exists in the
                                          test harness.
The audit's forwarded headers            KL-2502. That supabase-js forwards
                                          `global.headers` and PostgREST
                                          exposes them is documented behaviour,
                                          not executed here. Degrades to NULL.
Secret rotation and key management       KL-2503, owner Phase 27.
Login is distinguishable by TIMING       KL-2504. The MESSAGE is identical; the
                                          duration is not, because a real
                                          address reaches a password check
                                          inside Supabase Auth.
Fixed rate-limit windows                 KL-2506. The boundary allows double
                                          the limit in one instant.
The limiter fails OPEN                   KL-2507, and it is a decision.
deliveries.manage reaches every delivery KL-2508. Inside one business, not
                                          across businesses; narrowing it would
                                          need a role comparison inside a
                                          policy, which ADR-010 forbids.
Shared NAT shares a login quota          KL-2509.
No MFA                                   Not in master's scope for any phase.
No webhooks                              None exist. The first one will need
                                          signature verification and
                                          idempotency, from the phase that
                                          brings it.
```

## How to verify all of this

```bash
npm run test    # includes the four suites below
npm run lint
npm run typecheck
npm run build
```

```text
src/tests/database/isolation.test.ts       RLS posture over the whole schema
src/tests/database/cross-tenant.test.ts    the four-verb sweep, generated
src/tests/database/rate-limit.test.ts      the limiter, its table, its hash
src/tests/database/audit.test.ts           the audit trail and its redaction
src/tests/unit/security-posture.test.ts    CSP, action gates, page gates,
                                            service_role, client/server split
```

Every one of them runs against real PostgreSQL with the real migrations and the
real policies (PGlite, ADR-007) or against the real source files. None of them
asserts against a mock.
