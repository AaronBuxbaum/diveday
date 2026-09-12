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

## Where the money actually goes

Read before proposing to "move a service to save money". **Read off the actual AWS bill for August
and the first nine days of September 2026**, not estimated from the stack — the estimate that used
to sit here was wrong by an order of magnitude on two lines, which is the reason this table now
cites an invoice.

| Line | $/month | What it buys |
| --- | ---: | --- |
| AWS Business Support+ | 25 | A support plan with a case path and response times. Fixed, and now the single largest line on the whole bill |
| Vercel Pro, one seat | 20 | Hosting, previews, crons, Analytics, Speed Insights |
| AWS S3, four buckets | 12 | Visual-regression baselines, database dumps, backups, media. **See the warning below — this is not yet attributed** |
| AWS Route 53 health check | 2.75 | The one check that runs outside the thing it checks (`infra/lib/global-stack.ts`); 30-second interval with string matching, against a non-AWS endpoint |
| AWS CloudWatch | 2.50 | Seven metrics and four alarms past the always-free ten (`infra/lib/observability.ts`) |
| AWS Secrets Manager | 1.20 | Three secrets at $0.40; `infra/lib/infra-stack.ts` §16 |
| Neon | 0 | Free tier; **suspends** past 300 CU-hours, which is the one ceiling that is an outage rather than an invoice |
| Sentry, Meta, Stripe | 0 | Free tiers and per-transaction |
| GitHub Actions | 0 | The repository is public, so runner minutes are free. They cost **wall-clock**: the workflow's nineteen jobs sit one under the twenty-concurrent-job cap, and a run that starts while another is in flight queues behind it — a green main run on 2026-08-31 waited ten minutes for a runner before its first job started |

So the bill is about **$64 a month**, of which $45 is AWS and $25 of that is a support plan. It was
described here as $22–24 until 2026-09-10.

> **The $12 of S3 is a finding, not a baseline.** This table used to carry the reg-suit bucket at
> "<1" and the entire AWS floor at "2–3". The August bill says S3 alone was $11.998, on an account
> with no production traffic, with daily spikes to $2 on 23, 24, 27 and 28 August. Nothing here
> attributes that to a bucket, and there are four candidates: the visual-regression bucket (~700
> PNGs per run, every run), the daily `pg_dump` objects, the backup bucket, and media. Requests, not
> storage, are the likely shape of it. Until someone runs Cost Explorer grouped by usage type, treat
> this line as unexplained rather than as the cost of doing business. Tracked as issue #1651.
>
> **The visual bucket has been tightened, and it will not move this line.** On 2026-09-10 the
> bucket's lifecycle expiry went from 180 days to 60 and the pruner from nightly to six-hourly
> (ADR 20260826-prune-visual-bucket's second amendment). Both are storage levers, and the arithmetic
> says storage is not where the money is: the bucket's steady state is roughly ten main baselines
> plus a day and a half of branch runs — about 145 snapshots × 854 PNGs × ~250 KB, or ~31 GB, which
> is ~$0.71/month of `TimedStorage-ByteHrs`. What matches the bill is requests, exactly as the daily
> profile above suggests: ~900 Tier-1 PUTs per publishing run at $0.005/1,000 is $0.0045 a run, and
> at this repository's rate of ~26 merges plus ~65 branch commits a day that is $0.41/day, or
> ~$12.3/month — which lands on both the measured $0.38/day and the August total. Neither a
> lifecycle rule nor a pruner touches a PUT. The only lever that reaches the $12 is whether every CI
> run needs to upload every capture, which is filed separately and is still the thing to do. What
> the 60-day expiry *does* buy is a lower ceiling on a silent pruner outage: at ~19 GB a day of
> accumulation, ~$27/month instead of ~$80.

What moving would and would not do:

- **Vercel → AWS (Lambda + CloudFront via OpenNext, or Amplify).** Saves the $20 and costs a
  deploy pipeline this repo does not have: previews, the eleven `vercel.json` crons, Analytics and
  Speed Insights all need replacing, `scripts/vercel-build.mjs` runs the production migration, and
  ADR 20260718-vercel-hosting chose Vercel for exactly those. Weeks of agent time to save the price
  of one lunch a month, before a single shop is paying. Not worth it pre-pilot; revisit when Vercel
  usage lines (function GB-hours, bandwidth) start to show on the invoice, which they do not today.
- **Neon → RDS / Aurora Serverless v2.** Costs *more* (Aurora's floor is ~$40/month at 0.5 ACU)
  and buys durability the free tier lacks. The right move is the one `pnpm cost:report` already
  names: Neon Launch at $19/month before the first pilot shop, because the free tier's ceiling
  suspends the endpoint rather than billing.
- **AWS Business Support+ → Basic.** Saves the largest single AWS line, and costs the case path.
  Worth a deliberate decision rather than a drift: the one thing on the checklist that *required* a
  support case, `cloudfront-account-verification` in
  [manual-actions.md](manual-actions.md), is an account-and-billing case, which Basic Support can
  raise for free. Keep the plan for the response times if a pilot is imminent; drop it if the case
  path is not being used.
- **AWS trimming.** Real but small, and each remaining item is filed rather than done here: three
  implicit Lambda log groups never expire; two IAM users exist for an MCP consumer that no longer
  does; RUM samples 100% of sessions. Together they are under $10 a month at pilot scale, and
  all of them are one-line changes in the stack. The largest of them is **done**: the
  `MutationDuration` metric filter was dimensioned by action label, which would have billed $0.30
  per distinct label — about $9/month across thirty-odd server actions — and is now one aggregate
  metric, with the per-action ranking left to the Logs Insights widget that already did it
  (issue #1241).

The cost worth engineering against is therefore **CI wall-clock**, not dollars — see
`.github/workflows/ci.yml`'s `changes` gate (a docs-only change skips the build, the Playwright
shards, the visual shards and the compare) and `src/test/shard-sequencer.ts` (unit shards dealt by
cost rather than by count).

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
