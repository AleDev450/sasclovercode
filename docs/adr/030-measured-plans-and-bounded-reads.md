# ADR-030 — Measured query plans, and a ceiling on every read

```text
Status: ACCEPTED
Date:   2026-08-31
Phase:  26 — Performance
```

## Context

Master section 33, Phase 26 is three lines long and the first one is the whole
brief: **"medir antes de optimizar"**. Section 18 lists what to avoid — N+1
queries, unbounded reads, unnecessary client components — and section 8 asks for
indexes that answer a real query pattern and no more.

None of that had ever been checked. Twenty-five phases added about 190 indexes,
each because somebody reasoned it would be needed, and nothing verified that the
planner agreed. Every list read was written the same way and nothing verified
they were bounded.

This ADR records how the phase decided to measure, because the method is what
survives it. The measurements themselves go stale; the apparatus does not.

## Decision

### 1. Plans are measured against real PostgreSQL with realistic volume

ADR-007 already runs actual PostgreSQL in-process for tests, so
`EXPLAIN (ANALYZE)` reports a real plan over real rows. Phase 26 adds a seeder
that loads forty tenants with catalogue, customers, orders and lines, and runs
`ANALYZE` before measuring.

The volume is not decoration. **`EXPLAIN` on a small table proves nothing**: with
ten rows the planner picks a sequential scan whether an index exists or not, and
it is right to. A test asserting "uses an index" against a three-row fixture
would fail on correct schemas and pass on broken ones.

The seeder taught this twice, both times by being wrong first:

- Orders were seeded for one tenant only. The plan came back a sequential scan,
  correctly — with every row under the same tenant, `where tenant_id = ...`
  filters nothing and an index on it is worthless. The measurement was right and
  the data was wrong.
- Locations and members got one row per tenant. Same failure, same lesson: it is
  the tenant COUNT that gives those tables volume, not rows per tenant.

### 2. Two different assertions, because small hot tables are a real case

`expectIndexed` — the planner must CHOOSE an index. Used on tables that grow:
`products`, `orders`, `order_items`, `customers`.

`expectIndexAvailable` — an index must EXIST and be usable, verified by turning
`enable_seqscan` off and confirming the planner can still serve the query. Used
on `locations`, `tenant_members`, `tenant_domains`.

The second assertion exists because those tables hold a handful of rows per
business. Even across forty tenants that is two or three pages, and PostgreSQL
reads them end to end — which is the correct plan at that size. Asserting an
index scan would have been **asserting something false**, and the only way to
make it pass would have been to inflate the fixture until the planner agreed
with the test.

That is fabricating a measurement to fit a conclusion, which is the precise
thing "medir antes de optimizar" forbids. What still matters for those tables is
that the index is there for the day the platform is big enough to need it, and
that is what the second assertion checks.

### 3. Unused indexes are reported, not failed

Section 8 says avoid over-indexing. The measured hot queries touch 8 of 116
non-primary-key indexes, and the test prints the gap rather than failing on it.

An untouched index is not automatically wrong: it may back a foreign key,
enforce uniqueness, or serve a query a later phase writes. What is wrong is
nobody ever looking. A failing assertion here would be deleted within a week;
a printed number gets read.

### 4. Every list read carries a ceiling, and an absent limit is not "no limit"

`LIST_CAP = 500` on every list query, including the ones nobody paginates.
`MAX_PAGE_SIZE = 100` as the most a client may ask for, applied on the server so
`?limit=1000000` is clamped rather than obeyed.

The ceiling is deliberately far above what the affected tables hold. It is not a
page size and no screen pages against it: it turns "this query reads the table"
into "this query reads at most this much", so a table that unexpectedly grows
degrades a screen instead of taking a request down.

**A list that can legitimately exceed the ceiling needs pagination, not a bigger
ceiling.** Raising the number to make a screen work is the wrong fix, and both
the constant and the budget document say so where somebody would go to change
it.

### 5. Pagination without `COUNT(*)`

`resolvePage` / `probeRange` / `pageInfo` / `trimProbe` fetch one row more than
the page and check whether it arrived.

No total. Counting every matching row on every page view is a second full read
of exactly the data the limit exists to avoid, and it buys a number nobody acts
on. "Is there a next page" is the only question the UI has.

This codifies a pattern Phases 13, 23 and 24 had each invented independently —
`orders`, `billing_documents` and `audit_logs` all fetch a probe row already.
The helper generalises what was already working rather than replacing it.

### 6. Timing is opt-in, and never records arguments

`timed(operation, run)` wraps a read and logs its duration; over
`SLOW_QUERY_MS = 200` it logs a warning. It is not a wrapper around the Supabase
client, because that would put every query in the product through one more layer
that can break for a measurement only interesting on the slow ones.

It records the operation NAME and the duration, never the parameters. A query's
arguments are customer names, phone numbers and document numbers — exactly the
personal data ADR-016 minimised and section 16 keeps out of logs. A test asserts
the logged object has three keys and no more.

## Alternatives considered

**Assert index usage everywhere, and seed until it passes.** Simpler to explain
and dishonest: it makes the fixture serve the assertion instead of the other way
round, and produces green tests over tables where a sequential scan was always
going to be the right plan.

**Fail the build on unused indexes.** Would satisfy section 8 more forcefully.
Rejected: too many legitimate reasons for an index not to appear in a
measurement of ten queries, and a test that cries wolf gets deleted.

**A global row limit inside the Supabase client.** One place instead of thirty-
four. Rejected: PostgREST's builder has no such hook, so it would mean wrapping
the client — and a silent global cap is worse than a visible one, because the
truncation happens where nobody is looking for it.

**`COUNT(*)` for real pagination with page numbers.** Nicer UI. Rejected for the
reason in decision 5, and because three phases had already independently chosen
the probe row, which is evidence about what this product actually needs.

**Optimising anything the measurement did not flag.** Considered and refused,
which is the point of the phase. No N+1 was found, so none was fixed. The
absence of static routes was checked and turned out to be a measured, documented
decision from Phase 25 (ADR-029: the CSP nonce forbids static rendering) rather
than a finding, and reverting it would be a security decision wearing a
performance costume.

## Consequences

- A deleted index or a new query with no index support fails CI with the plan
  attached, rather than becoming a page that got slower every week.
- No list read in the product can return an entire table, and a new one that
  tries fails TEST-2618 rather than shipping.
- The budgets in `docs/performance-budgets.md` are enforced, so they cannot
  drift into decoration.
- The plan suite costs a PGlite instance and about two seconds. It runs with
  every other test, because an apparatus somebody has to remember to run is one
  nobody runs.
- Real API and database latency remain unmeasured. They need a deployed
  environment, and the instrumentation is in place for when there is one
  (KL-2601).
