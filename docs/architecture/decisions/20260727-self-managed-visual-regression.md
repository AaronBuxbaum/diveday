# 20260727-self-managed-visual-regression — Drop Argos for Playwright's own `toHaveScreenshot()`

- **Status:** Accepted
- **Date:** 2026-07-27
- **Supersedes:** 20260721-argos-frozen-clock

## Context

`20260721-argos-visual-regression` (superseded by `20260721-argos-frozen-clock`, which stands
here unchanged — see below) added Argos as the hosted visual-regression service: CI uploads every
screenshot as a "build," Argos diffs it against a baseline, and a human approves or flags each
change in Argos's UI. That worked, but Argos's paid tier became a real recurring cost as the
surface count grew (39 surfaces × light/dark × phone/desktop + 2 print captures — 158 screenshots
per run today). The frozen-clock stabilisation work stands regardless of which backend diffs the
pixels; its own consequences section already anticipated this: "if Argos itself is ever dropped,
the frozen clock and the seam remain useful on their own."

The other requirement driving this change: the primary consumer of a visual diff in this repo is
an AI agent doing the first triage pass (the old `argos-triage` skill), not a human clicking
through a dashboard. An agent can already view images directly (the `Read` tool is multimodal), so
a hosted review UI and a build-listing API aren't load-bearing for that workflow — they're
overhead a self-managed baseline model doesn't need.

## Decision

Replace `@argos-ci/playwright` with Playwright's own `toHaveScreenshot()`, comparing against
baseline PNGs committed to the repo:

- `e2e/visual.spec.ts`'s `capture()`/`capturePrint()` now call `expect(page).toHaveScreenshot()`
  directly, looping over both viewports itself (Playwright has no built-in multi-viewport option
  the way Argos did) and restoring the base viewport afterward. Naming is unchanged in spirit:
  `landing-light-vw-390.png` where Argos produced `landing-light vw-390`.
- Baselines land under `e2e/visual.spec.ts-snapshots/` with the platform-specific Playwright
  filename for the macOS-hosted CI environment and are committed to git — no external service,
  account, or token. Baselines must be generated against the same macOS rendering environment as
  CI; changing the rendering platform can require a coordinated baseline refresh. Measured size at
  158 screenshots: ~61 MB. Plain git handles this fine; Git LFS is a lever to pull later if growth
  outpaces that, not something needed on day one.
- **No separate hosted review step exists.** The dedicated serialized visual CI job owns capture
  and runs Playwright once with `--update-snapshots`; a pixel mismatch becomes a baseline PNG diff
  instead of a failed step. On same-repo pull-request branches and direct `main` pushes, CI commits
  those PNGs back as a separate `ci: capture visual baseline diffs` commit and lets the cheap
  visual-only CI path rerun against that baseline-only change. Real Playwright failures still fail
  the job, and forked PRs get an uploaded baseline artifact because CI cannot push to those
  branches.
  This separate generated commit is the load-bearing replacement for what Argos's hosted approval
  enforced ("agents cannot silently update a baseline in the same commit that regressed it," per
  the original ADR). GitHub's own image-diff viewer (2-up / swipe / onion-skin, already rendered
  on any PR touching a binary PNG) is the review UI a human uses to confirm that commit.
- `.claude/skills/argos-triage` is replaced by `visual-triage`: instead of calling a hosted API to
  list a build's diffs, the skill inspects the generated baseline commit or, for red/unpushable
  runs, checks out the branch and re-runs `e2e/visual.spec.ts` locally. The baseline it diffs
  against is the same committed file in the same repo. `e2e-and-argos` is renamed
  `e2e-and-visual` with the same content, minus Argos-specific API language.
- CI (`.github/workflows/ci.yml`) drops `ARGOS_TOKEN` entirely. Visual regression runs in a
  dedicated macOS-hosted job while non-visual end-to-end coverage runs in parallel shards. Pixel
  diffs are soft-handled as generated baseline commits; non-screenshot Playwright failures remain
  attached to the visual job that produced them. Baseline-only changes narrow the affected
  end-to-end work, but the existing safeguards remain in force and no shard should be treated as a
  substitute for repository checks.
- `.claude/settings.json`'s `mcp__Argos__*` tool allowlist is removed along with the dependency.

## Alternatives considered

- **Keep Argos, negotiate a cheaper tier / trim coverage.** Doesn't address the actual ask (a
  self-managed, cheaper-by-construction setup); still a recurring bill and a hosted account to
  administer.
- **reg-suit / BackstopJS as a self-hosted VRT tool.** Both run their own capture pipeline
  (Puppeteer or their own scenario config) separate from the Playwright specs this repo already
  writes — meaning either duplicate test definitions or a second capture pass, plus a second
  report format to maintain. Playwright already produces an equivalent HTML report
  (`playwright-report/`) with a diff viewer for failed screenshot assertions, uploaded as a CI
  artifact on failure — nothing about reg-suit's or BackstopJS's own review UI is a gain here.
- **Custom pipeline (Playwright + odiff/pixelmatch + S3 + a hand-built review UI).** Most control,
  most build effort, for a diffing algorithm and review surface Playwright's own comparator and
  GitHub's image-diff viewer already provide for free.
- **Vercel Blob for baseline storage instead of committing to git.** Would decouple "the baseline"
  from git history — reverting a commit wouldn't revert the baseline with it, which is worse for
  reproducibility than the current model, where the baseline *is* whatever's committed at that
  path. Considered and rejected; revisit only if repo size from committed PNGs becomes a genuine
  problem (Git LFS is the more natural next lever regardless, since it keeps the baseline
  git-addressed).

## Consequences

- **No recurring cost.** GitHub Actions minutes for the marginal CI rerun a baseline-approval
  commit triggers are the only added spend; the dedicated visual job keeps that rerun scoped to
  visual work while non-visual end-to-end coverage remains independently sharded.
- **Approving a diff now means reviewing a generated commit, not clicking a button.** There's no
  "approve without touching the branch" motion the way Argos's hosted UI allowed; CI pushes the
  baseline commit when permissions allow, and that commit retriggers a scoped visual-only check.
- **The discipline that prevents an agent from silently approving its own regression is now a
  git-history rule** (baseline updates as their own labeled commit), not a system-enforced hosted
  separation. This is weaker in the sense that nothing blocks an agent from ignoring the PNG diff,
  and stronger in the sense that it's visible in the git log forever, not gated behind an account
  only humans can see into. The `visual-triage` skill's pitfalls section calls this out explicitly.
- **Baselines are now part of the repo.** ~61 MB at 158 screenshots today; each accepted visual PR
  adds roughly the size of the surfaces it actually changed (typically a handful of files, not all
  158). Plain git handles this comfortably for the foreseeable future; Git LFS remains the next
  lever if that changes.
- Baseline establishment and refresh must use the macOS-hosted CI rendering platform. A platform
  change can produce broad antialiasing or font-rendering diffs without a product regression, so
  those changes require deliberate triage and a separate baseline commit rather than being folded
  into the code change.
- `20260721-argos-frozen-clock`'s decision (freeze the clock on both sides, never mask) is
  unchanged by this ADR and is marked superseded only because this record is now the head of the
  lineage — the clock-freezing mechanism itself carries forward exactly as documented there.
