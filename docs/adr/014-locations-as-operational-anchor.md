# ADR-014 — Locations as the anchor of every operational module

```text
Status: ACCEPTED
Date:   2026-08-25
Phase:  10 — Locations
```

## Context

Master section 33 places this phase before any operational module and says why
in one line: "Crear soporte multi-sucursal **antes de** módulos operativos."
Section 8 already names `tenant_id + location_id` among the indexes to pay
attention to, for tables that do not exist yet.

So `locations` is not a feature. It is a column that orders, tills, stock
movements and invoices will each carry from Phase 13 onwards, and the decisions
taken here are inherited by all of them. Four of those decisions had a tempting
wrong answer.

## Decision

### 1. Every tenant has a location, with no nullable escape hatch

Master section 33 again: "Incluso clientes de una sola sede utilizarán una
location." A one-shop business gets a branch created for it by the same trigger
that creates its settings, theme and SEO row, named after the business itself.

The alternative — a nullable `location_id` "for the simple ones" — would turn
every future query into two queries, every index into a worse one, and every
report into a decision about what to do with the null. Cheaper to make the
degenerate case a real case with one row in it.

The invariant is then defended: a trigger refuses to deactivate a tenant's last
active location. Without it, the failure would surface three modules away as
"cannot create order" rather than here as "you closed your only shop".

### 2. Opening hours are relational, and a shift never crosses midnight

Master section 7 reserves JSONB for genuinely dynamic configuration and sends
repeating groups to relational storage. Hours are the textbook case: seven days,
and in Peru almost always two shifts a day. In JSONB, "shifts must not overlap"
and "closing is after opening" would be application validation — which holds only
while everybody goes through the same code path. Here they are a CHECK and a
trigger, so they hold for a platform operator and for a migration too.

`closes_at > opens_at` is strict, so a bar open 18:00-02:00 is stored as two
rows: 18:00-24:00 on Friday and 00:00-02:00 on Saturday. Allowing
`closes_at < opens_at` to mean "crosses midnight" would make overlap detection
undecidable and would make every future "is it open now" query a special case.
PostgreSQL's `time` accepts `24:00:00`, so "until midnight" needs no fudge.

Touching ends are not an overlap: 10:00-12:00 and 12:00-14:00 are a normal split
shift, and refusing them would force a business to invent a one-minute gap.

### 3. `time`, not `timestamptz` — which is not a contradiction of section 40

Section 40 keeps timestamps in UTC. It governs **instants**: when an order was
placed, when a payment cleared. "We open at nine" is not an instant — it stays
true when the clock changes — and storing it as a moment in UTC would make it
drift against the business's own day.

### 4. A location is deactivated, never deleted

There is no DELETE policy. From Phase 13, orders, tills, stock movements and
invoices reference a location; deleting one would either cascade that history
away or leave it dangling, and neither is acceptable for records a business is
legally required to keep. `is_active = false` says "we do not operate here any
more" without pretending it never happened.

This matches the posture already taken elsewhere: tenants have a status,
memberships have a status, platform admins are revoked rather than removed.

### 5. Two `numeric` columns, not PostGIS

The extension is not enabled on this project and does not exist in the PGlite
harness, and this phase computes no distances. Section 8 says every index must
answer a real query pattern; the same applies to an extension. When Phase 19
needs delivery zones, haversine over two numeric columns is a SQL expression
away, and enabling PostGIS then is a decision with a query behind it.

The columns are constrained to real coordinates and to being present together —
half a coordinate is not a location, it is a pin in the Atlantic.

## Alternatives considered

**A `schedule` JSONB column on `locations`.** One table instead of two, and the
shape master section 33 literally lists ("schedule" as a field). Rejected on
section 7: the validation that matters would have moved into application code,
and the first writer that bypassed it would store a schedule nothing can render.

**An `EXCLUDE USING gist` constraint for overlaps.** The declarative, atomic way
to say it, and the right one if `btree_gist` were available. It is not, so the
rule would have been unenforceable in the harness where every other constraint
in this schema is executed rather than assumed. A trigger is less elegant and is
actually verified; the residual concurrency window is recorded as KL-1007.

**A `is_primary` flag now, mirroring `tenant_domains`.** Cheap to add and
plausibly needed. Rejected as speculative: nothing in this phase has to choose a
branch, and inventing a default before there is a chooser means guessing what
Phase 13 will want. Recorded as KL-1001 rather than built.

**Making the public block a CMS section type.** Master section 30 lists
"dirección" and "horarios" among what a tenant website shows, and Phase 07 built
a typed section system. Adding a ninth type means a schema, an editor and a
renderer branch — a phase's worth of work. The footer block delivers the same
information now; the section type stays available as a later decision.

## Consequences

- Every operational table from Phase 13 onwards carries `location_id` as a
  non-nullable column, and the index pattern section 8 names is already the
  right one.
- A business cannot reach a state where it has no branch, so no later module
  needs a "what if there are none" path.
- Branch history is permanent. A tenant that has opened and closed ten shops
  keeps ten rows, and every past order still points at a real one.
- Opening hours are queryable: "which branches are open at 20:00 on Friday" is a
  `where` clause, not a JSONB walk in application code.
- An active branch's name, address, phone and coordinates are public — they are
  what a business prints on its own website. What stays private is a branch it
  has closed, which is a business fact that appears nowhere public.
