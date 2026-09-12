# 20260907-external-uptime-monitor — Watch DiveDay with a Route 53 health check, and answer the question in public at `/status`

- **Status:** Accepted
- **Date:** 2026-09-07

## Context

Every alerting path DiveDay has runs *inside* the deployment it is watching. Sentry reports what
throws, the CloudWatch metric filters in [20260806-cloudwatch-log-shipping](20260806-cloudwatch-log-shipping.md)
count lines the app wrote, and the Sentry cron monitor notices a tick that never arrived. All three
go quiet together in the one failure that matters most — the deployment never booted, DNS is wrong,
the region is gone — because nothing is running to report anything. The incident runbook has carried
a `TODO(owner)` saying exactly this since 2026-08-06, and the AWS dossier files it as **AWS-1**
(a check from outside) and **AWS-2** (a status page). It was still zero.

The second half is a different question with the same root. When a shop's bookings start failing,
the owner has no way to tell our incident from their wifi, and the only path to an answer is an
email to us that we may not read for an hour. That is a support cost, and on a departure morning it
is a shop standing at a counter guessing.

N-55 on the 2026-09-07 improvement sheet is both halves, approved to build, which also answers
H-45's first sequencing row.

## Decision

**A Route 53 health check polls `https://www.dive.day/api/health` from outside the account, and
`/status` answers the same question to anyone who asks.** Three pieces:

1. **The monitor** — one `AWS::Route53::HealthCheck` and one CloudWatch alarm, §22 of
   `infra/lib/infra-stack.ts`, declared as a row in `UPTIME_TARGETS` in `infra/lib/observability.ts`
   alongside every other signal this product watches. Type `HTTPS_STR_MATCH`, 30-second interval,
   three consecutive failures before Route 53 flips the status, and the alarm's own two
   one-minute periods on top: roughly four minutes from outage to an email at `alerts@dive.day`,
   the mailbox every other alert already reaches.
2. **`/api/health`** — unchanged in what it answers, and now sharing its database check with the
   page (`src/db/health.ts`) so the two cannot drift. `"status":"ok"` in its body is from today a
   contract, not a detail: the health check matches that literal as well as the status code.
3. **`/status`** — a public page, no session, outside `/shop/**`, which runs the checks in the
   request that renders it and says what it found and when. From 2026-09-11 the marketing footer
   links it, beside About (issue #1475). It shipped with nothing pointing at it, and the page sets
   `robots: { index: false }`, which closes the other door: the page whose whole audience is a shop
   whose bookings just broke was reachable only by a reader who already knew its address.

Two properties are load-bearing and are pinned by tests rather than by prose.

**The alarm treats missing data as breaching**, alone among every alarm in the stack. Everywhere
else a quiet app is a healthy app. Here, no data means the monitor itself stopped reporting, which
is indistinguishable from the outage it exists to catch; a false page on a Route 53 off-day is the
cheaper mistake.

**The check matches the body, not only the status code.** A parked domain, a CDN error shell and a
misrouted deployment all answer 200 with a page. Matching `"status":"ok"` is what makes green mean
that DiveDay's own route answered with its own verdict, and it costs $1.00/month of the $2.75 the
check costs in total (a non-AWS endpoint is $0.75, and each optional feature on one is $1.00 —
HTTPS and string matching are the two in use).

## Alternatives considered

- **CloudWatch Synthetics canaries**, the dossier's AWS-1 recommendation — a Lambda, an S3 asset, a
  bundled handler and a role, for a heartbeat that a health check performs with none of them. Where
  Synthetics genuinely wins is the browser canary that *renders* `/s/<slug>` and asserts a departure
  card is on the page, which catches the blank-200 class a heartbeat cannot see. That check needs a
  real shop slug, and pre-pilot there is none that is not the demo; it is left open (issue #1474)
  rather than shipped against a slug that would go red the day the fixture changed. Revisit when the
  first pilot shop is live, and note the canary is additive — this row does not have to be undone.
- **A third-party monitor** (UptimeRobot, Better Stack), which the runbook proposed and whose free
  tier is sufficient — a second vendor, a second account, a second credential, and a second place to
  look, all outside the CDK stack, which means outside review and outside the registry that states
  what this product watches and what it costs. Rejected on ownership, not on price.
- **A status page in S3 behind CloudFront in another region**, driven by the alarms (AWS-2 as
  written) — it survives an outage this page does not. It also cannot say anything the alarms did
  not already say minutes ago, and total loss of the deployment is precisely what the monitor
  already covers by mailing a human. A page that *checks* when it is read is worth more on the
  common failure (the app serving, the database gone), and its own failure is legible: if `/status`
  does not load, that is an answer.
- **A hand-operated incident switch on the page** — the mode in which a status page lies. Nothing
  here is written by a person or cached anywhere; the page reports only what it observed while
  rendering.

## Consequences

An outage now reaches a human in about four minutes without anyone watching a dashboard, and a shop
that suspects us has a URL instead of an email. The cost is about $34/year, stated in the registry
header beside the rest.

What it commits us to: `/api/health`'s two fields and the literal `"status":"ok"` are now an external
contract — `infra/lib/observability.test.ts` reads the route's source and `e2e/status.spec.ts` reads
the wire, so a rename fails in two places before it can leave a check green against nothing. The
alarm needs **us-east-1**, where Route 53 publishes its health-check
metrics; that is now why the health checks and their alarms are a stack of their own, `DiveDayGlobal`,
pinned there while the rest of the estate moved to us-east-2 (ADR 20260910-one-region-in-us-east-2).
An alarm in any other region finds no metric — which the breaching-on-missing-data setting turns into
a page rather than a silence.

Revisit when the first pilot shop exists (add the browser check against a real public schedule), if
the alarm proves noisy enough that four minutes is the wrong latency, or if DiveDay leaves Vercel —
AWS-5's hosting move changes what the endpoint is, not whether it should be watched from outside.
