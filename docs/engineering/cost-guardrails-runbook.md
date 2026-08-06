# Cost guardrails runbook

What DiveDay pays for, what stops it running away, and — the part that matters most — what
nothing is watching.

Decisions: [ADR 20260802-aws-cost-guardrails](../architecture/decisions/20260802-aws-cost-guardrails.md)
for the AWS half, [ADR 20260806-provider-usage-guardrails](../architecture/decisions/20260806-provider-usage-guardrails.md)
for everything else. The human setup steps are in the generated
[manual-actions.md](manual-actions.md) (items `provider-spend-caps`, `usage-guardrail-tokens`,
`verify-usage-guardrails`) — add steps to the registry in `infra/lib/infra-stack.ts`, never to
this file.

## The posture, in one line

**Alert-only. Nothing in this system ever disables, throttles, or degrades anything.**

That is a deliberate trade, not an omission. A false-positive shutoff — a usage API returning a
bad number, a parser misreading a renamed field — would take a dive shop's booking page down on a
Saturday morning. An unexpected invoice does not. Every ceiling below is therefore set generously,
and the only consequences of crossing one are an email and a Sentry event.

## Who bills us

| Provider | What for | Guardrail | Who watches |
| --- | --- | --- | --- |
| AWS | SES, SNS, S3 (visual baselines, backups), Location Service | `AWS::Budgets::Budget` + Cost Anomaly Detection, both alert-only | AWS itself, via email — no DiveDay code involved |
| Vercel | Hosting, functions, bandwidth, Analytics, Speed Insights | `vercel_spend` in `src/lib/cost-guardrails.ts`, polled daily | `/api/cron/usage` |
| Neon | Postgres compute, storage, egress | `neon_compute`, `neon_storage`, `neon_egress`, polled daily | `/api/cron/usage` |
| Sentry | Error events | `sentry_errors` — **console only** | Nobody. See below. |
| Meta (WhatsApp Cloud API) | Per-conversation messaging | `whatsapp_conversations` — **console only** | Nobody. See below. |
| Stripe | Per-transaction fees | none, deliberately | — |

Stripe has no ceiling because its cost is proportional to revenue that has already arrived: a
Stripe bill that grows is a business succeeding, not a leak. Everything else on this list can grow
without anything good happening.

**Resend is not on this list because DiveDay does not use it.** SES has been the sole email
provider since [ADR 20260803-ses-sole-email-provider](../architecture/decisions/20260803-ses-sole-email-provider.md),
and SES spend sits inside the AWS budget above. If you are reading a finding that says otherwise,
the finding predates that ADR.

## What actually happens when a ceiling is hit

This is the question worth being precise about, because the three answers are not equally urgent
and the registry encodes them as codes (`CeilingOverflow`) rather than prose.

- **`bills_overage` — Vercel spend, Neon storage, Neon egress, WhatsApp conversations.**
  Everything keeps serving; the invoice grows. Nothing breaks, nothing is lost. This is a money
  problem with a deadline of "before the card is charged".
- **`suspends` — Neon compute.** The one that is not about money. On Neon's free plan, an
  exhausted compute allowance suspends the compute endpoint, which from inside DiveDay looks like
  the database going away: every page, every booking, every manifest. On a paid plan the same
  ceiling meters instead. **Confirm which behaviour your plan has** — `provider-spend-caps` in
  manual-actions.md asks you to, and it changes whether `neon_compute` warnings are a budget
  conversation or an outage countdown. The registry warns at 40% of this one, earlier than any
  other, on the assumption of the worse plan.
- **`drops` — Sentry errors.** Past the quota Sentry silently discards events. Nothing breaks and
  nothing tells you; error monitoring simply stops, usually on the busiest day of the month, which
  is the day you most need it. **This also disables the dead-man's switch on every cron**, because
  a dropped check-in and a missed run are indistinguishable from the outside.

## What the monitor can see

`GET /api/cron/usage` runs daily at 09:00 UTC (`vercel.json`), gated by `CRON_SECRET` exactly like
the other three crons. It:

1. Polls Vercel's `GET /v1/billing/charges` and Neon's
   `GET /api/v2/consumption_history/v2/projects`, both read-only, both bounded by a 15-second
   timeout, both parsed narrowly with zod.
2. Evaluates every ceiling in `src/lib/cost-guardrails.ts` against what came back.
3. Emails `alertRecipient()` — `OPS_ALERT_EMAIL`, falling back to `ALERT_EMAIL` — for anything at
   `warn` or `over`, **once per ceiling per period per level**.
4. Captures the same to Sentry, plus a warning for any probe that went blind.
5. Writes one `cron_usage.scan_complete` line naming every ceiling and its verdict.

The response body carries every ceiling's full evaluation, which is what
`verify-usage-guardrails` in manual-actions.md tells you to read.

## What the monitor cannot see

The honest part. Read this before trusting a quiet inbox.

- **Sentry and WhatsApp are not polled at all.** Both are in the registry as `console_only`,
  which evaluates to `unobservable` and is never rendered as `ok`. Sentry publishes an
  organization stats API and could become `polled`; nobody has minted the token. Meta's billable
  conversation totals live in Business Manager and the Cloud API reports per-message delivery
  rather than a running total, so that one needs a person looking.
- **A calendar month is not a billing period.** Vercel and Neon both bill on an account
  anniversary. `periodKeyFor` uses UTC calendar months because it needs a denominator and an alert
  period, not because it reproduces an invoice. Do not reconcile a warning against a statement and
  conclude the monitor is broken.
- **Every ceiling number is a figure a human chose**, not a plan allowance quoted from a vendor.
  Free tiers change several times a year; a number in the repo claiming to be "the Neon free-tier
  allowance" would be wrong within months while still looking authoritative. Review the array in
  `src/lib/cost-guardrails.ts` when the plan changes.
- **Neither response shape has been verified against a live account.** No Vercel or Neon
  credential exists in this repo, so both parsers were written from published documentation. Both
  say so in their own source. That is why the first real run has an explicit manual step: compare
  the logged figure against the console, by eye, once.
- **Spend between two daily runs is invisible.** The floor on detection is one day. A runaway that
  starts at 09:01 UTC has 24 hours before anything looks.
- **The monitor cannot see its own absence.** That is what the Sentry Cron Monitor
  (`diveday-usage-guardrails`) is for — and see the Sentry `drops` note above for why that switch
  is not unconditional.
- **Nothing here watches a bill that is not a ceiling in the registry.** A new vendor is invisible
  until somebody adds a row.

## Reading a `not_configured` / `unavailable` / `unobservable`

These three are deliberately distinct, all the way from the probe to the email. Collapsing any of
them into `ok` would produce the failure this whole feature exists to avoid: a monitor reporting
fine because it could not look.

| Level | Means | Do |
| --- | --- | --- |
| `not_configured` | No token pair for this probe | Mint them — `usage-guardrail-tokens` in manual-actions.md. Expected on a fork or a local run. |
| `unavailable` | A token exists and the read still failed | Read the reason code (below) |
| `unobservable` | No probe exists for this ceiling | Look at the vendor console by hand |

Reason codes on `unavailable`, from the response body or `cron_usage.scan_complete`:

| Reason | Meaning |
| --- | --- |
| `unauthorized` | Token wrong, expired, or revoked |
| `forbidden` | Token valid, scope insufficient — Vercel needs the billing team, Neon needs an organization key |
| `rate_limited` | Back off; the next daily pass will retry |
| `http_<status>` | Anything else the provider returned |
| `network_error` | The request never got a response |
| `no_charge_rows` | Vercel answered 200 with nothing this parser recognised — suspect a shape change |
| `metric_absent` | Neon answered but never mentioned this metric — suspect a renamed field or a key scoped to the wrong org |
| `unrecognised_shape` | The Neon payload did not match the documented envelope |
| `response_too_large` | More rows than the parser will read; a truncated sum would read *low*, so it refuses |
| `external_http_disabled` | `DIVEDAY_DISABLE_EXTERNAL_HTTP=1` — expected under the e2e fleet, never in production |
| `probe_threw` | A probe raised instead of returning; a bug, not a provider problem |
| `invalid_sample` | The provider returned a negative or non-finite number |
| `invalid_ceiling` | The registry entry itself is broken |

## Escalation

1. **A `warn` email.** Nothing is wrong yet. Open the provider console, confirm the figure, and
   decide whether the ceiling or the usage is what should change. For `neon_compute`, confirm
   first whether your plan suspends or meters.
2. **An `over` email.** For `bills_overage` ceilings: expect the invoice, decide whether to move
   plan. For `neon_compute` on a free plan: this is an impending outage — upgrade the plan, do not
   wait for the period to roll.
3. **A `unavailable` Sentry warning that persists for more than two days.** You are blind on that
   ceiling. Fix the token or the parser; do not let it become background noise, because a blind
   probe and a healthy one produce the same silence in the inbox.
4. **No `cron_usage.scan_complete` line and no Sentry check-in.** The poll is not running. Check
   the Vercel cron invocation log and `CRON_SECRET`.
5. **An alert you expected and did not get.** The claim ledger suppresses one alert per ceiling
   per period per level. It is a row in `notification_rate_limit_state` keyed
   `usage-ceiling/<ceilingId>/<period>/<level>`; deleting it re-arms that alert immediately. A
   send that failed releases its own claim, so a transient SES problem does not cost a month of
   alerting.

## Changing a ceiling

Edit the array in `src/lib/cost-guardrails.ts`. Nothing else needs to change: the alert body, the
log line, the response, and the tests all derive from it. `src/lib/cost-guardrails.test.ts` holds
the invariants a new row must satisfy (positive ceiling, `warnAt` strictly inside it, machine-key
ids and metrics).

Adding a *provider* means a probe in `src/lib/usage/`, one line in `collectUsageSamples`, and — if
it cannot be polled — an honest `console_only` row rather than no row at all.
