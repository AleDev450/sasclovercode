# ADR-032 — Splitting E2E by what it needs, and a checklist that cannot lie

```text
Status: ACCEPTED
Date:   2026-08-31
Phase:  28 — Production Readiness
```

## Context

Master section 33, Phase 28 is a list of fifteen lines ending in `PASS`. Two of
them could not honestly be written:

```text
E2E             no Playwright, no equivalent, zero tests. Phases 00 and 05 both
                recorded "Owner: Fase 28".
Accessibility   one component test file out of 84. Section 19 asks for keyboard
                navigation, labels, focus, contrast, aria and clear errors, and
                twenty-seven phases wrote `aria-describedby` by hand with
                nothing ever checking a single one.
```

And a third problem, which is about the checklist itself: this project has no
deployed environment and has never run against a real Supabase. Several items
therefore cannot be verified here at all — and a phase whose deliverable is a
list of `PASS` has an obvious way to fail, which is to write them anyway.

## Decision

### 1. The E2E suite is split by what it needs, and part of it actually ran

```text
@standalone   6 tests. Playwright 1.62 + Chromium against `next start`, no
              database. EXECUTED, passing.
@stack        the business flows. Skipped with a printed reason when Supabase
              credentials are absent.
```

The standalone half exists so that at least one end-to-end test is a fact rather
than a plan. It boots the production server, drives a real browser, and asserts
on real responses — so a misconfigured Playwright, a missing browser or an app
that cannot serve a request all fail loudly.

It found two things immediately, which is the argument for it:

- `/api/health` does **not** run dependency-free. Phase 00 built it as a pure
  liveness probe and Phase 24 added a database check, so without Supabase it
  answers `degraded` with a 503. The Phase 07 proxy comment still describes the
  Phase 00 behaviour. Reading a comment is not measuring.
- The Playwright config waited for a 200 from that route and timed out for two
  minutes against a server that was up and answering correctly. Readiness now
  waits on the port, because "the server accepts connections" is the only thing
  true without a database.

### 2. Writing specs that cannot run yet — and why that is not the Phase 09 mistake

Phase 09 declined to write a Vercel adapter it could not test, on the grounds
that an untested integration reporting success is worse than none. These specs
look superficially similar and are the opposite case.

**An integration claims something. A skipped test claims nothing.** It prints
"skipped, needs Supabase", which is exactly true, and it is what somebody runs
the day the stack exists instead of starting from an empty file.

What they are not is verified. Until they run, they are a plan, and the
checklist says `PARCIAL` rather than `PASS` for that reason (KL-2801).

### 3. axe in jsdom, with the contrast rule turned off on purpose

21 accessibility tests run axe over the ten UI primitives and over real forms
with and without errors, plus a static sweep over all 140 components for labels,
`htmlFor` targets, tab order, clickable divs and unannounced errors.

The colour-contrast rule is **disabled explicitly**. jsdom lays nothing out and
computes no styles, so those rules cannot run — they would report zero
violations and look exactly like a pass.

A test that appears to check contrast and does not is worse than no test: it
produces the confidence without the verification. So the rule is off, the reason
is written at the point of the decision, and the checklist says `PARCIAL` for
accessibility rather than `PASS`.

### 4. The sweep found real defects, and one of its own rules was wrong

Two genuine bugs, both invisible on screen:

- `<Label htmlFor="customerId">` in the billing form pointed at an id that did
  not exist. The control is `CustomerPicker`, whose search box carried only a
  `placeholder` — and a placeholder is not an accessible name: it disappears
  when you type and some screen readers never announce it. Somebody using a
  screen reader reached the customer field and heard nothing.
- Five forms displayed field errors that nothing announced.

And one rule of the sweep was itself wrong. It demanded `aria-invalid`
everywhere, which is right for a field error and wrong for a form-level one:
`errors.items` on an order belongs to the list, not to any single input, and
`role="alert"` is the correct answer there. The rule now accepts either and
rejects neither — which is a more precise statement of what section 19 actually
requires, not a relaxation to make a test pass.

A second rule reported six correct components because it conflated
`htmlFor="literal"` with `htmlFor={expression}`. That failure mode — a
well-meaning check that cries wolf — is how a test gets deleted rather than
fixed, so it was made precise instead of loosened.

### 5. The checklist verifies itself

`docs/production-readiness.md` states all fifteen items with `PASS`, `PARCIAL`
or `NO`, and `production-checklist.test.ts` asserts:

- every item has a verdict
- every `PASS` cites how it is checked — a command, a path, or a phase
- every cited path exists
- every non-`PASS` says what is missing, how to close it, and whether it blocks
- the sentence saying the system has never run against its own infrastructure is
  still there

It caught the document within minutes of it being written: the Security row
cited `src/tests/database/security-*.test.ts`, which does not exist. The real
files are `unit/security-posture.test.ts` and `database/rate-limit.test.ts`.

That is the failure this test is for. Not somebody lying — somebody renaming a
file and leaving a claim that outlives the thing it claimed.

### 6. The result is 11 PASS, 4 PARCIAL, and that is the honest answer

Marking the four would have taken one commit and produced a document that reads
better and means nothing. The four say what is missing, what it costs to close,
and whether it blocks a deployment.

Three limitations block production and they are listed apart from the other
~195 open KLs, because a list that does not separate the three that matter from
the rest is a list nobody can act on.

## Alternatives considered

**Ship the E2E specs without running any of them.** The whole suite would have
been a plan. One executed test is worth more than fifty written ones, because it
proves the harness is real.

**Mock Supabase so the E2E suite runs green.** It would have produced fifteen
`PASS` lines and verified nothing about the system the checklist is about. E2E
that mocks its own backend is an integration test with a browser attached.

**Leave contrast enabled and let it report zero.** The number would have looked
like a pass and the checklist could have said `PASS` for accessibility. This is
the single most tempting shortcut in the phase and the one that would have made
the document worthless.

**Mark the four PARCIAL items as PASS.** Considered explicitly, because the
phase is named "Production Readiness" and four amber lines look like failure.
They are not: they are the four things somebody has to do, written down where
they will be read.

## Consequences

- The E2E harness is real, installed and executed. The business flows are one
  `supabase start` away from running rather than one project away from existing.
- Accessibility is checked automatically for the first time, and two real
  defects that had shipped are fixed.
- The production checklist cannot drift from the repository without a red build.
- The project can state precisely what stands between it and production: a
  Supabase project, a deployment, and running the tests that are already
  written. That is a shorter list than it would have been able to produce
  before this phase, and it is true.
