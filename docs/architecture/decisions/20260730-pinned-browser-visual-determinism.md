# 20260730-pinned-browser-visual-determinism — Run the lockfile-pinned Chromium, with deterministic rasterization

- **Status:** Accepted
- **Date:** 2026-07-30

## Context

Two CI failure modes had the same root: nothing pinned the browser, and nothing pinned how it drew.

**1. `Test timeout of 15000ms exceeded while setting up "page"`.** The standing explanation was
resource contention between four concurrent Playwright shards. That is not what happens. Each shard
is a separate `ubuntu-latest` runner, and `E2E_WORKER_COUNT` (`cpus/4`) resolves to **one** worker on
a 4-core runner — the logs say so directly: `Running 34 tests using 1 worker, shard 3 of 4`. There is
one browser and one Next server on the machine.

The Playwright HTML report artifacts from the failing shards say what actually happened. Two sampled
runs, both failing on the *first* test to reach a browser:

| Step | run 30568605407 (shard 3) | run 30563804385 (shard 2) | every later test in the same job |
| --- | --- | --- | --- |
| `Launch browser` | 40,891 ms | 27,670 ms | 150–175 ms |
| `Create page` | 13,821 ms (timed out) | 12,868 ms (timed out) | 80–110 ms |
| `POST /api/test/reset` | 773 ms | 836 ms | 710–900 ms |

The first browser launch in a job is two to three orders of magnitude slower than every relaunch
after it, and the first page creation is still paying for it. The fixture accounting then decides who
gets blamed: Playwright bills a test's `timeout` for its **test-scoped** fixtures but not its
**worker-scoped** ones, so the 41s `browser` launch (worker-scoped) costs wall clock and fails
nothing, while `page` (test-scoped) inherits a cold browser and blows a 15s budget it did not spend.
Test-scoped setup totalled 773 + 396 + 13,821 ms against a 15,111 ms test — the whole budget, none of
it the test's own work. The error names `page` because that is the fixture in flight when the
deadline lands; nothing about the marketing spec is slow.

The cold start is not mysterious either. Playwright's own browser was never being launched.
`playwright.config.ts` scanned system paths *before* Playwright's own resolution, so five CI jobs
restored a ~270 MB `ms-playwright` cache, ran `playwright install chromium`, and then launched
whatever browser the runner image shipped — Chrome 150.x while the lockfile pinned Chrome for
Testing 151.0.7922.34. A browser Playwright did not provision, starting under a fresh `HOME` on a
cold page cache immediately after the job untarred that cache and a build artifact, is what takes 41
seconds.

**2. Visual diffs "on antialiasing".** The same misresolution. ADR `20260730-linux-ci-runners`
already flagged it as the documented first suspect for an unexplained full-suite diff: *"Baselines
therefore still move whenever the runner image bumps its browser."* Baselines are keyed to git
commits, so a runner-image rollout between a parent commit and its child compares two different
browsers' glyph rasterization and reports it as a code change.

Underneath that, three inputs to the rendered image were unpinned even for one browser build.
Chromium's font rasterization defaults (hinting, subpixel positioning, LCD text) re-rasterize a whole
line of text when its origin moves by a fraction of a pixel; `--disable-skia-runtime-opts` was off,
so Skia selected SIMD paths from the host CPU's feature bits across a runner fleet that is not
homogeneous; and screenshots were taken without `animations: "disabled"`, so any CSS transition
mid-curve landed on a different frame each run.

Finally, the comparison itself had no tolerance at all: `reg-suit`'s `matchingThreshold` defaults to
`0`, meaning a single unit of difference in one channel of one pixel counts as changed.

## Decision

**Run the browser the lockfile names.** `e2e/browser.ts` resolves, in order: an explicit
`PLAYWRIGHT_CHROMIUM_EXECUTABLE` / `CHROME_PATH` / `CHROMIUM_PATH`; then Playwright's own pinned
revision when it is installed (no `executablePath` override at all); and only if that is absent, a
system browser. Sandboxed agent environments that pre-install a mismatched Chromium and block
downloads still work, as a documented fallback rather than the default. `playwright.config.ts` and
`scripts/ensure-playwright-browser.ts` both go through that one function, so the pre-flight check
reports the browser the suite will actually launch.

**Pin rasterization.** All browsers in the fleet launch with `DETERMINISTIC_RENDERING_ARGS`:
`--font-render-hinting=none`, `--disable-font-subpixel-positioning`, `--disable-lcd-text`,
`--disable-skia-runtime-opts`, `--disable-partial-raster`, `--disable-checker-imaging`. Playwright's
defaults already cover the process-level noise (`--force-color-profile=srgb`, background throttling,
the component updater); these cover text rasterization and raster scheduling, which its defaults
leave to Chromium.

**Pin time in a capture.** Both `capture()` and `capturePrint()` pass `animations: "disabled"`.

**Pay cold start off the clock.** `e2e/global-setup.ts` launches a browser, opens a page, and
navigates once before any test runs, in parallel with the existing server warm-up. Cold start becomes
untimed setup instead of a lottery over which test draws it.

**Give the comparison a noise floor.** `regconfig.json` sets `matchingThreshold: 0.05` (half of
pixelmatch's own default) and `enableAntialias: true`, which maps to pixelmatch's `includeAA: false`.
`thresholdRate` stays at `0.01`.

The floor is calibrated, not guessed. Capturing `/` and `/pricing` twice from one browser — once with
the rendering flags and once without, so the *only* difference is rasterization — gives a change of
exactly the shape a browser bump produces:

| Capture | changed at `t=0`, AA counted | changed at `t=0.05`, AA ignored |
| --- | --- | --- |
| `/` (1280×4054) | 257,240 px — 4.96% | 104,291 px — 2.01% |
| `/pricing` (1280×5050) | 388,020 px — 6.00% | 175,737 px — 2.72% |

The tolerance removes about 60% of the pixels, and a genuine rasterization-wide change still lands
two to three times over `thresholdRate`. `reg-cli` flags both files under either setting. That is the
property wanted: sub-perceptual jitter falls under the floor, a real change does not go near it.

`retries` stays at `0`. The point is to remove the flake, not to re-roll it.

## Alternatives considered

- **Raise the per-test timeout, or add a retry.** Both hide a 41-second browser launch instead of
  fixing it, and the repository's no-retry rule exists precisely so a flake gets found. A timeout
  wide enough to cover a 41s cold start would also stop bounding real hangs.
- **Extend the test timeout from inside the fixture** (`testInfo.setTimeout(timeout + elapsed)`).
  Correct in principle — it un-bills setup the test did not cause — but it papers over the same cold
  start and leaves the wall-clock cost. Worth revisiting if a *warm* fixture ever gets genuinely
  expensive; `/api/test/reset` at ~0.8s is not that.
- **`playwright install --only-shell chromium`.** Roughly halves the cached browser (~270 MB → ~110
  MB) across five jobs and starts faster. Rejected for now: it changes which binary rasterizes, on
  top of a change that already re-baselines the suite, and two rebaselines in one commit make the
  diff unreadable. It is the obvious next win once this baseline settles.
- **Tolerate the noise only, without pinning the browser.** A `matchingThreshold` wide enough to
  absorb a whole browser-version change is wide enough to absorb a real regression. The tolerance
  here is a noise floor under a deterministic renderer, not a substitute for one.
- **Vendor the fallback and emoji fonts into the repo.** Would close the last unpinned rendering
  input, but it is a much larger change and the Noto packages in the runner image move rarely.
  Recorded below as residual risk instead.

## Consequences

- **This re-baselines the visual suite once.** The rendering flags change what Chromium draws, and
  CI moves from the runner image's Chrome 150.x to Chrome for Testing 151.0.7922.34. The calibration
  above measures the flags alone at 2.0–2.7% of pixels after tolerance, against a 1% threshold, so
  expect a near-full-suite diff on the adopting PR — for the same reason and with the same remedy as
  `20260730-linux-ci-runners`: nothing to regenerate, the merge to `main` publishes the new baseline.
  The diff to actually read is layout: element positions and image heights should be unchanged, and
  anything that reflows is a real finding hiding in the rebaseline.
- **Captures are reproducible on one machine.** Two consecutive full runs of `e2e/visual.spec.ts`
  under this configuration produced all 194 screenshots byte-for-byte identical.
- **Baselines stop moving with the runner image.** The browser is now a lockfile fact. It changes
  when `@playwright/test` is upgraded — a reviewable commit that should expect a full-suite diff —
  and not otherwise.
- **The ~270 MB browser cache stops being dead weight.** Five jobs were restoring it and discarding
  it. A missing system library now surfaces in `globalSetup`'s warm-up launch, as one clear error
  before any test runs, rather than as 34 timeouts.
- **Nothing here costs runtime.** Twelve full-page captures took 7,272 ms without the rendering flags
  and 7,354 ms with them — inside run-to-run noise; disabling partial raster does not measurably
  slow a workload that already forces a full paint. The warm-up adds one browser launch that the run
  was paying anyway, moved earlier. What it saves is the expensive failure: a timed-out shard costs a
  re-run of all fourteen jobs.
- **The warm-up prints what it cost**, e.g. `e2e: warmed … — launch 173ms, first page + navigation
  5157ms`. That second number is the one to watch: 5.2s on an idle 4-core machine, out of a 15s test
  budget, for work no test caused. If a setup timeout ever comes back, this line says in one read
  whether cold start is still the reason and which browser paid it.
- **A local `pnpm visual` in a sandbox still will not match CI**, because the fallback browser
  differs. `pnpm e2e:browser-check` now says so out loud instead of leaving the diff report to
  imply it. Triage from the CI report — see the **visual-triage** skill.
- **`enableAntialias` costs some sensitivity to pure-typography regressions**, since pixelmatch
  excludes pixels its neighbourhood test reads as antialiasing. A font-weight or size change that
  moves nothing else is the case to watch; in practice such a change also moves layout, which the
  non-AA pixels catch.
- **`thresholdRate: 0.01` is still loose and is now the weakest link.** One percent of a
  1280×11802 schedule capture is ~150,000 pixels — enough for a whole component to change and pass.
  It was left alone deliberately: tightening it in the same commit that re-baselines everything would
  make both changes unmeasurable. Once a few `main` runs have published stable baselines under the
  pinned browser, the residual changed-pixel rate is measurable, and `thresholdRate` should be
  tightened to sit just above it.
- **Residual unpinned input: fonts from the runner image.** Geist is self-hosted by
  `next/font/google` at build time, so the body text is pinned; emoji and any fallback glyph still
  come from the image's fontconfig. If a diff ever confines itself to emoji, this is the first
  suspect.
- `scripts/ensure-playwright-browser.mjs` becomes `scripts/ensure-playwright-browser.ts`, run with
  `tsx`, so it can share the resolver instead of keeping a second copy of the candidate list that
  could disagree with it.
