# 20260730-linux-ci-runners — Run CI on Linux runners instead of macOS

- **Status:** Accepted
- **Date:** 2026-07-30

## Context

Every `ci.yml` job ran on `macos-latest`. Nothing required macOS — no ADR or doc ever justified it,
and the repository is public, so GitHub bills standard runners (macOS included) at zero. The
`get_workflow_run_usage` API confirms this: run 30546820346 reports `MACOS: total_ms: 0` across all
14 jobs. The choice was therefore never about cost, only wall-clock feedback time.

Two things made macOS slow, and only one of them is about hardware.

**Concurrency.** GitHub caps concurrent macOS jobs far below the account-wide job limit. `ci.yml`
fans out to 14 jobs; only about five macOS jobs ever ran at once, and often fewer. Run 30546820346
took **18m24s** of wall clock to do **32.4 minutes** of runner work — an average concurrency of
**1.76**. Roughly eleven of those eighteen minutes were jobs sitting in a queue. Successful runs on
`main` ranged from 4.3 to 18.4 minutes (median 9.7); that spread *is* the queue.

**Per-job speed.** A benchmark workflow (run 30550868094) mirrored `ci.yml` job-for-job across both
runner OSes from one commit, so the runner was the only variable:

| Job | Linux | macOS |
| --- | --- | --- |
| Repository safeguards | 32s | 83s |
| Typecheck | 34s | 67s |
| Lint | 32s | 65s |
| Build | 69s | 92s |
| Playwright build | 65s | 104s |
| Unit shards (range) | 72–110s | 102–155s |
| Playwright shards (range) | 163–192s | 160–236s |
| Visual capture | 247s | 269s |
| **Total runner time** | **26.2 min** | **34.2 min** |
| **Queue delay (median / max)** | **3s / 11s** | **12s / 135s** |

`ubuntu-latest` is a 4-core AMD EPYC 9V45 with 16 GB; `macos-latest` is a 3-core virtualized Apple
M1 with 7 GB. Browser-bound work is close to a wash — the M1 is not a slow machine. The gap is in
Node tooling, and a large, fixed part of it is `actions/setup-node`, which takes 1–3s on Linux
(Node 22 is in the image's tool cache) versus 27–38s on macOS, on *every* job.

## Decision

Run every `ci.yml` job on `ubuntu-latest`. The Playwright browser cache path moves from
`~/Library/Caches/ms-playwright` to `~/.cache/ms-playwright` to match.

## Alternatives considered

- **Keep everything on macOS.** Pays a queue penalty that grows with every job added to the fan-out,
  for no benefit anyone had written down.
- **Split: fast jobs on Linux, keep `visual` on macOS.** Would have preserved the existing S3
  baselines and kept CI rendering aligned with a Mac developer's local `pnpm visual`. Rejected —
  it keeps the slowest single job (`visual`, the critical path together with `playwright-build`) on
  the constrained runner pool, and leaves two runner images to maintain. The baseline reset is a
  one-time cost; the queue is paid on every push.

## Consequences

- **Faster and far more predictable feedback.** Linux queue delay was a median of 3s against 12s
  (max 135s) for macOS in the benchmark, and up to 626s in production runs. Both the mean and the
  variance drop.
- **This invalidates the entire visual baseline, once.** Screenshots were compared across the two
  OSes at the same commit: **186 of 190 exceed `regconfig.json`'s `thresholdRate` of 0.01**, with a
  median of 9.6% of pixels changed. This is not faint antialiasing — at a tolerance of 48/255 per
  channel, 153 still exceed the threshold. Layout is stable (identical wrapping and element
  positions); what moves is glyph rasterization (CoreText vs FreeType/fontconfig) and the emoji
  font (Apple Color Emoji vs Noto Color Emoji). Five screenshots do genuinely reflow, changing
  height: `course-paths-{dark,light}-vw-390` (1359→1339), `schedule-{dark,light}-vw-390`
  (13231→13255), and `manifest-print` (1652→1651).
- Because baselines are keyed to git commits in S3, there is nothing to regenerate: the first `main`
  run after this merge publishes the Linux baseline, and every later commit compares against it. The
  switch PR itself shows a near-full-suite diff, expected and explained by this ADR.
- **A Mac developer's local `pnpm visual` no longer matches the CI baseline** and will report most
  screenshots as changed. Triage visual diffs from the CI report rather than locally — see the
  **visual-triage** skill.
- **Unchanged, and still a latent fragility:** `playwright.config.ts` prefers a system browser over
  Playwright's own resolution, so CI never used the pinned Chromium on either OS. It used the
  image's Google Chrome 150.0.7871.129 on macOS and now uses the image's Chromium 150.0.7871.0 at
  `/usr/bin/chromium` on Linux. Baselines therefore still move whenever the runner image bumps its
  browser. This ADR does not change that; it is called out so the next unexplained full-suite diff
  has a documented first suspect.
