# 20261015-coverage-and-mutation-testing — Measure the safety files with coverage-v8 and Stryker

- **Status:** Accepted
- **Date:** 2026-10-15

## Context

The 2026-10-14 test review found no coverage tool and no mutation testing: whether the suite pins
the safety-critical modules was estimated from imports, and the 170+ readiness cases had never
been checked for whether they assert anything. The owner approved both as dev dependencies
(review decisions 6 and 7). Reachability across `src/lib` and `src/db` is near total, so a blanket
coverage target would measure the wrong thing; the gap is in branches and assertions on a short
list of files that decide boarding, permissions and money.

## Decision

- **`@vitest/coverage-v8`** (pinned to the installed Vitest version), configured in
  `vitest.config.ts` for eleven safety files only and off unless `--coverage.enabled`. CI's four
  unit shards record it into their blob reports; the `coverage-floors` job merges them with
  `vitest --merge-reports` (no second test run) and `scripts/coverage-floors.mjs` holds each file
  to its branch-coverage floor in `scripts/coverage-floors.json`. A floor only rises: `--write`
  banks a rise and refuses a fall; `--absorb "<why>"` records a fall with its reason.
- **`@stryker-mutator/core` and `@stryker-mutator/vitest-runner` 9.6.1**, run by
  `.github/workflows/mutation.yml` (weekly once the blocker below is fixed), one module per leg, starting with `src/lib/readiness.ts`
  and `src/lib/trip-admission.ts`. `scripts/mutation-issues.mjs` files the survivors as one
  `needs-triage` issue per module, in the follow-up format, and closes it when none survive. It
  never runs on a pull request and never fails one. Stryker loads `stryker.vitest.config.ts`: the
  `lib` project's pure files only, because the runner forces the threads pool, which the PGlite
  files cannot use. 9.6.1 rather than 10.0.0 because 10 brings Babel 8 into the tree, which Sentry's
  bundler plugin does not accept as its peer.

## Alternatives considered

- **A whole-tree coverage threshold** — mostly measures reachability; it would gate noise.
- **Coverage in a separate CI run** — doubles the unit minutes; the blob merge reuses the shards.
- **Mutation testing on pull requests** — minutes of reruns per module; a weekly finding is enough.

## Consequences

- The unit shards pay v8 coverage collection and upload a blob each. A new untested branch in a
  safety file fails `coverage-floors`; the fix is a test, or an absorbed fall with a reason.
- The list is derived (`scripts/coverage-safety-files.mjs`); a new matching file needs a `--write`.
- **Blocker found by the trial run:** under Vitest 5 every in-function mutant "survives" with its
  tests green (trip-admission 7.5%, all 13 kills module-level), though forcing one on by hand fails
  16 tests. The schedule stays off and no survivor issue is filed until a run kills an in-function
  mutant; the runner fault is #2622.
- Equivalent mutants will appear in the issues and need a human to call them; that is the cost of
  the signal.
- Revisit if the weekly issues go unread for a month (drop the workflow and the two packages), or
  when the next modules (`waivers`, `authz`, `roll-call`, `trips`, `deposits`) are added. Leaving
  costs two configs, two scripts, a workflow and a CI job.
