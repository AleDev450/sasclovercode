# ADR-022 — Stock as a view over movements; consumption triggered at order completion

```text
Status: ACCEPTED
Date:   2026-08-27
Phase:  18 — Inventory
```

## Context

Master section 33 (Phase 18) is short, and one sentence in it is the whole
design brief:

> El stock deberá derivarse de movimientos. Evitar simplemente:
> `products.stock = stock - 1` sin trazabilidad.

Every other instruction — the seven tables, the six movement types
(`purchase`, `sale`, `adjustment`, `waste`, `return`, `transfer`), "preparar
multi-location" — follows from taking that sentence literally. What it does
NOT say is when a `sale` movement gets written, even though `recipes`/
`recipe_items` (also required by this phase) only mean something if
completing an order eventually produces one. That gap was put to the user
directly rather than guessed at, because it is exactly the kind of decision
with several defensible answers and a real cost to picking wrong: **at
`completed`** was chosen, over `confirmed` (closer to when a kitchen
actually uses an ingredient, but requires reversing a deduction if the order
is cancelled afterward) and over "no automatic wiring this phase" (leaves
`recipes`/`recipe_items` pointless as tables nothing reads).

## Decision

### 1. Current stock is a `VIEW`, never a stored column

```sql
create view public.inventory_stock_levels as
select inventory_item_id, location_id, sum(quantity) as quantity_on_hand
from public.stock_movements
group by inventory_item_id, location_id;
```

Master's own sentence is the argument: "el stock deberá derivarse de
movimientos" reads most literally as *there is no number sitting at rest
anywhere — the balance IS the sum of the ledger, always*. A trigger-kept
column (the shape this project already uses for `orders.paid_cents`,
`cash_sessions.expected_cents`, `billing_documents.total_cents`) would still
need somewhere to **live**, and a stock balance is inherently a fact about
one **(inventory_item, location)** pair — not a fact about `inventory_items`
alone, because "preparar multi-location" means the same salmon has a
different count at each branch. Storing it would mean either a per-location
column set on `inventory_items` (impossible — the set of locations is not
fixed at table-design time) or an eighth table just to hold a balance,
which is exactly the unrequested infrastructure master section 47 warns
against: the seven tables master names are the complete, closed list, and a
`CREATE VIEW` is not an eighth table — it is a saved query, recomputed from
`stock_movements` on every read, which is the most literal possible reading
of "derived."

`stock_movements` itself carries no UPDATE or DELETE policy, ever — the same
append-only shape as `cash_movements` (Phase 14) and `order_status_history`
(Phase 13) — so the view can never disagree with the ledger it sums: there
is no path by which a movement changes after the fact without a new,
separate movement recording why.

### 2. `purchases` is a receipt, not a purchase-order workflow

A `purchases` row is written at the moment stock physically arrives, and it
never changes state afterward — no `draft → ordered → received` lifecycle,
no cancellation of a purchase. Master asks for the table, not a workflow
around it; inventing one (with its own transitions table, its own guard
trigger) is real scope nobody requested, and — unlike a document lifecycle
SUNAT itself defines (ADR-021) or a payment that can be voided (ADR-018) —
nothing about "goods arrived" is naturally reversible in place. A bad
delivery, an over-order, spoiled stock: all of these are corrected with a
NEW `stock_movements` row (`waste` or `return`), not by rewriting history
that already happened.

There is deliberately no `purchase_items` table, because master's exact
list does not include one. Each line of a purchase is one `stock_movements`
row of type `purchase`, carrying `purchase_id`, `inventory_item_id`,
`quantity`, and `unit_cost_cents` — the ledger row already has everything a
"line item" would need, and inventing a second table to hold the same three
numbers again would be duplicating data the ledger already owns.

`purchases.total_cost_cents` IS a trigger-kept rollup, unlike a stock
balance — the opposite call from decision 1, made for the opposite reason.
A purchase is read as "one row, one total" far more often than a
(item, location) pair is read as "one balance": a purchases listing page
needs a number per row without an aggregate subquery per row, the same
argument that already justifies `orders.total_cents` (Phase 13) and
`billing_documents.total_cents` (Phase 17) as stored, not computed on read.

### 3. Stock consumption from a recipe fires once, at `orders.status =
'completed'`, and never needs to be reversed

`completed` is the one status `order_transitions` (Phase 13) gives no
outgoing edge at all — nothing follows it, and nothing can turn it back into
`cancelled`. Picking that exact point means a cancellation from `pending`,
`confirmed`, `preparing`, or `ready` NEVER interacts with inventory, because
by construction no `sale` movement can have been written yet for an order
that has not reached `completed`. This removes an entire category of
complexity a `confirmed`-triggered design would require (an order cancelled
after ingredients were already "used" would need automatic, and auditable,
reversal — its own trigger, its own edge cases, its own test surface) for a
correctness gain (closer to the literal moment a kitchen touches an
ingredient) the user was asked about directly and did not choose.

The trigger is `AFTER UPDATE OF status ON orders WHEN (new.status =
'completed' AND old.status IS DISTINCT FROM 'completed')`: for every
`order_items` row of the order whose `product_id` names a product with an
active recipe, one `stock_movements` row per `recipe_item`, quantity
`-(recipe_item.quantity * order_item.quantity)`. A line with no product, or
a product with no recipe (or an inactive one), contributes nothing — never
an error, because most menu items in a real business will not have a
recipe defined on day one, and refusing to complete an order over a missing
recipe would make this phase load-bearing for a workflow it should only be
observing.

### 4. Insufficient stock never blocks completing an order

`stock_movements.quantity` is allowed to take a location's balance negative.
Master gives this phase no instruction to check inventory before confirming
or completing a sale, and building that check — which would have to run
inside the same trigger that writes the `sale` movements, and would have to
decide what "not enough" means across a multi-item recipe with partial
availability — is a real, unrequested feature with real operational risk if
its logic is wrong (a false "out of stock" blocking a sale is worse for a
running restaurant than a stock count that goes negative and gets corrected
later with a `waste`/`adjustment` movement once someone actually counts the
shelf). The negative balance itself is the signal a future reporting phase
can surface; this phase's job is only to make sure it is never silent.

### 5. `recipe_items.quantity` is always in its `inventory_item`'s own unit

No unit conversion (kg↔g, l↔ml) exists anywhere in this phase. An
`inventory_item` is defined once with one `unit_id`; every `recipe_item`
that references it, and every `stock_movements` row that touches it,
expresses its quantity in that same unit. Converting between units is a
real feature (and a real source of rounding bugs) nobody has asked for —
skipping it by construction, rather than building and testing a conversion
table nobody uses yet, is the smaller and more honest system.

### 6. `units` is a tenant-scoped table, seeded by default

Mirrors `payment_methods` (Phase 14): a business can rename, add, or
deactivate its own units, and `create_tenant_defaults()` (extended a
fourth time, after `tenant_settings`/`tenant_themes`/`tenant_seo`,
`locations`, and `billing_provider_configs`) seeds `kg`, `g`, `l`, `ml`,
`unidad` for every tenant automatically — nobody visits a setup screen
before recording their first inventory item.

## Alternatives considered

**A materialized stock-balance table, trigger-kept like `orders.paid_cents`.**
Rejected in decision 1 — it would be an eighth table outside master's exact
list, for a balance that a `VIEW` already computes correctly on every read
with no risk of drifting from its own ledger.

**A `purchases` state machine (draft/ordered/received/cancelled).** Rejected
in decision 2 — master asks for the table, not a workflow; a receipt that
already happened is corrected with a new movement, not by rewriting itself.

**Triggering consumption at `confirmed` instead of `completed`.** Presented
to the user as the more "realistic" option; not chosen, specifically
because of the reversal complexity it would add for every subsequent
cancellation — see decision 3.

**Blocking order completion when a recipe's ingredients are insufficient.**
Rejected in decision 4 — unrequested, and risky in the specific way a false
positive would be (refusing a real sale over a possibly-stale count).

**A unit-conversion table, letting `recipe_items` use a different unit than
its `inventory_item`.** Rejected in decision 5 — real, unrequested scope,
and every use in this phase is satisfied without it.

## Consequences

**Good**

- Stock can never silently drift from what actually happened: the view IS
  the ledger, summed, with no second place a bug could leave stale.
- A cancelled order — at any point before `completed` — never needs
  inventory-side cleanup, because it never touched inventory in the first
  place.
- Adding a low-stock report, a reorder alert, or a stock-check-before-sale
  feature later is additive: none of them require changing how a movement
  is written today, only reading `inventory_stock_levels` differently.

**Bad / accepted**

- `inventory_stock_levels` is an aggregate query on every read, not an
  indexed point lookup. At the volumes a single restaurant's inventory
  produces (dozens of items, a few hundred movements a day) this is not a
  measured problem; if it ever became one, the fix is an index on
  `stock_movements (inventory_item_id, location_id)`, not a schema change.
- A kitchen can oversell an ingredient that ran out mid-shift with nothing
  stopping the sale in the moment — the same trade-off master leaves
  `orders` itself with today (nothing checks inventory before confirming a
  sale). Named here as a real, current limitation, not implied away.
- Stock consumed by a recipe is only ever recorded once an order reaches
  `completed` — a kitchen watching a live stock number mid-shift will see
  it fall behind actual usage until orders are marked delivered, not the
  instant food is plated.

**Deferred**

- A low-stock / reorder-point report, once a phase actually asks for one.
- Any stock-availability check before an order is confirmed or completed.
- Unit conversion, if a business ever needs `recipe_items` in a unit other
  than the one its `inventory_item` was defined in.
