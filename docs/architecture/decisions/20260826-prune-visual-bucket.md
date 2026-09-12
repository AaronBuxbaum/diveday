# 20260826-prune-visual-bucket — Prune visual regression testing bucket while preserving active main baseline

- **Status:** Accepted
- **Date:** 2026-08-26

## Context

Visual regression testing (`reg-suit` via `e2e/visual.spec.ts` and `scripts/visual-compare.mjs`) publishes captured screenshots and comparison reports to the S3 bucket `diveday-vrt` under top-level prefixes named by full 40-character commit SHAs. Over time, pulls requests, feature branches, and merged commits accumulate hundreds of snapshot prefixes in S3 (over 460 prefixes and 500,000 objects totaling >120 GB of data).

Previously, `VisualRegressionBucket` relied on an unconditional 7-day S3 lifecycle expiration rule (`expiration: cdk.Duration.days(7)`). This created a critical operational risk: during quiet engineering periods (>7 days without a commit to `main`), the active main baseline snapshot was automatically purged by S3. Subsequent pull requests and visual runs would fail baseline resolution, report all captured surfaces as *new*, and lose visual diffing until a new commit was pushed to `main`.

Conversely, while active, PR branches and superseded snapshots lingered for 7 days, accumulating substantial storage and list overhead.

## Decision

1. **Intelligent automated pruning with S3 lifecycle safety backstop:**
   - Configure a 60-day object expiration lifecycle rule (`expire-old-visual-snapshots`) on `VisualRegressionBucket` as a backstop ceiling, plus a 1-day abort rule for incomplete multipart uploads (`abortIncompleteMultipartUploadAfter: cdk.Duration.days(1)`). It was 30 days as written, then 180, and is 60 since 2026-09-10 — see the second amendment.
   - Implement an automated Lambda function `diveday-visual-bucket-pruner` (`VisualBucketPruner`) scheduled every six hours via EventBridge Scheduler (`VisualBucketPrunerSchedule`) to promptly clean up stale PR snapshots while preserving the active main baseline. It ran nightly at 04:00 UTC until 2026-09-10.

2. **Active Baseline Resolution Algorithm:**
   - Query GitHub REST API (`GET /repos/AaronBuxbaum/diveday/commits?sha=main&per_page=30`) or local `git log` to retrieve recent commit SHAs on `main`.
   - Walk candidate commits from newest to oldest, probing S3 for `${sha}/out.json`.
   - The newest commit with an extant snapshot report is identified as the active main baseline.
   - List all top-level directory prefixes in the S3 bucket via `ListObjectsV2Command` (`Delimiter: "/"`).
   - Preserve the active main baseline prefix (and any explicitly requested commit SHAs).
   - Delete all objects under stale prefixes in 1000-object batches via `DeleteObjectsCommand`.

3. **Developer CLI Tooling:**
   - Provide `scripts/prune-visual-bucket.mjs` and `pnpm visual:prune` with support for `--dry-run`, `--bucket <name>`, `--keep <sha>`, and `--repo <owner/repo>` to inspect or trigger pruning on demand from any environment.
   - Provide AWS CLI invocation support (`aws lambda invoke --function-name diveday-visual-bucket-pruner /dev/stdout`).

## Alternatives considered

- **S3 Object Tagging + Lifecycle Rules:** Tagging main baselines as `keep=true` and applying S3 lifecycle filter rules. Rejected because reg-suit's S3 publisher plugin does not support custom object tags on upload without modifying third-party code, and retrospective tag updates across 1,000+ objects per run introduce API latency and cost.
- **Pruning directly inside CI push-to-main jobs:** Running bucket cleanup on every push to main inside GitHub Actions. Rejected because failed or cancelled CI runs could skip cleanup, whereas a dedicated AWS EventBridge Scheduler + Lambda ensures decoupled, reliable execution on its own cadence, independent of CI runner states.
- **Retaining fixed N days of snapshots:** Kept the same flaw: periods of low activity still wipe out the trunk baseline.

## Consequences

- **Main baseline preservation:** The active main baseline is guaranteed to persist in S3 regardless of how many days pass between commits to `main` — *by the pruner*. The bucket's own `expire-old-visual-snapshots` lifecycle rule still deletes every object at 60 days and cannot tell a live baseline from a dead one, so a gap longer than that is still the failure this ADR set out to fix. The rule is a cost backstop, not part of the guarantee.
- **More than one baseline is kept, deliberately.** reg-suit's expected key is the *parent* commit on a push to main and the *fork point* on a pull request (`scripts/reg-suit-keys.mjs`), and for a stacked pull request it is the layer below's head, which is on no branch the main-history walk can enumerate. Keeping only the newest main baseline therefore deleted the baseline of every open branch overnight, and a run with no baseline reports that nothing changed. The pruner keeps the last 10 verified main baselines plus every prefix published in the last day (amended 2026-09-08, below).
- **No verified baseline means no pruning.** If nothing on recent `main` has a published snapshot, the pruner deletes nothing and says so. That state is far more likely to mean the probe cannot read the bucket than that every baseline is genuinely gone, and the earlier behaviour — nominate an unverified HEAD and prune against it — emptied the bucket in one scheduled run.
- **Zero storage bloat:** Stale PR snapshots and obsolete historical baselines are reclaimed every six hours.
- **Observability:** Pruning runs emit structured JSON logs (`visual_pruner.summary`) to CloudWatch Logs with bounded 1-month retention.

## Amended 2026-09-08: the age floor is one day, not seven

The floor was seven days, which meant every branch's captures sat in the bucket for a week whether or not anything was still comparing against them — the dominant term in the bucket's size, since the count-based `KEEP_MAIN_BASELINES` already holds the main history at ten prefixes however old they are.

It is now **one day** (`MIN_PRUNE_AGE_MS` in `scripts/prune-visual-bucket-lib.mjs` and `infra/lib/visual-bucket-pruner-handler.ts` — the two copies must move together). What the floor is *for* is unchanged: covering a baseline the main-history walk cannot name, which in practice is a stacked pull request's lower layer. That layer publishes its own prefix on every push, and a stack whose lower layer has not been pushed in over a day is not a stack anyone is iterating on — its next push republishes the prefix before the layer above needs it. The ten kept main baselines are untouched by this, and neither is the refusal to prune with nothing verified to keep.

## Amended 2026-09-10: a sixty-day floor and a six-hourly pruner

The lifecycle rule is **60 days** (it was 180) and the pruner runs **every six hours** (it was nightly at 04:00 UTC). Both are in `infra/lib/infra-stack.ts`, sections 8 and 15; `infra/lib/visual-bucket-pruner.test.ts` pins both at synth time. Nothing about *what* is kept moved — see the four invariants below, none of which this touches.

**Why the floor came down.** 180 days was chosen as a backstop for the case the pruner itself stops running, and that is still all it is: in normal running the pruner reclaims a branch snapshot within about thirty hours, so nothing in this bucket is ever sixty days old, let alone a hundred and eighty. What the number actually sets is the ceiling on a *silent pruner outage*. At roughly 91 CI runs a day and ~213 MB a run (854 PNGs at ~250 KB) a dead pruner accumulates about 19 GB a day, so the ceiling falls from ~3.5 TB (~$80/month) to ~1.15 TB (~$27/month). Sixty days is still sixty chances for the pruner to act first, and still far outside any open branch's life.

**Why the cadence went up.** The floor under a branch snapshot is 24 hours, but the *collection* of one that is already past that floor waited for the next nightly run — so a branch snapshot's worst case was ~48 hours. At four runs a day it is ~30. Branch snapshots are the dominant term in this bucket's size, so this is the one lever here that reaches steady-state storage without touching a retention guarantee. It quadruples the pruner's GitHub API calls (`fetchGitHubBranchCommits`, 30 commits a call) and its `ListObjectsV2` traffic; both are trivially cheap, and the refusal to prune when nothing on recent `main` is verified is what keeps a rate-limited call safe rather than destructive.

**What this does not do, and the runbook says so too.** It does not move the $12/month S3 line that issue #1651 was filed about. That bill is request-shaped, not storage-shaped: the bucket's steady state is roughly ten main baselines plus a day and a half of branch runs — about 145 snapshots x 854 PNGs x ~250 KB, or ~31 GB, which is ~$0.71/month of `TimedStorage-ByteHrs`. The six-hourly cadence takes perhaps a third off the branch term, which is cents. The $12 is ~900 Tier-1 PUTs per publishing run at $0.005/1,000, at the repository's own rate of ~26 merges plus ~65 branch commits a day: $0.41/day, ~$12.3/month, which lands on the measured $0.38/day and on the August invoice. Neither a lifecycle rule nor a pruner touches a PUT. The lever that would is whether every CI run needs to upload every capture, filed separately.

**Four things this amendment deliberately does not change**, because each of them is a way to break the suite silently rather than loudly:

- `KEEP_MAIN_BASELINES = 10`, in both copies. reg-suit's expected key is the fork point on a pull request, so lowering it deletes the baseline of every open branch — and a run with no baseline reports `Changed: 0`.
- `MIN_PRUNE_AGE_MS = 24h`, in both copies. It is the only thing that knows about a stacked pull request's lower layer, which is on no branch the main-history walk can enumerate.
- The refusal to prune when nothing on recent `main` has a verified snapshot.
- The rule that the lifecycle expiry may only ever be a **floor beneath** the pruner, never a bound that can reach inside it. Sixty days clears the pruner's own horizon by a wide margin; the synth test named "expires objects far beyond the pruner's own retention, never inside it" is what holds that line against a future tightening.
