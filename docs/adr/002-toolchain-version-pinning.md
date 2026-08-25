# ADR-002 — Toolchain version pinning: track Next.js, not `latest`

```text
Status: ACCEPTED
Date:   2026-08-24
Phase:  00 — Foundation
```

## Context

`CLOVERCODE_MASTER.md` section 4 requires checking current official
documentation instead of assuming an old implementation is still valid. On
2026-08-24 the npm registry published:

| Package       | `latest` |
| ------------- | -------- |
| `next`        | 16.3.2   |
| `react`       | 19.2.8   |
| `typescript`  | 7.0.2    |
| `eslint`      | 10.9.1   |
| `tailwindcss` | 4.3.3    |
| `zod`         | 4.4.3    |

Taking `latest` everywhere would have produced a broken toolchain:

- **TypeScript 7.0.2** is outside the range that `typescript-eslint@8.68.0`
  supports (`>=4.8.4 <6.1.0`). `typescript-eslint` is a direct dependency of
  `eslint-config-next@16.3.2`, so TS 7 breaks type-aware linting.
- **ESLint 10.9.1** is not accepted by three plugins that `eslint-config-next`
  ships with — `eslint-plugin-import`, `eslint-plugin-react` and
  `eslint-plugin-jsx-a11y` all cap at `^9`. Installing it leaves npm reporting
  `invalid` peers across the tree.

The official `create-next-app@16.3.2` template pins `typescript: ^5` and
`eslint: ^9` — that is the combination Next.js actually tests.

## Decision

**The Next.js release we run defines the supported window for its own toolchain.**
We take the newest version of each package that is _inside_ that window, not the
newest version that exists.

Concretely for Phase 00:

| Package         | Pinned    | Why not `latest`                                      |
| --------------- | --------- | ----------------------------------------------------- |
| `next`          | `16.3.2`  | exact pin; the framework defines the window           |
| `react`         | `19.2.8`  | exact pin; must match what Next.js was built against  |
| `typescript`    | `^5.9.3`  | TS 7 unsupported by `typescript-eslint@8`             |
| `eslint`        | `^9.39.5` | ESLint 10 unsupported by `eslint-config-next` plugins |
| everything else | `^latest` | no conflict                                           |

`next` and `react` are pinned exactly (no `^`); everything else uses a caret.

A green `npm ls` with zero `invalid` peers is a release criterion, not a nice to
have.

## Alternatives considered

| Alternative                               | Why rejected                                                                                                 |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Take `latest` for everything              | Broken type-aware lint and an invalid peer tree from day one.                                                |
| Take `latest` + `--legacy-peer-deps`      | Hides the conflict instead of resolving it; the incompatibility is real, not a metadata artefact.            |
| Take `latest` + drop `eslint-config-next` | Loses the Next.js-specific rules (`no-img-element`, `no-sync-scripts`, RSC boundaries) that catch real bugs. |
| Pin every dependency exactly              | No patch-level security fixes without a manual bump. Too rigid outside the framework core.                   |

## Consequences

**Positive**

- `npm ls` reports no invalid peers.
- Lint, typecheck and build agree on one TypeScript version.
- Upgrades follow one trigger: a Next.js major/minor moves the window.

**Negative**

- We run one major behind on TypeScript and ESLint. Accepted: correctness of the
  toolchain outweighs having the newest compiler.
- ESLint 9.x carries an npm deprecation notice. `9.39.5` is the `maintenance`
  dist-tag and still receives fixes, so this is cosmetic.

## Upgrade triggers

Re-evaluate this ADR when **either** happens:

1. `eslint-config-next` bumps `typescript-eslint` to a version accepting
   TypeScript 7 -> move to TypeScript 7.
2. `eslint-config-next` bumps `eslint-plugin-import` / `-react` / `-jsx-a11y` to
   versions accepting ESLint 10 -> move to ESLint 10.

Verify either with:

```bash
npm view eslint-config-next dependencies
npm ls eslint typescript
```
