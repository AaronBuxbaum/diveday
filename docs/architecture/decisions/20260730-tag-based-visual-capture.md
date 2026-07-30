# 20260730-tag-based-visual-capture — Distribute visual captures into the functional e2e suite, tagged `@visual`

- **Status:** Proposed
- **Date:** 2026-07-30

## Context

Visual regression coverage lived entirely in one file, `e2e/visual.spec.ts`: a curated, hand-maintained
list of `capture()` call sites, grouped into a handful of large "site tour" tests (one navigates
through ~15-20 public pages, another through ~25 staff surfaces), run in its own single-worker CI job
(`reg-suit visual regression`), separate from the functional suite's four sharded CI jobs. Nothing in
it asserted; `reg-suit` diffed the resulting PNGs against the parent commit's S3 baseline.

That architecture's main weakness surfaced directly: the "public surfaces" tour test hung mid-capture
on `main` CI and blew its `test.setTimeout(60_000)` budget (see PR #258), even though the identical
code had passed the same job cleanly on its own PR branch minutes earlier — a CI-runner slowdown with
too little margin, not a code regression. PR #258 patched this by splitting the tour into smaller
tests, following a pattern already present in the file (the `about` page had been split out for the
same reason before). That fix treated the symptom. The structural cause is that all visual capture
work was serialized into one job on one worker, while the functional suite (`e2e/*.spec.ts`, 41 files,
137 tests at the time of writing) already ran sharded four ways.

A follow-up conversation explored the tradeoff explicitly (see the exploratory doc referenced in that
PR's discussion) between keeping visual and functional specs as separate concerns (current
architecture, and the stated position of the `e2e-and-visual` skill) versus folding capture calls into
the functional suite outright. Weighing the options in that doc (status quo; capture as an opt-in
fixture callable from any spec; tag-based automatic collection; failure-triggered-only; full
auto-snapshot on every test) against their cost — capture volume, signal dilution from
near-duplicate states, and spreading the capture determinism machinery into a suite whose entire
design point is fast/tight-timeout/no-retries — landed on the tag-based option as the one worth
building and trying.

## Decision

Move every `capture()`/`capturePrint()` call out of the dedicated `e2e/visual.spec.ts` "site tour" and
into the functional spec file that already reaches that surface, each wrapped in a
`test.describe(..., { tag: "@visual" })` block. `e2e/visual.spec.ts` is deleted.

- The capture helpers (`capture`, `capturePrint`, `paintWholeDocument`, `VIEWPORTS`, and all of the
  hard-won determinism logic and commentary behind them) move to a new shared module,
  `e2e/visual-capture.ts`, importable from any spec.
- Each capture site becomes a new, self-contained `test()` — it does its own navigation, not a splice
  into an existing functional test's body — so existing functional tests are untouched and unaffected.
  Curation is preserved: a human still decides which states are worth a baseline and writes the
  capture call, exactly as before. Only the *file* it lives in changed, not the *decision process*.
  This is what keeps this decision compatible with the `e2e-and-visual` skill's "keep functional specs
  and visual specs separate" principle — the concepts (assert vs. capture) stay separate even though
  the files no longer do.
- CI: the four `Playwright shard N/4` jobs now run every spec file (no more excluding
  `e2e/visual.spec.ts`), so `@visual`-tagged tests execute as part of whichever shard their file lands
  in and ride that parallelism. Each shard job additionally uploads `e2e/screenshots/` as an artifact.
  A new final job (renamed from `visual` to `reg-suit visual regression` — same name, different
  shape) downloads and merges all four shards' screenshot artifacts into one `e2e/screenshots/`
  directory and runs `reg-suit run` only — no Playwright execution, no browser install, since capture
  already happened in the shard jobs.
- `package.json`: `visual:run` (which ran `playwright test e2e/visual.spec.ts && reg-suit run`) is
  replaced by `pnpm exec playwright test --grep @visual && pnpm reg:run`; `reg:run` is a new script
  wrapping just `dotenv -c -- reg-suit run`, reused by both the local `visual` script and CI's merge
  job.

## Alternatives considered

- **Status quo (keep `e2e/visual.spec.ts`):** No new CI plumbing, but leaves visual work stuck on one
  worker while functional work already runs four-way parallel — the structural cause of the flake
  PR #258 patched, left unaddressed.
- **Capture as an opt-in fixture, still one file:** Gets some of the "don't re-navigate" benefit but
  keeps the single-job bottleneck — doesn't reach the parallelism win.
- **Full auto-snapshot on every functional test:** Rejected in the exploratory doc — capture volume
  would grow roughly 4-10x with no curation cap, most of the growth is near-duplicate states that
  dilute reg-suit report signal rather than add design coverage, and it spreads the capture
  determinism tax (scroll-to-paint, font wait, image decode — all deliberately bounded, but still real
  per-capture cost) into a suite whose whole selling point is fast and tight-timeout.
- **Failure-triggered captures only:** Useful as a debugging aid, not a substitute — it drops the
  proactive regression-catching that's the entire point of this suite.

## Consequences

- **Real parallelism for visual work.** Capture wall-clock now scales with the functional suite's
  four-way sharding instead of being bottlenecked on one worker — this is the actual fix for the class
  of flake PR #258 encountered, not just a wider timeout.
- **CI got one more moving part.** The merge job depends on artifacts from all four shard jobs
  succeeding and uploading; a shard that fails before its upload step means that shard's screenshots
  are simply absent from the diff (same "run degrades to reporting fewer surfaces" behavior reg-suit
  already had for a missing baseline, not a new failure mode, but worth knowing).
- **Screenshot count is unchanged** — same 50 capture sites, same light/dark × phone/desktop matrix,
  just regrouped across ~23 files instead of one. This decision does not adopt full auto-snapshotting;
  see the rejected alternative above for why.
- **This is explicitly a live experiment**, not a settled migration — it exists to be exercised and
  evaluated, not merged on the strength of this ADR alone. If it doesn't hold up, reverting means
  re-consolidating the `@visual`-tagged tests back into a dedicated file and restoring the CI job
  split; nothing about the underlying `reg-suit`/S3 infrastructure (ADR 20260729) changes either way.
- **Docs/skills updated in this same change:** `AGENTS.md`, `docs/engineering/testing.md`,
  `docs/product/marketing.md`, and code comments in `playwright.config.ts` / `e2e/browser.ts` that
  named `e2e/visual.spec.ts` directly. The `e2e-and-visual` and `visual-triage` skills are updated to
  describe capture sites as distributed and tagged rather than confined to one file.
