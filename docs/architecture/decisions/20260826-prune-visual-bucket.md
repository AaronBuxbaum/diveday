# 20260826-prune-visual-bucket — Prune visual regression testing bucket while preserving active main baseline

- **Status:** Accepted
- **Date:** 2026-08-26

## Context

Visual regression testing (`reg-suit` via `e2e/visual.spec.ts` and `scripts/visual-compare.mjs`) publishes captured screenshots and comparison reports to the S3 bucket `diveday-vrt` under top-level prefixes named by full 40-character commit SHAs. Over time, pulls requests, feature branches, and merged commits accumulate hundreds of snapshot prefixes in S3 (over 460 prefixes and 500,000 objects totaling >120 GB of data).

Previously, `VisualRegressionBucket` relied on an unconditional 7-day S3 lifecycle expiration rule (`expiration: cdk.Duration.days(7)`). This created a critical operational risk: during quiet engineering periods (>7 days without a commit to `main`), the active main baseline snapshot was automatically purged by S3. Subsequent pull requests and visual runs would fail baseline resolution, report all captured surfaces as *new*, and lose visual diffing until a new commit was pushed to `main`.

Conversely, while active, PR branches and superseded snapshots lingered for 7 days, accumulating substantial storage and list overhead.

## Decision

1. **Intelligent automated pruning with S3 lifecycle safety backstop:**
   - Configure a 30-day object expiration lifecycle rule (`expire-old-visual-snapshots`) on `VisualRegressionBucket` as a backstop ceiling, plus a 1-day abort rule for incomplete multipart uploads (`abortIncompleteMultipartUploadAfter: cdk.Duration.days(1)`).
   - Implement an automated Lambda function `diveday-visual-bucket-pruner` (`VisualBucketPruner`) scheduled daily at 04:00 UTC via EventBridge Scheduler (`VisualBucketPrunerSchedule`) to promptly clean up stale PR snapshots daily while preserving the active main baseline.

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
- **Pruning directly inside CI push-to-main jobs:** Running bucket cleanup on every push to main inside GitHub Actions. Rejected because failed or cancelled CI runs could skip cleanup, whereas a dedicated AWS EventBridge Scheduler + Lambda ensures decoupled, reliable, daily execution independent of CI runner states.
- **Retaining fixed N days of snapshots:** Kept the same flaw: periods of low activity still wipe out the trunk baseline.

## Consequences

- **Main baseline preservation:** The active main baseline is guaranteed to persist in S3 regardless of how many days pass between commits to `main` — *by the pruner*. The bucket's own `expire-old-visual-snapshots` lifecycle rule still deletes every object at 30 days and cannot tell a live baseline from a dead one, so a gap longer than that is still the failure this ADR set out to fix. The rule is a cost backstop, not part of the guarantee.
- **More than one baseline is kept, deliberately.** reg-suit's expected key is the *parent* commit on a push to main and the *fork point* on a pull request (`scripts/reg-suit-keys.mjs`), and for a stacked pull request it is the layer below's head, which is on no branch the main-history walk can enumerate. Keeping only the newest main baseline therefore deleted the baseline of every open branch overnight, and a run with no baseline reports that nothing changed. The pruner keeps the last 10 verified main baselines plus every prefix published in the last 7 days.
- **No verified baseline means no pruning.** If nothing on recent `main` has a published snapshot, the pruner deletes nothing and says so. That state is far more likely to mean the probe cannot read the bucket than that every baseline is genuinely gone, and the earlier behaviour — nominate an unverified HEAD and prune against it — emptied the bucket in one scheduled run.
- **Zero storage bloat:** Stale PR snapshots and obsolete historical baselines are reclaimed daily.
- **Observability:** Pruning runs emit structured JSON logs (`visual_pruner.summary`) to CloudWatch Logs with bounded 1-month retention.
