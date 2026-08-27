# ADR-015 — Money as integers in the minor unit

```text
Status: ACCEPTED
Date:   2026-08-25
Phase:  11 — Catalog
```

## Context

Master section 39 is short and binding:

> Nunca utilizar floating point para dinero. Utilizar estrategia consistente:
> `numeric/decimal` correctamente definido; o unidades monetarias menores
> enteras; **según decisión arquitectónica documentada**.

It offers two options and requires the choice to be written down. The ADR index
had this pencilled in for Phase 13/14, where orders and payments live — but
Phase 11 introduces the first prices in the system, so the decision cannot wait
for the phase that consumes them. A catalogue written against one representation
and an orders module written against another is a migration nobody wants.

Everything downstream inherits this: order lines, discounts, taxes, till
reconciliation, SUNAT documents, reports.

## Decision

**Integers in the currency's minor unit.** S/ 24.90 is stored, passed and summed
as `2490`. Columns are `bigint`. There is no `numeric` money column anywhere and
no `number` holding a major-unit amount.

The currency itself is **not** stored per amount. It lives once per business in
`tenant_settings.currency` (Phase 06). A tenant transacts in one currency, and
repeating the code on every row is a chance for two rows to disagree about
something that cannot actually differ.

`src/lib/money` is the only place that converts:

```text
parseMoney("24.90")   -> 2490      the single entry point from a form
formatMoney(2490)     -> "24.90"   round-trips with parseMoney
formatCurrency(...)   -> "S/ 24.90"
multiplyMoney, sumMoney, percentOfMoney
```

### Why not `numeric(12,2)`

Not because PostgreSQL gets it wrong — `numeric` arithmetic in SQL is exact, and
for a system that only ever computed totals in SQL it would be a fine choice.

The problem is the boundary. PostgREST serialises `numeric` as a JSON number,
JavaScript parses that into a double, and from that point every total the
application computes is floating point. `0.1 + 0.2` is `0.30000000000000004` in
every JavaScript runtime. A till that is one cent out at the end of a shift is a
real problem for a real business, and "always do the arithmetic in SQL" is a
discipline rather than a guarantee — it holds until the first developer adds up
an array of line totals in a React component, which is a completely reasonable
thing to write.

Integers remove the hazard by construction. There is no float to get wrong
because there is no float, at any layer, ever.

### Why `parseMoney` splits the string

`Math.round(Number(value) * 100)` is the obvious implementation and is wrong in
a way that only shows up on some inputs: `Number("8.07") * 100` is
`806.9999999999999`. `Math.round` rescues that particular case, which is exactly
what makes the bug survive review — it works until somebody uses `Math.trunc`,
or multiplies before rounding.

Splitting on the decimal separator never creates a float at all. TEST-1101's
last case is the set of inputs that catch the other implementation.

### Why three decimals is rejected rather than rounded

`24.905` is a typo or a misunderstanding about what a price is. Silently storing
`24.91` hides both, and the business never learns that the system cannot
represent what they typed. Refusing is the honest answer, and the message says
what shape is expected.

### The ceiling

`MAX_CENTS` is 10,000,000,000 — S/ 100 million — enforced by a CHECK on every
money column and by `parseMoney`. That is far beyond any real price or order in
this market, and far below `Number.MAX_SAFE_INTEGER` (about 9.0e15 cents). The
gap is deliberate: thousands of maximum-sized amounts can be added together
without ever leaving the range where a JavaScript integer is still exact.

## Alternatives considered

**`numeric(12,2)` with a strict "arithmetic only in SQL" rule.** Rejected
above: a rule that lives in people's heads is not a guarantee, and the failure
is silent.

**`numeric` in the database, converted to integer cents at the boundary.** Best
of both in principle. Rejected because the conversion point becomes the bug: it
has to be applied in every reader, and a missed one produces a float that looks
right in testing and drifts in production. One representation everywhere is
simpler to hold.

**A `Money` class carrying its own currency.** Correct for a system where one
row can be in a different currency from the next. This is not that system — a
tenant transacts in one currency — so the class would add ceremony to every
value in exchange for modelling a case that cannot happen. If multi-currency
ever arrives, the currency joins the row and this stays an integer.

**Storing more than two decimals for unit prices.** SUNAT's UBL allows unit
prices with more precision than two decimals, which Phase 17 may need for
per-kilo or per-unit pricing on an invoice. Deferred deliberately: the catalogue
prices things in what a customer pays, and a phase that genuinely needs finer
granularity can add a column with its own scale rather than making every price
in the system carry precision it does not use.

## Consequences

- Every money column in every future phase is `bigint` in minor units. Orders,
  payments, discounts and invoices inherit the decision without re-litigating
  it.
- Prices cross the PostgREST boundary as JSON integers, which JavaScript parses
  exactly. Nothing on the way out can turn them into floats.
- Forms hold decimal strings and the database holds integers; `parseMoney` and
  `formatMoney` are the only bridge, and they round-trip.
- Display always needs a currency, which comes from the business rather than the
  amount. The public site reads it through `get_public_business_identity`,
  extended in this phase for exactly that reason — `tenant_settings` still has
  no public policy, because the RUC sits in the same row (ADR-012).
- A future multi-currency requirement means adding a column, not changing the
  representation.
