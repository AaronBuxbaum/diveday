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

## Fetching the report as an agent

`reg-suit` prints an `index.html` report link, but that page is a client-rendered SPA — its body is
literally `<div id="app"></div>` until JS runs, so a text-only fetch (WebFetch, `curl` without a
browser) sees nothing. Never try to read that link directly. Instead:

```bash
pnpm visual:report                      # current HEAD's commit
pnpm visual:report --commit <sha>       # a specific commit (e.g. a PR's head, from CI logs)
pnpm visual:report --all                # also pull passed items, not just changed/new/deleted
```

This pulls `out.json` and the relevant `expected`/`actual`/`diff` PNGs straight from the same public
S3 bucket (`regconfig.json`'s `reg-publish-s3-plugin` — no AWS credentials needed, the bucket is
public-read) into `.reg-report/<commit>/`, alongside a `REPORT.md` listing each changed/new/deleted
item with the local paths to its images. Read `REPORT.md`, then open each PNG path with `Read` — it
renders images directly, which is the actual point: raw pixels beat any text description of them.
This works from a fresh checkout without ever running Playwright locally, as long as CI has already
published a report for that commit.

## Triage loop

1. Read the code and route/state changes before opening images.
2. Get the report — `pnpm visual:report` against the commit under review (see above), or run the
   full local comparison on Linux:
   ```bash
   pnpm visual
   ```
3. Read `.reg-report/<commit>/REPORT.md` and view the expected/actual/diff PNGs it lists.
4. Put each difference in one bucket:
   - **Expected:** the code change explains it. Merge the branch to update S3 references for subsequent builds.
   - **Regression:** the image reveals an unintended layout/content/state change. Fix the source, rerun comparison, and verify the diff is gone.
   - **Unclear:** do not merge and ask for a decision.

## Mapping and stability

Visual specs are organized in `e2e/visual.spec.ts`. If a diff appears without a relevant code change, check `DIVEDAY_CLOCK`, browser version, fonts, and the deterministic PGlite reset. Do not mask a moving element to make the diff disappear.

## Handoff

Summarize the test case, viewport, bucket, root cause, and the commit's `pnpm visual:report`
command (or the reg-suit HTML report link, for a human who wants the interactive view).
