# 20261122-diff-mutation-testing — Drill the changed money and safety lines on every pull request

- **Status:** Accepted
- **Date:** 2026-11-22
- **Supersedes:** the Stryker half of [20261015-coverage-and-mutation-testing](20261015-coverage-and-mutation-testing.md) and the cut in [20261101-cut-mutation-testing](20261101-cut-mutation-testing.md)

## Context

Nobody reads agent-written code, so "would a test notice if this line broke?" needs a machine
answer. The Stryker trial failed because no in-function
mutant ever switched on under Vitest 5 (#2622). The cause, found while building this: Vitest 5's
`fsModuleCache` serves a module transformed earlier, keyed by the file on disk, so mutated text
never reached a test. Measurements are in the PR that lands this.

## Decision

- **Engine** (`scripts/mutation/engine.mjs`): parses with `oxc-parser` 0.152.0 (dev dependency,
  already in the lockfile) and splices small breaks into the source: comparisons,
  and/or, arithmetic, negation, literals, conditions, skipped calls, `return undefined`,
  `some`/`every`, `Math.min`/`max`. Never in types, imports, directives, tagged templates, object
  keys, `as const`/`satisfies` targets or logging calls. A break that does not parse is dropped.
  `// mutation-ok: <reason>` (8+ characters) exempts a line and is listed; a bare one fails.
- **Switch** (`scripts/mutation/vite-plugin.mjs`, `vitest.mutation.config.ts`): one Vitest process
  per break; Vite is handed the broken text for the target and `fsModuleCache` is off. Nothing on
  disk changes, so four breaks run at once. `scripts/mutation/run.test.mjs` proves an in-function
  `>=` → `>` is caught when a test pins it and survives when none does.
- **Scope** (`scripts/mutation/scope.mjs`): the coverage safety files plus money files. The tests
  run are those that import the file (directly or through a re-export door) and its colocated
  tests, never Postgres or guard files. A red unbroken baseline stops the run.
- **Pull requests**: ci.yml's `mutation-diff` drills changed lines only, at most 150 breaks in 20
  minutes, sampled deterministically by head commit. A survivor fails the job while
  `scripts/mutation/policy.json` sets its class to `block`; `warn` reports. Both start at `block`
  pending the owner's call.
- **Weekly** (`mutation.yml`): every line of each file in `scripts/mutation/floors.json`, its score
  held to a floor that only rises.

## Alternatives considered

- **Restore Stryker** — the cut forbids it, and its switch is what failed; this one is 30 lines.
- **Stryker's command runner** — the whole suite per mutant; far too slow.
- **Whole files on pull requests** — minutes spent on lines the change never touched.

## Consequences

- Cost: about two seconds of wall time per break on four cores for a pure `src/lib` file
  (trip-admission: 118 breaks in 227 s); a
  pull request pays at most 20 minutes.
- Accepted risk: a set of breaks is a sample, not a proof. Equivalent breaks need `mutation-ok`; a
  capped or time-boxed run says so and claims nothing it did not try. Only direct importers run, so
  a break caught only by a distant test reads as a survivor.
- Revisit if survivors are routinely marked `mutation-ok` instead of tested, or runs keep hitting
  the time box. Leaving costs a dev dependency, a directory, a config, a CI job and a workflow.
