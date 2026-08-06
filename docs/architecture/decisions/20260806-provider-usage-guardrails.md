# 20260806-provider-usage-guardrails — Poll Vercel and Neon usage daily and alert; never auto-disable

- **Status:** Accepted
- **Date:** 2026-08-06

## Context

[ADR 20260802-aws-cost-guardrails](20260802-aws-cost-guardrails.md) put an alert-only budget and
Cost Anomaly Detection on the AWS account. That covers roughly $5/month — the *smallest* bill
DiveDay pays. The larger ones are on other vendors' consoles, where AWS Budgets cannot see:

- **Vercel** hosts the app, its functions, its bandwidth, Analytics, and Speed Insights.
- **Neon** is the database. Its compute allowance is the one ceiling on the whole list whose
  overflow is *downtime* rather than money: on the free plan an exhausted allowance suspends the
  compute endpoint, which from inside DiveDay looks like the database going away mid-day.
- **Sentry** and **Meta's WhatsApp Cloud API** both bill against quotas nothing in DiveDay reads.

Nothing notices any of this until an invoice arrives, or — for Neon — until the site stops.

Two corrections to the finding that raised this (OPS-9), both verified before building anything.
**Resend is not used**: SES has been the sole email provider since
[ADR 20260803-ses-sole-email-provider](20260803-ses-sole-email-provider.md), and SES spend already
sits inside the AWS budget. And **the AWS side is not the gap** — it is done, and its posture is
the one to copy rather than improve on.

## Decision

**A registry, four probes, a daily cron, and an email. Alert-only, mirroring the AWS ADR
exactly: nothing disables, throttles, or degrades anything, ever.** A false-positive shutoff
caused by a misread usage API would take a dive shop's booking page down on a Saturday; a surprise
invoice would not. That asymmetry decides the whole design.

**`src/lib/cost-guardrails.ts` is the registry** — provider-neutral, pure, framework-free, codes
not sentences. One row per ceiling worth watching, each naming its provider, metric, unit, value,
period, warning fraction, whether anything can observe it, and what the provider does when it is
reached. `evaluateCeiling` turns a sample into `ok`/`warn`/`over`, with `>=` at both boundaries:
the ceiling is the number you did not want to reach, not the first value past it.

**Every ceiling value is a figure a human chose, not a plan allowance quoted from a vendor.** This
is the difference between a table that ages gracefully and one that lies. Free tiers change several
times a year, and a constant claiming to be "the Neon free-tier compute allowance" would be wrong
within months while still reading as authoritative. A number that is openly "the level at which
Aaron wants an email" is never wrong — it is a decision, reviewed by editing the array. Same shape
as `monthlyBudgetLimit` defaulting to 5 in the CDK stack.

**Probes live in `src/lib/usage/`, take an injected `fetch`, and honour
`DIVEDAY_DISABLE_EXTERNAL_HTTP=1`** the same way `marine-forecast.ts` and `analytics.ts` do —
gated on the real `fetch` only, so a unit test passing its own fetcher still exercises the adapter.
Vercel reads `GET /v1/billing/charges` (newline-delimited FOCUS v1.3 rows); Neon reads
`GET /api/v2/consumption_history/v2/projects` (the **v2** endpoint — `/consumption_history/account`
and its legacy metric names were removed in June 2026). Neither shape has been verified against a
live account, because no credential for either exists in this repo; both parsers say so in their
own source, both are narrow and zod-validated, and `verify-usage-guardrails` in the manual-actions
registry makes "compare the first logged figure against the console, by eye" an explicit step.

**A sample has four states and none of them may ever flatten into `ok`.** `measured`,
`not_configured` (no credential), `unavailable` (a credential exists and the read still failed),
`unobservable` (no probe exists). This is the safety property the whole feature rests on: a monitor
that reports fine because it could not measure is strictly worse than no monitor, because it
converts "nobody is watching" into "somebody is watching and it's fine". The distinction survives
into the alert, the Sentry tags, the log line, and the HTTP response. A `measured` sample that is
negative or non-finite is downgraded to `unavailable` rather than read as very low usage, for the
same reason.

**Ceilings nothing can measure stay in the registry, labelled.** Sentry and WhatsApp are
`console_only`. Omitting them would make the table read as full coverage, which is the same lie in
a different place.

**The alert is a notification kind on the existing SES pipeline** — `usage_ceiling_alert`,
addressed to `alertRecipient()`, English and founder-only exactly as `new_account_alert` and
`demo_started_alert` are ([ADR 20260805-demo-try-alerts](20260805-demo-try-alerts.md)). It carries
no personal data because none exists on this path: every field is a machine key or a number about
an invoice. It names what the provider does at the ceiling, and it says out loud that nothing has
been turned off — somebody reading a cost warning at 7am should not have to wonder whether the site
is already down.

**It is the only kind with no `shopId`, and that is structural.** Every other notification is
about one tenant's booking, diver, or account. This one is about the platform's Vercel bill; there
is no shop it belongs to. It therefore rides `notify()` rather than `sendNotification()`, because
the latter enqueues a retryable failure into `notification_send_queue`, whose `shop_id` is a
non-null foreign key. One attempt, no durable retry: a cost warning that is a day late does not
justify a tenant-scoped retry queue, and the daily cron is itself the retry.

**Once per ceiling per period per level, enforced by a claim in `notification_rate_limit_state`.**
The tempting answer — "the send queue's unique `idempotency_key` already gives us that" — is
wrong, and the reason is easy to miss when reading `sendNotification`: a row only ever enters that
queue when a send **fails** and is retryable. A successful send writes nothing, so the unique key
deduplicates retries and nothing else. Under a daily cron, a ceiling that stays over would mail
every morning for three weeks. `notification_rate_limit_state` already exists, is empty, was built
as generic provider-keyed infrastructure that was never taken up, and is exactly the right shape —
a text key and a `next_allowed_at` instant, which is precisely the question being asked. No
migration, no new table. The claim is taken *before* sending so two overlapping runs cannot both
mail, and **released** when the send did not land, so one SES hiccup cannot cost a ceiling its
whole month of alerting while looking healthy.

**`/api/cron/usage`, daily at 09:00 UTC**, copying `/api/cron/retention`'s posture exactly:
fail-closed `CRON_SECRET` bearer auth (503 unconfigured / 401 wrong-or-missing) with the gate
*before* the Sentry check-in, its own Cron Monitor slug with its own env override, an explicit
`maxDuration`, and one structured `cron_usage.scan_complete` line per run. 09:00 keeps it clear of
the other three entries.

**Environment keys are `USAGE_VERCEL_*` / `USAGE_NEON_*`, not `VERCEL_*` / `NEON_*`.** `VERCEL_` is
the namespace Vercel injects its own system variables into on every deployment; a hand-set variable
there is a collision waiting to happen. One `USAGE_` namespace also makes the whole feature
greppable from `.env.example`. All four are optional and exempted from `check:env`'s required-key
sweep for the same reason `PLACES_*` is: absent is a supported state, and the monitor says so out
loud rather than going quiet.

## Alternatives considered

- **Wait for the invoice.** Rejected: that is the status quo, and the detection latency is a
  month. For `neon_compute` it is worse than a month — the first signal would be the site being
  down.
- **Auto-disable, throttle, or shed load at a ceiling.** Rejected outright, on the same reasoning
  as the AWS ADR. The guardrail must never be able to cause the outage it exists to prevent.
- **A per-resource Vercel breakdown instead of one total.** Rejected: the failure worth catching is
  "the total moved", and per-resource ceilings need re-tuning every time traffic shifts between
  resources without the total changing at all.
- **A new table for the alert ledger.** Rejected: a migration for a boolean-per-month is more
  machinery than the problem deserves when a table with exactly that shape already exists unused.
- **Vendor spend caps only, with no in-app monitor.** Rejected as the *whole* answer, kept as part
  of it. Console caps are the only hard stop that exists and `provider-spend-caps` in the
  manual-actions registry requires them — but they are per-vendor, invisible from the repo, and
  say nothing until the threshold. The in-app monitor is what makes the trend legible, in one
  inbox, with the numbers in a log drain.
- **A dashboard instead of email.** Rejected for the same reason ADR 20260727 rejected it for
  signups: a low-volume structured signal with one known recipient is an email, not a dashboard
  somebody has to remember to open.
- **Polling hourly.** Rejected: provider usage figures do not update that fast, Vercel's cron
  cadence is a hosting-plan question, and a day is already an order of magnitude better than the
  month the status quo offers.
- **Skipping the ceilings nothing can poll.** Rejected — see above; a registry that silently omits
  what it cannot see reads as complete.

## Consequences

Vercel and Neon spend become visible a day after it moves rather than a month, in the same inbox
that already receives signups and demo tries, with the numbers in the log drain for anything that
wants to chart them later. The Neon compute ceiling in particular is now an early warning about an
outage rather than a post-mortem finding.

What it commits us to: two more third-party tokens to mint and rotate, two parsers written against
documentation that will drift, and a registry of numbers a human has to review when a plan changes.
The parsers are the real maintenance cost, and they are built to fail loudly — a shape change
reports `no_charge_rows` or `unrecognised_shape` and raises a Sentry warning rather than quietly
reading zero.

Revisit when: Sentry or WhatsApp usage becomes worth a probe rather than a console visit (the
registry rows are already there, waiting to change `console_only` to `polled`); or a second
deployment needs its own ceilings, at which point the registry becomes per-environment
configuration rather than a constant.
