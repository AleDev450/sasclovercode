# ADR-010 — RBAC: permissions in the database, never role checks in code

```text
Status: ACCEPTED
Date:   2026-08-25
Phase:  03 — Authorization + RLS
```

## Context

Master section 12 asks for a reusable authorization layer and is explicit about
what to avoid: code littered with `if (role === "admin")`. Section 45 adds that
navigation does not determine authorization. Section 33 (Phase 3) requires the
proof that `Tenant A != Tenant B` at the PostgreSQL level.

Phases 01 and 02 left `tenants` and `tenant_members` closed. This phase opens
them, and how it opens them decides whether isolation stays provable.

## Decision

### 1. Code asks for a permission, never for a role

`requirePermission(tenantId, PERMISSIONS.ORDERS_CANCEL)`. No call site compares
a role. Changing which role may cancel an order is a row in a migration.

### 2. The catalogue lives in the database, mirrored as typed constants

`Permission` is a union of literals, so a typo is a compile error rather than a
silent `false` at run time — which would read as "access denied" and be very
hard to trace. `authorization-schema.test.ts` fails if the mirror drifts.

### 3. `roles.code` reuses the `tenant_role` enum

Rather than migrating `tenant_members.role` to a text FK. A role outside the
enum stays impossible by type, and Phase 02's column is untouched. This resolves
KL-209 of Phase 02.

### 4. The permission check lives in SQL, not in TypeScript

`has_permission(tenant_id, permission)` is what both the RLS policies and the
application call. One implementation, one place to audit. A TypeScript-only
check would be bypassed by anything that reaches the database another way.

### 5. Policy helpers are SECURITY DEFINER, and they must be

A policy on `tenant_members` that reads `tenant_members` re-enters its own
policy: infinite recursion. A SECURITY DEFINER function does not go back through
RLS, which breaks the cycle. Because it bypasses RLS, it is written defensively:
`SET search_path = ''`, fully qualified names, `revoke execute from public`
before granting, and **no user parameter** — identity comes from `auth.uid()`
inside the body, so a caller can only ask about themselves.

### 6. A permission is scoped to a tenant, always

`has_permission` takes the tenant explicitly. There is no ambient "current
tenant" for authorization. A check whose tenant is implicit is a check that will
one day look at the wrong tenant.

### 7. The catalogue is loaded by migration, not by seed

Departing from master section 23. `supabase/seed.sql` runs on a local
`db reset` but **not** on `db push` to a deployed project. A missing catalogue
makes every `has_permission` return false, locking every environment out.
Reference data that RLS depends on is schema, not sample data.

### 8. Escalation to `owner` is blocked in the database

Only a caller holding `settings.manage` — which the catalogue grants to `owner`
alone — may create, modify or remove an `owner` row. Enforced in `WITH CHECK` as
well as `USING`, because `USING` alone would let a manageable row be _turned
into_ an owner row. In the database and not the application, because a Server
Action is not the only path to a write.

### 9. `getMyPermissions` is for rendering only

It returns the whole set at once so a screen does not ask once per element — an
N+1 of authorization checks. It never replaces the server-side check.

## Alternatives considered

| Alternative                                | Why rejected                                                                                    |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| Role checks at each call site              | Exactly what master section 12 forbids. Unauditable and impossible to change safely.            |
| Permissions resolved only in TypeScript    | Anything reaching the database another way bypasses it. RLS could not use it.                   |
| Policies querying `tenant_members` inline  | Infinite recursion, and the same subquery duplicated in every policy.                           |
| Permissions as JSONB on the membership row | No referential integrity, no way to ask "who can cancel an order", and drift per row.           |
| Per-tenant custom roles                    | Real complexity with no demand yet. The catalogue can grow into it without a rewrite.           |
| `role = 'owner'` in the escalation guard   | Reintroduces the role comparison this ADR removes, in the most security-sensitive place of all. |

## Consequences

**Positive**

- One authorization implementation, shared by RLS and the application.
- Adding a permission is a migration row.
- Isolation is proved by execution, per role, in `authorization.test.ts`.
- Privilege escalation is blocked where it cannot be bypassed.

**Negative**

- `has_permission` is a round trip per distinct check. `my_permissions` exists
  for screens that need many.
- The TypeScript catalogue mirrors the database and must be kept in step. The
  contract test makes drift loud rather than silent.
- A SECURITY DEFINER function is powerful by construction: every one added later
  needs the same four precautions.

## Follow-up

- **Phase 04** creates the first owner during provisioning, and owns the
  "a tenant must always have at least one owner" invariant, which cannot be
  expressed declaratively here (SPEC EC-306).
- **Phase 21** adds module/plan gating on top of permissions: a permission held
  but not enabled by the plan must still deny.
- **Phase 24** records role changes in `audit_logs`.
