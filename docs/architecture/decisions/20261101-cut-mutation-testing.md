# 20261101-cut-mutation-testing — Cut mutation testing until the Vitest 5 runner works

- **Status:** Accepted
- **Date:** 2026-11-01
- **Supersedes:** the Stryker half of [20261015-coverage-and-mutation-testing](20261015-coverage-and-mutation-testing.md); its coverage-floor half stands

## Context

The 2026-10-15 decision added Stryker for the pure safety modules, run weekly. Its own trial found
that under Vitest 5 the runner never switches on a mutant inside a function, so every such mutant
survives with its tests green (trip-admission scored 7.5%, all 13 kills module-level; issue #2622).
The schedule was therefore never turned on: the workflow, its config, the issue filer and two
dev dependencies ran nowhere and produced no signal, and a manual run would have filed noise.

## Decision

Delete the `Mutation testing` workflow, `stryker.config.mjs`, `stryker.vitest.config.ts`,
`scripts/mutation-issues.mjs` and its test, the `workflow-alert.mjs` entry for the workflow, the
`test:mutation` script and the two `@stryker-mutator` dev dependencies. The coverage floors
(`@vitest/coverage-v8`, `coverage-floors` in `ci.yml`) are unchanged.

Reopen when the Stryker Vitest runner can kill an in-function mutant under the Vitest major we
run. The check is concrete: force one known in-function mutant on and see its test fail. Then
write a new ADR; do not restore the deleted files from this one.

## Alternatives considered

- **Keep the dormant workflow** — it asserts a safety check that does not exist.
- **Switch the runner to the command runner** — reruns the whole suite per mutant; far too slow.

## Consequences

- Branch coverage floors are the only automated measure of how well the suite pins the safety files.
- Assertion quality in those files is checked by review (`dive-domain-expert` runs), not a score.
- Cost to come back: re-add two dev dependencies, a config and a workflow, about a day.
