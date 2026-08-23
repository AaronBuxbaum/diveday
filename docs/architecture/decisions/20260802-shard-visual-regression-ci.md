# 20260802-shard-visual-regression-ci — Shard the visual-capture CI job, compare once

- **Status:** Accepted
- **Date:** 2026-08-02

## Context

`e2e/visual.spec.ts` captures dozens of surfaces at light/dark × phone/desktop (plus print) — 238
screenshots per run. Unlike the functional `playwright` CI job, which was already split into a
4-way `--shard` matrix, the `visual` job ran the whole spec in one unsharded job with
`E2E_WORKERS: "1"`, so it serialized every capture behind a single browser+server pair. As the
suite grew, that job became CI's longest-running step and the effective bottleneck on merge time.

`reg-suit run` (the S3 baseline compare, `docs/architecture/decisions/20260729-reg-suit-visual-regression.md`)
has no shard-aware mode — it needs the complete `e2e/screenshots/` set and the real git history
in one place to compute a key and publish one report. (The key generator named here was
`reg-keygen-git-hash-plugin` until 2026-08-23; the keys are now stated rather than inferred, but
they are still computed from git history in this one job — see
[20260821-stacked-pull-requests](20260821-stacked-pull-requests.md).)

## Decision

Split the single `visual` job into two:

- **`visual`** — a 4-way `--shard` matrix, same pattern as the `playwright` job. Each shard checks
  out the repo, downloads the shared `next-build` artifact, runs
  `pnpm exec playwright test e2e/visual.spec.ts --shard=N/4` (nothing in that spec asserts, so a
  visual change never fails this step), and uploads its slice of `e2e/screenshots/` as
  `visual-screenshots-N`. `E2E_WORKERS: "1"` stays pinned per shard, for the same
  single-runner browser+server contention reason as the `playwright` job
  (`20260731-ci-parallelization-resources-build-concurrency.md`).
- **`visual-report`** — depends on all four `visual` shards, downloads and merges the four
  `visual-screenshots-*` artifacts back into one `e2e/screenshots/` directory
  (`actions/download-artifact`'s `pattern` + `merge-multiple`), then runs `reg-suit run` exactly
  once. The git-history checkout and `reg-suit-baseline-parent` anchoring
  (`20260729-reg-suit-visual-regression.md`) moved here, since this is the only step that still
  touches git history or S3.

`package.json`'s `visual:run` (used by local `pnpm visual`) is unchanged in behavior, just split
into `visual:capture` (the Playwright run) and `visual:compare` (the `reg-suit run`) so CI can
invoke each half independently.

## Alternatives considered

- **Raise `E2E_WORKERS` instead of sharding across jobs** — cheaper to write, but the
  contention finding in `20260731-ci-parallelization-resources-build-concurrency.md` (2 workers on
  4 cores is already the tested ceiling for this suite) means more in-job workers trades wall-clock
  for the same timeout-driven flake risk that ADR paid down elsewhere; sharding across separate
  4-core runners avoids that trade entirely.
- **Run `reg-suit run` per shard, publish four partial reports** — would parallelize the compare
  step too, but `reg-suit`'s S3 key/publish model is built around one report per commit; four
  partial publishes would each treat the others' screenshots as missing and race each other for
  the same S3 key. Not worth building around a tool that has no shard-aware mode.

## Consequences

- Visual CI wall-clock is now bounded by the slowest quarter of the spec plus one lightweight
  merge-and-compare job, instead of the whole spec serialized.
- Costs more runner-minutes in total (four capture jobs' fixed overhead — checkout, build
  download, browser install — instead of one), traded for shorter wall-clock on the critical path.
- A shard that produces zero screenshots (a config or build break) fails its own upload step
  (`if-no-files-found: error`) rather than silently shrinking the merged set that `visual-report`
  compares.
- If the spec keeps growing, the shard count is the knob: raise the matrix (and the `--shard`
  denominator alongside it) the same way `playwright`'s was tuned in
  `20260731-ci-parallelization-resources-build-concurrency.md`.
