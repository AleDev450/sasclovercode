# ADR-019 — POS calls Server Actions as RPCs; the cart is ephemeral

```text
Status: ACCEPTED
Date:   2026-08-27
Phase:  15 — POS
```

## Context

Master section 33 (Phase 15) is unusually strict for how little it asks to be
built:

> Construir POS utilizando el mismo backend... No duplicar lógica de
> pedidos. POS deberá utilizar `orders`.

Every Server Action written so far — Phase 06 through 14 — is called the same
way: a `<form action={serverAction}>` wired to `useActionState`, one
submission, one page-level result. A POS screen cannot work that way. A sale
is one continuous interaction — build a cart, pick a customer, take one or
more payments, print — and inserting a full page transition (or even just an
`useActionState` reset) between "the order now exists" and "now charge it"
would be exactly the kind of friction a till exists to avoid. This needed a
decision, because the obvious cheap answer — build a `posCheckoutAction` that
re-implements order creation for this one screen — is precisely what section
33 forbids.

## Decision

### 1. `createOrderForPos` shares one insert path with `createOrderAction`

`orders/server/actions.ts` gains an unexported helper carrying the actual
work `createOrderAction` already did (insert `orders`, insert `order_items`,
translate the database's refusal into a message). `createOrderAction` keeps
calling it and keeps returning the shared `FormState` the rest of the
codebase depends on — behaviour identical to before this phase.

A second, newly exported function, `createOrderForPos(tenantSlug, formData)`,
calls the **same** helper and returns a shape POS actually needs:
`{ status: "success", orderId, orderNumber } | { status: "error", ... }`.

The alternative — giving `FormState` an optional `orderId` field so
`createOrderAction` could serve both callers — was rejected: `FormState` is
shared by every form in the project (`src/lib/forms/state.ts`'s own comment
says so), and widening it for one caller's convenience is exactly the kind of
"modificar arquitectura sin justificar" master section 51 warns against. One
helper, two return shapes, is a smaller and more honest change than one
return shape stretched to cover two purposes.

### 2. POS calls actions directly, not through a `<form>`

`src/modules/pos/components/checkout-panel.tsx` builds a `FormData` object by
hand and does `await createOrderForPos(tenantSlug, formData)`, then, for each
tender line, `await recordPaymentAction(IDLE_FORM_STATE, formData)` — plain
async calls from a client component's event handler, with `useTransition` for
the pending state.

This works because a Next.js Server Action is an ordinary async function; the
`(prevState, formData) => FormState` shape every other action in this
codebase uses is a convention for `useActionState` compatibility, not a
constraint the runtime imposes. Nothing about `"use server"` requires a
`<form>` in front of it.

`recordPaymentAction` needed **no changes** for this. It already accepts
exactly what POS has once step 1 returns: an `orderId`, a `paymentMethodId`,
an `amount`, and — for a cash tender — a `cashSessionId` from the same open
sessions Phase 14 already exposes. The guard rails Phase 14 built (the
overpay cap, the cash/session rule) apply identically regardless of which
screen the request came from, which is the entire point of Phase 14 putting
them in the database rather than in a Server Action's own `if` statements.

### 3. The cart is client-side `useState`, and stays that way

No draft-order table, no `localStorage`, nothing written before the cashier
actually checks out. An order only starts existing, in `orders`, at the
moment `createOrderForPos` succeeds — exactly the same moment it would exist
if the same items had been entered through the plain `/pedidos` form.

A "draft order" concept would be new state this phase has no requirement to
justify, and would immediately raise the questions Phase 13 already resolved
for a _real_ order — can a draft be seen by another cashier, does it expire,
does it collide with the correlative — for a screen that does not need any of
that. Losing an in-progress cart on a refresh is a real cost, accepted and
named rather than solved (see the SPEC's Known Limitations).

## Alternatives considered

**A dedicated `pos_orders` staging table**, converted to a real order at
checkout. Rejected: this is the parallel order-creation path section 33
explicitly forbids, dressed up as a draft.

**Reimplementing the insert in a `posCheckoutAction`.** Rejected for the same
reason, more directly — it is a second copy of exactly the logic ADR-017 put
one authoritative version of in the database and one caller of in
`createOrderAction`.

**Widening `FormState` with an optional `orderId`.** Rejected in decision 1.

**Keeping `<form>`/`useActionState` and using `router.refresh()` between
steps.** Would work, but turns a single sale into a sequence of page-level
transitions for no benefit — the very friction a till screen exists to
remove — and Server Actions already support being called directly.

## Consequences

**Good**

- Order creation has exactly one implementation, called from two places with
  two different needs. A bug fixed in one is fixed in both.
- `recordPaymentAction`'s invariants (the overpay cap, the cash/session rule)
  protect POS automatically; POS's own code has nothing to get wrong about
  them.
- The pattern of calling a Server Action directly, without a `<form>`, is now
  precedented once, with the reasoning written down — Phase 16 (a live
  kitchen display) will want the same shape and can point here instead of
  re-deriving it.

**Bad / accepted**

- A cashier who refreshes mid-sale loses the cart. No confirmation dialog
  guards against it in this phase.
- Because payments are sent as a sequence of independent
  `recordPaymentAction` calls, a POS checkout with three tender lines where
  the second fails leaves the order **partially paid**, not rolled back —
  which is the correct outcome (the first payment genuinely happened), but
  the screen has to say so clearly rather than presenting checkout as one
  atomic step. See the SPEC's Manejo de errores.

**Deferred**

- Any persistence for an in-progress sale (so a crashed tab doesn't lose a
  half-built cart) — no phase has asked for it yet.
