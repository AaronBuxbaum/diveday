# FU-20260812-backup-watchdog-cannot-see-a-short-run — Teach the freshness check how many bundles it should have found

- **Status:** Open
- **Raised:** 2026-08-12 — branch `claude/aws-free-tier-options-d3xbkd`, the change that added the
  platform backup runner (ADR 20260812-platform-backup-runner)
- **Kind:** risk
- **Effort:** S
- **Touches:** `infra/lib/infra-stack.ts` (§19), `src/app/api/cron/platform-backup/route.ts`,
  `docs/engineering/backup-and-restore-runbook.md`

## What I noticed

The weekly platform backup pass stops starting new shops once 240 seconds of its 300-second slot
are gone (`SOFT_DEADLINE_MS` in the route). Shops it did not reach are counted as `skipped` in the
log line and the JSON response, and the pass still answers **200** — deliberately, because a pass
that ran out of time is not the same kind of event as a pass that failed.

The AWS-side watchdog (`diveday-backup-freshness-check`, §19) alarms when the newest
`exports/<date>/` prefix is missing, older than 8 days, or contains **zero** `.zip` bundles. It has
no idea how many bundles it *should* have found.

So here is the case that goes wrong, silently, and gets worse as the product succeeds: DiveDay
reaches, say, 40 shops, and 300 seconds is no longer enough for all of them. Every week the pass
backs up the first ~25 shops in `createdAt` order and skips the rest. The prefix exists. It has 25
bundles in it. It is one day old. The watchdog says `ok`, every week, forever — and the 15
newest-joined shops, the ones a growing business can least afford to lose, have never been backed
up at all. Nobody finds out until a restore.

The shop ordering is stable *by design* (so a truncated pass is repeatable rather than random),
which in this failure mode is precisely what makes the same shops lose every single time.

## Why it isn't already done

Scope, and a genuine design question I did not want to answer unilaterally.

Making the watchdog count is easy. Making it count *correctly* is not: it would need to know the
expected number of non-demo shops, and the only authority on that is the database, which the
watchdog deliberately cannot reach — the whole point of §19 is that it runs in AWS with no
dependency on Vercel or Neon being alive. Handing it a number means the pass has to publish one,
which means the check now trusts a value written by the thing it is checking. That is weaker than
it looks but still much better than nothing, and choosing how much weaker is a judgement call.

I also did not want to quietly turn `skipped > 0` into an alarm: on a small estate a one-off skip
from a slow week is noise, and the cost-guardrails posture in this repo is consistently
"alert-only, and never on a threshold that fires during normal operation".

## Proposed change

Recommended: **have the pass write a manifest, and have the watchdog read it.**

1. In `src/app/api/cron/platform-backup/route.ts`, after the loop, PUT a small
   `exports/<date>/_manifest.json` containing `{ shops, stored, failed, skipped, completedAt }`.
   The uploader already has `s3:PutObject` on this prefix, so no IAM change is needed.
2. In §19's Lambda, fetch that manifest for the newest run... which needs `s3:GetObject`, and that
   is the part to think about. **Scope it to `exports/*/_manifest.json` only** — never
   `arnForObjects("*")` — so the watchdog still cannot read a bundle. Alarm when the manifest is
   missing (a pass that died mid-run never wrote one), when `skipped > 0`, or when the `.zip` count
   under the prefix is below `stored`.
3. Alternatively, and more weakly, skip the manifest: alarm when the newest run's bundle count is
   **lower than the previous run's**. It needs no new IAM at all and catches shrinkage, but it
   cannot catch an estate that has been truncated at the same point since the first run.

What I am *not* proposing: making the route answer 500 on a skip. A partial pass genuinely did
useful work, and a 500 there would train whoever reads the cron log to ignore a real failure.

Whatever is chosen, the real fix underneath is that one Vercel function invocation is the wrong
shape for an unbounded estate. If this is being touched anyway, consider whether the pass should
page through shops across several invocations (a cursor in the manifest) rather than trying to fit
the whole estate in one slot.

## Prompt

```text
DiveDay's weekly platform backup (src/app/api/cron/platform-backup/route.ts) stops starting new
shops after 240s of its 300s budget and reports the rest as `skipped`, answering 200. The AWS-side
watchdog that checks the backup landed (infra/lib/infra-stack.ts section 19,
`diveday-backup-freshness-check`) only checks that the newest exports/<date>/ prefix exists, is
under 8 days old, and holds at least one .zip. It therefore cannot tell a complete run from one
that has been silently backing up only the oldest 25 of 40 shops every week.

Close that blind spot. Read first: docs/product/follow-ups/FU-20260812-backup-watchdog-cannot-see-a-short-run.md
(it states the recommended approach and the one to avoid), ADR
docs/architecture/decisions/20260812-platform-backup-runner.md, section 19 of
infra/lib/infra-stack.ts, and docs/engineering/backup-and-restore-runbook.md section 2.

The constraint that makes this non-obvious: the watchdog must keep working when Vercel and Neon are
down -- that independence is why it exists -- so it cannot query the database for the expected shop
count. And it must not gain the ability to read a backup bundle: the uploader credential is
write-only precisely so a leaked Vercel environment cannot download a shop's exported waivers, and
a watchdog with s3:GetObject on the bundles would undo that. If you add GetObject, scope it to the
manifest key pattern alone and assert the scoping in infra/lib/backup-freshness.test.ts.

Done means: a run that skipped shops raises an alert, a complete run does not, both are covered by
tests in infra/lib/backup-freshness.test.ts and src/app/api/cron/platform-backup/route.test.ts, the
runbook's section 2 table says what the watchdog now checks, and `pnpm check` is green. Then delete
docs/product/follow-ups/FU-20260812-backup-watchdog-cannot-see-a-short-run.md as part of the change.
```
