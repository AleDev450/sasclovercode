# ADR-020 — Station is snapshotted for filtering; Realtime only triggers a refetch

```text
Status: ACCEPTED
Date:   2026-08-27
Phase:  16 — Kitchen / KDS
```

## Context

Master section 33 (Phase 16) asks for real-time orders, three states
(`new`/`preparing`/`ready`), four stations (kitchen/bar/sushi/desserts), and
one instruction that governs how much of this gets built:

> Analizar uso de Supabase Realtime. Solo utilizar realtime donde aporte
> valor real.

This is the first phase to touch Supabase Realtime at all — a grep of the
whole codebase before this phase found no channel subscription anywhere —
and the first to need a value that changes for a reason other than money
(ADR-015, ADR-017) copied onto `order_items` at insert.

Two decisions needed recording, because both have an obvious cheap answer
that turns out to be wrong once Realtime enters the picture.

## Decision

### 1. `order_items.station` is a snapshot, for a filtering reason

The obvious design is a live join: `order_items.product_id → products →
categories.kitchen_station`, computed at read time, the way any ordinary
foreign-key relationship works. It would have been correct for a page that
loads once and re-fetches on demand.

It cannot work for Realtime. Supabase's `postgres_changes` filter
(`table=order_items,filter=station=eq.sushi`) can only compare a **literal
column of the table being watched**. It has no way to express "and this
row's product's category has this station" — that is a join, and
`postgres_changes` does not run one. Without a station column sitting
directly on `order_items`, a sushi station's tablet would have to subscribe
to every `order_items` change for the whole tenant and filter in the
browser: drinks, desserts, everything, arriving over the wire before being
thrown away client-side. That is not "using realtime where it adds real
value" — it is paying its cost everywhere and collecting the benefit
nowhere.

So `station` is copied from the product's category onto the line at insert,
by the same trigger that already copies name and price
(`snapshot_order_item()`, Phase 13) — extended, not duplicated. One extra
assignment in a function that already reads the product row for the price.

**This is not an extension of ADR-017.** ADR-017 snapshots price and name
because a catalogue change must never rewrite history that already happened
— a financial-immutability argument. Station is snapshotted so a Postgres
filter has a column to compare against — a filtering argument. That they
land in the same trigger is a coincidence of timing (both need to happen
once, at insert, from the same product row), not evidence they are the same
kind of decision. If a category's station is corrected next week, new
tickets route correctly and old, already-fired lines keep whatever station
they were created with — which is also the right behaviour for a screen
about *what's cooking right now*, not a historical report.

### 2. Realtime triggers a refetch. It does not carry data.

The client subscribes to two things, both filtered to the tenant:
`order_items` INSERT (a new ticket line arrived) and `orders` UPDATE OF
`status` (a ticket moved). On either, it calls `router.refresh()`.

The alternative — parsing the realtime payload and merging it into local
component state — was rejected because it means a second, parallel
implementation of exactly what `listKitchenOrders` already computes: which
orders are in `(confirmed, preparing, ready)`, which of their lines belong
to this station, in what order. A realtime payload carries one row's raw
columns, not that shape. Building it client-side means keeping two
implementations of the same read in step forever, which is the same failure
mode ADR-017 §4 already named for a duplicated state machine — except here
it would be a duplicated query instead of a duplicated FSM.

A kitchen produces a handful of events a minute at the busiest hour. A full
`router.refresh()` per event re-runs one indexed query
(`orders_tenant_status_idx`, Phase 13) and re-renders one screen — cheap,
and always exactly as correct as the page's first load, because it *is* the
page's first load, run again. This is the concrete answer to "solo utilizar
realtime donde aporte valor real": the value Realtime adds here is
**knowing when to ask again**, not carrying the answer itself.

## Alternatives considered

**Station as a live join, re-evaluated on every read.** Rejected in
decision 1 — it is what breaks Realtime filtering, which is the entire
reason this phase reaches for Realtime at all.

**Station on `products` instead of `categories`.** More precise, and far
more setup per business: tagging four categories is a one-time cost;
tagging every product is not. No business need has been named for
per-product override, so the coarser, cheaper default was chosen. If one
ever is, a nullable per-product override can be added without touching this
decision.

**A client-side cache merging realtime payloads (e.g. a normalised store
keyed by order id).** Rejected in decision 2 — real value for a screen with
complex client-only state (drag-and-drop reordering, optimistic edits),
neither of which this board has. It would be solving a problem this phase
does not have, in exchange for a second copy of `listKitchenOrders`'s logic
to keep synchronised.

**Broadcast or Presence instead of `postgres_changes`.** Both are for
different problems — client-to-client messaging and "who's online",
respectively. This phase only needs "the database changed, go look again",
which is exactly what `postgres_changes` is for.

**Per-item status instead of order-level.** Rejected: Phase 13's state
machine already governs the order as a whole, and splitting a ticket's
lifecycle per station is a real product question (what does "the order" even
mean once its parts move independently?) that nobody has asked for. Reusing
`advanceOrderStatusAction` unmodified was only possible because this phase
did not reopen that question.

## Consequences

**Good**

- A station's Realtime subscription only ever receives what it actually
  needs — the wire cost of the feature scales with what's relevant, not
  with the whole tenant's order volume.
- `listKitchenOrders` is the only place the "what does a kitchen board show"
  logic exists. Realtime cannot drift from it, because it never reimplements
  it.
- Reusing `advanceOrderStatusAction` and `orders.view`/`orders.update`
  unmodified means this phase adds no new permission and no new write path
  to audit.

**Bad / accepted**

- A category's station change is not retroactive to lines already snapshotted
  — correct for "what's cooking now", but means a report built later that
  asks "how much did the sushi station make last month" has to know the
  snapshot can disagree with the category's *current* station. Not a
  concern this phase has a reader for yet.
- A `router.refresh()` per event re-renders the whole board rather than
  patching one card. Accepted as the simpler, correct-by-construction choice
  at kitchen-order volumes; revisit only if a real board is ever shown to be
  too busy for it, which no phase has observed.

**Deferred**

- Per-product station override, if a business ever needs one product routed
  differently from its category.
- Any Realtime use beyond "please refetch" — Broadcast/Presence, optimistic
  client state — waits for a screen that actually needs it.
