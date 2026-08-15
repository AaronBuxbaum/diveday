# 20260812-platform-database-dump — Back up the whole cluster, not just what a shop may take with it

- **Status:** Accepted
- **Date:** 2026-08-12
- **Amended:** 2026-08-15 — the dump moved out of the export bundles' bucket into one of its own. See
  the amendment at the end of *Decision*; it is the part to read before adding any principal that can
  write to either bucket.
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

**A weekly CodeBuild project, `diveday-database-dump`, streaming a `pg_dump` into S3 under a
`dumps/` prefix.** `infra/lib/infra-stack.ts` §20. It shared the export bundles' bucket until
2026-08-15; see the amendment at the end of this section for why it now has one of its own, which is
the part to read before adding anything that can write to either.

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
  under `exports/` — since the 2026-08-15 amendment below it holds no grant on their bucket at all —
  and it cannot delete anything. Restoring a dump is a deliberate human act with the admin profile.
- **Kept 35 days, then deleted.** Its own lifecycle rule, and deliberately the opposite of the
  bundles' "current versions never expire". A bundle is a portability artifact with no
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

### Amendment (2026-08-15): the dump gets its own bucket

**`DatabaseDumpBucket` (`diveday-database-dumps`), separate from `DatabaseBackupBucket`.** Everything
above stands; only the destination moves. This is the amendment written for whoever next adds a
principal that can write to either bucket, so it is stated as reasoning rather than as a diff.

The two artifacts share almost nothing:

| | `exports/` (the bundle bucket) | the dump bucket |
| --- | --- | --- |
| Writer | IAM user whose access key lives in **Vercel** | CodeBuild role that never leaves AWS |
| Contents | Per-shop bundles, deliberately excluding `user_accounts`, `account_tokens`, `calendar_feeds` | The full cluster: every password hash and every medical answer |
| Retention | Current versions never expire (H-02 makes it a legal call) | 35 days, then deleted |
| Restores a login | No | **Yes — it is the only thing that does** |

Colocating them meant every grant on that bucket had to be **remembered** to be prefix-scoped. Two of
the three were. The one that was not — the uploader's `arnForObjects("*")`, narrowed on 2026-08-15 —
was the one whose credential ships to a third party, so a leaked Vercel environment could overwrite
the one artifact that restores a login, and the freshness check would have read the overwrite as a
fresh dump. That specific hole was closed by narrowing the grant. This is the other half: a separate
bucket makes the class of mistake **unrepresentable rather than reviewable**, which is the difference
between a rule and a guardrail. No principal holding Vercel-resident credentials has any grant on the
dump bucket at all, so there is no prefix to remember.

What that cost, and what it bought:

- **The watchdog is still one function.** This was the constraint that made the decision non-obvious:
  §19 checks the dump and the bundles in one pass on the stated reasoning that *two alarms with the
  same trigger and the same reader is one too many*. The split changed that argument by one word —
  "one more prefix" became "one more bucket" — which is one more `s3:ListBucket` statement
  (`ListDatabaseDumpsOnly`) and one more environment value (`DUMP_BUCKET`). A second watchdog would
  have been a second schedule, a second log group, a second retry policy and a second thing to
  remember exists, for one `ListObjectsV2` call. `infra/lib/backup-freshness.test.ts` asserts there
  is exactly one.
- **The dump bucket is unversioned, and that is a fix rather than a downgrade.** On a *versioned*
  bucket a lifecycle expiration deletes nothing: it writes a delete marker and the bytes survive as a
  non-current version until `noncurrentVersionExpiration`. "Kept 35 days" therefore meant the file
  existed for up to **70** days — twice the window chosen for an artifact whose entire retention
  argument is that holding it longer is a liability, doubled by a bucket property picked for the
  bundles. Unversioned, 35 days means 35 days. What versioning was buying here went with the shared
  bucket: it insured against an overwrite of a good object by a bad one, and the overwriter it
  insured against was a principal that should never have been able to write a dump. The writer that
  remains holds no `DeleteObject` and writes a date-stamped key, so the worst it can do is replace
  *today's* dump; last week's is a different key and untouched. The bundle bucket keeps versioning —
  its overwrite story and its indefinite retention are both unchanged.
- **The `dumps/` prefix stays, and so does the prefix-scoped grant.** The prefix keeps every
  documented path, the watchdog's date-folder listing and a one-line `aws s3 sync` between the two
  buckets exactly as they were. Keeping the grant scoped to it after it stopped being the boundary
  costs nothing, and widening it *because* the bucket is now dedicated is precisely how a dedicated
  bucket stops being dedicated.
- **The bundle bucket's `dumps/` prefix keeps its expiry rule**, renamed `drain-legacy-database-dumps`
  so its status is legible. Nothing writes it any more, but the dumps already there are real dumps;
  deleting the rule would strand them in a bucket whose other prefix never expires. It goes when the
  prefix is empty of *versions* (roughly 70 days after the deploy, per the paragraph above —
  `aws s3api list-object-versions`, not `aws s3 ls`). Until then the uploader's `exports/*` scoping is
  still load-bearing, not merely tidy.

**Not done: moving `exports/` instead.** The bundles are what the app writes constantly and the dump
is the rarer, more dangerous artifact. If one moves behind a stricter boundary it is the dump.

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
- **Leave the dump in the bundles' bucket and write down that colocation is deliberate**
  (the alternative weighed on 2026-08-15, raised by
  `FU-20260815-dumps-and-exports-share-one-bucket`). It is the cheap option and it is honest as long
  as the invariant it depends on — *every* grant on that bucket is prefix-scoped — really is enforced
  for every principal, which the tests did cover. Rejected because that invariant is a rule an author
  has to remember, and the one time it was not remembered it shipped a credential with reach over the
  dump to a third party. The bucket boundary needs remembering by nobody. The stated cost of splitting
  — the freshness check needing a second grant, or worse becoming two functions — turned out to be one
  `ListBucket` statement.
- **S3 Object Lock on the dump bucket** (WORM, so not even an admin can delete a dump inside its
  window). Rejected: Object Lock requires versioning, which is the property this bucket deliberately
  drops so that "35 days" is a real 35 days, and a compliance-mode lock on a file of every password
  hash in the platform makes the retention decision *harder* to honour rather than easier.

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
  read it, its bucket expires everything in it, and the job that writes it has no grant on the bundle
  bucket — but the file exists, and anyone with account admin can read it. That is the same posture as
  the bundles and it is worth stating rather than implying.
- **The 2026-08-15 split is a migration, not a rename** — the old bucket is `RemovalPolicy.RETAIN`
  with a live weekly writer and a restore procedure pointing at it. The sequence, and the transition
  window it opens, are §2c of
  [the backup and restore runbook](../../engineering/backup-and-restore-runbook.md); the two facts
  that make it one rather than a cutover are that **old dumps are not copied** (they stay readable in
  the bundle bucket for the rest of their 35-day window rather than being re-dated by a copy, which
  would restart their expiry clock) and that **the new bucket is empty until a dump runs into it**, so
  a deploy that lands between a Monday dump and the Tuesday watchdog raises one honest false alarm
  unless a build is started by hand. Starting one is the same command the setup step already
  documents, and it doubles as proof the new grant works.
- **Two buckets to re-adopt after a `cdk destroy`, not one.** The `backup-bucket-readoption` manual
  action (§17) now names both, and `--context dumpBucketName=` is the escape hatch beside
  `--context backupBucketName=`.
- **Escape hatch:** if the Neon PITR window is later lengthened to something comfortable, this layer
  narrows from day-to-day recovery to vendor-independence insurance, and the schedule could drop to
  monthly by changing one cron expression. Nothing else keys on the cadence.
