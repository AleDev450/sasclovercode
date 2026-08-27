# ADR-017 — Order snapshots and the state machine in the database

```text
Status: ACCEPTED
Date:   2026-08-27
Phase:  13 — Orders Core
```

## Context

Master section 33 gives Phase 13 two instructions that are unusually specific
for that document:

> Los precios del pedido deben guardarse como snapshot.
> Nunca depender del precio actual de `products` para calcular pedidos
> históricos.

and

> Estados definidos mediante state machine clara.
> Evitar cambios de estado arbitrarios.

Both need a decision recorded, because both have an obvious cheap implementation
that satisfies the sentence and not the intent: a JOIN "for now", and an `if`
inside a Server Action.

The deeper fact shaping this phase: `orders` is the first table in CloverCode
that records an **event** rather than a setting. Everything before it was
correctable — a wrong price is fixed and leaves no trace. From here, the system
has to answer "what did we sell on Tuesday?" with an answer that does not change
depending on when it is asked.

## Decision

### 1. The line owns its price. The catalogue is a pointer.

`order_items` stores `name_snapshot`, `unit_price_cents`, `quantity`,
`discount_cents`, `tax_cents` and `total_cents`. `product_id` is **nullable**
and `ON DELETE SET NULL`.

That nullability is the decision, not an oversight. It states that the line does
not need the product for anything: the pointer exists so a report can ask "how
many times did we sell this", and if the catalogue entry disappears the line is
still exact — it merely stops being attributable.

The failure this prevents is silent, which is why it needed a decision rather
than a convention. A line that reads its price through a JOIN works perfectly
until somebody raises a price, and then every order ever placed reports a total
that was never charged. Nothing errors. The reports are simply wrong,
retroactively, and nothing in the data shows they were ever right.

So TEST-1307 does not check that a total is correct when created. It creates an
order, **changes the product's price**, and asserts the order did not move.

### 2. The snapshot is taken by the database, not by the form

`snapshot_order_item()` runs `before insert` and copies the name and price from
`products` / `product_variants`.

This is a security decision as much as an integrity one. Accepting a price from
a form is the classic shopping-cart vulnerability: whoever controls the browser
controls what they pay. And validating a submitted price against the catalogue
in the Server Action does not help — if the server already knows the correct
price, the form field contributes nothing but an attack surface.

So there is no price field anywhere in `src/modules/orders/schemas.ts`, and
TEST-1305's first assertion is the **absence** of one. A price field added later
"for convenience" is the vulnerability walking back in, and an absence has to be
pinned down or it returns.

The discount does come from the caller: it is a decision the business makes, not
a fact about the catalogue. It is bounded by `order_items_discount_within_gross`.

### 3. Totals are computed by the database, on write

A trigger recomputes `orders.subtotal_cents`, `discount_cents`, `tax_cents` and
`total_cents` from the lines on every insert, update and delete.

Not by the application, because the application is not the only writer — Phase
15 brings a POS, Phase 19 a courier app — and two writers each computing a total
independently is two totals that eventually differ by a cent nobody can explain.

Not as a view or an aggregate computed on read, because an order is read far
more often than written, and Phase 14 needs `total_cents` to be a stored value
it can compare payments against.

### 4. The state machine is a TABLE, and the trigger reads it

`order_transitions` holds eight rows. `guard_order_status_change()` refuses
anything not in it.

A table rather than a `CASE` inside the trigger, for three reasons:

```text
It can be READ.    The dashboard asks which buttons to draw, so the UI cannot
                   offer a transition the backend refuses.
It can be TESTED   as data: TEST-1301 compares it against the TypeScript
                   mirror row for row.
It can be CHANGED  by an INSERT in a migration, reviewable on its own, rather
                   than by an edit buried in a procedure.
```

`completed` and `cancelled` are terminal by **absence** from the left column —
so TEST-1313 checks the absence rather than trusting it.

The machine has no `tenant_id`. The lifecycle of an order belongs to the
product, not to each business: a tenant does not get to invent a path from
`completed` back to `pending`. That makes it the second table in the project
allowed a `using (true)` read policy, alongside the Phase 03 capability
catalogue — and the project-wide invariant test in `isolation.test.ts` was
extended with that justification rather than weakened.

### 5. Cancelling is not updating

`orders.cancel` is a separate permission from `orders.update`, checked by a
separate Server Action, and `advanceOrderSchema` refuses `cancelled` outright.

A cook holds `orders.update` and moves food along. Voiding a sale is a different
decision, and inferring it from "which fields changed" would mean the permission
depends on the shape of a request rather than on what is being done.

### 6. The order number is per tenant, and a race is resolved by the index

`assign_order_number()` takes `max(number) + 1` scoped to the tenant. Two
cashiers racing produce a unique-violation on `(tenant_id, number)`; the caller
retries.

A global `bigserial` would number tenant A's orders 1, 5, 9 while tenant B took
2, 3, 4 — which looks broken on a ticket and leaks how much other businesses on
the platform are selling. Taking a lock instead of allowing the race would
serialise every order of every tenant behind one another.

## Alternatives considered

**A JOIN to `products` for price, "until reporting needs it".** Rejected: this
is the exact failure section 33 names, and it is unrecoverable — once orders
exist with no stored price, the historical prices are gone.

**Storing the price but computing line totals on read.** Rejected: a rounding
rule applied at read time can change with the code, so two readings of the same
order could differ. Storing `total_cents` fixes the arithmetic at the moment of
sale.

**A `numeric(12,2)` for money here, since PostgreSQL sums it exactly.**
Rejected: ADR-015 settled this. PostgREST serialises `numeric` as a JSON number
and JavaScript parses it into a double. `quantity` is the one `numeric` in the
phase and it is not money.

**The state machine as application code.** Rejected in decision 4.

**Enforcing the machine only in the Server Action, with the trigger as a
"backstop".** Rejected as a distinction without a difference: if the trigger is
correct, the application check is a UX affordance, which is what
`lifecycle.ts` already is.

**Computing `tax_cents` here at 18% IGV.** Rejected: whether something is
affected by IGV, and whether the price already includes it, is Phase 17 with
SUNAT's rules in hand. The column exists and travels into the total, holding
zero, so the snapshot section 33 asks for is complete without inventing a fiscal
rule (section 51).

## Consequences

**Good**

- A historical order is immune to every later change in the catalogue, including
  the product being deleted.
- No code path anywhere accepts a price from a client.
- An order's lifecycle is one artefact, readable by the UI and enforced by the
  database, and the two are pinned together by a test.
- `orders.total_cents` is a stable, stored number Phase 14 can reconcile
  payments against and Phase 17 can invoice.
- The customer purchase history Phase 12 could not provide (its KL-1209) is now
  a query away: the index exists.

**Bad / accepted**

- The line duplicates the product's name and price. That is the point, but it
  means a typo corrected in the catalogue does not correct past orders — which
  is correct behaviour that will occasionally be reported as a bug.
- The state machine is written twice. TEST-1301 is what makes that safe, and it
  must never be deleted.
- The order number can collide under concurrency and needs a retry. The retry is
  not yet automatic (KL-1304).
- Totals recompute per row rather than per statement, so a hundred-line order
  does a hundred small updates to one row. Acceptable at this size; noted as
  KL-1303.

**Deferred**

- Refunds and partial returns need Phase 14's payment layer to mean anything.
- Editing a confirmed order is deliberately impossible; if a business needs it,
  the answer is likely a credit note (Phase 17), not a mutable order.
