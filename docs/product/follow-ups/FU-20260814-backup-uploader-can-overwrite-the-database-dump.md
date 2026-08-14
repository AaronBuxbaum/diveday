# FU-20260814-backup-uploader-can-overwrite-the-database-dump — The Vercel-resident uploader credential reaches `dumps/`, not just `exports/`

- **Status:** Open
- **Raised:** 2026-08-14 — `security-reviewer` pass on the run-census change that closed
  FU-20260812-backup-watchdog-cannot-see-a-short-run. Found while verifying that the census
  introduced no new IAM; it introduced none, and this was already there.
- **Kind:** risk
- **Effort:** S
- **Touches:** `infra/lib/infra-stack.ts` (the WriteBackupBundlesOnly statement in §11, checkDump
  in §19, the dump role in §20), `infra/lib/backup-freshness.test.ts`,
  `infra/lib/database-dump.test.ts`

## What I noticed

The platform backup uploader — the IAM user whose access key lives in Vercel's environment as
`PLATFORM_BACKUP_AWS_*` — is granted `s3:PutObject` on `backupBucket.arnForObjects("*")`
(`infra/lib/infra-stack.ts` §11, sid `WriteBackupBundlesOnly`). That wildcard is the *whole bucket*,
and the bucket holds two prefixes:

- `exports/<date>/<slug>.zip` — the per-shop bundles this credential is for.
- `dumps/<date>/…` — the weekly `pg_dump`, written by a **different** principal (a CodeBuild role,
  §20), and the only artifact that can restore a *login*. The per-shop bundles deliberately exclude
  `user_accounts`, `account_tokens` and `calendar_feeds`, so restoring from bundles alone gives you
  every shop record and nobody who can sign in.

So a leaked Vercel environment can overwrite the dump. It cannot *read* one — the credential is
`PutObject` only, which is the property the whole design rests on and which stays intact — but it
can replace one with a zero-byte object or with garbage.

The dump's own watchdog does not close this: it checks that a dated prefix under `dumps/` exists and
is under 8 days old (`checkDump`, §19). It never looks at size or content. An overwritten dump reads
as a fresh one.

The bucket is versioned, so the real dump survives as a non-current version and this is recoverable
by someone who knows to look. That is what keeps this a risk rather than an incident.

## Why it isn't already done

Out of scope for the change that found it, and deliberately left rather than done as a drive-by: the
census change was reviewed on the promise that it added no IAM, and quietly *narrowing* someone
else's grant in the same diff would have made that claim harder to check, not easier. Narrowing a
live credential's resource ARN is also the kind of edit whose blast radius is a failed weekly backup
discovered a week later, which wants its own change and its own deploy.

There is also a real question underneath it that I should not answer alone: whether the two prefixes
belong in one bucket at all. They have different writers, different readers, different retention
needs and now demonstrably different threat models.

## Proposed change

Smallest correct fix, and probably the right one:

1. Narrow §11's `WriteBackupBundlesOnly` from `arnForObjects("*")` to `arnForObjects("exports/*")`.
   One line. The uploader has never written anywhere else — `platformBackupObjectKey` and
   `platformBackupCensusKey` (`src/features/backup-export/period.ts`) are the only key builders that
   use this credential, and both are `exports/`-prefixed.
2. Assert the scoping in `infra/lib/backup-freshness.test.ts`, beside the existing "stays write-only,
   with no way to read a bundle back" test, which currently pins the *actions* and not the
   *resource*.
3. Consider teaching `checkDump` a minimum plausible size. A dump that is 200 bytes is not a dump,
   and today nothing anywhere would say so. This is the half that catches an *accidental* truncation
   as well as a malicious one.

Worth deciding while there: whether `dumps/` should move to its own bucket, so the two artifacts stop
sharing a blast radius. That is a bigger change and a genuine architecture call — it is why this
entry is a question as much as a task.

**Not proposed:** giving the uploader `s3:GetObject` to verify its own writes. That is precisely the
property the backup design refuses, and the reason the freshness check runs in AWS from a different
principal at all.

## Prompt

```text
DiveDay's platform backup uploader -- the IAM user whose access key lives in Vercel's environment --
is granted s3:PutObject on the whole backup bucket, not just the prefix it writes. It can therefore
overwrite the weekly pg_dump under dumps/, which is the only artifact that can restore a login
(the per-shop export bundles exclude user_accounts, account_tokens and calendar_feeds by design).
Close that.

Read first:
  - docs/product/follow-ups/FU-20260814-backup-uploader-can-overwrite-the-database-dump.md (this
    file -- it names the smallest fix and the bigger question underneath it)
  - infra/lib/infra-stack.ts section 11, the `WriteBackupBundlesOnly` statement
  - infra/lib/infra-stack.ts section 19, `checkDump` -- which checks a dated prefix exists and is
    under 8 days old, and never looks at size, so an overwritten dump reads as a fresh one
  - infra/lib/infra-stack.ts section 20, the CodeBuild role that actually writes dumps/
  - docs/architecture/decisions/20260812-platform-database-dump.md
  - docs/engineering/backup-and-restore-runbook.md section 2c

The change is one line -- arnForObjects("*") becomes arnForObjects("exports/*") -- plus a test.
The care is in proving nothing else uses that credential first: grep for every key builder that
takes a PlatformBackupConfig (src/features/backup-export/period.ts has them) and confirm all of
them are exports/-prefixed. A too-narrow grant fails as a silent weekly backup that nobody notices
for a week, so verify before deploying rather than after.

Then assert the RESOURCE in infra/lib/backup-freshness.test.ts. The existing "stays write-only"
test pins the actions and not the resource, which is exactly why this went unnoticed.

Also consider giving checkDump a minimum plausible size for a dump -- a 200-byte object is not a
dump, and today nothing would say so. That half catches accidental truncation too.

Do NOT give the uploader s3:GetObject to verify its own writes. That property is the reason the
freshness check runs in AWS from a separate principal at all.

The bigger question, worth raising with the owner rather than deciding alone: dumps/ and exports/
have different writers, different readers, different retention and now different threat models.
They may not belong in one bucket. Say what you think in the PR.

Done when: `pnpm check` is green, infra tests assert the narrowed resource, and the PR says whether
the two prefixes should stay in one bucket. Delete
docs/product/follow-ups/FU-20260814-backup-uploader-can-overwrite-the-database-dump.md as part of
the change.
```
