# Backup and restore runbook

How DiveDay's production data is protected and how it comes back. Three DiveDay-side layers:

1. **Neon's own point-in-time recovery** over the Postgres project provisioned by Vercel's Marketplace
   integration ([ADR 20260718-vercel-neon-hosting](../architecture/decisions/20260718-vercel-neon-hosting.md)).
   §1.
2. **A scheduled logical export** built on the existing per-shop export seam
   (`loadShopExportBundleInput` in `src/db/export.ts` → `buildExportBundle` → `zipExportBundle` in
   `src/lib/export.ts`) written to the private, versioned `DatabaseBackupBucket` in
   `infra/lib/infra-stack.ts` §11. §2. The reasoning for both of the above is
   [ADR 20260802-backup-and-restore-posture](../architecture/decisions/20260802-backup-and-restore-posture.md).
3. **A weekly full-cluster `pg_dump`** into the same bucket under `dumps/`, shipped 2026-08-12
   ([ADR 20260812-platform-database-dump](../architecture/decisions/20260812-platform-database-dump.md)).
   §2c. It exists because the export bundles cannot carry credentials, so layer 2 alone restores a
   platform nobody can sign in to.

A third, complementary layer shipped 2026-08-04 (§2's own scheduler followed on 2026-08-12): the
**shop-owned weekly backup** (§2b below) — the same export bundle, delivered by cron to a bucket
each shop configures under its own credentials. It is a per-shop product feature for
vendor-independence ("your data is yours" even if DiveDay disappears), not a substitute for either
DiveDay-side layer: it covers only shops that configured a destination, and it inherits every gap
of the export bundle stated in §2.

This exists because the highest-value rows are the ones we can least re-create.
`waiver_records` is legal evidence and its working retention default is "indefinite"
([H-02](../product/human-decisions.md)) — a database we cannot restore is a shop's liability
history we cannot produce.

## What holds production state

| Store | What's in it | Primary recovery | Secondary copy |
| --- | --- | --- | --- |
| Neon Postgres (`aws-us-east-1`) | Everything in `src/db/schema.ts` — bookings, waivers, medical answers, orders, accounts | Neon PITR (branch from timestamp) | The weekly full-cluster dump under `dumps/` (§2c — the only copy that carries accounts and tokens), plus the per-shop export bundles under `exports/` |
| Vercel Blob (`*.public.blob.vercel-storage.com`) | Certification card photos, recap photos, course/dive-site media, imported waiver source documents | None built in — Vercel Blob has no PITR and no versioning | The `photos/` directory inside each export bundle (see the gap below) |
| Vercel project env vars | `DATABASE_URL`, `AUTH_SECRET`, `CRON_SECRET`, `BLOB_READ_WRITE_TOKEN`, Stripe/AWS SES/Twilio keys | Not backed up by design — secrets never enter the repo | Owner's password manager (`TODO(owner)`, below) |

## 1. Neon point-in-time recovery

> **2026-08-12 — the owner's answer: the window is short, and not long enough to rely on.** That is
> the decision-relevant half of this question and it has been acted on: it is what moved the
> full-cluster `pg_dump` (§2c) from "the obvious next increment" to shipped, on the reasoning in
> [ADR 20260812-platform-database-dump](../architecture/decisions/20260812-platform-database-dump.md).
> Read the first row of the table below as the operative one.
>
> `TODO(owner)` — **still record the exact number.** Neon console → the DiveDay project →
> **Settings → Storage** (labelled *History retention* / *Restore window*). Write the days here, next
> to the plan name, and the date you checked it. **Do not guess it** — every procedure below is scoped
> by it, and a wrong value in a runbook is worse than an absent one because it will be trusted during
> an incident. What the exact figure changes now is narrow but real: whether §2c is day-to-day recovery
> (hours) or vendor-independence insurance (7+ days), and therefore whether its weekly cadence is
> right.

The plausible values and what each one means for the procedures below:

| If the window is | What it means operationally |
| --- | --- |
| ~6 hours to 1 day (typical free-tier default) | Only same-shift mistakes are recoverable from Neon. Anything noticed the next morning must come from the export bundles, which means accepting the export's known gaps. The quarterly restore test below becomes the primary evidence that recovery works at all, and increasing the window (a plan or setting change) should be raised as a cost/risk decision. |
| ~7 days (common paid-plan default) | Covers "we noticed on Monday what broke on Friday", which is the realistic detection latency for a solo-operator product. Export bundles become genuinely secondary. |
| 30 days or more | Comfortable. The export's role narrows to vendor-independence — surviving loss of the Neon account itself — rather than day-to-day recovery. |

Also record, in the same place: whether history retention is configured **per branch** and whether
the production branch actually has the project-level value applied. A project-wide setting that a
branch overrides is a trap.

### Restore procedure — branch from a timestamp

Neon restores by **branching**, not by rewinding in place. This is the property that makes it safe
to use during an incident: the live database is untouched until you deliberately repoint at the new
branch.

1. **Pick the target instant.** The last moment you believe the data was good — from the Sentry
   event, the deploy time, or the `cron_reminders.scan_complete` log line. Err earlier; you can
   branch again at a later instant, but you cannot un-write over good data.
2. **Create the branch.** Neon console → **Branches → New branch** → parent = the production
   branch, **Include data up to** = that timestamp. Name it for the incident
   (`restore-20260802-orders`), never `main-copy`.
3. **Verify before you cut over.** Connect to the branch's own connection string and check the rows
   the incident is about — count the table that lost rows, read back a specific `waiver_records`
   row's `integrity_hash`, confirm `SELECT max(created_at)` sits before the bad event. A branch that
   was cut a minute too late looks identical from the outside.
4. **Cut over** by updating `DATABASE_URL` and `DATABASE_URL_UNPOOLED` in the Vercel project
   (Production scope) to the restored branch's pooled/direct strings, then redeploy. `src/db/client.ts`
   picks the connection up at boot; there is no in-app switch.
5. **Reconcile what happened after the target instant.** Everything written between the branch point
   and the cutover is on the old branch only — bookings taken, waivers signed, Stripe webhooks
   received. Stripe is authoritative for money and can be replayed; waivers cannot. Read the old
   branch (it still exists) and re-enter by hand what matters.
6. **Keep the old branch** until the incident is closed and written up. It is the only record of the
   window you just discarded.

Partial restore — pulling three rows back without moving the whole database — is the same first
three steps, then `INSERT ... SELECT` across a connection to the restore branch. Prefer this
whenever the damage is scoped, because it costs no reconciliation.

## 2. Scheduled logical export

The second copy, in storage DiveDay controls under credentials Neon does not hold. It reuses the
export seam that already powers the staff CSV download, so it is code that is exercised and tested
rather than a backup-only path that rots.

**Be honest about its shape — these are the facts that decide how you use it:**

| Property | Reality |
| --- | --- |
| Scope | **Per shop, not full-database.** Every query in `src/db/export.ts` is `where(eq(<table>.shopId, shopId))`. A platform backup is a loop over shops, one bundle each; there is no single "dump everything" call. |
| Consistency | Each bundle is produced in one `read only` / `repeatable read` transaction (`src/db/export.ts`, the transaction options at the end of `loadShopExportBundleInput`), so a booking that commits mid-export can never appear in `bookings.csv` while its person is missing from `people.csv`. Bundles for *different* shops are separate transactions and are not consistent with each other. |
| Coverage | 34 CSVs, including `waiver_records.csv` (26 columns — carrying `integrity_hash`, `integrity_version`, and `medical_answers`) and `waiver_templates.csv` (**including the full `body`**, so a restored waiver can be reconstructed against the text that was actually signed rather than against whatever the current template says). |
| Photos | Every DiveDay-stored image or document URL referenced by any CSV is fetched and bundled byte-identically under `photos/<url pathname>` — including `import_source_document_url` and `import_source_medical_document_url` on waiver records. |
| Format | A zip, built in memory by `zipExportBundle` (fflate). Large shops produce large bundles; this is a memory-bound operation, not a stream. |

### The two gaps, stated plainly

**Credentials are deliberately excluded.** `NOT_INCLUDED` in `src/lib/export.ts` says it outright:
login accounts, password hashes, email-verification/password-reset/invite tokens, and staff
calendar-subscription links are never exported. That is *correct* for a portability export — a shop
walking away should not receive password hashes — and it is a **genuine hole for disaster
recovery**. Restoring a platform from bundles alone gives you every shop record and nobody who can
sign in. Recovery from bundles therefore includes re-inviting staff and forcing a password reset for
every account; plan for it rather than discovering it.

**A photo that fails to fetch is silently dropped.** `fetchExportPhotos` in `src/lib/export.ts`
returns `null` for any URL that times out (10s), returns non-OK, or throws, and those nulls are
filtered out. Nothing is logged, nothing is counted, and the bundle succeeds. For a portability
export that is a reasonable "never fail the whole download for one image". **For a backup it is a
landmine**: a bundle can be missing a waiver's source document with no signal at all, and you will
find out during a restore, which is the worst possible time.

Mitigation until that is fixed: after each run, compare the number of files under `photos/` against
the count of distinct managed-blob URLs across the CSVs, and treat any shortfall as a failed backup
for that shop. The durable fix is for `fetchExportPhotos` to report its failures so a caller can
decide — that belongs to whoever owns `src/lib/export.ts` next, and it is worth doing.

### Destination and credentials

| Thing | Value |
| --- | --- |
| Bucket | `DatabaseBackupBucket` (`infra/lib/infra-stack.ts` §11), default name `diveday-backups`, override with `--context backupBucketName=...` |
| Properties | Versioned, `BlockPublicAccess.BLOCK_ALL`, SSE-S3, `enforceSSL`, `RemovalPolicy.RETAIN` |
| Lifecycle | Current versions never expire (H-02 retention is a legal call, not a lifecycle rule); Infrequent Access at 30 days, Glacier **Instant** Retrieval at 90; non-current versions expire at 90 days; incomplete multipart uploads abort at 7 days |
| Uploader | IAM user `diveday-backup-uploader`, `s3:PutObject` + `s3:AbortMultipartUpload` only — no read, no delete, no list |
| Key convention | `exports/<YYYY-MM-DD>/<shop-slug>.zip` — date first so a whole run is one prefix |

The uploader's access key is minted by `cdk deploy` and delivered in the credentials secret
([§10 of the infrastructure runbook](infrastructure-runbook.md#10-the-credentials-secret)) as the
four `PLATFORM_BACKUP_*` values, which `pnpm infra:deploy` writes into `.env.vercel` like any other
application credential. It rode in the "Not .env values" section until 2026-08-12, while the runner
was undecided.

Shipping it to a third-party environment is acceptable *because* of how narrow it is: `s3:PutObject`
and `s3:AbortMultipartUpload` on this bucket's objects, nothing else. It cannot list the bucket, read
an object back, or delete one — so a leak of the Vercel environment cannot become a download of every
shop's exported waivers. That is also why the freshness check below has to run somewhere else.

```bash
AWS_PROFILE=diveday-admin aws secretsmanager get-secret-value \
  --secret-id diveday/env --query SecretString --output text
```

### The runner (running since 2026-08-12)

`GET /api/cron/platform-backup`, **Mondays 05:00 UTC** (`vercel.json`), decided in
[ADR 20260812-platform-backup-runner](../architecture/decisions/20260812-platform-backup-runner.md).
For every non-demo shop it builds the bundle above and PUTs it to `exports/<YYYY-MM-DD>/<slug>.zip`.
Implementation is `src/features/backup-export/platform-backup.ts`; the bundle itself is assembled by
that module's `bundle.ts`, shared byte for byte with the shop-owned pass in §2b.

| Property | Reality |
| --- | --- |
| Cadence | Weekly, Mondays 05:00 UTC — an hour after the shop-owned pass, so the two never contend for the same function slot |
| Idempotency | By object key only. There is no ledger table: the key is deterministic per run date, and the bucket is versioned, so a re-run overwrites additively. A retried pass redoes work rather than skipping it |
| Scope | Non-demo shops. The seeded `blue-mantis` fixture is flagged `isDemo`, so **a local or e2e run of this pass stores nothing** — that is correct, and it means the pass cannot be smoke-tested against the seed |
| Bound | A soft deadline at 240s of the 300s ceiling stops the pass *starting* new shops; one already in flight finishes. A stopped pass reports `skipped` in its log line and response, answers 200, and is not an incident — shop order is stable, so the next run reaches the same shops first |
| Failure handling | Per shop, coded, never thrown: one shop's failure never costs another its backup. A pass with any failure answers 500 and checks in to Sentry as `error` |
| Unconfigured | Without the four `PLATFORM_BACKUP_*` values the route answers **501** and stores nothing — and deliberately does *not* check in to Sentry, so a deployment that was never given the credential cannot read as a healthy weekly backup forever |
| Monitors | Sentry cron monitor `diveday-platform-backup`; the `cron_platform_backup.pass_failed` log code feeds the existing `CronPassFailures` CloudWatch alarm |

**What this does not tell you is whether a bundle is actually there.** The uploader is write-only, so
the route knows only that each PUT was accepted. That question is answered by the watchdog below.

### The watchdog: is the backup actually landing?

`diveday-backup-freshness-check`, a Lambda on an EventBridge Scheduler rule (**Tuesdays 06:00 UTC**,
`infra/lib/infra-stack.ts` §19). One `ListObjectsV2` over `exports/`, and an email to the
observability topic when the newest run is **missing**, **older than 8 days**, or **has no bundles
under it**.

It lives in AWS rather than in the app for two reasons that are each sufficient on their own: the
application literally cannot see the bucket (the uploader has no `ListBucket`, which is what stops a
leaked deployment credential reading a shop's exported waivers back out), and an alarm that runs on
Vercel cannot fire when the failure *is* Vercel — a suspended project takes the cron, its log line,
and its Sentry check-in with it, and silence looks identical to a quiet healthy week.

Test it by hand without waiting for Tuesday:

```bash
AWS_PROFILE=diveday-admin aws lambda invoke \
  --function-name diveday-backup-freshness-check /dev/stdout
```

It answers `{"status":"ok"|"stale"|"empty"|"never_run", ...}` and only emails on the last three.

> `TODO(owner)` — **Record where production secrets are backed up.** `AUTH_SECRET`, `CRON_SECRET`,
> `BLOB_READ_WRITE_TOKEN`, and the Stripe/AWS SES/Twilio keys exist only in Vercel's project settings.
> Losing the Vercel account loses them, and `AUTH_SECRET` in particular is not regenerable without
> invalidating every outstanding session and every `recap-links.ts`-signed token. Name the password
> manager or vault holding them, and the date last verified.

## 2b. Shop-owned weekly backup (running since 2026-08-04)

The complementary layer a shop controls end to end
([ADR 20260804-shop-owned-backup-export](../architecture/decisions/20260804-shop-owned-backup-export.md)):
`/api/cron/backup-export` (Mondays 04:00 UTC, `vercel.json`) builds the same per-shop export
bundle §2 describes — every CSV, the README, bundled photos — adds the shop-wide `trips.ics`
calendar document, and PUTs it to the S3-compatible bucket the shop configured at
`/shop/<slug>/settings/export` (the Backups half of the one data-out surface — ADR
20260806-one-data-out-surface; `/shop/<slug>/settings/backup` is a 308 to it). Implementation
lives in `src/features/backup-export/`.

Operationally distinct from §2 in every way that matters during an incident:

| Property | Reality |
| --- | --- |
| Who holds it | The shop. Endpoint, bucket, and credentials are the shop's own (AWS S3, Cloudflare R2, Backblaze B2, MinIO — anything SigV4). DiveDay stores the secret key AES-sealed (`src/lib/secret-box.ts`, same posture as WhatsApp tokens) and never returns it, even to the shop. |
| Coverage | Only shops that configured a destination. This is a product feature, not a platform guarantee — never count it as "DiveDay has offsite backups". |
| Cadence / idempotency | Weekly, at most one succeeded scheduled delivery per shop per ISO week; the object key (`<prefix>/diveday-backup-<slug>-<ISO week>.zip`) is deterministic per week, so a retried pass overwrites rather than accumulates. |
| Failure handling | Every attempt is a row in `shop_backup_deliveries` with a coded outcome, shown in the shop's own delivery history. A failed week is retried on the next weekly tick — never inside the same pass, so a broken bucket costs one failed row per week. A Sentry cron monitor (`diveday-backup-export`) plus a per-failure Sentry event cover the DiveDay side. |
| Gaps | Exactly §2's: credentials/`user_accounts` never exported, and a photo that fails to fetch is silently absent. A shop restoring from its own bundle re-invites staff the same way §2's procedures do. |
| Restore | The bundle is the standard export zip — the quarterly test's step 4 and the import path in step 5 apply verbatim to a shop-owned copy. |

`SECRET_ENCRYPTION_KEY` matters here: rotating it without re-sealing makes every stored
destination credential unreadable, which surfaces as `credential_unreadable` delivery failures
until each shop re-enters its key. Treat that as part of any key-rotation plan.

## 2c. Full-cluster `pg_dump` (running since 2026-08-12)

The layer that can restore a **login**, decided in
[ADR 20260812-platform-database-dump](../architecture/decisions/20260812-platform-database-dump.md).
Everything §2 and §2b describe is built from the export seam, which withholds credentials by design —
so before this existed, a restore from bundles alone produced every shop, every booking, every waiver,
and nobody who could sign in. This closes that, and the per-shop export goes back to being purely the
portability feature it was built as.

| Property | Reality |
| --- | --- |
| What it is | `pg_dump --format=custom --no-owner --no-privileges` over the whole cluster, gzipped. Covers `user_accounts`, `account_tokens` and `calendar_feeds` — and everything else — in one file |
| Host | CodeBuild project `diveday-database-dump` (`infra/lib/infra-stack.ts` §20), image `public.ecr.aws/docker/library/postgres:17-alpine`. Pinned to the Postgres **major** version: `pg_dump` may be newer than its server, never older, so `DUMP_POSTGRES_MAJOR` is a floor to raise when Neon upgrades |
| Cadence | Weekly, **Mondays 05:30 UTC**, EventBridge Scheduler → `codebuild:StartBuild`. Half an hour after the export pass, a day before the watchdog, so one week's dump and one week's bundles share a run date |
| Key convention | `dumps/<YYYY-MM-DD>/diveday.dump.gz` in the same `DatabaseBackupBucket` |
| Retention | **35 days, then deleted** — its own lifecycle rule, deliberately the opposite of the bundles' "never expire". The file holds every password hash and every medical answer in the platform, and it answers a question asked within days of a loss, never months. `DUMP_RETENTION_DAYS` in `infra/lib/infra-stack.ts` is the one number to change if H-02 lands somewhere else |
| Credential | `diveday/database-url-unpooled` — the **direct** connection string, not the pooled one (a transaction-mode pooler is unreliable for `pg_dump`, same reason migrations use the direct connection). Deploys holding the literal `unset`; a build refuses with a named message until a human fills it in |
| Who can read a dump | Nobody reachable from the app. The job's own role is `PutObject`/`AbortMultipartUpload`/`GetObject` scoped to `dumps/*` — it cannot reach the shop bundles under `exports/`, and it cannot delete. Reading a dump back needs the admin profile |
| Streaming | `pg_dump \| gzip \| aws s3 cp -` under `set -o pipefail`. No temp file. **`pipefail` is load-bearing**: without it the build's status is the upload's, so a `pg_dump` that died mid-stream would store a truncated dump and report success |
| Monitors | The same weekly `diveday-backup-freshness-check` — it lists `dumps/` too and alarms when the newest dump is missing or over 8 days old, before it checks the bundles, so a week where both broke raises both alarms |

Set it up (once), and run one by hand:

```bash
# The direct endpoint from Neon — not the -pooler one.
AWS_PROFILE=diveday-admin aws secretsmanager put-secret-value \
  --secret-id diveday/database-url-unpooled --secret-string '<DATABASE_URL_UNPOOLED>'

AWS_PROFILE=diveday-admin aws codebuild start-build --project-name diveday-database-dump
AWS_PROFILE=diveday-admin aws s3 ls s3://diveday-backups/dumps/ --recursive
```

### Restore procedure — accounts and everything else

A full recovery is two parts, in this order, and the order matters: the dump is the base and the
bundles are what happened after it.

1. **Branch or provision a target.** A fresh Neon branch (or project, if the account itself is what was
   lost), and its direct connection string.
2. **Fetch the newest dump and check its size** before trusting it — a few hundred bytes means a failed
   run stored something, which the `pipefail` guard should make impossible but is worth a glance.

   ```bash
   AWS_PROFILE=diveday-admin aws s3 cp \
     s3://diveday-backups/dumps/<YYYY-MM-DD>/diveday.dump.gz . && ls -l diveday.dump.gz
   ```
3. **Restore it.** `--no-owner --no-privileges` again on the way in, because the target's roles are not
   the source cluster's:

   ```bash
   gunzip -c diveday.dump.gz | pg_restore --dbname="<target direct URL>" \
     --no-owner --no-privileges --exit-on-error
   ```
4. **Sign in.** This is the step that was impossible before this layer existed: staff accounts,
   password hashes and tokens are present, so nobody has to be re-invited and no password reset has to
   be forced.
5. **Replay anything newer than the dump** from the export bundles (§2, and the import path in §4's
   step 5). The dump is at most a week old; the bundles are the same age, so in practice this step
   covers the gap between the two run times rather than a week of work.

Photos are still the gap §3 describes: the dump carries the blob *URLs*, not the bytes. The bundles'
`photos/` directories are the only copy.

## 3. Vercel Blob posture

Vercel Blob is where every uploaded image and imported waiver document lives, written through the
seam in `src/lib/storage/` and recognised by `isManagedBlobUrl` (`src/lib/storage/blob-host.ts`).

**There is no provider-side backup.** Vercel Blob offers no point-in-time recovery and no object
versioning. A deleted or overwritten object is gone. The only copy DiveDay holds is the `photos/`
directory inside each export bundle — which is exactly why the silent-drop gap above matters more
than it looks.

The app already does the *deletion* side carefully: orphan-media cleanup is queued and retried
through `retryPendingMediaDeletions` on the daily cron rather than deleted inline, so a transient
provider failure does not lose track of an object. That is a consistency mechanism, not a backup.

## 4. Quarterly restore test

A backup nobody has restored is a hypothesis. Run this once a quarter and record the result in the
log below. It should take under an hour.

1. **Pick a target** — a timestamp roughly 24 hours ago, one shop's most recent export bundle, and the
   most recent dump under `dumps/`.
2. **Branch the database.** Neon console → new branch from the production branch at that timestamp.
   Note how long the branch takes to become available; that number is your real RTO.
3. **Connect and verify.** Point a local `DATABASE_URL`/`DATABASE_URL_UNPOOLED` at the branch and
   run `pnpm dev`. Sign in as a staff user. Open a trip's manifest and a signed waiver. The waiver
   is the test that matters: it must render, and its `integrity_hash` must still verify.
4. **Restore from the bundle, independently.** Download the shop's zip from `s3://<backup
   bucket>/exports/<date>/<shop-slug>.zip`. Confirm: `waiver_records.csv` opens and has the expected
   row count; `waiver_templates.csv` contains a full `body`, not a truncated one; the file count
   under `photos/` matches the distinct managed-blob URLs in the CSVs (this is the silent-drop
   check — a mismatch is a failed test, not a curiosity).
5. **Exercise the import path** for at least one CSV through
   `src/app/shop/[shopSlug]/settings/import/` into a scratch shop, so the round trip is proven and
   not assumed.
6. **Restore the dump into an empty branch and sign in** (§2c's procedure). This is the step that
   proves the layer the bundles cannot cover: a `pg_restore` that completes without `--exit-on-error`
   firing, followed by a real sign-in with a real staff password. A dump that restores but whose
   accounts do not authenticate is a failed test, not a partial pass — record it as one.
7. **Tear down** — delete the Neon branch and the scratch shop. Leaving a restore branch alive costs
   storage and, worse, invites someone to connect to it later thinking it is production.
8. **Record the run below**, including anything that surprised you. "Everything fine" with no notes
   is the least useful possible entry.

### Restore test log

| Date run | Who | Neon window at the time | Branch-available time (RTO) | Bundle verified | Dump restored + sign-in | Findings |
| --- | --- | --- | --- | --- | --- | --- |
| _never_ | — | — | — | — | — | `TODO(owner)` — no restore has ever been tested. The first run is also the first evidence any of this works. |

## What this runbook does not cover

- **§2's scheduled export runs weekly since 2026-08-12, but nobody has restored from one.** The
  quarterly restore-test log below still reads `never`. A backup nobody has restored is a
  hypothesis; what changed is that there is now evidence it is being *written* (the watchdog), not
  evidence it can be *read*. Run the test in §4 before describing recovery as proven.
- **The export's credential gap is now covered elsewhere, not fixed in the export.** §2c's
  full-cluster dump carries `user_accounts`, `account_tokens` and `calendar_feeds`; the bundles still
  do not and still should not. What that means practically: a restore from bundles *alone* still yields
  nobody who can sign in, so recovery is the two-part procedure in §2c rather than one artifact.
- **The photo gap is unchanged, by either layer.** A photo that fails to fetch is still dropped
  silently from a bundle (§2), and the dump carries blob *URLs*, not bytes — so the bundles' `photos/`
  directories remain the only copy of an image.
- **Nobody has restored a dump either.** The layer is written and watched; §4's step 6 is what will
  turn it from a hypothesis into evidence.
- **No cross-region or cross-account copy.** Backups sit in the same AWS account as everything else
  in `infra/lib/infra-stack.ts`. Losing that account loses them. Versioning plus `RETAIN` plus a
  write-only uploader is the mitigation, and it is a partial one.
- **No restore-time objective is promised.** Nobody has measured one; step 2 of the quarterly test is
  what will produce the first real number.
- **Stripe, AWS SES, and Twilio hold their own records** and are not backed up here. Stripe is
  authoritative for money in a restore conflict, and that is deliberate.
- **Retention itself is undecided.** H-02 has a working default of "indefinite" and no legal answer.
  The lifecycle rule in §11 was written to never be the thing that deletes evidence; when H-02 lands,
  both the rule and this runbook need revisiting.

## When a restore goes wrong

| Symptom | Look at |
| --- | --- |
| The branch you need is older than Neon will go | The PITR window at the top of this file — if it is unrecorded, that is the finding. Fall back to the newest export bundle in S3 and accept its gaps (no credentials, possibly missing photos) |
| Restored app boots but nobody can sign in | Expected when restoring from export bundles alone: `user_accounts`/`account_tokens` are never exported (`NOT_INCLUDED`, `src/lib/export.ts`). Restore the newest dump under `dumps/` first (§2c) and layer the bundles on top; re-inviting staff and forcing password resets is now the fallback for when no dump is available, not the standard procedure |
| No dump under `dumps/` at all | The `diveday/database-url-unpooled` secret was never filled in, so every build refused (§2c). The weekly watchdog alarms on exactly this. Check the `diveday-database-dump` project's last build log for the named refusal |
| `pg_restore` fails on ownership or grants | The dump is taken `--no-owner --no-privileges`; pass both on the way in too — the target branch's roles are not the source cluster's |
| A waiver renders but its integrity hash does not verify | Compare `waiver_templates.csv`'s `body` for that `template_version` against what the app is rendering — a restore that mixed a current template with an old record is the usual cause |
| `photos/` is short of what the CSVs reference | `fetchExportPhotos` dropped them silently (`src/lib/export.ts`). Check whether the blob objects still exist; if they do, re-run the export for that shop, if they do not, the document is gone and the incident is a data-loss incident |
| Export bundle is missing a table you expected | The table was never added to `src/db/export.ts`. Confirm against `EXPORT_FILE_NOTES` in `src/lib/export.ts` — a table absent there is absent from every historical bundle too |
| App still points at the old database after a cutover | `DATABASE_URL`/`DATABASE_URL_UNPOOLED` are read at boot in `src/db/client.ts`; changing them in Vercel requires a redeploy, not just a save |
| `cdk destroy` ran and you need the backups | They are still there — `RemovalPolicy.RETAIN` leaves `DatabaseBackupBucket` behind on purpose. Re-adopt it by name or read it directly from the console |
