# H-154: Who runs the first restore, and where are the production secrets backed up?

- **Status:** Chosen
- **Human owner:** Aaron Buxbaum

## Decision or approval needed

**No restore of DiveDay's backups has ever been run** (the 2026-10-23 code pre-mortem, item 3). The
weekly full-cluster dump and the per-shop bundles are written and watched, but the runbook's restore
log read `never`, the Neon restore window was unrecorded, and nobody had written down where
`AUTH_SECRET`, `CRON_SECRET` and `SECRET_ENCRYPTION_KEY` are backed up.

## Decision

**Decided 2026-10-23 (Aaron, in the project thread, call 2: "Recommended"): Aaron runs the first
restore himself this week, with an agent holding the runbook; the monthly drill follows.** The
agent reads the steps, runs what Aaron approves, and records the restore window, the secrets'
vault and the first log row in the runbook in the same session.

## What ships

- `.github/workflows/restore-drill.yml` and `scripts/restore-drill.mjs`: monthly and on demand,
  restore the newest dump into a scratch Neon branch, sign in as the seeded owner, read tomorrow's
  manifest, delete the branch. Never the production branch.
- The first-run checklist at the top of §4 of
  [backup-and-restore-runbook.md](../../engineering/backup-and-restore-runbook.md), and the three
  blanks there (restore window, secrets backup, first log row) marked "Aaron, first run with an
  agent".

Set to **Implemented** when the first run's row is in the runbook's log and the workflow has run
green once.

## Unblocks / follow-up

- The workflow's AWS role (`GitHubActionsRestoreDrillRole`) is in the CDK stack. Until the stack
  is deployed and `RESTORE_DRILL_ROLE_ARN` is set on the `restore-drill` environment (manual action
  `restore-drill-role-variable`), the drill runs by hand as the first-run checklist does.

Part of the [human decision log](README.md#decision-register).
