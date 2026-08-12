# 20260812-platform-backup-runner — A weekly cron writes the platform backup, and AWS watches that it landed

- **Status:** Accepted
- **Date:** 2026-08-12

## Context

[20260802-backup-and-restore-posture](20260802-backup-and-restore-posture.md) established two
recovery layers: Neon PITR, and a scheduled logical export into a private, versioned S3 bucket that
DiveDay controls. The second one was built as far as its edges and no further —
`infra/lib/infra-stack.ts` §11 has the bucket, the lifecycle rules, and a write-only
`diveday-backup-uploader` IAM user; `src/db/export.ts` → `src/lib/export.ts` has the bundle seam;
`src/features/backup-export/` has an S3 client and the shop-owned weekly delivery built on both.

Nothing called one from the other. The runbook said so plainly, in two places: a `TODO(owner)` on
"decide what runs the export on a schedule and wire it up", and a line under *What this runbook does
not cover* stating "do not describe DiveDay as having offsite backups until it does". The uploader's
access key rode in the credentials document's off-dotenv section under the heading
`diveday-backup-uploader -> nowhere yet`.

So the platform's only real recovery layer was Neon's PITR window — whose length is *also* an
unrecorded `TODO(owner)`, and which on a free-tier project can be as little as six hours.

The runbook named two candidate runners: a Vercel Cron route, or a GitHub Actions scheduled
workflow.

## Decision

**A weekly Vercel Cron route builds and uploads the bundles. A weekly EventBridge Scheduler + Lambda
watchdog, in the AWS account that holds the bucket, checks that they landed.**

Two mechanisms, because the job has two halves that want to run in different places.

### The runner: `GET /api/cron/platform-backup`, Mondays 05:00 UTC

The bundle can only be assembled where `DATABASE_URL` and the Vercel Blob token already are, and
that is the Next application. Re-implementing `buildExportBundle` anywhere else would fork the
artifact and quietly invalidate the runbook's restore procedure, which is written once and applied
to whichever copy is at hand. So the runner is an authenticated route beside the four crons that
already exist, and it reuses the shop-owned pass's shape exactly: `CRON_SECRET` bearer, fail closed,
its own Sentry monitor, one log line per pass, one shop's failure never costing another its backup.

Specifics worth recording:

- **The bundle assembly moved to `src/features/backup-export/bundle.ts`** and both runners call it,
  so "the same bundle, two destinations" is a fact rather than an intention.
- **Key convention `exports/<YYYY-MM-DD>/<slug>.zip`**, as the runbook already specified. Date
  first is load-bearing, not cosmetic — see the watchdog below.
- **No delivery ledger table.** The shop-owned backup has one because a *shop* needs to see why its
  backup failed, months later, in a UI. An operator needs to know a *pass* was unclean, now, which
  the route's response, log line and Sentry check-in already say. Idempotency comes from the
  deterministic key instead, and the bucket is versioned so a re-run is additive.
- **Demo shops are excluded** (ADR 20260724-per-visitor-demo-shops): per-visitor fixtures whose
  purpose is to be discarded. A consequence to know about is that the seeded `blue-mantis` fixture
  is itself flagged `isDemo`, so the pass cannot be smoke-tested against the seed.
- **A soft deadline at 240s of the 300s ceiling** stops the pass starting new shops rather than
  being killed mid-upload. A stopped pass is reported (`skipped`), not alarmed: the ordering is
  stable, so next week reaches the same shops first.
- **The uploader credential moves into the app's environment** as `PLATFORM_BACKUP_*`
  (`config/env-registry.mjs`), out of the "nowhere yet" block.

### The watchdog: `diveday-backup-freshness-check`, Tuesdays 06:00 UTC

Everything above tells us a PUT was *accepted*. Nothing tells us a bundle is *there*, and two
distinct failures live in that gap:

1. **The application cannot see its own work.** The uploader is `PutObject` only — no `ListBucket`,
   no `GetObject` — deliberately, so that a leak of the deployed environment cannot be turned into a
   download of every shop's exported waivers. That property is worth keeping, which means the check
   has to come from a different principal.
2. **A backup whose only alarm shares fate with the thing being backed up is not much of an alarm.**
   If the Vercel project is suspended, deleted, or its crons silently stop, then the pass stops and
   so does every signal that would have said so — the log line, the Sentry check-in. Absence of
   evidence becomes indistinguishable from a healthy quiet week.

So the check runs in AWS: an EventBridge Scheduler rule invokes a Lambda that does one
`ListObjectsV2` with `Delimiter: "/"` over `exports/`, reads the run dates back as common prefixes
(ISO dates sort lexicographically into chronological order — which is why the key is date-first),
and publishes to the existing observability SNS topic when the newest run is **missing**, **older
than 8 days**, or **empty of bundles**. It holds `s3:ListBucket` and nothing else: it can answer "is
it there", never "what is in it".

Eight days rather than seven so an ordinary run that drifts by an hour does not alarm.

**Cost: $0.** EventBridge Scheduler's first 14M invocations and Lambda's first 1M requests are
always-free allowances; this is 52 invocations a year. The failure code
`cron_platform_backup.pass_failed` joins the existing `CronPassFailures` metric filter rather than
getting its own, which would have been $0.40/month for a signal that already has a home.

## Alternatives considered

- **A GitHub Actions scheduled workflow** (the runbook's other named candidate) — rejected. It would
  need `DATABASE_URL` and the blob token as repository secrets, widening the blast radius of a
  compromised Actions runner to the production database, to save nothing: the code still has to be
  the app's.
- **EventBridge Scheduler triggering the route directly, instead of Vercel Cron.** Rejected as a
  false independence. Scheduler cannot call an arbitrary HTTPS endpoint, so it would need a Lambda
  holding a shared secret, and the route being triggered still lives on Vercel — so the fate-sharing
  it claims to solve is untouched. Fate-independence belongs in the *verification*, which is where
  this decision puts it, and the trigger stays the boring one-line cron beside the other four.
- **A `pg_dump` layer instead** (the runbook's "obvious next increment"). Not rejected — deferred,
  and still worth doing. It is strictly larger, covering `user_accounts`, `account_tokens` and
  `calendar_feeds`, which the per-shop bundle excludes by design and which is why restoring from
  bundles alone gives you every shop record and nobody who can sign in. It needs a host and the
  direct connection string, which is a bigger decision than this one; shipping the export layer that
  already exists should not wait on it. Filed as
  [FU-20260812-backups-still-cannot-restore-a-login](../../product/follow-ups/FU-20260812-backups-still-cannot-restore-a-login.md).
- **A `platform_backup_deliveries` table** mirroring the shop-owned ledger — rejected as schema for
  its own sake. See the runner section above.
- **Alarming on the cron's Sentry monitor alone.** Rejected: that is exactly the signal that
  disappears in the scenario worth catching.

## Consequences

DiveDay has an offsite backup that actually runs, and the runbook's §2 stops being a documented
capability. The claim "do not describe DiveDay as having offsite backups" can be retired — with one
honest qualifier that survives this change: the bundle still excludes credentials and still drops a
failed photo fetch silently, so a restore from bundles alone means re-inviting every staff account,
and a bundle can be missing a waiver's source document with no signal. Both are pre-existing gaps
stated in the runbook, and neither is made better or worse here.

The weekly pass reads every non-demo shop's full dataset and holds a bundle in memory at a time.
That is the same memory-bound shape the shop-owned pass already has, and the soft deadline bounds
the pass rather than the bundle — a single shop whose bundle does not fit in a Vercel function's
memory would fail as a coded outcome, and would be the signal that this needs streaming.

The known blind spot this creates: the watchdog checks that the newest run has *some* bundles, not
that it has *all* of them, so an estate that outgrows the 300-second slot would be truncated at the
same point every week and still read as healthy. Filed as
[FU-20260812-backup-watchdog-cannot-see-a-short-run](../../product/follow-ups/FU-20260812-backup-watchdog-cannot-see-a-short-run.md),
and it is the first thing to fix if shop count grows.

Nobody has restored from one of these yet. The quarterly restore test in the runbook is still
`never` in its log, and this change does not alter that: a backup nobody has restored is a
hypothesis, and now it is a hypothesis with more evidence that it is being written.
