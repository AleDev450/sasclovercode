# ADR-016 — Personal data minimization and customer identity

```text
Status: ACCEPTED
Date:   2026-08-27
Phase:  12 — Customers
```

## Context

Master section 33 governs Phase 12 with one line:

> No almacenar más información personal de la necesaria.

It is the only phase in the master document whose instruction is a
**restriction** rather than a capability. Every other phase says what to build;
this one says what not to keep.

That needs a decision recorded, because "not more than necessary" is not
self-executing. Necessary for whom, judged when? Left implicit, the answer
drifts: a field gets added because a customer asked for it once, and three
phases later nobody remembers what it was for or whether it can be removed.

Two further facts shape it. First, a customer is identified in Peru by a
document — DNI, RUC or CE — and from Phase 17 that document goes to SUNAT on
every invoice. Second, `customers` is the first table in CloverCode holding data
about people who are **not users of the system**: a person who buys a set menu
never consented to anything, has no account, and cannot see or correct what the
business stored about them.

## Decision

### 1. A column must name the operation that needs it

Every column of `customers` and `customer_addresses` justifies itself against a
concrete operation in this phase or the next. Considered and **excluded**:

```text
notes / observations   A free-text field about a person accumulates health
                       data ("alergico al mani"), judgements, and things
                       nobody would want printed. No operation needs it.

date of birth          Only loyalty (Phase 20) would want it. Let that phase
                       add it and justify it then.

gender                 No operation uses it.

address on customers   Belongs in customer_addresses: a person has several.
```

The test of necessity is applied by the phase that needs the field, not by the
phase that can imagine needing it. This is section 51 ("no desarrollar
funcionalidades futuras por adelantado") applied to data rather than to code,
and it cuts the other way from the usual schema instinct: an unused nullable
column is normally harmless, and here it is a liability that grows while nobody
looks at it.

### 2. Personal data never reaches a log

Log lines in this module carry `tenantId` and `customerId` and nothing else. No
document number, email, phone or name.

A log is where personal data escapes without anyone deciding it should: it is
copied to other systems, retained far longer than the row, and read by people
who do not hold `customers.view`. The id is enough to investigate an incident,
and anyone investigating can look the row up through the same permission
everyone else needs.

### 3. No public read path exists, and its absence is tested

Phases 10 and 11 both end their migrations with a `..._select_public` policy
granting `anon` a view of active rows, correctly: a branch address and a menu
exist to be seen.

`customers` and `customer_addresses` have no such policy, and must never get
one. The risk is specifically that somebody adds one **by analogy** while
following the established shape of the codebase.

So the absence is asserted rather than assumed: TEST-1210 reads `pg_policies`
and fails if any policy on either table names `anon`. A test that instead
queried the table as an anonymous user would prove the situation today; reading
the catalogue proves the rule. It matters because this defect fails silently —
the public site would render identically, and nobody would notice until someone
queried the table directly.

### 4. Identity is scoped to the tenant, never global

`UNIQUE (tenant_id, doc_type, doc_number)`, never `UNIQUE (doc_number)`.

This is master section 11, but the consequence here is worse than the
duplicate-slug problem Phase 11 faced. A global unique index on a document
number would mean:

```text
the same person can be a customer of exactly one business on the platform, and

one business can discover, by collision, that a competitor already has them.
```

That is a shared national customer registry built between competitors by
accident, out of a missing column in an index.

### 5. The RUC check digit is enforced by the database

`public.is_valid_ruc(text)` is `IMMUTABLE` and called from the CHECK constraint
on `customers`.

A RUC whose check digit does not add up is a RUC that does not exist. If one
reaches the table, Phase 17 sends it to SUNAT, SUNAT rejects the document, and
the error surfaces five phases from the form that caused it, with an invoice in
the middle.

Validating only in Zod would be enough if the dashboard form were the only
writer. It is not: a platform operator has policies, Phase 13 will create
customers mid-order, Phase 15 brings its own POS. An invariant that depends on
every writer remembering is not an invariant — the same argument Phase 10 used
for `guard_last_active_location`.

The TypeScript twin in `src/modules/customers/documents.ts` exists to produce a
message a person can act on, not to be the guarantee.

### 6. Customers are deactivated; addresses are deleted

No DELETE policy on `customers`. From Phase 13 an order points at one, and a
business must keep its sales records.

An address **can** be deleted, and the distinction is deliberate: an address is
current contact information, not history. Someone who moved does not want their
old home left in a list. Phase 13 will copy the delivery address onto the order
rather than referencing this row, so deleting it never rewrites where something
was delivered last month.

## Alternatives considered

**A `deleted_at` soft-delete on customers.** Rejected: it is the same retention
with a friendlier name. If the row must be kept for the sales records, saying so
with `is_active` is honest; a column called "deleted" holding data that was not
deleted misleads whoever reads the schema next.

**Encrypting the document number at rest.** Rejected for this phase, not on
principle. Postgres-level encryption would break the unique index and the
search, which are the two operations the column exists for, and Supabase already
encrypts the volume. Application-level encryption of a searchable identifier is
a project of its own and belongs with a threat model, not with a first CRUD.

**A `pasaporte` document type.** Rejected: not in master section 33, and section
51 forbids building ahead. Adding it later is `alter type ... add value`, which
does not rewrite the table.

**Validating the RUC only in Zod.** Rejected in decision 5 above.

**Storing the customer as an `auth.users` row.** Rejected: it would mean
creating a login for every person who buys a set menu. A customer is data
belonging to the business, not an account on CloverCode.

## Consequences

**Good**

- The set of personal data CloverCode holds is small, enumerated, and each item
  traceable to an operation.
- A malformed RUC cannot exist in the database regardless of which module writes
  it.
- Cross-tenant exposure of customer data requires deleting a policy, and the
  test suite fails when one is added for `anon`.
- Logs can be shipped to any aggregator without shipping personal data.

**Bad / accepted**

- Businesses that want a notes field on a customer cannot have one, and will
  ask. The answer is a future phase that justifies it, not a text column added
  quietly now.
- The document validation exists twice, in SQL and in TypeScript. They must be
  changed together; both are tested against the same real RUCs so a divergence
  fails.
- The document is stored in plain text, and this ADR should be revisited if
  CloverCode ever holds documents at a scale that makes the table a target on
  its own.

**Deferred to later phases**

- Anonymising a customer on request while keeping their orders needs orders to
  exist (Phase 13 or later).
- Retention limits — how long an inactive customer is kept — need a legal answer
  this project does not yet have.
