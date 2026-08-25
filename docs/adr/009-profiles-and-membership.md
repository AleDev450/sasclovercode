# ADR-009 — Profiles, memberships, and a guarded read path

```text
Status: ACCEPTED
Date:   2026-08-25
Phase:  02 — Authentication
```

## Context

`CLOVERCODE_MASTER.md` section 11 splits authentication (Supabase Auth) from
business identity (this application), with a user able to belong to several
tenants:

```text
auth.users -> profiles -> tenant_members -> tenant + role
```

Section 33 (Fase 2) is explicit that a password is never stored outside Supabase
Auth. Section 10 requires explicit RLS policies on every private table.

## Decision

### 1. `profiles.id` IS `auth.users.id`

Not a surrogate key with a foreign key beside it. A profile has no identity of
its own — it is the business face of exactly one auth user — and a second id
would let the two drift apart. `ON DELETE CASCADE` makes "delete my account"
mean what it says.

No credential column exists on `profiles`, and a compile-time assertion in
`src/tests/database/schema-contract.test.ts` fails if one is ever added.

### 2. Profiles are created by a database trigger

Sign-up is not the only way a row appears in `auth.users`: an invitation, an
admin creating a user, or a future OAuth provider all insert directly, and none
of them run application code. A trigger on `auth.users` is the only place that
observes every path. A second trigger keeps `profiles.email` in step when the
address changes in `auth.users`.

The insert is `ON CONFLICT DO NOTHING`: a retry must not abort user creation,
because an account that can authenticate but has no profile is worse than a
duplicate attempt.

### 3. `tenant_members` carries a coarse `role` enum

Section 11 defines a membership as carrying a role, so a membership without one
is not the entity the master describes. Phase 03 adds `roles`, `permissions` and
`role_permissions` for granular authorization; this column remains the coarse
role, and what a role may DO is resolved through those tables — never by
comparing this value in application code, which section 12 forbids explicitly.

`UNIQUE (tenant_id, user_id)` is what stops two roles for one person in one
business, which would make every authorization check depend on row order.

### 4. Tenant identity is read through `get_my_memberships()`, not by opening `tenants`

The application needs a tenant's name and slug beside each membership, and
`public.tenants` has been deny-by-default since Phase 01. Two ways out:

- add a SELECT policy on `tenants` for members;
- a `SECURITY DEFINER` function that performs the join.

The function is chosen. Opening `tenants` to authenticated users is an
authorization decision, and section 33 places authorization and RLS policy
design in Phase 03. This delivers exactly what authentication needs without
pre-empting that design, and it follows the pattern Phase 01 established with
`resolve_tenant_by_domain`.

The security property is the **absence of a parameter**: the identity comes from
`auth.uid()` inside the body, so a caller cannot ask about anybody else. A test
asserts the empty argument list directly, so adding one fails the build.

`REVOKE EXECUTE ... FROM PUBLIC` precedes the grant, applying the finding of the
Phase 01 final audit. `anon` is not granted: without a session the function can
only return zero rows, so exposing it would add surface for no capability.

### 5. Membership does not imply a roster

`profiles` and `tenant_members` are readable only by their own owner. Being a
member of a tenant does not let you list the other members: that reads other
people's rows, and it belongs to an explicit permission in Phase 03.

## Alternatives considered

**Create the profile from the application after sign-in.** Misses every path
that does not run our code, and leaves a window where an authenticated user has
no profile.

**Store the role as text.** Loses the database's guarantee that only the eight
roles of section 12 exist.

**Give `tenant_members` a policy allowing members to read their whole tenant's
rows.** Convenient for a future member list, and it grants a capability nothing
in this phase needs — with permissions still one phase away.

## Consequences

- The test harness needed an `auth` schema shim with `auth.uid()`, closing
  Phase 01 KL-103.
- Phase 03 must decide whether `tenant_members.role` stays an enum or becomes a
  foreign key to `roles`. Both remain open; the enum is not load-bearing for
  permission checks, which do not exist yet.
- Membership management (invite, revoke, change role) has no write path at all
  in this phase — the tables are deny-by-default for writes. Phase 04 owns it.
