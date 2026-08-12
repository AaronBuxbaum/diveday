# FU-20260812-backups-still-cannot-restore-a-login — Decide whether the platform backup gets a pg_dump layer

- **Status:** Open
- **Raised:** 2026-08-12 — branch `claude/aws-free-tier-options-d3xbkd`, while wiring the runner for
  the scheduled logical export (ADR 20260812-platform-backup-runner)
- **Kind:** question
- **Effort:** M
- **Touches:** `docs/engineering/backup-and-restore-runbook.md`, `src/lib/export.ts`,
  `infra/lib/infra-stack.ts`, `docs/architecture/decisions/`

## What I noticed

DiveDay's platform backup now actually runs weekly — but what it stores cannot restore a working
platform, and the reason is structural rather than a bug.

The bundle is built from the per-shop **export** seam, which exists to let a shop *leave*. Its
`NOT_INCLUDED` list in `src/lib/export.ts` deliberately excludes login accounts, password hashes,
email-verification / password-reset / invite tokens, and staff calendar-subscription links. That is
correct for portability — a shop walking away should not receive password hashes — and it means a
restore from bundles alone produces every shop, every booking, every waiver, and **nobody who can
sign in**. The tables it misses are `user_accounts`, `account_tokens` and `calendar_feeds`.

So the recovery story today is: Neon PITR covers everything, for however long its window is (which
is *itself* still unrecorded at the top of the runbook, flagged there as an owner decision, and can
be as little as six hours on a free-tier project); and past that window the export bundles cover the
data but not the means to reach it.

The runbook already names the fix — "Adding a `pg_dump` layer (the obvious next increment)" — and
has done since 2026-08-02. Wiring the runner made it sharper rather than solving it: there is now a
scheduled, watched pipeline that a `pg_dump` could ride on, and no remaining excuse of "there is
nowhere to put it".

## Why it isn't already done

It needs decisions I should not make alone, and it is a strictly larger change than the one I was
asked for.

`pg_dump` needs somewhere to run with the **direct** connection string (`DATABASE_URL_UNPOOLED` —
a transaction-mode pooler is unreliable for this, the same reason migrations use the direct
connection). A Vercel function is a poor host for it: no `pg_dump` binary, and a full dump is not a
300-second, memory-bounded job. That points at a container or a scheduled runner somewhere new,
which is an infrastructure decision with a real cost, and cost posture on this account is a human
call (see `docs/product/human-decisions.md`).

There is also a genuine question underneath: a full `pg_dump` contains password hashes and every
medical answer in one file. Where it may be stored, who may read it, and how long it is kept are
retention and policy questions tangled with **H-02** (waiver retention, still open), not
engineering ones.

## Proposed change

Decide, in this order:

1. **Is the Neon PITR window long enough that this does not matter?** Answer the owner-decision
   marker at the top of the runbook first — record the actual retention days. If the window
   is 7+ days and the Neon account itself is considered durable, a `pg_dump` layer is
   vendor-independence insurance rather than day-to-day recovery, and can wait.
2. If it is short (hours), treat this as the highest-priority gap in the recovery posture, above
   anything else in this register.
3. When it lands: it belongs in the runbook's §2 as a sibling of the bundle export, written to the
   same `DatabaseBackupBucket` under a separate prefix (`dumps/<date>/`) with its own lifecycle
   rule, and the per-shop export goes back to being purely the portability feature it was built as.
   It needs its own ADR covering the host, the credential, and the retention answer from H-02.

What I am *not* proposing: adding `user_accounts` to the export bundle. That would put password
hashes into a file staff can download from a settings page, which is a much worse trade than the
gap it closes.

## Prompt

```text
DiveDay's weekly platform backup stores per-shop export bundles that deliberately exclude
user_accounts, account_tokens and calendar_feeds, so restoring from them yields a complete platform
that nobody can sign in to. Decide whether to add a pg_dump layer, and if so, ship it.

Read first: docs/product/follow-ups/FU-20260812-backups-still-cannot-restore-a-login.md,
docs/engineering/backup-and-restore-runbook.md (all of section 2, and the "Adding a pg_dump layer"
subsection), NOT_INCLUDED in src/lib/export.ts, and ADR
docs/architecture/decisions/20260802-backup-and-restore-posture.md.

Step 1 is not code: answer the owner-decision marker at the top of that runbook, recording Neon's
actual PITR retention window, because it decides whether this is urgent or merely prudent. Do not guess that
number -- read it from the Neon console and write it down with the date checked.

The constraints that make this non-obvious: pg_dump needs the direct connection
(DATABASE_URL_UNPOOLED, not the pooled one) and a host that is not a 300-second Vercel function;
and the resulting file contains password hashes and medical answers in one place, so where it lives
and how long it is kept is entangled with H-02 in docs/product/human-decisions.md, which is a human
decision and not yours to close. Do NOT solve this by adding user_accounts to the export bundle --
that would put password hashes behind a staff download button.

Done means: the PITR window is recorded; a decision is written as an ADR; and if the decision is to
ship, the dump runs on a schedule, lands under its own prefix in DatabaseBackupBucket with a
lifecycle rule, is covered by the freshness watchdog in infra/lib/infra-stack.ts section 19, and
the runbook's section 2 and section 4 restore test both describe it. Run `pnpm check`. Then delete
docs/product/follow-ups/FU-20260812-backups-still-cannot-restore-a-login.md.
```
