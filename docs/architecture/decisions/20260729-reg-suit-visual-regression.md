# 20260729-reg-suit-visual-regression — Use reg-suit with S3 for visual regression

- **Status:** Accepted
- **Date:** 2026-07-29
- **Supersedes:** 20260729-backstop-visual-regression

## Context

We previously migrated from Playwright's `toHaveScreenshot()` to BackstopJS for visual regression testing (ADR `20260729-backstop-visual-regression`). However, BackstopJS was too slow, serializing visual comparisons within each scenario shard, and requiring complex scenario definitions. While Playwright raw screenshot assertions are fast, committing reference PNGs to the repository increases git repository bloat. We want a lightweight visual regression solution that does not require a hosted dashboard service (like Argos or Percy), keeps snapshot files out of the repository, but remains fully pullable/inspectable by MCP servers or AI agents using standard S3 storage.

## Decision

Use `reg-suit` with the `reg-publish-s3-plugin` and `reg-keygen-git-hash-plugin` for visual regression:

- Playwright tests run via `e2e/visual.spec.ts` and capture raw screenshots with `page.screenshot()` into `e2e/screenshots/` (gitignored, and `regconfig.json`'s `actualDir`), running within the standard parallel worker fleet. Nothing in that spec asserts, so a visual change never fails a Playwright test — it appears as a diff in the reg-suit report.
- `reg-suit` manages comparing the current screenshots against the parent git commit's baselines downloaded from AWS S3, generating an interactive HTML report, and publishing the actual screenshots back to S3.
- Infrastructure is managed via AWS CDK in TypeScript under the `infra/` directory (precompiled to JS on deployment).
- S3 configuration is set in `regconfig.json`, resolving the bucket name dynamically from the `$REG_SUIT_S3_BUCKET_NAME` environment variable, with credentials from `$REG_SUIT_AWS_ACCESS_KEY_ID` / `$REG_SUIT_AWS_SECRET_ACCESS_KEY` and the PR comment from `$REG_SUIT_GITHUB_CLIENT_ID`.
- Dev dependencies installed: `reg-suit`, `reg-publish-s3-plugin`, `reg-keygen-git-hash-plugin`, `aws-cdk`, `aws-cdk-lib`, and `constructs`.
- Add scripts to `package.json`:
  - `pnpm visual`: Runs Playwright visual screenshot generation followed by `reg-suit run`. There is deliberately no `visual:update` counterpart — baselines are keyed to git commits in S3, so the way an intentional change becomes the next baseline is by merging it, not by regenerating anything locally.
  - `pnpm infra:deploy`: Deploys the AWS CDK infrastructure stack (`DiveDay`) using `tsx` on-the-fly.
  - `pnpm infra:synth`: Synthesizes the CDK infrastructure template.
  - `pnpm infra:diff`: Compares local CDK modifications against deployed resources.

## Alternatives considered

- **Playwright native toHaveScreenshot():** Fast and simple, but commits visual baseline images to git, increasing repository size over time.
- **BackstopJS:** Rejected due to slow execution speed and complex configuration overhead.
- **Hosted visual dashboard (Argos/Percy):** Excluded to avoid hosting a separate dashboard service.

## Consequences

- **Git repository clean:** Visual baselines are stored externally in S3, avoiding repository size growth.
- **AWS S3 dependency:** Running the visual regression suite requires `$REG_SUIT_AWS_ACCESS_KEY_ID`, `$REG_SUIT_AWS_SECRET_ACCESS_KEY`, and an S3 bucket named by `$REG_SUIT_S3_BUCKET_NAME` (all set from repository secrets in `.github/workflows/ci.yml`). Without them `pnpm visual` still captures the screenshots; only the comparison step needs the bucket.
- **Fast runtimes:** Parallel screenshot capture in Playwright coupled with `reg-suit`'s fast image comparison engine ensures quick feedback loops.
- **The CI job needs a real branch and real history.** Keys come from git, not from
  the CI event: `reg-keygen-git-hash-plugin` reads HEAD for the actual key and walks
  back to this commit's *parent* for the expected one. A default `actions/checkout`
  breaks both — on a `pull_request` it lands on a detached merge commit, and
  `fetch-depth: 1` leaves no parent to reach. The failure is loud but misleading:
  every screenshot reports as *new* rather than compared (so the diff count is a
  reassuring zero) and the job then dies on "Fail to detect the current branch"
  without having looked at a pixel. The `visual` job therefore checks out
  `${{ github.head_ref || github.ref_name }}` at `fetch-depth: 0`. If this job ever
  goes red with zero changed items and a git error, this is why — read the log
  before assuming the baseline moved.
- **The hosted report needed a script to actually be agent-pullable.** The design goal above ("remains
  fully pullable/inspectable by MCP servers or AI agents using standard S3 storage") was only half
  true: the S3 bucket is public and needs no credentials, but `index.html` is a client-rendered SPA —
  its body is `<div id="app"></div>` until JS runs — so a text-only fetch sees nothing, and every
  object is stored with `Content-Encoding: gzip`, which some HTTP clients decode transparently and
  others (plain `curl`, `https.get`) hand back as opaque bytes. `pnpm visual:report`
  (`scripts/visual-report.mjs`) fetches `out.json` and the relevant `expected`/`actual`/`diff` PNGs
  for a commit, decoding gzip by magic number rather than trusting the header, and writes them plus a
  `REPORT.md` summary to `.reg-report/<commit>/` — flat files an agent's `Read` tool can open directly,
  no browser or AWS credentials required. See the **visual-triage** skill.
- **A direct push to main needs a git branch reg-suit doesn't otherwise have.** `reg-keygen-git-hash-plugin`'s
  expected-key detection (`getBaseCommitHash()`) only works by computing a merge-base against *other* local
  branches — it has no "just diff against the previous commit" mode, because it's designed for a topic-branch-vs-trunk
  PR flow. The `visual` job's checkout puts only `main` in the working copy for a push event, so there is no other
  branch to triangulate against: the key generator returns null, and every screenshot on every push to main used to
  report as brand new — "Failed to detect the previous snapshot key" / "New items: N" / "Passed items: 0" in the CI
  log, every time, without ever actually comparing a pixel. The `visual` job now adds a branch ref at `HEAD^` before
  running `pnpm visual` (only on `push`, not `pull_request`, where the existing branch-vs-main triangulation already
  works) — that gives the plugin the second branch its algorithm needs, so it resolves the previous commit's
  published S3 snapshot as the baseline and only reports a diff when the pixels actually changed. If that previous
  snapshot was never published, the S3 fetch just comes back empty and the run degrades to the old all-new behavior
  for that one push, rather than a hard failure.
- **The `reg` commit status is suppressed on direct pushes to main, kept on PRs.** `reg-notify-github-plugin`'s
  `setCommitStatus` ties the `reg` GitHub status directly to whether `reg-suit run` found *any* pixel diff against
  the immediate parent commit — it has no notion of "a human already approved this in the PR". On a PR that's the
  point: an unreviewed diff should block merge, per the visual-triage skill. But a push straight to `main` is
  already-merged history, and the same diff reappears there for the same reason (the comparison is always against
  the immediate parent, never against "was this signed off on"), with no PR left for the status to gate — so every
  commit that legitimately changed a pixel left main showing a permanently red, unactionable `reg` status. The
  `visual` job now patches `regconfig.json` to set `setCommitStatus: false` before running `reg-suit run`, but only
  `if: github.event_name == 'push'`; pull requests are untouched and still get the enforced status. The
  "reg-suit visual regression" Actions job itself is a separate signal either way — it only fails on a real pipeline
  error (build, install, upload), never on a pixel diff, on both events.
