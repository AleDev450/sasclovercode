# ADR-018 — Payment voiding and the cash ledger

```text
Status: ACCEPTED
Date:   2026-08-27
Phase:  14 — Payments + Cash
```

## Context

Master section 14 gives Phase 14 four sentences and a table list: `payments`,
`payment_methods`, `cash_registers`, `cash_sessions`, `cash_movements`; keep
`Order`, `Payment` and `Invoice` separate; prepare efectivo, Yape, Plin,
tarjeta, transferencia and future gateways.

Phase 13 (ADR-017) already decided how CloverCode records an *event*: a line
owns its price, a trigger computes totals, and a state machine lives in the
database as data the UI can read. Phase 14 inherits that posture directly —
`orders.total_cents` is exact and does not move, which is precisely what a
payment needs to reconcile against — but it is not a re-run of Phase 13. A
payment's own lifecycle has one edge, not eight, and cash introduces something
Phase 13 never had: a *ledger*, where what matters is not one row's status but
a running sum across many rows.

## Decision

### 1. A payment is voided, not transitioned

`payments.voided_at` / `payments.void_reason`, mirroring `orders.cancelled_at`
/ `orders.cancel_reason` exactly, rather than a `payment_status` enum plus a
`payment_transitions` table copying ADR-017 §4's machinery.

`order_transitions` earned its shape because it has eight edges that the
dashboard must read to decide which button to draw, and TEST-1301 needs it
as data to compare against the TypeScript mirror. A payment has exactly one
possible move — `completed → voided` — so there is nothing to read that a
single nullable timestamp does not already say, and nothing for a table of
pairs to test that a CHECK constraint does not already enforce. Building the
Phase 13 machinery here would be process imitating a previous phase's shape
rather than solving this phase's problem — exactly what master section 51
(no complejidad innecesaria) rules out.

`cash_sessions` gets the same treatment: `closed_at` / `closing_cents` rather
than a `cash_session_status` enum. An open session is one whose `closed_at`
is null; there is no third state.

### 2. A payment cannot push an order's paid total past its total

A trigger on `payments` computes what `orders.paid_cents` would become and
refuses the insert if it would exceed `total_cents`. `orders` itself carries
`CHECK (paid_cents <= total_cents)`, so the invariant holds even when the
*other* side moves — Phase 13 allows editing lines on a still-`pending` order
(FR-1315), which can shrink `total_cents` after a payment already raised
`paid_cents`. Without the CHECK on `orders`, that edit would silently leave
an order that owes less than it already collected. With it, the line edit is
the thing that gets refused, which is the correct place to stop: money
already taken is a fact, and a catalogue-side edit does not get to make it
disappear.

### 3. `cash_movements` is a ledger, not a mirror of `payments`

A cash payment does not skip a movement row "because the payment row already
has the amount." It gets one, written by a trigger, because a till's
count at closing time is the sum of a *ledger* — sales, payouts, deposits,
adjustments — and a query that reconstructs that sum by re-deriving it from
`payments` on every close would have to know, forever, every future kind of
cash movement that is not a payment (a payout for petty cash, a deposit from
the safe). Keeping the ledger append-only and separate from `payments` (no
UPDATE, no DELETE — the same posture as `order_status_history`) means closing
a session is one `sum()`, and it stays one `sum()` no matter what gets added
to `cash_movement_type` later.

Voiding a cash payment inserts a compensating `adjustment` row rather than
deleting or editing the original `sale` row, for the same reason Phase 13
never deletes an order: the ledger is a record of what happened, and "this
payment turned out to be a mistake" is itself something that happened.

### 4. Cash payments require an open session; other rails refuse one

`payment_methods.type = 'cash'` requires `payments.cash_session_id` to name
an *open* session on a register at the order's own location. Every other
type requires `cash_session_id IS NULL`.

This is not a modelling convenience, it is what the till actually is: a
count of physical bills in a drawer. A Yape confirmation, a card voucher and
a bank transfer never touch that drawer, so folding them into the same
ledger would make `expected_cents` mean "cash, plus some other things,
depending on what got paid that shift" — a number nobody could sanity-check
against what is actually in the drawer.

### 5. Order status and payment status are independent

No trigger reads `orders.paid_cents` to move `orders.status`, and no trigger
reads `orders.status` to gate a payment (beyond refusing `cancelled`, which
is refusing to add money to something that no longer exists as a sale).

The master doc's instruction for this phase is explicit: `Order`, `Payment`
and `Invoice` "no son la misma entidad." A restaurant that runs a tab marks
an order `completed` (delivered) long before it is paid; a restaurant that
takes prepaid orders collects the full amount while the order still sits in
`pending`, waiting for the kitchen. Coupling the two axes would be encoding
one business's workflow as the platform's rule.

## Alternatives considered

**A `payment_status` enum with a transitions table**, matching Phase 13's
shape one-for-one. Rejected in decision 1: a table earns its existence by
being read and tested as data; with one edge there is nothing there to read.

**Refunds implemented now, as a negative payment.** Rejected: a refund that
matters — money back to a customer for a return — needs a document trail
that ties to what SUNAT will later require (Phase 17's credit notes). A
negative-`payments`-row implemented ahead of that is exactly the "no
desarrollar funcionalidades futuras por adelantado" master section 51 rules
out, and ADR-017 already deferred returns to "Phase 14's payment layer to
mean anything" — meaning the layer existing, not every consequence of it
being built early.

**Deriving `expected_cents` from `payments` at close time instead of a
`cash_movements` ledger.** Rejected in decision 3: it works only as long as
cash movements and payments stay the same set, which stops being true the
first time a business needs to record a payout from the till — a scenario
explicitly named as needing its own row (`cash_movements`) by the master
doc's own table list, not invented by this ADR.

**Driving order status from payment completeness.** Rejected in decision 5,
directly against the master doc's own instruction for this phase.

## Consequences

**Good**

- Voiding a payment is symmetric with cancelling an order: same column
  shape, same "why does the empty field imply this row never happened"
  reasoning, one pattern to learn instead of two.
- `orders.paid_cents` is always trustworthy without a join: Phase 15's POS
  can ask "how much is left to pay" from a single row.
- The till's expected count is one `sum()` over an append-only ledger,
  correct through any future cash-movement kind without touching the
  `payments` table.
- An order's delivery state and its payment state can each tell their own
  true story — tabs and prepayment both work without a special case.

**Bad / accepted**

- A cash sale is two inserts under one trigger (`payments`, then
  `cash_movements`) instead of one. Accepted: the alternative (deriving the
  ledger from `payments` at read time) is the thing decision 3 rejects.
- Voiding is a data-entry correction, not a customer refund. A business that
  needs the latter waits for Phase 17, and is told so in the SPEC's Fuera de
  alcance rather than discovering it by the feature's absence.

**Deferred**

- Payment gateway webhooks (an async Yape/Plin confirmation arriving from a
  provider, rather than typed in by a cashier who already saw it on their
  phone) — `payment_methods.type` reserves the values, nothing calls out to
  one yet.
- Product returns and customer refunds — Phase 17, per ADR-017.
