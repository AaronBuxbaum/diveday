# 20260827-stack-ci-skips-the-middle-layers — A stack's middle layers do not run the expensive gate

- **Status:** Accepted
- **Date:** 2026-08-27
- **Supersedes:** [20260827-stack-ci-priority](20260827-stack-ci-priority.md)

## Context

ADR [20260827-stack-ci-priority](20260827-stack-ci-priority.md), accepted earlier the same day,
reached the right diagnosis and bought it at a price that made it worse than the problem. The
diagnosis stands: a stacked pull request is an ordered chain, every layer pays a sixteen-job gate,
and a five-layer stack asks for eighty-odd concurrent jobs none of which are ordered by what a human
is waiting on. The bottom is the layer that merges next; the top is the one containing everything
beneath it; a middle layer is neither.

What it bought that with was a `stack-priority` job that **held a runner idle for up to forty
minutes** while polling the other layers' workflow runs. The ADR named this honestly — "GitHub
Actions has no way to wait without holding a runner" — and priced it as one runner against eleven
deferred jobs. Watched running, the trade reads differently. On the three-layer stack open on
2026-08-27, the bottom's gate job finished in six seconds and the other two sat occupying runners,
doing nothing, indefinitely. On a five-layer stack that is four of the account's concurrent job
slots held permanently by a mechanism whose entire purpose is to free slots.

Three facts, none of which that ADR had, make the whole apparatus unnecessary:

1. **GitHub puts the layer's position in the event payload.** `github.event.pull_request.stack`
   carries `position`, `size`, `base.ref` and `base.sha`. Verified on the live stack: PR #1057
   `position 1`, #1060 `position 2`, #1065 `position 3`, all `size 3`. The 316-line script existed
   to read three fields that arrive for free, and GitHub's own guidance — *Optimizing CI for stacked
   pull requests* — recommends branching on exactly them.
2. **A job skipped by an `if:` reports as successful to branch protection.** Required status checks
   pass on `success`, `skipped` *or* `neutral`. Only a *workflow*-level skip (path filter, branch
   filter, `[skip ci]`) leaves a check pending and blocks a merge. So the superseded ADR's
   load-bearing sentence — "a layer whose gate never ran cannot merge on its own" — is backwards.
3. **This repository has no required status checks.** The only ruleset on `main` is *No push to
   main*: `deletion` and `non_fast_forward`. Nothing about any check gates any merge today, so the
   premise the yield was built to satisfy does not exist here at all.

Together those turn the choice the previous ADR framed as "yield or be unmergeable" into a plain
question about what a middle layer's green is worth — and that answer is available. Merging is
bottom-up, so a middle layer lands only inside a group the bottom's run or the top's has already
spoken for; and when it *becomes* the bottom, the cascading rebase force-pushes it, which fires
`synchronize` and runs the full gate on it before it is the layer next to merge.

## Decision

**A stack's middle layers do not run the expensive half of CI at all.** The `stack-priority` job,
`scripts/stack-ci-priority.mjs` and its test are deleted. In their place, six job definitions in
`.github/workflows/ci.yml` carry one condition, byte for byte:

```yaml
    if: >-
      github.event_name != 'schedule'
      && (github.event.pull_request.stack == null
      || github.event.pull_request.stack.base.ref == github.event.pull_request.base.ref
      || github.event.pull_request.stack.position == github.event.pull_request.stack.size)
```

| Payload | Meaning | Gate |
| --- | --- | --- |
| `stack == null` | not stacked, or a push to `main` | runs |
| `stack.base.ref == base.ref` | the lowest unmerged layer | runs |
| `stack.position == stack.size` | the top layer | runs |
| otherwise | a middle layer | **skipped** |

`repo-safeguards`, `lint`, `typecheck`, the four unit shards, the four Playwright shards and
`db-surface-changes` carry it. `real-postgres` needs nothing: a skipped `db-surface-changes` leaves
`outputs.changed` empty, which is not `'true'`.

The condition is repeated rather than factored because a job-level `if:` cannot read a
workflow-level `env:` — the `env` context is not available there. `scripts/check-stack-ci-skip.mjs`
(in `pnpm check:repo`) holds the copies identical and requires every job in the workflow to appear
in exactly one of its two lists, so a job added later is classified deliberately rather than by
omission.

### A fork cannot classify itself as a middle layer

The condition reads attacker-influenceable payload data on a public repository, so the failing-open
direction matters. `stack` is populated only for a pull request somebody registered in a stack via
`POST /repos/{owner}/{repo}/stacks`, which requires write access. A fork's pull request — and any
pull request opened against a topic branch without being registered — has `stack == null`, which is
the **run** branch. Every shape the condition does not recognise falls through to the full gate.

### The visual path still runs on every layer

`build`, `visual` and `visual-report` do not carry the condition, for the same reason the superseded
ADR excluded them from its yield, and more sharply: a stacked layer's reg-suit baseline is the head
commit of the layer directly below it (`scripts/reg-suit-keys.mjs`), and the layer above polls S3
for that snapshot (`scripts/wait-for-baseline.mjs`). Deferring publication delayed the layer above;
*skipping* it means the snapshot is never published at all, so the top would time out and report
every surface as new under a reassuring `Changed: 0` — the pipeline's documented worst failure, and
the one AGENTS.md forbids merging on. A middle layer therefore still spends six jobs promptly. The
eleven it no longer spends are the ones that were competing for nothing.

## Alternatives considered

- **Keep the yield, but wait for free with an environment wait timer.** A job held by an environment
  protection rule sits in `Waiting` *before* it is dispatched to a runner — which is why wait-timer
  time is not billable — and `environment.name` accepts an expression from the `github` context, so
  `stack-now` / `stack-top` / `stack-middle` with wait timers of 0, 5 and 15 minutes would have
  reproduced the previous ADR's behaviour at roughly ten runner-seconds. Refused because it keeps a
  mechanism to preserve a guarantee (every layer green before merge) that this repository does not
  currently enforce and did not ask for, and it moves the tuning into repository settings, where no
  file records it. Worth revisiting the day required status checks are switched on.
- **Skip on every layer but the bottom** (drop the top too). Cheaper again, and Graphite offers it as
  a setting. Refused because the top layer's green is the closest thing a stack has to a statement
  about the merged result, and it is what a session building upward is actually reading.
- **Order the whole stack strictly bottom-to-top.** Refused in the superseded ADR for serialising
  the signal most often read, and it is worse here: it needs a wait, which is the thing being
  removed.
- **Do nothing and accept the idle runners.** The status quo as of this morning. It spends a
  concurrent slot per waiting layer, permanently, to avoid a green that nothing reads.

## Consequences

- A middle layer's checks read as **skipped**, not pending. GitHub counts that as success, so if
  required status checks are ever switched on, a middle layer will show green without having run —
  the failure mode to watch, and the reason the environment-wait-timer alternative above is written
  down rather than discarded.
- A layer merged out of order — an atomic `gh stack merge` landing several layers at once — lands
  its middles without their gate. Merging a layer at a time keeps the guarantee, because the
  cascading rebase runs the full gate on each layer as it becomes the bottom.
- The gate stops costing anything: no API call, no `GITHUB_TOKEN`, no `actions: read` /
  `pull-requests: read` grant, no 25 seconds on every unstacked pull request and push to `main`, and
  no runner held. 316 lines of script, its test and a 53-line job are deleted.
- The stacks *preview endpoint* is no longer a dependency; the payload field is. If GitHub withdraws
  or renames it, `stack` reads as `null` on every layer and CI runs in full everywhere — the same
  fail-open direction as before.
- `.claude/skills/stacked-prs/SKILL.md` and AGENTS.md's *Parallel work* both described the yield.
  Both are corrected in the same change.
