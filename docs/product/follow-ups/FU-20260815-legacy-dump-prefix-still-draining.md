# FU-20260815-legacy-dump-prefix-still-draining — Delete the drain lifecycle rule once the old dumps have actually gone

- **Status:** Open
- **Raised:** 2026-08-15 — splitting the full-cluster `pg_dump` out of the export bundles' bucket
  (closing FU-20260815-dumps-and-exports-share-one-bucket). The split leaves one rule behind on
  purpose; this entry is the reminder to take it away when it has finished its job, and the thing
  that stops somebody taking it away early.
- **Kind:** cleanup
- **Effort:** S
- **Touches:** `infra/lib/infra-stack.ts` — §11, the drain-legacy-database-dumps lifecycle rule and
  the WriteBackupBundlesOnly grant beside it; `infra/lib/database-dump.test.ts` — the "keeps
  draining the dumps the bundle bucket still holds" test;
  `docs/engineering/backup-and-restore-runbook.md` — §2c's transition window, §2's Lifecycle row

## What I noticed

The dump now lives in `diveday-database-dumps` and nothing writes `dumps/` in `diveday-backups` any
more — but the dumps written there before 2026-08-15 are still real dumps, with every password hash
and every medical answer in the platform in them. They are not copied to the new bucket (a copy
re-dates the objects and restarts their expiry clock), so they leave the only way they can: the
`drain-legacy-database-dumps` lifecycle rule, which is the old `expire-database-dumps` rule renamed
so its status is legible.

Until that prefix is empty, two things that look like tidying are wrong:

- **Deleting the rule** strands those files in a bucket whose other prefix never expires. That is the
  migration's one irreversible mistake, and the only thing standing in front of it is the rule's name
  and a comment.
- **Widening the uploader grant** (`WriteBackupBundlesOnly`, scoped to `exports/*`) on the grounds
  that "the dumps moved out". They have not all moved out yet, and that credential's access key lives
  in Vercel.

"Empty" is not what `aws s3 ls` shows. `diveday-backups` is versioned, so the rule's expiry writes a
delete marker at 35 days and the bytes survive as non-current versions for another 35 — roughly 70
days after the deploy, not 35.

## Why it isn't already done

It cannot be: it is blocked on wall-clock time and on a deploy that has not happened yet. The rule
has to keep running until it has nothing left to run on, and no amount of care in the change that
raised this can make that window shorter. Filed rather than left in the runbook alone because a
step that comes due ten weeks after the change that created it is exactly the kind a closing message
loses.

## Proposed change

When the check below comes back empty, delete the `drain-legacy-database-dumps` entry from
`backupBucket`'s `lifecycleRules` in `infra/lib/infra-stack.ts` §11, drop the test that pins it, and
cut §2c's step 5 and §2's "Plus one rule that is on its way out" clause from the runbook. Deploy.

**Not proposed:** widening `WriteBackupBundlesOnly` past `exports/*` at the same time. Its prefix
scoping is no longer the thing holding the design up, and it stays anyway — a write-only credential
that ships to a third party has no business reaching anything it was not built to write.

## Prompt

```text
DiveDay's weekly full-cluster pg_dump moved out of the export bundles' S3 bucket into its own on
2026-08-15 (ADR 20260812-platform-database-dump, the amendment at the end of its Decision section).
The dumps written before that move were deliberately NOT copied: they drain out of
s3://diveday-backups/dumps/ under a lifecycle rule named `drain-legacy-database-dumps`, in
infra/lib/infra-stack.ts section 11. This task is removing that rule now that it has nothing left
to drain.

Check first, and do NOT skip this -- the bucket is versioned, so `aws s3 ls` stops showing these
objects 35 days before they actually go:

  AWS_PROFILE=diveday-admin aws s3api list-object-versions \
    --bucket diveday-backups --prefix dumps/ --query 'length(Versions)'

If that answers anything other than null or 0, STOP and leave everything as it is: deleting the
rule while objects remain strands full-cluster dumps -- every password hash and every medical
answer in the platform -- in a bucket whose other prefix never expires. Say so and close.

If it is empty:
  - delete the `drain-legacy-database-dumps` entry from backupBucket's lifecycleRules
    (infra/lib/infra-stack.ts section 11) and the comment block above it
  - delete the "keeps draining the dumps the bundle bucket still holds" test in
    infra/lib/database-dump.test.ts
  - in docs/engineering/backup-and-restore-runbook.md, remove step 5 of section 2c's transition
    window and the "Plus one rule that is on its way out" clause from section 2's Lifecycle row;
    keep the rest of the transition window if any dump older than the split is still referenced
    anywhere, otherwise trim it to a sentence of history

Leave the uploader grant alone: `WriteBackupBundlesOnly` stays scoped to `exports/*`. Its access
key lives in Vercel, and narrowness there is the habit the bucket split exists to make unnecessary,
not one to spend now that it is.

Everything under infra/ is ASCII-only (scripts/check-infra-ascii.mjs) -- no em dashes, no
non-ASCII punctuation, in comments or string literals.

Done when: `pnpm test infra --reporter=dot` is green, `pnpm check` is green, and the runbook no
longer describes a rule that is not there. Delete
docs/product/follow-ups/FU-20260815-legacy-dump-prefix-still-draining.md as part of the change.
```
