# 20260806-cloudwatch-log-shipping — Ship structured logs to CloudWatch, and alarm on a small, declared set of counts

- **Status:** Accepted
- **Date:** 2026-08-06

## Context

DiveDay already knows two things about itself in production, and only two. Sentry reports what
**throws** ([20260727-sentry-error-monitoring-q7fk2p](20260727-sentry-error-monitoring-q7fk2p.md)),
and an external uptime check answers whether the site is up
([incident-response-runbook.md](../../engineering/incident-response-runbook.md)). Everything else
the app *decides* goes to `console.log` as a JSON line from `src/lib/log.ts` and evaporates.

That gap is not theoretical, and it is not about errors. These are all things the app handles
deliberately, logs, and returns 200 for:

- `checkout.paid_account_mismatch` — a payment landed against the wrong Connect account.
- `payment.refused_cancelled_booking` — a diver paid for a seat that no longer exists.
- `notification.ses_send_failed` — a waiver link never left the building. The booking still looks
  perfectly fine in the app.
- `rate_limit.store_failed` — the abuse guard is failing open, by design, on every public write.
- `cron_retention.prune_failed` — a weekly pass ran, checked in green with Sentry, and did nothing.

None of those throws. None reaches Sentry. Vercel's log view is a live tail with roughly an hour of
history and no query language, so by the time anyone thinks to look, there is nothing to look at.
The one operational question this product cannot currently answer is *"how often has that been
happening?"*

The infrastructure to answer it is already half-built and already paid for: this account runs a CDK
stack with cost guardrails, SES, SNS, S3, and Amazon Location
([20260805-cdk-minted-credentials-and-manual-actions](20260805-cdk-minted-credentials-and-manual-actions.md)),
and CloudWatch Logs is where the SMS delivery receipts already land
([20260802-sms-delivery-receipts](20260802-sms-delivery-receipts.md)).

## Decision

**`log()` ships the line it already wrote, and the stack declares a small, deliberate set of counts
over that stream.** Five pieces, each answering the next question an operator asks:

1. **A log group** (`/diveday/app`, one-month retention) declared by the stack, §13 of
   `infra/lib/infra-stack.ts`.
2. **`src/lib/observability/`** — buffers each already-serialized line and `PutLogEvents` it, behind
   its own least-privilege IAM user.
3. **Metric filters** over the shipped JSON, one per row of the registry in
   `infra/lib/observability.ts`.
4. **Alarms** on those metrics, to the same `alerts@dive.day` mailbox every other operational alert
   already reaches.
5. **A dashboard and saved Logs Insights queries**, so the question after the alarm has an answer
   that is one click rather than remembered query syntax.

Five properties decide the design, and each is enforced by a test rather than asserted here.

**The console write happens first and unconditionally.** Shipping is strictly additional. Whatever
drain the deployment already tails sees exactly what it saw before, a CloudWatch outage costs
nothing the app had yesterday, and a deployment with no credentials — every local run, the whole
unit suite, the e2e fleet, any fork — behaves byte for byte as `log()` always did. This is the only
reason it is acceptable to put a network call behind a function the Stripe webhook and the roll-call
path both call.

**Nothing in the shipper can fail a caller.** It never throws, never rejects, and never re-buffers a
failed batch. Memory is bounded: past 2,000 buffered lines the *oldest* are dropped and counted,
because an unbounded buffer on a serverless instance is an out-of-memory kill wearing an
observability badge. Five consecutive failures trip a breaker for the life of the instance, reported
once — without it, a wrong credential means an SDK retry storm on every request, forever.

**The flush runs after the response, through an injected hook.** `src/instrumentation.ts` installs
Next's `after()`; the shipper itself imports no framework, because `src/lib` is framework-free by
rule and because the fallback has to work in a plain `node` process too. The four cron routes are
the exception: they `await flushLogs()` in a `finally`, since a pass's log line *is* the record that
it ran, and a route that already takes seconds does not care about one more call.

**Metrics are a registry, not a per-event-code expansion.** A CloudWatch custom metric costs about
$0.30/month and this app emits ~40 distinct codes; a filter per code would cost more per month than
the entire AWS budget the stack sets, for a set of graphs nobody chose. So seven signals earn a
metric and an alarm, chosen because each has a distinct human response, and every other code stays
answerable for free through Logs Insights. Adding a signal means editing one array — there is
deliberately no way to add a graph without also stating what a bad value is and who answers it.

**A filter that matches nothing is the failure mode this design most has to avoid**, because it does
not error, it counts zero forever and the alarm above it reads healthy. `infra/lib/observability.test.ts`
therefore reads the `$.event` codes out of `src/` and fails when a registry row names one the app no
longer emits. That also promotes the event code from an implementation detail to a contract, which
`src/lib/log.ts` now says out loud.

**Log lines carry ids and codes, never PII** — unchanged from `LogContext`'s existing rule, and the
reason one-month retention is an acceptable number rather than a liability. The shipper's IAM user
holds `logs:CreateLogStream` and `logs:PutLogEvents` on that one group and nothing else: no
`CreateLogGroup` (which would let the app make an unexpiring group and keep its own operational
record forever), and no read of any kind, because the credential lives in a third party's
environment.

## Alternatives considered

**Leave it to Sentry.** Sentry answers "what threw", and it answers it well. Every case above is a
handled decision that returns 200. Sentry's Logs product would cover it, but it is priced per
ingested unit on a plan already chosen for its free error quota, and it would not give the *counts*
that make "three times this hour" different from "once, last month".

**CloudWatch Embedded Metric Format (EMF).** Genuinely elegant — metrics ride inside the log line
and CloudWatch extracts them at ingest, so no second call and perfect correlation. Rejected for one
reason: the natural dimension is the event code, and EMF makes cardinality a property of a *call
site* rather than of a reviewable list. One careless dimension is a metric per value and a bill
nobody predicted. Metric filters put the same counts in the stack, in a diff.

**A metric per event code.** ~40 codes, ~$12/month against a $5 budget whose 50% and 80% alerts
would then fire every month on fixed cost — turning the guardrail from
[20260802-aws-cost-guardrails](20260802-aws-cost-guardrails.md) into noise, which is the specific
failure that ADR exists to avoid.

**Vercel Log Drains to a third party (Datadog, Axiom, Better Stack).** Less code — a drain is
configuration. Rejected because it is a new vendor, a new bill, a new account, and a new place PII
rules have to hold, to reach a service this account already runs, already pays for, and already
sends SMS receipts to. The AWS posture from
[20260805-cdk-minted-credentials-and-manual-actions](20260805-cdk-minted-credentials-and-manual-actions.md)
is the one to extend rather than compete with.

**CloudWatch RUM for browser telemetry.** Real user monitoring is already covered by Vercel
Analytics and Speed Insights, and those two are exactly what the capability-URL redaction machinery
in `src/app/observability.ts` was built around
([capability-telemetry-runbook.md](../../engineering/capability-telemetry-runbook.md)). A third
browser SDK means a third consumer of that redaction and a per-session bill for a view we have.

**X-Ray, Application Signals, Application Insights.** All want AWS-hosted compute to instrument.
The app runs on Vercel.

**Writing to CloudWatch synchronously inside `log()`.** Simplest possible flush, and it would put a
network round-trip on the Stripe webhook's critical path. Never.

## Consequences

- **A new runtime dependency**: `@aws-sdk/client-cloudwatch-logs`. It is loaded through a dynamic
  `import()` on the first flush of a *configured* deployment, so it never enters the module graph of
  the many `src/db` and `src/lib` files that import `log()`, and an unconfigured deployment never
  loads it at all. Same vendor and same SigV4 machinery as the three AWS SDK clients already here.
- **Four new environment variables** (`CLOUDWATCH_AWS_REGION`, `CLOUDWATCH_AWS_ACCESS_KEY_ID`,
  `CLOUDWATCH_AWS_SECRET_ACCESS_KEY`, `CLOUDWATCH_LOG_GROUP`), filled in by the stack's credentials
  document like every other AWS credential. All four or nothing; absent is supported and is the
  normal local state.
- **A recurring AWS cost that did not exist before**: seven custom metrics (~$2.10/month) plus log
  ingestion and one month of storage. That is real against a $5 budget default, and the runbook says
  so — the budget is a number a human chose, and this is a reason to revisit it, not a reason for
  the stack to raise it quietly.
- **One more manual action.** An SNS email subscription needs a click no API can perform, so
  `confirm-observability-alarms` joins the short list. Until it is clicked, every alarm transitions
  correctly and notifies nobody.
- **Event codes are now a contract.** Renaming one used to be free. It now silently stops a metric
  filter counting, which is why a test reads them out of `src/` and fails on drift.
- **Sentry's role is unchanged and still necessary.** It has stack traces, release attribution, and
  cron monitors; this has counts, history, and query. Neither replaces the other, and the
  monitoring runbook's coverage table now says which answers what.
- **`src/lib/log.ts` gained a side effect.** It is bounded, non-throwing, and off by default, but it
  is no longer a pure `console.*` wrapper — worth knowing before the next change to that file.
