---
name: visual-triage
description: Triage reg-suit visual-regression differences locally or in CI, decide whether each change is expected, and approve by pushing the code change.
---

# Visual triage

reg-suit baselines live in AWS S3 and are mapped to git commits via `reg-publish-s3-plugin` and `reg-keygen-git-hash-plugin`. A test run captures actual images under `.reg/actual`, compares them against the baselines of the parent git commit downloaded from S3, and uploads the results/reports.

Baselines are captured on CI's `ubuntu-latest` runners (ADR 20260730-linux-ci-runners). Running
`pnpm visual` on macOS re-renders every screenshot through a different font stack and reports most
of the suite as changed — that is the platform, not your diff. Triage from the CI report unless you
are on Linux.

## Triage loop

1. Read the code and route/state changes before opening images.
2. Run the visual comparison — on CI, or locally on Linux:
   ```bash
   pnpm visual
   ```
3. Open the HTML report link printed by `reg-suit` (or locate the S3 bucket report) to inspect reference, actual, and diff images.
4. Put each difference in one bucket:
   - **Expected:** the code change explains it. Merge the branch to update S3 references for subsequent builds.
   - **Regression:** the image reveals an unintended layout/content/state change. Fix the source, rerun comparison, and verify the diff is gone.
   - **Unclear:** do not merge and ask for a decision.

## Mapping and stability

Visual specs are organized in `e2e/visual.spec.ts`. If a diff appears without a relevant code change, check `DIVEDAY_CLOCK`, browser version, fonts, and the deterministic PGlite reset. Do not mask a moving element to make the diff disappear.

## Handoff

Summarize the test case, viewport, bucket, root cause, and the reg-suit report link.
