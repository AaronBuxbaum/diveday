# 20260812-platform-database-dump — Back up the whole cluster, not just what a shop may take with it

- **Status:** Accepted
- **Date:** 2026-08-12
- **Supersedes:** nothing. Extends
  [20260802-backup-and-restore-posture](20260802-backup-and-restore-posture.md) and
  [20260812-platform-backup-runner](20260812-platform-backup-runner.md).

## Context

DiveDay's platform backup runs weekly and stores per-shop export bundles. Those bundles are built
from the **export** seam — the code path that exists so a shop can *leave* — and `NOT_INCLUDED` in
`src/lib/export.ts` deliberately withholds login accounts and password hashes, email-verification /
password-reset / invite tokens, and staff calendar-subscription links. That is correct for
portability: a shop walking away must not receive password hashes.

It also means a restore from bundles alone reconstitutes every shop, every booking, every waiver —
and **nobody who can sign in**. The missing tables are `user_accounts`, `account_tokens` and
`calendar_feeds`.

Until now the only thing covering that gap was Neon's point-in-time recovery, for however long its
window is. The owner's answer to that question, 2026-08-12, is that **the window is not long enough
to rely on** — which is the branch
`FU-20260812-backups-still-cannot-restore-a-login` called "the highest-priority gap in the recovery
posture, above anything else in this register".

Two things stood in the way of the fix the runbook has named since 2026-08-02, and both are now
answerable:

1. **A host.** `pg_dump` is a binary, and it needs the **direct** connection string
   (`DATABASE_URL_UNPOOLED` — a transaction-mode pooler is unreliable for this, the same reason
   migrations use the direct connection). A Vercel function is a poor host: no `pg_dump`, and a full
   dump is not a 300-second, memory-bounded job.
2. **Where such a file may live.** A full dump holds every password hash and every medical answer in
   the platform, in one file. Retention is tangled with **H-02** (waiver retention, still open).

## Decision

**A weekly CodeBuild project, `diveday-database-dump`, streaming a `pg_dump` into the existing
backup bucket under its own `dumps/` prefix.** `infra/lib/infra-stack.ts` §20.

- **Host: AWS CodeBuild**, `BUILD_GENERAL1_SMALL`, image
  `public.ecr.aws/docker/library/postgres:17-alpine` (AWS's ECR Public mirror of the official image,
  so the pull needs no Docker Hub credential). It runs an arbitrary image on a schedule with no VPC,
  no NAT and no cluster to keep warm — the cheapest host in AWS for "run one Postgres client tool
  once a week", at cents a month billed by the minute. The image is pinned to the Postgres **major**
  version because `pg_dump` may be newer than its server but never older; raising
  `DUMP_POSTGRES_MAJOR` when Neon upgrades is the entire maintenance burden of that choice.
- **Schedule: EventBridge Scheduler, Mondays 05:30 UTC**, via the universal `codebuild:startBuild`
  target (no Lambda in the middle whose only job is one SDK call). Half an hour after the export pass
  and a day before the watchdog, so one week's dump and one week's bundles carry the same run date.
  In AWS rather than on Vercel for [20260812-platform-backup-runner](20260812-platform-backup-runner.md)'s
  reason restated: a backup that can only run where the app runs shares fate with it.
- **Streamed, never staged.** `pg_dump --format=custom … | gzip | aws s3 cp -` under
  `set -o pipefail`. No temporary file, so the job needs no disk headroom; and `pipefail` is
  load-bearing rather than hygiene — without it the build's exit status is the *upload's*, so a
  `pg_dump` that died mid-stream would store a truncated dump and report success, which is the single
  worst outcome available here. The buildspec then reads the object's own `ContentLength` back, so
  "the PUT was accepted" is not mistaken for "a dump is there".
- **Its own credential, in its own secret.** `diveday/database-url-unpooled`, deployed holding the
  literal `unset`, filled in once by a human (§17's `database-dump-connection` action, now on the
  short checklist). Not folded into `diveday/env`: that secret is the stack's *outbound* hand-off
  document, rewritten from a rendered `.env.example` on every deploy, so a pasted value there would be
  overwritten by the next `cdk deploy`. A stack that was never handed a connection string fails its
  first build with a named message rather than storing a zero-byte object every week.
- **Write-only, into one prefix.** The job's role holds `s3:PutObject`/`AbortMultipartUpload` and
  (for the size read-back) `GetObject`, all scoped to `dumps/*`. It cannot reach the shop bundles
  under `exports/`, and it cannot delete anything. Restoring a dump is a deliberate human act with the
  admin profile.
- **Kept 35 days, then deleted.** Its own lifecycle rule on the `dumps/` prefix, and deliberately the
  opposite of the bundles' "current versions never expire". A bundle is a portability artifact with no
  credentials in it and waiver rows H-02 makes indefinite. A dump answers "the Neon project is gone and
  PITR cannot reach back far enough" — a question asked within days of the loss, never months. Holding
  a file of every password hash and every medical answer for longer than it can plausibly be used is a
  liability, not a backup. Five weeks covers a missed run plus a holiday. `DUMP_RETENTION_DAYS` is the
  one number to change if H-02 lands somewhere else. No transition to Infrequent Access first: IA has a
  30-day minimum billing duration, so aging an object that expires at 35 days costs *more* than leaving
  it standard.
- **Watched by the existing weekly check**, not a second one: `diveday-backup-freshness-check` gained
  one more `ListObjectsV2` over `dumps/` and alarms when the newest dump is missing or older than the
  same 8-day threshold. It runs that check **before** the bundle logic, because that logic returns
  early on each of its own failures and a week where both layers broke has to raise both alarms.

## Alternatives considered

- **Add `user_accounts` to the export bundle.** Rejected outright, and the follow-up said so first:
  that puts password hashes behind a button staff can click on a settings page. A far worse trade than
  the gap it closes.
- **A Lambda with a `pg_dump` layer.** Needs a binary sourced from somewhere and kept patched, and a
  full dump is not a 300-second memory-bounded job. The 15-minute ceiling would arrive eventually and
  arrive during growth, which is the worst time for a backup to start failing.
- **Fargate on a schedule.** Same container story as CodeBuild with a VPC, subnets and (for egress to
  Neon) a NAT gateway or VPC endpoints — tens of dollars a month of standing cost against a $30 budget,
  for 52 runs a year.
- **`pg_dump` from the app on Vercel.** No binary, no time, and it would need the direct connection
  string in the same environment as the write-only uploader credential — undoing the property that
  makes shipping that credential to a third party acceptable.
- **Neon's own branch/snapshot export.** Vendor-internal, so it does not answer the one question the
  dump exists for: surviving loss of the Neon account itself.
- **Keep dumps forever, like the bundles.** Rejected on the content, not the cost: an indefinite
  archive of every password hash in the platform is a bigger risk than the recovery it buys, and PITR
  plus a five-week dump window plus indefinite bundles already covers every realistic timeline.

## Consequences

- **The recovery story is now complete but two-part.** A full restore is: `pg_restore` the newest dump
  for accounts, tokens and calendar feeds, and the bundles for anything newer than the dump. Section 2c
  of the backup-and-restore runbook is the procedure; section 4's quarterly restore test now covers it.
- **A new manual step, on the short checklist.** Until `diveday/database-url-unpooled` is filled in
  the dump layer does not exist. The watchdog says so within a week rather than silently — but the
  checklist entry is what stops that week happening at all.
- **One more secret**, so Secrets Manager's fixed cost goes from $0.80 to $1.20 a month. Against the
  $30 budget that is noise; §16's "one secret, not eight" argument is about the *hand-off document*
  having one reader, and this is not that document.
- **A dump is the most sensitive object in the account.** Nothing reachable from the application can
  read it, its prefix expires, and the job that writes it cannot read the bundles beside it — but the
  file exists, and anyone with account admin can read it. That is the same posture as the bundles and
  it is worth stating rather than implying.
- **Escape hatch:** if the Neon PITR window is later lengthened to something comfortable, this layer
  narrows from day-to-day recovery to vendor-independence insurance, and the schedule could drop to
  monthly by changing one cron expression. Nothing else keys on the cadence.
