---
name: visual-triage
description: Triage reg-suit visual-regression differences locally or in CI, decide whether each change is expected, and approve by pushing the code change.
---

# Visual triage

reg-suit baselines live in AWS S3 under `reg-publish-s3-plugin`, keyed by full commit sha. A test run captures actual images under `.reg/actual`, compares them against the baseline downloaded from S3 for this commit's *base* — the fork point from `main`, stacked pull request or not (ADR 20260919-stack-ci-cancels-superseded-layers) — and uploads the results/reports. Which commit that is, is stated rather than inferred: `scripts/reg-suit-keys.mjs` computes both keys and `pnpm visual:compare` puts them in the environment `regconfig.json` reads (ADR 20260821-stacked-pull-requests). Set `REG_EXPECTED_KEY` yourself to compare against a commit of your choosing.

Baselines are captured on CI's `ubuntu-latest` runners (ADR 20260730-linux-ci-runners). Running
`pnpm visual` on macOS re-renders every screenshot through a different font stack and reports most
of the suite as changed — that is the platform, not your diff. Triage from the CI report unless you
are on Linux.

Same trap on Linux in a sandbox: CI renders with the Chromium `@playwright/test` pins, but a sandbox
that blocks browser downloads falls back to its own pre-installed build, which rasterizes text
differently (ADR 20260730-pinned-browser-visual-determinism). `pnpm e2e:browser-check` prints which
browser it resolved — if it says "falling back", your local diff is not comparable to the baseline.

## Before the first image

Read the sticky `diveday:visual-summary` comment first ([pr-comment.md](pr-comment.md)). The
baseline is your branch's parent commit, not current `main`, so **rebase onto current `main`
before triaging** or attribute each inherited surface to the PR it came from. On a stacked PR read
the comment on every layer, name the layer each inherited diff came from, and use
`pnpm visual:layers` for one layer's own slice. A surface you expected to move that reads as passed
was not selected: add the `visual-all` label and push again.

## Triage loop

1. Read the code and route/state changes before opening images.
2. On a PR, read the sticky visual summary comment first — if it says nothing was compared, stop and
   fix that; a zero there is not evidence.
3. Get the report — `pnpm visual:report` against the commit under review ([fetching.md](fetching.md)), or run the
   full local comparison on Linux:
   ```bash
   pnpm visual
   ```
4. Read `.reg-report/<commit>/REPORT.md` and view the expected/actual/diff PNGs it lists.
5. Put each difference in one bucket:
   - **Expected:** the code change explains it. Merge the branch to update S3 references for subsequent builds.
   - **Regression:** the image reveals an unintended layout/content/state change. Fix the source, rerun comparison, and verify the diff is gone.
   - **Unclear:** do not merge and ask for a decision.

## Reference

- [pr-comment.md](pr-comment.md) — the sticky `diveday:visual-summary` comment in full: `NOTHING WAS COMPARED`, the parent-commit baseline, rebasing before triage, what a PR captures (`visual-all`), and `pnpm visual:layers` for a stacked layer.
- [fetching.md](fetching.md) — getting the report and its images from a session.
- [mapping.md](mapping.md) — attributing a diff to code, unstable captures, and a capture with two causes.

## Handoff

Summarize the test case, viewport, bucket, root cause, and the commit's `pnpm visual:report`
command (or the reg-suit HTML report link, for a human who wants the interactive view).
