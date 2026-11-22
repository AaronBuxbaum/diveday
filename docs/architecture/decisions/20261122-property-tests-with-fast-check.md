# 20261122-property-tests-with-fast-check — State the safety and money rules as property tests

- **Status:** Accepted
- **Date:** 2026-11-22

## Context

Agents write the code and nobody reads all of it, so a rule that matters has to survive an agent
who breaks it and then edits the example test to match. A handful of hand-picked examples cannot
do that: the same agent chose them. Admission against readiness, readiness failing closed, money
arithmetic, seat capacity, roll-call convergence, nitrox and the departure clock each have a rule
that can be stated in one sentence and attacked with generated inputs.

## Decision

Add `fast-check` 4.10.3 as an exact-pinned devDependency. `src/test/property.ts` wraps it:
`property(name, arbitraries, predicate, { runs })` registers a Vitest test with 300 runs by
default, `FC_RUNS` multiplies them, `FC_SEED` replays one sequence, and a failure prints the shrunk
counterexample and the exact `FC_SEED=<n> pnpm test <file>` rerun command. Shared arbitraries
(`arbDay`, `arbCents`, `arbMoment` anchored on `TEST_FROZEN_CLOCK`, and the card and requirement
shapes) live there too. A property sits in `<module>.properties.test.ts` beside the module it pins
and calls the real function, never a restatement of it. Each property was shown to fail against a
deliberately broken copy of its rule before it landed.

## Alternatives considered

- Keep extending hand-rolled generators like the xorshift fuzz in
  `src/lib/agency-check.fuzz.test.ts`. It has no shrinking, so a failure is a large random case
  someone must minimize by hand, and no standard replay: each such file would grow its own seed
  plumbing. That file is left as it is; it is not migrated.
- More example tests. They cannot catch the case nobody thought of, and the author of a break can
  edit them.

## Consequences

A test-only dependency of about 1 MB, no runtime code. The properties run in the fast `lib` project
(the few in `src/features` in `node`) and cost well under a second per file at 300 runs. A failing
property is a real counterexample, never a flake to retry. Rules that live only in SQL (a payment
status moving forward, the booking transaction's capacity race) are not pinned here; the
real-Postgres suites own them.
