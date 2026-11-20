# 20261105-ci-runs-on-the-top-of-the-stack — Only the top layer of a stack runs CI

- **Status:** Accepted 2026-11-05 — **H-20261105-ci-on-the-stack-top** (Aaron Buxbaum, in session)
- **Date:** 2026-11-05
- **Supersedes:** [20261003-every-stack-layer-runs-ci](20261003-every-stack-layer-runs-ci.md)
- **Amends:** [20261105-gh-stack-is-the-stack](20261105-gh-stack-is-the-stack.md)

## Context

The account has a fixed number of concurrent runners, and Aaron merges a whole stack from its top. Running the gate on every layer spread that capacity across pull requests, so each took longer to finish, and one failure at the top could make the rest of the work irrelevant.

## Decision

**Only the top layer of a stack runs CI.** A first job, `stack-gate` (`scripts/ci-stack-gate.mjs`), reads the repository's stacks and answers `run=false` for any layer below the top; `changes` and `repo-safeguards` honour it, and every other job is skipped through its `needs`. `ci-result` always runs: on a lower layer it passes at once with a summary naming the layer that runs, because main requires the `CI result` check and a skipped one left every layer under the top unmergeable (2026-11-20). The layer is untested, not tested; the real verdict is the top's. A pull request in no stack runs as before. The gate also names the stack's **diff base**, the bottom layer's base sha, and change detection, the fast lane, the PR-body check and the untested-logic warning diff against it, so infra, migration and safety changes in a lower layer are seen by the top's run (the migration and closing-keyword guards and the visual keys already used the default branch). The gate is fail-open: an API error, or a chained base that never registers (it waits up to a minute), runs CI. A new layer opened above makes the old top a lower layer, so its next run is skipped.

## Alternatives considered

- **Run every layer** (the 2026-10-03 rule). Rejected: it is the slice this ADR removes.
- **Cancel lower runs after they start.** Rejected: needs `actions: write`, the grant ADR 20261003 removed, and wastes the minutes anyway.
- **A `labeled` trigger to force a lower layer.** Rejected: every label change would start a run in the same concurrency lane and cancel the one in flight. The `ci-now` label is read live by the gate instead; add it and re-run the skipped run (or push).

## Consequences

Cheaper and faster for the layer that matters. A lower layer shows a passing `CI result` and skipped jobs, so a merge "up to a lower layer" has no CI of its own behind it unless it carries the `ci-now` label, read live by `stack-gate`: add it, then re-run the skipped run or push. A run already in flight on the old top continues until its next push or a newer commit supersedes it.
