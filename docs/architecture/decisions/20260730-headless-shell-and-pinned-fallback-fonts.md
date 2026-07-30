# 20260730-headless-shell-and-pinned-fallback-fonts — Install only the headless shell; self-host the fallback glyphs

- **Status:** Accepted
- **Date:** 2026-07-30

## Context

ADR 20260730-pinned-browser-visual-determinism pinned the e2e fleet to the lockfile's Chromium
revision and its rasterization flags, and left two items open for later:

- **`playwright install --only-shell chromium`** — rejected "for now" only because stacking it on
  top of a still-unbaselined browser pin would make one commit's diff unreadable. That baseline has
  since merged to `main` (#250), so the reason to wait is gone.
- **"Residual unpinned input: fonts from the runner image."** Geist is self-hosted by
  `next/font/google` at build time, so Latin body text is pinned. Everything outside Geist's
  `"latin"` subset — arrows, checkmarks, dingbats (→ ✓ ★ ☀ …, used in real UI, not just copy) and
  marketing-copy emoji (🤿 🐬 ⛵ …) — falls through the CSS font stack to `system-ui, sans-serif`,
  which resolves against whatever fontconfig packages the GitHub Actions runner image ships. That
  moves independently of this repo, on the runner image's own schedule.

## Decision

**Install only the headless shell.** CI now runs `pnpm exec playwright install --only-shell
chromium` in both the `playwright` and `visual` jobs. The fleet never sets `headless: false`
anywhere (`playwright.config.ts`'s one project uses `devices["Desktop Chrome"]` with no channel
override), so the full headed browser this used to also download and cache was dead weight — the
suite only ever launched it headless, which Playwright already serves from a separate,
purpose-built binary. The `~/.cache/ms-playwright` cache key gets a `-shell` suffix so this lands as
a clean cache instead of restoring the old full-Chromium blob under the same lockfile hash and
silently keeping the extra weight until that entry aged out on its own.

This requires `e2e/browser.ts`'s `pinnedChromiumInstalled()` to stop trusting
`chromium.executablePath()` at face value: that API always resolves the headed `chromium` binary's
path regardless of the `headless` option (microsoft/playwright#39327), so right after a correct
`--only-shell` install it reports "not installed" — which would send `chromiumExecutableOverride()`
looking for a system fallback and quietly undo the pin. It now derives the shell's own path
(`chromium_headless_shell-<rev>` next to `chromium-<rev>`, the pairing Playwright's own registry
installs and revisions together) and checks that first, falling back to the headed path so a plain
`playwright install chromium` (no `--only-shell`) still resolves.

**Self-host the fallback glyphs.** `src/app/layout.tsx` adds two more `next/font/google` calls
alongside Geist — `Noto_Sans_Symbols_2` (arrows, dingbats, misc symbols — the whole BMP range this
app's own UI uses, not just marketing copy) and `Noto_Color_Emoji` (the pictographic emoji in
marketing/onboarding copy) — both `preload: false` since they only ever cover rare glyphs, never
above-the-fold text. `globals.css`'s `font-family` stack becomes `var(--font-sans),
var(--font-noto-symbols), var(--font-noto-emoji), system-ui, sans-serif`. Both are self-hosted at
build time by the same mechanism that already pins Geist, so they're a lockfile/Next-version fact
like the browser revision, not a runner-image fact.

## Alternatives considered

- **Vendor Noto Color Emoji into the repo directly, install fonts via a pinned APT snapshot, or any
  other CI-time font install.** All close the same gap but need a package/binary this repo doesn't
  otherwise touch, checksum verification, and a refresh process of their own. `next/font/google`
  already exists in this codebase for exactly this job (self-host a Google Font at build time,
  pinned by the toolchain) and both fonts are in its supported list — no new mechanism, no new
  runtime dependency.
- **Leave `--only-shell` for a later PR, separate from the font change.** Both changes rebaseline
  the visual suite for the same underlying reason (an input to rasterization changed), and the
  previous ADR's objection to combining them — an already-unsettled baseline stacked with a new one
  — no longer applies now that baseline is on `main`. One rebaseline event covering both is more
  legible than two back-to-back ones.
- **Keep the full Chromium download and only fix the font gap.** Leaves real, measured CI cost on
  the table (the ADR calibrated the full download at ~270 MB across five jobs) for no correctness
  reason — nothing in this fleet ever launches headed.

## Consequences

- **This re-baselines the visual suite again.** Two independent inputs changed: the binary
  (`chromium-headless-shell` is a distinct build from headed `chromium` launched with `--headless`,
  with its own history of rendering differences from the "new" headless mode) and the font fallback
  chain (glyphs that used to come from the runner image's fontconfig now come from two specific
  self-hosted files). Expect diffs anywhere an arrow, checkmark, dingbat, or emoji renders, plus
  whatever the shell-vs-headed rasterization difference touches. Nothing to regenerate — the merge
  to `main` publishes the new baseline, per ADR 20260729-reg-suit-visual-regression.
- **The CI browser cache drops by roughly half** (the ADR's own measurement: ~270 MB → ~110 MB), and
  cold start should improve correspondingly since there is less to fault off disk on first launch.
- **Fallback glyph rendering is now a lockfile/build fact, not a runner-image fact.** The residual
  risk ADR 20260730-pinned-browser-visual-determinism recorded — "if a diff ever confines itself to
  emoji, this is the first suspect" — is closed for the glyphs this codebase actually uses (arrows,
  checkmarks, dingbats, marketing emoji, enumerated from the current `src/` tree). A future glyph
  outside both self-hosted fonts still falls through to `system-ui, sans-serif` and can still drift;
  that residual is now much smaller and the fix is the same recipe (add the matching Noto font).
- **A local headed Playwright run** (`--headed`, or any future project that sets `headless: false`)
  needs the full `chromium` browser, which CI no longer installs. Not a CI concern today — nothing
  in this fleet runs headed — but worth remembering if that ever changes; the fix is dropping
  `--only-shell` from the install command, not touching `e2e/browser.ts`.
- **Escape hatch:** if `chromium.executablePath()`'s upstream bug is fixed and starts reporting the
  effective (headless-aware) path, `headlessShellExecutablePath()` in `e2e/browser.ts` becomes
  redundant and can be deleted in favor of the plain check it replaced.
