# ADR-031 — A restore is not an insert

```text
Status: ACCEPTED
Date:   2026-08-31
Phase:  27 — Backups + Disaster Recovery
```

## Context

Master section 33, Phase 27 asks for seven documents and one act:

> Realizar al menos una prueba real de restauración en entorno no productivo.
>
> Un backup que nunca se probó no puede considerarse estrategia de recuperación.

The act came first, and it failed.

The schema has 123 triggers across 49 migrations. They are all correct and all
necessary: they maintain invariants, number orders per tenant, denormalise
`tenant_id` onto child tables, and write the audit trail. Twenty-five phases
added them one at a time, each for a good reason.

Restoring a dump into that schema does not work.

## Decision

### 1. Every restore runs with `session_replication_role = 'replica'`

Measured before anything was written:

```text
Naive restore (triggers on)
  insert the dumped `tenants` row
    -> create_tenant_defaults fires
    -> invents a location, settings, theme and SEO row
  insert the dumped `locations` row
    -> ERROR: duplicate key value violates unique constraint
              "locations_tenant_name_key"
    -> the load aborts, part of the data in and part out

Correct restore (session_replication_role = 'replica')
  no trigger fires, every row lands exactly as dumped
```

The important word is **fails**, not "degrades". A restore that silently
duplicated rows would be worse in one way — nobody would notice — but this one
dies partway through a load, during an incident, with somebody watching a clock.

The root cause is a sentence worth keeping: **a restore is not an insert.** The
rows already existed. They already passed through those rules once. Applying the
rules again rewrites data whose whole purpose is to be exactly what it was.

`pg_restore --disable-triggers` sets the same flag. It is not an optimisation
and it is not optional.

### 2. The drill runs in CI, not once

`src/tests/database/restore-drill.test.ts` seeds two tenants, dumps every table,
rebuilds a database from the migrations, restores, and compares row by row.

A rehearsal somebody has to remember to perform gets performed once, at the
moment it is written, and never again — which on the day it matters is the same
as not having one. Section 33 asks for "al menos una"; running it on every push
costs six seconds and removes the question.

### 3. The drill also asserts what did NOT happen

Row counts alone would pass while the data came back subtly wrong. So it checks
the columns a trigger would have rewritten: order numbers, which are assigned by
a trigger, and `updated_at`, which `set_updated_at` stamps on every write. Those
are the corruption nobody notices until a report disagrees with a customer.

### 4. Isolation is verified after the restore, not assumed

A restore touches every table of every tenant at once, with triggers off and —
in production — under a role that bypasses RLS. It is the only procedure in the
system that operates outside the defences twenty-five phases built.

So the drill checks, after restoring, that RLS is still enabled on every tenant
table and that one tenant still cannot read another's customers.

**A restore that returns the data and leaves RLS ineffective returns everybody's
data to everybody, and looks like a successful recovery.**

And one assumption the entire procedure rests on, checked rather than believed:
`session_replication_role = 'replica'` disables triggers and foreign keys, and
does **not** disable policies (TEST-2712). If it did, the restore window would be
a window with no isolation at all and the runbook would need a different shape.

### 5. `audit_logs` retention has a floor, not just a default

`purge_audit_logs(interval)` deletes rows older than the interval and **refuses
anything under 90 days**, with no grant to any tenant role.

The default of 365 days is a storage decision. The floor is not: without it,
`purge_audit_logs(interval '1 hour')` empties the audit trail with one
parameter, and the person most likely to type that is the person who least wants
the trail to exist. Section 17 asks for auditing precisely for that moment.

### 6. The schema is rebuilt, not restored

Section 22 requires every database change to go through a versioned migration,
which makes the schema code rather than state. Recovery applies
`supabase/migrations/` to an empty database instead of restoring a snapshot of
the structure — and TEST-2701/2702 verify it produces the same schema every
time.

## Alternatives considered

**Make the triggers restore-aware,** with a guard like
`if current_setting('app.restoring', true) = 'on' then return new`. Rejected:
it puts recovery logic into 123 business triggers, where it would be forgotten
in the next one somebody writes, to replace a switch PostgreSQL already
provides and `pg_restore` already sets.

**Drop the triggers before restoring and recreate them after.** Works, and
leaves a window where a half-restored database has no invariants and somebody
has to remember to put them back. `session_replication_role` is scoped to the
session and reverts by itself.

**Restore over the broken project instead of a new one.** Faster. Rejected in
the runbook: while the restore runs elsewhere, the original is still evidence.
If the restore goes wrong, restoring over the top means there is nothing left to
try.

**A `COUNT(*)`-based verification instead of a row-by-row diff.** Cheaper and
would have passed while `updated_at` was silently restamped on every row.

**Writing the runbook first and testing later.** What the master document
forbids in one sentence, and the reason this ADR exists: the document would have
been confident, complete, and wrong at step three.

## Consequences

- Recovery has a procedure that has been executed, not just written. The
  difference is one line in the runbook that nobody would have guessed.
- The drill costs about six seconds per test run and protects the one procedure
  that is only ever used when everything else has failed.
- A future trigger that breaks restorability fails CI at the moment it is added,
  rather than during an incident months later.
- `audit_logs` stops growing without bound, and cannot be emptied by the
  businesses it records.
- Storage still has no backup. A restore returns the paths and not the files, so
  a recovered catalogue has broken images. Recorded as KL-2701 rather than
  quietly left out of the runbook.
- RPO and RTO are declared, and the RPO depends on PITR being enabled on the
  Supabase project. Until that is verified, the declared number is an intention
  (KL-2702).
