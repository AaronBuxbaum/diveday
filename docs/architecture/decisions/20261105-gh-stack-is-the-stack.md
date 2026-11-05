# 20261105-gh-stack-is-the-stack — Stacks are made and moved with `gh stack`

- **Status:** Accepted 2026-11-05 — Aaron Buxbaum, in session: "I'm totally okay with gh stack sync's approach. We can change our rule."
- **Date:** 2026-11-05
- **Supersedes:** [20260907-a-runner-registers-the-stack](20260907-a-runner-registers-the-stack.md)
- **Amends:** [20260821-stacked-pull-requests](20260821-stacked-pull-requests.md), [20261003-every-stack-layer-runs-ci](20261003-every-stack-layer-runs-ci.md)

## Context

The runner-side registrar existed because a cloud session could reach no stacks endpoint. Threads now run locally, and GitHub ships `gh stack` over the same endpoints. Our own tooling had grown to about 3,200 lines and worked against how Aaron uses stacks (survey and evidence in issue #3923):

- The registrar refused every fork and commented on 66 pull requests in two weeks, each left unregistered, against Aaron's 2026-11-02 call not to gate stacking.
- GitHub rewrites layers above a merge and locks a registered base, so a merge-commit-only rule and `stack:sync` fought the platform.
- Aaron clicks Merge on the top pull request and the whole stack lands; only the top has to pass CI.

A 2026-11-05 trial of `gh stack` v0.1.0 on throwaway drafts: `init`, `add -Am`, `submit --auto` and `link` run non-interactively and register the stack; `add` refuses any layer but the top, so a stack cannot fork; `rebase` then `push` (force-with-lease) moves it; `merge` is atomic and checks only open and not draft.

## Decision

**Stacks are made and moved with `gh stack`; nothing in this repository registers, warns about or repairs them.**

1. Layers: `gh stack add -Am "<msg>" <branch>`, then `gh stack submit --auto`; adopt existing pull requests with `gh stack link`. Always non-interactive.
2. Branches move by cascading rebase (`gh stack rebase`, `gh stack push`). The merge-commit-only rule is dropped.
3. CI is fixed from the top; lower layers need not pass.
4. Deleted: `stack.yml`, `stack-register`, `stack-warnings`, `stack-sync` (`pnpm stack:sync`), their tests, and the skill's `why.md` and `pipeline.md`. `stack-map.mjs` stays.

## Alternatives considered

- **Keep our registrar and simplify it** (drop the fork comment). Rejected: it still duplicates `gh stack submit`.
- **No stacks, every PR off `main`.** Rejected: loses the one-click merge and brings back shared-file conflicts.
- **Graphite.** Rejected on cost.

## Consequences

Easy: one tool, no fork refusals, no runner job per pull request event. Hard: `gh stack` tracks a stack in local git config, so a stack moves from the clone that holds it; auto-created pull requests have empty bodies, so the position line is a second step. The lost-work warning of #3646 goes with its script; the whole-stack merge removes the side-branch merges that caused it. `scripts/red-below.mjs` still bannered a red layer below; follow-up.

Escape hatch: a stack is still chained-base pull requests and merges bottom-up by hand.
