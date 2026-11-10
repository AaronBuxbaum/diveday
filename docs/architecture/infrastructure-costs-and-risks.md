# Infrastructure costs, evidence and resource risks

This is a source map, not a current bill, verified account plan or deployment inventory.
`pnpm cost:report` reports those distinctions explicitly. Its generation time does not refresh
historical evidence. Earlier estimates and completed proposals are preserved in the
[November 10 archive](../product/archive/infrastructure-costs-and-risks-20261110.md).

## What can be measured

- `pnpm cost:report --json` reads local probe configuration and source inventory without calling
  provider APIs. Credentials being present does not prove a probe works.
- `pnpm cost:report --live --json` reuses the
  [usage collector](../../src/features/usage/collect.ts) for configured Vercel and Neon probes.
  Failed, absent and unconfigured measurements remain distinct. No all-provider total is derived.
- Each live reading names its source, requested UTC calendar-month window, unit, scope, plan
  verification limit and request time. This is not necessarily the account's invoice period.
  The Vercel collector assumes USD; reconcile its first reading and currency against the
  provider account before using it as billing evidence. No live account verification is claimed.
- AWS, Sentry, Meta and Stripe billing are not measured by this CLI. AWS budget definitions are
  source evidence only. Actual deployment, current plans, quotas and rate cards remain unknown.

Use the [cost guardrails runbook](../engineering/cost-guardrails-runbook.md) for the usage cron,
alert-only thresholds and first-reading reconciliation. Neither this report nor a closed ticket
is proof that credentials, project quotas or provider dashboards were configured.

## Historical invoices are not a fixed floor

The runbook records August/early-September AWS bills totaling $43.55 and the later removal of a
$25 support subscription on November 2. Subtracting the support charge produces an arithmetic
scenario, not a new invoice or minimum bill. The old total included variable, unattributed S3
spend. Do not add it to assumed subscription prices or arbitrary headroom to label a current
monthly run rate. The report retains this history separately with its source and dates.

## Current source topology

| Area | What source establishes | What still needs account or runtime evidence |
| --- | --- | --- |
| Manifest SSE | [Route](../../src/app/api/trips/[id]/manifest-events/route.ts) retires streams after 240 seconds, before its route ceiling. | Viewer time is not billed GB-hours; measure memory, execution and reconnect outcomes. |
| PostgreSQL LISTEN | [Subscriber](../../src/db/manifest-events.ts) shares one listener per warm process with viewers and closes it after 120 idle seconds. | Count warm processes and actual connections, not one database connection per tablet. |
| External monitoring | [Global stack](../../infra/lib/global-stack.ts) defines Route 53 health checks and SNS alarms. | Verify deployed checks and an alert drill before claiming coverage. Do not buy a duplicate canary on this document's authority. |
| Database dumps | [Infrastructure stack](../../infra/lib/infra-stack.ts) schedules weekly dumps. | Verify successful artifact age and restoration; a schedule is not a completed backup. |
| Media | S3 implementation has replaced Vercel Blob. | Attribute actual storage, requests and transfer before projecting costs. |
| Rate limiting | [Environment registry](../../config/env-registry.mjs) requires production Upstash configuration; [runtime](../../src/lib/rate-limit.ts) warns on unexpected fallback. | Verify deployed settings and behavior without printing secrets. Source is not evidence of current fallback. |
| Migrations | Build-time application of migrations can overlap the prior release. | Keep expand/contract checks; verify deployment procedure before changing hosting. |

## Budget alerts do not prove quota headroom

The [registry](../../src/lib/cost-guardrails.ts) contains owner-chosen alert budgets. The 300
compute-unit-hour Neon threshold is not a quoted Free allowance. Org-level consumption sums
multiple projects; it cannot establish a production project's remaining allowance. GiB-months
are cumulative consumption, not current-size storage. A successful low budget reading must not
be interpreted as assurance that a particular project's quota is safe.

A quota observation needs the actual production project, verified plan/allowance, reset period,
current utilization and enough runway for the polling interval. For example, a 95/100 project
needs attention regardless of whether an org budget of 300 is below its warning threshold.
Actual production account evidence has not been collected for this change. Keep alerts
informational; never shut off bookings to save money.

## WhatsApp billing evidence

Conversation counts and a supposed 1,000-conversation allowance are not a delivered-message cost
model. A charge depends on the applicable category, recipient market, rate version and billing
account. Provider message identity and delivery outcome must be reconciled with account invoices
before a modeled charge can be called actual spend. The tenant-scoped
`readWhatsAppDeliveredUsage` reader in `@/features/whatsapp-webhook` counts verified delivered
callbacks by sending WABA/phone and pricing classification. The shop export includes
`whatsapp_delivered_usage.csv`; coverage starts with callbacks received since deployment, not
complete historical/account usage. Market, rate version, money, currency and invoice payer remain
unknown. Do not infer that all shops' charges belong to DiveDay's Meta account.

This correction changes no delivery semantics, channel selection, opt-ins, account plan or
billing configuration. The old conversation ceiling is removed rather than replaced with an invented
allowance. Actual rate/invoice reconciliation and production project quota evidence remain
unverified; callback counts and local diagnostics do not certify them.

## Operational references

- [System overview](overview.md)
- [Infrastructure decisions](aws-migration-dossier.md)
- [Realtime manifest runbook](../engineering/realtime-manifest-events-runbook.md)
- [Backup and restore](../engineering/backup-and-restore-runbook.md)
- [Incident response](../engineering/incident-response-runbook.md)
