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
  without having looked at a pixel. The `visual-report` job (the merge/compare stage that
  runs `reg-suit run` after the sharded `visual` capture jobs finish — see
  `20260802-shard-visual-regression-ci.md`) therefore checks out
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
  PR flow. The `visual-report` job's checkout puts only `main` in the working copy for a push event, so there is no
  other branch to triangulate against: the key generator returns null, and every screenshot on every push to main
  used to report as brand new — "Failed to detect the previous snapshot key" / "New items: N" / "Passed items: 0" in
  the CI log, every time, without ever actually comparing a pixel. The `visual-report` job now adds a branch ref at
  `HEAD^` before running `pnpm visual:compare` (only on `push`, not `pull_request`, where the existing
  branch-vs-main triangulation already works) — that gives the plugin the second branch its algorithm needs, so it
  resolves the previous commit's
  published S3 snapshot as the baseline and only reports a diff when the pixels actually changed. If that previous
  snapshot was never published, the S3 fetch just comes back empty and the run degrades to the old all-new behavior
  for that one push, rather than a hard failure.
- **Main failing to publish a snapshot is now loud on the run that caused it** (added 2026-08-06). The
  degradation above is the *consumer* side and is unchanged: a run that finds no baseline still
  reports everything as new rather than failing hard. The producer side had no signal at all. Because
  the publish steps are correctly gated on every visual shard succeeding — a partial capture set would
  become the next commit's baseline and report the missing surfaces as new forever after — one flaky
  screenshot on a push to main means that commit publishes nothing, and every branch cut from it is
  blind. Nothing said so: the shard's own red reads as one flaky capture, `visual-report` stayed green
  because the publish steps were *skipped* rather than failed, and a push has no pull request for the
  sticky summary comment to land on, so the warning went to a job summary nobody opens. It was
  discovered twice on 2026-08-06, days apart, each time from an unrelated branch's red `reg` status
  and a backwards investigation. `visual-report` now fails on a push whose shards did not all succeed,
  with an error naming the consequence and the fix (re-run the failed shard; a green re-run publishes
  the snapshot). Pull requests are deliberately exempt — a PR's missed snapshot is never anyone else's
  baseline, and its visual report and sticky comment already say what happened.
- **Both keys are now named outright, and the two entries above are history** (changed 2026-08-23,
  issue #909). `reg-keygen-git-hash-plugin` took no options at all, so the only way to steer it was
  to arrange the local git graph the way its merge-base triangulation wanted to read it — which is
  what the detached-HEAD `git checkout -B` and the invented `reg-suit-baseline-parent` branch above
  were for. `regconfig.json` now carries `reg-simple-keygen-plugin` and `scripts/reg-suit-keys.mjs`
  computes the two keys from the CI event: the head commit for the actual one, and
  `git merge-base origin/<base ref> HEAD` (pull request) or `HEAD^` (push to main) for the expected
  one. Measured against the plugin it replaces over a throwaway stack, it returns the identical sha
  in every case the plugin could answer at all, which is the property that matters — the whole
  published baseline history is keyed by full 40-character sha, so a different key format would make
  all of it unreachable at once. Both steps are deleted; the checkout keeps its SHA pin and
  `fetch-depth: 0`, which a merge-base still needs. The consumer side is unchanged: an unresolvable
  expected key still degrades to "no baseline, everything reported as new" rather than failing hard,
  and the log still says `Failed to detect the previous snapshot key`. Reasoning and the measurement
  are in [20260821-stacked-pull-requests](20260821-stacked-pull-requests.md).
- **Two merges landing within `visual-report`'s 6-10 minute runtime raced the checkout onto the wrong
  commit** (found 2026-08-14). The job's checkout used `ref: ${{ github.event.pull_request.head.sha ||
  github.ref_name }}` — a branch *name* (`main`) for push events, resolved to whatever `main` currently
  points to when the checkout step actually runs, not the commit that triggered this run. Every other
  job in the workflow checks out `github.sha` implicitly (no `ref` at all), pinning to the exact
  triggering commit; this was the one job that didn't. If a second push landed on `main` while the
  first push's `visual-report` job was still running, the checkout would silently pick up the *second*
  commit while the screenshots downloaded via `download-artifact` in the same job stayed the first
  commit's own (artifacts are matched by workflow run, not by SHA). reg-suit then derived its git keys
  from the wrong commit and published the first commit's screenshots to S3 tagged under the second
  commit's hash — so the first commit's own hash was never published. The next run's baseline lookup
  (`HEAD^`, per the entry above) found nothing under that hash and fell back to the same "no baseline"
  path as a missing snapshot: every screenshot read as new, none as compared. Reproduced by merging
  twice in quick succession on main (427 new items, 0 compared, 0 deleted). Fixed by pinning the
  checkout to `github.sha` for push events too, matching every other job.

### Amended 2026-09-01: the baseline is the nearest published ancestor

The expected key still comes from the graph (`scripts/reg-suit-keys.mjs`), but the graph does not
know which commits published. Three things leave a commit with no snapshot: a change touching only
`docs/`, Markdown or `.claude/` now skips the visual half of CI outright (the `changes` gate in
`ci.yml`); a push to `main` whose run was cancelled or lost a capture shard published nothing (five
consecutive main runs were cancelled on 2026-09-01 and the next one compared 0 of 696 surfaces);
and a stacked layer whose layer below never finished. `scripts/wait-for-baseline.mjs` now runs on
every `visual-report`, not only a stacked one: after any wait, if the expected key has no `out.json`
it walks up to forty first-parent ancestors and substitutes the nearest one that published, writing
the substitution into `REG_EXPECTED_KEY` and a `REG_BASELINE_NOTE` the sticky comment renders. The
diff may then include main's own movement between the two commits, and says so; the alternative was
comparing nothing under a reassuring `Changed: 0`. `pnpm visual` does the same locally. Main pushes
also get a concurrency group per commit, since `cancel-in-progress: false` never protected a
*queued* run.

