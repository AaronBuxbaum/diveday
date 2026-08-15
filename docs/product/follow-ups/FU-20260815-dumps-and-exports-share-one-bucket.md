# FU-20260815-dumps-and-exports-share-one-bucket — Decide whether the database dump belongs in the same bucket as the shop export bundles

- **Status:** Open
- **Raised:** 2026-08-15 — narrowing the backup uploader's grant to `exports/*`
  (closing FU-20260814-backup-uploader-can-overwrite-the-database-dump). That change removed the
  reachability; this is the architecture question underneath it, which the entry it came from
  deliberately did not answer alone.
- **Kind:** question
- **Effort:** M
- **Touches:** `infra/lib/infra-stack.ts` (§11 the bucket and uploader, §19 the freshness check,
  §20 the dump project), `infra/lib/backup-freshness.test.ts`, `infra/lib/database-dump.test.ts`,
  `docs/engineering/backup-and-restore-runbook.md`

## What I noticed

`DatabaseBackupBucket` holds two artifacts that have almost nothing in common:

| | `exports/` | `dumps/` |
| --- | --- | --- |
| Writer | IAM user, access key lives in **Vercel** | CodeBuild role, stays in AWS |
| Contents | Per-shop bundles, deliberately excluding `user_accounts`, `account_tokens`, `calendar_feeds` | Full cluster: every password hash and every medical answer |
| Retention | Current versions never expire | 35 days, then deleted |
| Restores a login | No | **Yes — it is the only thing that does** |

They share a bucket, a versioning policy, a set of lifecycle rules whose two halves contradict each
other, and — until 2026-08-15 — a blast radius: the uploader's grant was `arnForObjects("*")`, so a
leaked Vercel environment could overwrite the dump. That specific hole is closed. What is not
decided is whether two artifacts this different should have been colocated in the first place.

The cost of the current arrangement is that every grant touching this bucket has to be *remembered*
to be prefix-scoped. Two of the three already are (S20's dump role, and now S11's uploader). The
one that was not is the one that shipped a credential to a third party. A separate bucket makes
that class of mistake unrepresentable rather than reviewable — which is the difference between a
rule and a guardrail.

## Why it isn't already done

Out of scope for the change that found it, which was narrowing one grant and asserting it, and
deliberately not done as a drive-by: moving a bucket is a `RemovalPolicy.RETAIN` resource with a
live weekly writer, a live weekly reader, and a documented restore procedure pointing at it. That
wants its own change, its own deploy and its own runbook edit, not a rider on a one-line fix.

It is also genuinely arguable. The one-bucket design has a real case, and it is not just inertia:
one bucket means the freshness watchdog answers both questions in one place with one `ListBucket`
grant, which is why §19 checks the dump before the bundles and raises both alarms in one run. Split
them and that function either needs a second grant or becomes two functions — and "two alarms with
the same trigger and the same reader is one too many" is a stated design decision in that section.

## Proposed change

Decide between:

1. **Leave them together, and say why.** Record in
   `docs/architecture/decisions/20260812-platform-database-dump.md` that colocation is deliberate,
   that prefix-scoping every grant is the invariant it costs, and that
   `infra/lib/backup-freshness.test.ts` is where that invariant is enforced. Cheapest, and honest
   as long as the test really does cover every principal — today it covers the uploader and the
   dump role, which is all of them.
2. **Split `dumps/` into its own bucket.** Its own lifecycle (35 days, no exceptions), its own
   versioning answer, and no principal holding Vercel-resident credentials with any grant on it at
   all. The freshness check keeps one `ListBucket` per bucket, which is one more grant and no more
   functions. This is the option that makes the 2026-08-14 finding structurally impossible rather
   than merely fixed.

Under either, the *reason* belongs in the ADR — the next person to add a writer to this bucket is
the person this decision is for.

**Not proposed:** moving `exports/` instead. The bundles are the thing the app writes constantly
and the dump is the rarer, more dangerous artifact; if one moves behind a stricter boundary it is
the dump.

## Prompt

```text
Decide whether DiveDay's weekly full-cluster pg_dump should live in its own S3 bucket rather than
sharing DatabaseBackupBucket with the per-shop export bundles, and implement the decision.

Read first:
  - docs/product/follow-ups/FU-20260815-dumps-and-exports-share-one-bucket.md (this file -- the
    table of how differently the two artifacts behave is the substance of the question)
  - infra/lib/infra-stack.ts section 11 (the bucket, its lifecycle rules, and the uploader whose
    access key ships to Vercel), section 19 (the freshness check that reads both prefixes in one
    run), section 20 (the CodeBuild role that writes dumps/)
  - infra/lib/backup-freshness.test.ts -- specifically "can write the bundle keys the app builds,
    and nothing under dumps/", which is the invariant that keeps one bucket safe
  - docs/architecture/decisions/20260812-platform-database-dump.md
  - docs/engineering/backup-and-restore-runbook.md sections 2 and 2c

The constraint that makes this non-obvious: section 19 deliberately checks the dump and the bundles
in ONE function, on the stated reasoning that two alarms with the same trigger and the same reader
is one too many. A split needs that to still hold -- one more ListBucket grant is fine, a second
watchdog is not.

The bucket is RemovalPolicy.RETAIN with a live weekly writer and a documented restore procedure
pointing at it, so a split is a migration, not a rename: the new bucket has to exist and be written
before the runbook and the restore procedure can name it, and the old dumps stay readable for their
35-day window. Sequence that explicitly in the PR rather than assuming a deploy cuts over cleanly.

Whichever way it goes, write the reasoning into
docs/architecture/decisions/20260812-platform-database-dump.md -- the audience is whoever next adds
a principal that can write to this bucket.

Done when: pnpm check is green, infra tests still assert every writer is prefix-scoped, the runbook
matches reality, and the ADR records the decision. Delete
docs/product/follow-ups/FU-20260815-dumps-and-exports-share-one-bucket.md as part of the change.
```
