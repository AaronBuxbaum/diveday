---
name: visual-triage
description: Triage reg-suit visual-regression differences locally or in CI, decide whether each change is expected, and approve by pushing the code change.
---

# Visual triage

reg-suit baselines live in AWS S3 under `reg-publish-s3-plugin`, keyed by full commit sha. A test run captures actual images under `.reg/actual`, compares them against the baseline downloaded from S3 for this commit's *base* — the fork point from `main`, or on a stacked pull request the head of the layer below — and uploads the results/reports. Which commit that is, is stated rather than inferred: `scripts/reg-suit-keys.mjs` computes both keys and `pnpm visual:compare` puts them in the environment `regconfig.json` reads (ADR 20260821-stacked-pull-requests). Set `REG_EXPECTED_KEY` yourself to compare against a commit of your choosing.

Baselines are captured on CI's `ubuntu-latest` runners (ADR 20260730-linux-ci-runners). Running
`pnpm visual` on macOS re-renders every screenshot through a different font stack and reports most
of the suite as changed — that is the platform, not your diff. Triage from the CI report unless you
are on Linux.

Same trap on Linux in a sandbox: CI renders with the Chromium `@playwright/test` pins, but a sandbox
that blocks browser downloads falls back to its own pre-installed build, which rasterizes text
differently (ADR 20260730-pinned-browser-visual-determinism). `pnpm e2e:browser-check` prints which
browser it resolved — if it says "falling back", your local diff is not comparable to the baseline.

## Start at the PR comment

On a pull request the `visual-report` job posts one sticky comment (marker `diveday:visual-summary`,
edited in place on each push) with the counts, the names of the changed/new/deleted surfaces, and
the exact `pnpm visual:report` command for that commit. Read it before anything else — it usually
tells you whether the diff is confined to the surfaces you touched. It never fails the build; the
enforcement is you (ADR 20260802-visual-diff-pr-comment).

Two things it says that reg-suit's own `reg-suit[bot]` comment and `reg` status cannot, because
their payload is counts only:

- **Which surfaces moved**, so triage can start without opening a browser.
- **Whether anything was compared at all.** A headline of `NOTHING WAS COMPARED` means reg-suit
  downloaded zero baseline images and reported every screenshot as *new* rather than diffed — the
  changed count is then a meaningless zero (ADR 20260729-reg-suit-visual-regression). Treat that run
  as *unknown*, never as clean, and fix the baseline resolution before reading anything into it.
  A run that really did compare says "no differences across N compared surface(s)" instead.

If the comment says no report was published, `reg-suit run` never got far enough to publish one —
read the `visual-report` job log rather than assuming the pixels held still.

**On any branch, the baseline is your own parent commit — not current `main`.** A branch cut a few
days ago is compared against the world as it was then, so every PR that merged in between shows up
in *your* report as changed pixels. That is not a subtle effect: a branch cut four PRs back came
back with 102 changed surfaces of which **66 belonged to other people**, and the four "new, no
baseline" items were another PR's brand-new captures. Triaging that honestly means opening diffs
for surfaces you never touched and attributing each one, which is slow and easy to get wrong in the
generous direction.

So **rebase onto current `main` before triaging**, and let CI re-run. The report then contains your
pixels and nothing else, which is the only version of it you can actually account for. If you
cannot rebase yet — `main` is red, or the fix is still in review — say so in the PR and attribute
the inherited surfaces explicitly by naming the PR each one came from; a reviewer cannot tell them
apart from yours by looking.

**On a stacked pull request, read that comment on every layer.** A layer's baseline is the head
commit of the layer below, whose S3 snapshot exists only if its own four visual shards went green in
a run that finished first — and a cascading rebase rewrites every commit above the merge point,
orphaning the keys published under them. So `NOTHING WAS COMPARED` is a *likelier* outcome here than
on an ordinary branch, and it means the same thing it always does: unknown, not clean. Re-run the
layer below and let it publish before triaging the layer above (ADR
20260821-stacked-pull-requests).

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

`REPORT.md` leads with the same verdict headline as the PR comment, above the counts, and prints how
many baseline images were downloaded — so a run that compared nothing cannot read as a clean one
here either.

## Triage loop

1. Read the code and route/state changes before opening images.
2. On a PR, read the sticky visual summary comment first — if it says nothing was compared, stop and
   fix that; a zero there is not evidence.
3. Get the report — `pnpm visual:report` against the commit under review (see above), or run the
   full local comparison on Linux:
   ```bash
   pnpm visual
   ```
4. Read `.reg-report/<commit>/REPORT.md` and view the expected/actual/diff PNGs it lists.
5. Put each difference in one bucket:
   - **Expected:** the code change explains it. Merge the branch to update S3 references for subsequent builds.
   - **Regression:** the image reveals an unintended layout/content/state change. Fix the source, rerun comparison, and verify the diff is gone.
   - **Unclear:** do not merge and ask for a decision.

## Mapping and stability

Visual specs are organized in `e2e/visual.spec.ts`. If a diff appears without a relevant code change, check `DIVEDAY_CLOCK`, browser version, fonts, and the deterministic PGlite reset. Do not mask a moving element to make the diff disappear.

Read the *shape* of a no-code-change diff before assuming a baseline moved:

- **Glyphs everywhere, layout identical** (element positions and image heights unchanged) — a
  rendering-input change, not a code change. The browser is pinned to the lockfile now, so the
  suspects are, in order: a `@playwright/test` bump, a change to `DETERMINISTIC_RENDERING_ARGS` in
  `e2e/browser.ts`, or the runner image's emoji/fallback fonts (Geist is self-hosted and pinned).
- **Confined to one element, with everything around it identical** — a capture that shot too early.
  Wait on something the surface only renders when it is done, not a `@media` or a moving element.
- **A solid blank stripe, or a whole screenful of nothing** — the capture gave up on a wait rather
  than the page rendering wrong. `paintWholeDocument` bounds every wait it owns and shoots anyway,
  which is deliberate: a stall costs one capture's sharpness, not the run. Every bound that fires
  warns to the shard's log with the surface URL, so **read the `visual:` lines in the "Capture
  visual regression screenshots" job output before reading the pixels** — they name which wait gave
  up (frames, image decode, the whole scroll-through pass, the fonts) and, for a driver-side stall,
  whether the renderer answered a trivial `evaluate` afterwards. A stripe with a matching warning is
  a harness stall to re-run, never a baseline to bank; a stripe with *no* warning is a real finding.
- **Anything reflows** — a real layout change. Read it as a finding even if it arrived inside a
  larger rebaseline.

`regconfig.json` sets `enableAntialias`, so a diff that survives to the report is not "just
antialiasing". It deliberately does **not** set `matchingThreshold` — the comparison runs at
reg-cli's default of `0`, meaning any per-pixel difference counts. Loosening that is not triage: if
a diff is noise, the renderer is the thing to fix.

## Handoff

Summarize the test case, viewport, bucket, root cause, and the commit's `pnpm visual:report`
command (or the reg-suit HTML report link, for a human who wants the interactive view).
