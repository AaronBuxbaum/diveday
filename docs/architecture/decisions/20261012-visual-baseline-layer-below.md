# 20261012-visual-baseline-layer-below — Compare a stacked layer against the layer below when it has published

- **Status:** Accepted
- **Date:** 2026-10-12

## Context

[20260919-stack-ci-cancels-superseded-layers](20260919-stack-ci-cancels-superseded-layers.md) keyed
every stacked layer's visual baseline to the stack's fork point from `main`, so no layer waited on
another. Its cost showed on 2026-10-12: with nineteen layers open, each upper layer reported about
926 changed captures, most of them other layers' work (747 of one layer's 776 were a banner copy
edit two layers down). Sessions spent millions of tokens working out which layer moved which
pixels. [20261003-every-stack-layer-runs-ci](20261003-every-stack-layer-runs-ci.md) means a lower
layer's commit is usually published already.

## Decision

`scripts/wait-for-baseline.mjs` checks, for a pull request whose base is not the default branch,
whether `git merge-base <base sha> HEAD` (the layer below's commit this branch contains) has a
published `out.json`. If it has, that commit becomes `REG_EXPECTED_KEY` and the sticky comment says
the diff is this layer's own. If it has not, nothing changes: the fork point from `main` stands,
with the existing ancestor walk. It never polls or waits.

## Alternatives considered

- **Key to the base sha and wait for it** — the 20-minute poll 20260919 removed.
- **Key to the base head even when this layer has not merged it** — reports the lower layer's newer
  commits as reversed changes on this one; the merge-base does not.
- **Leave it cumulative** — the triage cost above.

## Consequences

Most upper layers read only their own delta. A layer whose base commit was never published (its
run cancelled by a newer push) still reads the cumulative diff, and the comment says which baseline
it used. The top layer no longer shows the whole stack's delta; the bottom layer's report and each
layer's own add up to it. Revisit if lower-layer snapshots turn out to be rarely published.
