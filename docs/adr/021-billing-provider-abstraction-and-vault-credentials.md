# ADR-021 — BillingProvider as an unimplemented abstraction; credentials in Vault

```text
Status: ACCEPTED
Date:   2026-08-27
Phase:  17 — Electronic Billing / SUNAT
```

## Context

Master section 33 (Phase 17) gives this phase two instructions that pull in
different directions if read carelessly:

> Crear capa abstracta: BillingProvider. No acoplar dominio directamente a
> un proveedor... Consultar documentación SUNAT vigente antes de
> implementar.

and, in the standing prohibitions (section 51):

> implementar SUNAT basándose únicamente en memoria.

Read together they say: build the shape a real integration will plug into,
but do not guess at what a real integration looks like. This environment has
no PSE (Proveedor de Servicios Electrónicos) account, no sandbox credentials,
and no way to verify a request against SUNAT's OSE validation layer — so
"consultar documentación vigente" was done as three web searches during
planning (current results, not training-data memory), and what follows is
what that research supports building, not a simulation of an integration
nobody can test.

A second, unrelated problem arrived in the same phase: `billing_provider_configs`
is the first table in the whole project that has to hold a real external
secret (a PSE's API key or certificate). Every credential-adjacent decision
so far (`service_role`, ADR-011; the Vercel API token, ADR-013) has been
"we don't have one yet, so we don't build the thing that would need it." This
phase cannot make that same move for the *schema* — master explicitly asks
for `billing_provider_configs` to exist — but it still applies to what goes
inside it.

## Decision

### 1. `BillingProvider` ships with exactly one implementation, and it calls no API

```ts
interface BillingProvider {
  issue(document: BillingDocumentForProvider): Promise<BillingProviderResult>;
  void(reference: string, reason: string): Promise<BillingProviderResult>;
}
```

`ManualBillingProvider` is the only implementation. `issue()` does not send
anything anywhere: it records that the document was handed off, and returns
`sent`. Actually filing it — through SUNAT's own free **SEE-SOL** portal, or
a PSE's own web console — is done by a person, outside this system, who then
comes back and marks the document `accepted` or `rejected` themselves (a
Server Action, gated by `billing.create`, same shape as
`advanceOrderStatusAction`).

This is not a placeholder standing in for "real" work still to come in this
phase. It is the actual, complete deliverable master section 33 describes:
a business using CloverCode today can track every document it issues, in the
states SUNAT itself uses, with the same idempotency guarantee a real
integration would need — the one thing this phase cannot honestly do is
submit the XML for them, because nothing in this environment can verify that
submission ever worked.

A `NubefactBillingProvider` or similar is a future phase's own decision, made
once real credentials and a way to exercise them exist — the interface is
what makes adding one an addition, not a rewrite.

### 2. The document lifecycle is a transitions table, like `orders`, not a
nullable pair like `payments`

Five real edges: `pending→sent`, `pending→cancelled`, `sent→accepted`,
`sent→rejected`, `accepted→cancelled`. ADR-018 used a nullable pair for
payments specifically because voiding is one edge; this has the same
multi-edge shape ADR-017 gave `orders` its own data table for, and for the
same reasons — the UI needs to read which buttons to draw, and a test needs
to pin the TypeScript mirror (`billing/lifecycle.ts`) against it row for row.
`rejected` is terminal by absence, exactly like `orders.cancelled`: SUNAT
gives a rejected document no tributary validity, and the correct response is
a new, corrected document — not a way to resurrect the old one.

### 3. Idempotency is one partial unique index

`UNIQUE (tenant_id, order_id, type) WHERE status IN ('pending', 'sent',
'accepted')`. Master section 37 names SUNAT explicitly among operations that
must survive a retry safely, and section 47 forbids reaching for
infrastructure (queues, external retry frameworks) without a measured
problem this system actually has. Two concurrent attempts to bill the same
order collide on the index — the same "let the index arbitrate the race"
move Phase 13 used for order numbers and Phase 14 for one-open-cash-session.
Because the index only covers *live* documents, a `rejected` one does not
block the corrected retry SUNAT's own process requires.

A separate `idempotency_key` column (a UUID generated once at creation,
unchanged across retries) exists for the OTHER kind of idempotency a real
provider integration will eventually need: sending the same key on every
retry of the *same* attempt so the provider's own system can deduplicate a
request that succeeded but whose response was lost. The unique index and the
key solve two different races — the caller retrying the whole action, and a
single network call being retried — and both are needed even though only
`ManualBillingProvider` exists today.

### 4. Provider credentials live in Supabase Vault, referenced by id

`billing_provider_configs.credentials_secret_id` is a Vault secret id, not a
`jsonb` column. Writing one goes through a `SECURITY DEFINER` function,
`set_billing_credentials()`, gated by the new `billing.manage` permission —
the same posture ADR-010 established for every privilege-sensitive write in
this project: no `service_role`, a narrow function instead. There is no
matching read function for the raw value; a caller can ask
`has_billing_credentials()` (true/false) and nothing more. A form that
"edits" a saved credential re-enters it — it is never pre-filled from a
decrypted read, so a screenshot of the settings page can never leak one.

Master's own words for this phase — *"Credenciales deben almacenarse de
manera segura. No exponerlas al frontend"* — describe exactly this shape.
`supabase_vault` (encryption at rest, decryption gated by its own access
model) is what a `jsonb` column protected only by RLS cannot give: RLS stops
a *different tenant* or a caller without `billing.manage` from reading the
row, but it does not stop the row's own owner from being able to read back a
value that a compromised session, a support screenshot, or a future
read-adding bug could then leak in plaintext. Vault removes the plaintext
from the row entirely.

### 5. PGlite cannot exercise Vault. This is confirmed, not assumed.

`supabase_vault` is a compiled extension; PGlite's WASM build does not carry
it, and the project's test harness (`src/tests/helpers/database.ts`,
ADR-007) creates only the three bootstrap roles and the `auth` schema shim —
no `vault` schema. Because PL/pgSQL function bodies are not resolved until
first execution, the migration that *defines*
`set_billing_credentials()`/`has_billing_credentials()` applies cleanly
under PGlite regardless (the same lazy-validation fact this project already
relied on in Phase 14 for `cash_movements`' forward reference). What does
**not** work under PGlite is actually *calling* either function — so, unlike
every other table this phase adds, there is no PGlite database test for the
Vault path. It is verified once, by hand, against a real local Supabase
instance (the same Docker procedure Phases 14–16 already used), and that
gap is named here rather than covered by a test that would only prove PGlite
can run SQL text, not that Vault works.

## Alternatives considered

**Building a real PSE adapter now, from documentation alone.** Rejected:
master section 51 forbids exactly this, and an integration nobody can run a
single real request through is a liability dressed as a feature — it would
report success or failure based on assumptions, not observed behavior.

**A payments-style nullable pair for the document lifecycle.** Rejected in
decision 2 — this machine has five edges, not one.

**An external queue/job runner for retry-safety.** Rejected in decision 3 —
master section 47 requires a measured problem before infrastructure like
this, and a unique index fully satisfies "never emit two documents by
accidental retry" at this phase's actual scale.

**Credentials in a `jsonb` column gated only by RLS.** Rejected in decision
4 — RLS protects who can query the row; it does not remove the plaintext
from the row, which is the stronger guarantee "almacenarse de manera segura"
calls for once a real secret exists to protect.

**Skipping `billing_provider_configs` entirely until a real provider is
chosen.** Rejected: master explicitly lists it among the four tables this
phase prepares, and the config table's *shape* (which provider, per-type
series, whether credentials exist) is useful on its own — a business can set
its series numbering today even though nothing sends a request yet.

## Consequences

**Good**

- A business gets a complete, honest system of record for every document it
  issues today, without this project claiming an integration that was never
  actually exercised against SUNAT.
- Adding a real provider later is implementing one interface, not
  redesigning the schema or the permission model.
- A credential, once saved, cannot leak in plaintext through any read path
  this phase adds — including a future bug that adds a careless `SELECT *`.

**Bad / accepted**

- No business can auto-submit a document through CloverCode yet; every
  document still requires a person to actually file it elsewhere and report
  back the result. This is the real, current limitation, stated in the
  SPEC's Known Limitations rather than implied away.
- The Vault path has no automated regression test, only a one-time manual
  verification against real Supabase. A regression here would only be
  caught by hand, not by CI, until a real provider phase revisits this.

**Deferred**

- A real `BillingProvider` implementation, once a PSE relationship and
  sandbox credentials exist.
- Reading a credential back (even masked) for display — nothing has needed
  it yet; `has_billing_credentials()` is enough for every screen this phase
  builds.
