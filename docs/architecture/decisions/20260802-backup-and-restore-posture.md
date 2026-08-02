# 20260802-backup-and-restore-posture — Back production up with Neon PITR plus a scheduled per-shop export to a retained S3 bucket

- **Status:** Accepted
- **Date:** 2026-08-02

## Context

Production data lives in one Neon Postgres project (`aws-us-east-1`, see
[20260718-vercel-neon-hosting](20260718-vercel-neon-hosting.md)) and one Vercel Blob store. Nothing
about backup or recovery had ever been written down: no stated point-in-time-recovery window, no
copy of the data anywhere DiveDay controls, no restore ever rehearsed. That is the OPS-1 finding in
[the 2026-08-02 review](../../product/assessments/comprehensive-review-20260802.md), and it is worse
than a generic gap because `waiver_records` is legal evidence whose working retention default is
"indefinite" ([H-02](../../product/human-decisions.md)): the one dataset we are least able to
re-create is the one with the longest obligation attached to it.

Neon's own PITR is the fast, correct answer for almost every recovery — but it is a window inside a
single vendor account, and it protects against nothing that takes the account itself away. A second
copy, in different storage under different credentials, is what makes that a survivable class of
failure rather than a total one.

A seam for producing that copy already exists and is tested:
`loadShopExportBundleInput(db, shopId, now)` (`src/db/export.ts`) → `buildExportBundle` →
`zipExportBundle` (`src/lib/export.ts`), the machinery behind the staff CSV export. It reads inside
one `read only` / `repeatable read` transaction, so a bundle is a relationally consistent snapshot
rather than a smear of per-statement reads.

## Decision

Two layers, both documented in
[docs/engineering/backup-and-restore-runbook.md](../../engineering/backup-and-restore-runbook.md):

1. **Neon PITR is the primary recovery mechanism.** Restores go through Neon's
   branch-from-timestamp: create a branch at the target instant, verify it, then repoint
   `DATABASE_URL`/`DATABASE_URL_UNPOOLED`. Never restore in place over a live database. The exact
   retention window is plan-dependent and is a `TODO(owner)` in the runbook — it is a fact to look
   up in the Neon console, not one to assert here.
2. **A scheduled logical export is the secondary, vendor-independent copy.** It reuses the existing
   export seam per shop, iterating every shop, and writes the resulting zips to a **new, dedicated,
   versioned, private S3 bucket** — `DatabaseBackupBucket` in `infra/lib/infra-stack.ts` §9, with
   `RemovalPolicy.RETAIN`, `BlockPublicAccess.BLOCK_ALL`, SSE-S3, `enforceSSL`, and a lifecycle rule
   that only ever moves objects to colder storage (IA at 30 days, Glacier Instant Retrieval at 90)
   and never expires a current version. Uploads use a dedicated write-only IAM user
   (`diveday-backup-uploader`: `s3:PutObject` and `s3:AbortMultipartUpload`, nothing else).
3. **A quarterly restore test** with a written procedure and a recorded result, in that same
   runbook. A backup nobody has restored is a hypothesis.

The export's two known holes are documented rather than silently inherited: credentials
(`user_accounts`, `account_tokens`, calendar feed links) are deliberately excluded
(`NOT_INCLUDED` in `src/lib/export.ts`), and `fetchExportPhotos` drops a photo that fails to fetch
without any signal. Both are correct for a portability export and both are real gaps for disaster
recovery, so the export is a *complement* to Neon PITR, never a replacement for it.

## Alternatives considered

- **Neon PITR alone** — rejected: it is a window inside the account we are trying to be resilient
  to losing, and it says nothing about Blob objects.
- **`pg_dump` of the whole database on a schedule** — genuinely better coverage (it would include
  the credential tables the export omits) and worth adding later, but it needs a host to run on and
  a place to hold the direct connection string; the export seam is already written, already tested,
  already transactionally consistent, and ships today. Recorded in the runbook as the obvious next
  increment.
- **Reusing the existing `VisualRegressionBucket`** — rejected outright: it is `publicReadAccess`,
  `RemovalPolicy.DESTROY`, and expires objects after 7 days. Every property is wrong.
- **S3 Object Lock (WORM) on the backup bucket** — deferred: it must be enabled at bucket creation
  and cannot be turned off, and a retention period is exactly the H-02 legal question that has not
  been answered yet. Versioning plus `RETAIN` plus a write-only uploader covers the accident case;
  revisit when H-02 lands.
- **A managed third-party backup SaaS** — rejected for a solo-operator, ~$5/month AWS footprint
  (see [20260802-aws-cost-guardrails](20260802-aws-cost-guardrails.md)); another vendor, another
  credential, another bill.

## Consequences

Makes a "Neon account is gone" or "someone dropped a table three hours ago" scenario answerable
with a written procedure instead of improvisation, and gives the H-02 retention conversation
something concrete to attach to. Adds a small, near-free S3 bill (a shop's bundle is CSVs plus
photos; IA/Glacier IR transitions keep the long tail cheap) and one more IAM principal to rotate.

Commits us to: keeping the export seam's table list honest as the schema grows (a new table that
never reaches `src/db/export.ts` is silently outside the secondary copy), actually running the
quarterly restore test and recording it, and treating the backup bucket as undeletable — a
`cdk destroy` will leave it behind on purpose, and cleaning it up is a deliberate manual act.

Revisit if: `pg_dump` lands and makes the per-shop export redundant as a DR mechanism (it would
still be the portability feature); H-02 produces a real retention period, which likely means Object
Lock and a current-version expiry rule; or the shop count grows past the point where iterating shops
serially in one scheduled run is practical.
