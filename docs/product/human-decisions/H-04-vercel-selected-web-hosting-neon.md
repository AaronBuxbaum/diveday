# H-04: Vercel is selected for web hosting and Neon (Vercel Marketplace integration) is selected as…

- **Status:** Implemented
- **Human owner:** Product owner / technical owner

## Decision or approval needed

Vercel is selected for web hosting and Neon (Vercel Marketplace integration) is selected as the Postgres provider. Still open: who owns secrets, backups, domain, and incident response?

## Minimum outcome to record

Provider: Neon. Driver: `drizzle-orm/node-postgres`. Production builds run `pnpm db:migrate`; Vercel System Environment Variables are enabled. Still needed: region confirmation and named owner for secrets/backups/incident response.

## Unblocks / follow-up

**Recorded 2026-07-24:** production region is **Washington, D.C. / US-East** (Neon US East, N. Virginia — `aws-us-east-1`). **Aaron Buxbaum** is the named owner of production secrets, backups, domain, and incident response — the sole operator today, so the "product owner / technical owner" split collapses to one person; re-assign when the team grows. **Written down 2026-08-02:** the backup posture and restore-test cadence ([20260802-backup-and-restore-posture](../../architecture/decisions/20260802-backup-and-restore-posture.md), [backup-and-restore-runbook.md](../../engineering/backup-and-restore-runbook.md) — Neon PITR plus a scheduled per-shop export to a retained S3 bucket, quarterly restore test) and the incident-response runbook ([incident-response-runbook.md](../../engineering/incident-response-runbook.md)), closing the last two open items on this row's *documentation*. **Closed 2026-08-06:** `alerts@dive.day` exists, and every alert destination in both runbooks now terminates in it — Sentry issue alerts, the Sentry Cron Monitor's missed check-in, the app's own new-account alert, and the CDK stack's `alertEmail`, whose default was a personal Gmail until this date. **Closed 2026-09-07:** the external uptime monitor and the public status page ship, so this row's last open item is gone. Every other path runs *inside* DiveDay's own infrastructure and goes quiet in the outage that takes the app down; a Route 53 health check polling `/api/health` from outside the account does not, and `/status` says what it found to anyone who asks ([20260907-external-uptime-monitor](../../architecture/decisions/20260907-external-uptime-monitor.md)). The one gap left is a *rendering* check against a real shop's public schedule, which has no slug to point at before the first pilot. See [Neon hosting ADR](../../architecture/decisions/20260718-vercel-neon-hosting.md) and [Vercel hosting ADR](../../architecture/decisions/20260718-vercel-hosting.md).

Part of the [human decision log](README.md#decision-register).
