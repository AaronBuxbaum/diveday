# 20261003-every-stack-layer-runs-ci — Every layer of a stack runs the whole CI gate

- **Status:** Accepted 2026-10-03 — **H-92** (Aaron Buxbaum, in session: "remove the handling we added in the past to skip CI for "middle" PRs of a stack and just have it always run")
- **Date:** 2026-10-03
- **Supersedes:** [20260919-stack-ci-cancels-superseded-layers](20260919-stack-ci-cancels-superseded-layers.md) (the skip and the cancel; its visual-baseline key stays)
- **Amends:** [20260821-stacked-pull-requests](20260821-stacked-pull-requests.md), [20260907-a-runner-registers-the-stack](20260907-a-runner-registers-the-stack.md)

## Context

Work in this repository is built as GitHub stacks of pull requests, never as independent pull requests cut from `main` side by side (AGENTS.md's *Parallel work*, the **stacked-prs** skill, and the owner's restatement on 2026-10-03).

Since ADR [20260827-stack-ci-skips-the-middle-layers](20260827-stack-ci-skips-the-middle-layers.md), and more so since [20260919-stack-ci-cancels-superseded-layers](20260919-stack-ci-cancels-superseded-layers.md), a stack's middle layers ran nothing: every job in `ci.yml` carried a condition on `github.event.pull_request.stack`, and `scripts/stack-cancel.mjs` cancelled a layer's in-flight run the moment a new layer opened above it. The price, stated in both ADRs, was that a middle layer's green meant "nothing ran", and a layer merged out of order landed without its gate. Every reader of a stack had to remember which layers were real.

The owner asked for that handling to be removed so CI always runs.

## Decision

**Every pull request runs the whole `ci.yml` gate, wherever it sits in a stack.**

- The six `stack` conditions in `ci.yml` are deleted. A job's only remaining condition is the nightly scoping (`github.event_name != 'schedule'`) and the existing code/db change detection.
- `scripts/stack-cancel.mjs` and its test are deleted, and `stack.yml` no longer holds `actions: write`. The workflow only registers the chain as a stack.
- `scripts/check-stack-ci-skip.mjs`, the guard that pinned the skip condition, is deleted from `pnpm check:repo`.
- The visual baseline key from the superseded ADR stays: every layer compares against the stack's fork point from `main` (`scripts/reg-suit-keys.mjs`), so no layer waits on another and each layer's visual diff is cumulative.

## Alternatives considered

- **Keep the skip, drop only the cancel.** A middle layer would still read green having run nothing, which is the part the owner objected to.
- **Run the cheap gate on middle layers and skip only `build`/`visual`/`playwright`.** Halves the cost and keeps the confusing half: a layer whose e2e never ran still reads green.

## Consequences

- A stack costs a full gate per layer per push again, which is the cost ADR 20260827-stack-ci-priority first measured. The owner chose that over unrun layers.
- A green check on any layer means that layer was tested, so a stack can be merged a layer at a time or atomically without losing a gate.
- A superseded run on the layer below is no longer cancelled when a layer opens above it; per-ref concurrency still cancels a run superseded by a push to the same branch.
- `stack.yml` holds no grant that can destroy work.
