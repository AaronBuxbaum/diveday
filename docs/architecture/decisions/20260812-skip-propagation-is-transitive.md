# 20260812-skip-propagation-is-transitive — Wrap every `needs:`-downstream job's `if:` in `always()`, not just the first one

- **Status:** Accepted
- **Date:** 2026-08-12
- **Amends:** [20260811-deploy-gate-runs-fresh-diff](20260811-deploy-gate-runs-fresh-diff.md) — its
  Decision explains `deploy`'s `needs.diff.result == 'success'` clause as being about replacing the
  default success-gating, which is true but incomplete: it does not mention that the clause has to
  survive `always()`, nor that `deploy` needed `always()` at all. That gap is what this record closes.
  The two-role split, the required-reviewer gate, and the fresh-diff-before-approval behavior are all
  unchanged.

## Context

`.github/workflows/infra.yml`'s `deploy` job silently skipped on **every** `command: deploy`
dispatch — reported by the Actions UI as nothing more than "This job was skipped", with no error, no
annotation, and no pending-deployment state. It was confirmed not to be any of: the wrong `command`
input (checked in the UI *and* re-dispatched directly through the API with
`inputs: {"command": "deploy"}`), the `infra-deploy` environment being missing or misconfigured (it
exists, is restricted to `main`, and has a valid required reviewer — the reviewer was also removed and
re-added, to no effect), or the branch not matching.

The cause was found by adding a temporary job identical to `deploy` in the one respect that mattered:

| Job | `needs:` | `if:` | Result |
| --- | --- | --- | --- |
| `debug-deploy-condition` | `diff` | `always()` | **ran** |
| `deploy` | `diff` | the real condition | **skipped** |

The debug job printed, from inside the same run: `github.event_name: workflow_dispatch`,
`inputs.command: deploy`, `needs.diff.result: success`, and — evaluated by GitHub's own expression
engine — `full condition: true`. So `deploy`'s `if:` was *true* and `deploy` skipped anyway.

The reason is that GitHub's skip propagation is **transitive, and a job's own `if:` does not override
it**. `infra-changed` is skipped on every `workflow_dispatch` (its condition is `pull_request`-only).
`diff` survives that only because [an earlier fix the same day](20260812-github-oidc-sub-embeds-immutable-ids.md)
wrapped its `if:` in `always()`. But `deploy` — two hops down, `needs: diff` — still inherited the
skip *through* a `diff` that had succeeded. Fixing the first job in the chain was not enough; the
skip travels the whole `needs:` graph.

## Decision

`deploy`'s `if:` becomes `always() && <the existing three clauses>`. The `needs.diff.result ==
'success'` clause is now doing double duty and both jobs are documented as such in the workflow file:
it replaces the default success-gating that a bare `needs:` would imply (20260811's reason), *and* it
is what stops `always()` from running the deploy when `diff` failed outright.

The general rule this repo now follows: **in a `needs:` chain where any ancestor can be skipped, every
downstream job that must still run needs `always()` in its own `if:` — not just the first one.** The
first-job-only fix is the failure mode that produced this incident, because it looks like it worked
(`diff` ran) while the job that actually mattered kept skipping.

## Alternatives considered

- **`!cancelled()` instead of `always()`.** Arguably more correct in isolation — `always()` also runs
  a job after the run is cancelled, which `!cancelled()` does not. Rejected for consistency: `diff`
  and `ci.yml`'s `real-postgres`/`visual-report` jobs all already use `always()`, and the explicit
  `needs.diff.result == 'success'` clause already prevents the case that matters (deploying off a
  failed diff). A cancelled run's `diff` does not report `success`, so this job stays blocked either
  way.
- **Drop `needs: diff` from `deploy` entirely**, removing the propagation path rather than working
  around it. Rejected: that is exactly what 20260811 added, on purpose, so the reviewer approving the
  environment sees a fresh same-run diff rather than approving blind.
- **Give `infra-changed` a condition that makes it run (and no-op) on `workflow_dispatch`** instead of
  skipping, so nothing downstream ever inherits a skip. Rejected as the more invasive fix for the same
  outcome: it spends a runner on a job with nothing to do on every dispatch, and it leaves the same
  trap armed for the next `needs:` chain someone adds.

## Consequences

A `command: deploy` dispatch now actually reaches the `infra-deploy` environment's required-reviewer
gate instead of silently skipping. Nothing about what the deploy job *does* once approved has changed.

The failure mode this closes is unusually expensive to diagnose relative to its size, and worth
recognising on sight: a job that skips with a condition that is provably true, with no error anywhere,
is almost always `needs:` skip propagation rather than anything about the condition, the environment,
or the trigger. That is now stated in the workflow file at the point it bit, so the next reader does
not re-derive it.

Escape hatch: reverting is deleting `always() && ` from one `if:`, which restores the silent skip —
so the thing to preserve on any future edit to this job's condition is the wrapper, not the clauses.
