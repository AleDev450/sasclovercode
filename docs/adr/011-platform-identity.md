# ADR-011 — Platform identity: a separate table, and no service_role

```text
Status: ACCEPTED
Date:   2026-08-25
Phase:  04 — Super Admin
```

## Context

Master section 29 requires a CloverCode-only area and is explicit that
`SUPER_ADMIN` must never be confused with a tenant's `OWNER`. Section 33
(Phase 4) requires provisioning that creates tenant, system domain and owner
together. Section 49 makes that flow the project's first goal.

Two questions had to be answered, and both had an obvious wrong answer.

## Decision

### 1. Platform identity lives in its own table

`platform_admins`, keyed on `user_id`. Not a column on `profiles`, not a value
in `tenant_role`.

Putting it in `tenant_role` would mean a platform operator is, structurally, a
tenant member — the exact confusion section 29 forbids. A column on `profiles`
would be better but still invites a query that reads authority and membership
together. A separate table makes the confusion impossible by structure rather
than by discipline: `is_platform_admin()` does not read `tenant_members` at all,
and `has_permission()` does not read `platform_admins`.

Tests assert this in both directions: an owner is not an operator, and an
operator is not a member.

### 2. `revoked` rather than DELETE

Who held platform authority, and when they stopped, is auditable.

### 3. No write policy on `platform_admins`

Granting platform authority is not reachable through the API at all — it
happens by migration or direct database access. This closes the escalation path
where somebody who already has an account writes themselves a row.

### 4. **No `service_role` client in this phase**

Earlier phases deferred the service-role client to "Phase 04". Building it here
was reconsidered and rejected.

The reason it seemed necessary was that a platform operator must read and write
across every tenant, which RLS forbids. But that is what a _policy_ is for.
`is_platform_admin()` expresses the authority precisely, and the platform
policies are additive: a normal user's visibility is byte-for-byte unchanged.

A `service_role` key ignores RLS entirely. Introducing one means every future
bug in code holding it is a total compromise rather than a scoped one, and the
audit trail of "who could see what" stops being expressible in the schema.
While a policy does the job, the key is unjustified blast radius.

It is deferred to whatever phase demonstrates a need the database cannot meet —
creating accounts through the Auth admin API is the likely candidate (Phase 05).
"The plan said Phase 04" is not a reason to add a skeleton key.

### 5. Provisioning is one SQL function, idempotent

A business needs a tenant, a system domain and an owner. Three application-level
calls can fail in the middle and leave a business nobody can reach and nobody
can fix through the product. Inside a function it is one transaction.

Every step is `on conflict do nothing`, so a retry **completes** a partial
provisioning rather than duplicating or erroring (master section 37). A
double-submitted form is safe.

The privilege check lives inside the function too, not only in the caller: a
SECURITY DEFINER function runs elevated and must decide for itself who may run
it.

### 6. The platform area answers 404, not 403

For a signed-in user without authority. A 403 confirms that `/super-admin`
exists and that they merely lack the key.

### 7. The platform can read a roster but not write one

Support needs to see who belongs to a business. Who _works_ at Sugu Rolls is
Sugu Rolls' decision. The single exception is the first owner, created inside
provisioning, without which the business would be born unreachable.

## Alternatives considered

| Alternative                                | Why rejected                                                                                                  |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `SUPER_ADMIN` as a value in `tenant_role`  | Makes an operator a tenant member by construction. Exactly what section 29 forbids.                           |
| A boolean column on `profiles`             | Better, but still invites reading authority and membership in one query. No room for revocation history.      |
| `service_role` for the whole platform area | A key that ignores RLS, used where a policy suffices. Unjustified blast radius.                               |
| Provisioning as three calls from the app   | A failure mid-way leaves a business with no owner and no way to fix it in-product.                            |
| Raising an error on a duplicate slug       | A double-submitted form would show a failure for work that partly succeeded. Idempotency is kinder and safer. |
| 403 for non-operators                      | Confirms the area exists to anyone who probes it.                                                             |

## Consequences

**Positive**

- The two identities cannot blur; tests prove it in both directions.
- No key exists that bypasses RLS, so "who can see what" stays in the schema.
- Provisioning is atomic and safe to retry.
- Platform policies are additive: tenant isolation is untouched.

**Negative**

- An operator cannot fix a tenant's membership directly; that is deliberate,
  and will need a support path if it ever proves necessary.
- Granting platform authority requires database access. Correct for a handful
  of staff; it would need a real flow if the team grew.
- The listing is unpaginated (master section 18 requires paginating listings).
  Acceptable at hundreds of tenants; recorded with a trigger to revisit.

## Follow-up

- **Phase 05** owns inviting and creating user accounts, and is where the
  service_role question genuinely arises.
- **Phase 06** extends `provision_tenant()` with the default `tenant_settings`
  that section 33 asks for and that has no table yet.
- **Phase 24** records platform operations in `audit_logs`.
