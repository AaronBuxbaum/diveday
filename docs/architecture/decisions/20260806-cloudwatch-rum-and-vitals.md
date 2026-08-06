# 20260806-cloudwatch-rum-and-vitals — Core Web Vitals as CloudWatch metrics, plus CloudWatch RUM for session context

- **Status:** Accepted
- **Date:** 2026-08-06

## Context

[20260806-cloudwatch-log-shipping](20260806-cloudwatch-log-shipping.md) put the app's structured log
lines, and a small set of counts over them, into CloudWatch. It deliberately left real-user
performance out, on the reasoning that Vercel Speed Insights already covers it.

The follow-up ask is to have the AWS-side equivalent as well. Fair: Speed Insights is a good product
with one property this account cannot change — its numbers live in Vercel's console, on Vercel's
plan, with Vercel's retention. They cannot be graphed beside the money-path counts, cannot be
alarmed on to the same mailbox, and cannot be joined to the log line that explains them. "The
booking page got slow last Tuesday" and "the Stripe webhook started refusing last Tuesday" are two
consoles and a guess.

Two different questions are hiding in "Speed Insights, but AWS":

- **The numbers.** LCP, INP, CLS at p75, per route, over time, with a threshold someone can be told
  about. This is what Speed Insights *is*.
- **The context.** Which countries, which browsers, which devices, how a session moved between
  pages. Speed Insights does not answer this; CloudWatch RUM does.

## Decision

**Both, from two sources, because they are two different questions.**

**The numbers come from the browser's own measurements, through DiveDay's own endpoint.**
`useReportWebVitals` — Next's hook over the `web-vitals` code the framework already bundles, so no
new browser dependency — collects LCP, INP, CLS, FCP and TTFB and sends **one** `sendBeacon` per
page view to `/api/vitals`. That becomes one `web_vital.reported` log line, and the metric filters
in `infra/lib/observability.ts` extract each field as a CloudWatch metric scored at **p75**, the
statistic Google and Vercel both use because a median hides the slow quarter.

One beacon rather than five: LCP, FCP and TTFB settle early while INP and CLS keep getting worse
until the visitor leaves, so sending each metric as it arrives means five requests and five log
lines per page view for numbers that are not final yet. They are collected and sent on
`visibilitychange`/`pagehide`, which is also the only moment `sendBeacon` exists to be used.

**Alarms on the three Core Web Vitals only, at Google's own "good" boundaries** (LCP 2.5s, INP
200ms, CLS 0.1), over three consecutive hours. FCP and TTFB are collected and graphed because they
are how you tell *why* an LCP regressed — a slow server versus a slow render — but neither is worth
waking someone for. Three periods rather than one because a single slow hour on a young product is
one visitor on hotel wifi.

**The context comes from CloudWatch RUM**, narrowed three ways, each trading a RUM feature for a
property this app already promises:

- **`telemetries: ["performance"]` only.** RUM's `errors` telemetry duplicates Sentry, which has
  better stack traces and release attribution. Its `http` telemetry records request URLs, and this
  app's fetches include bearer-capability paths.
- **`disableAutoPageView: true`.** RUM's own recorder reads `location.pathname` verbatim, which on
  `/waivers/<token>` is a replayable credential leaving for a third system. Page views are recorded
  by `src/app/rum-client.tsx` instead, through the same `redactCapabilityUrl` Analytics, Speed
  Insights and Sentry all use — one redaction, four consumers, as
  [capability-telemetry-runbook.md](../../engineering/capability-telemetry-runbook.md) requires.
- **`allowCookies: false`.** RUM's cookies stitch a session across page loads. Without them a
  session is one page load, which is less useful and asks nothing of a diver mid-booking.

**The guest credential is public by construction and bounded accordingly.** A browser reaches RUM
through a Cognito identity pool with unauthenticated identities enabled — there is no other way for
a visitor who has not identified themselves to call `PutRumEvents`. The role ARN ships in the
browser bundle, so the bound is what it can do: one action, one app monitor ARN, with a trust policy
that pins both the identity pool (`aud`) and the unauthenticated flow (`amr`). The worst an abuser
achieves is junk page views in this monitor's own data. RUM's `domain` is set to the canonical host,
which is the only server-side control on who may write at all.

**The beacon endpoint is treated as the public write boundary it is.** `/api/vitals` is
rate-limited per IP (`RATE_LIMITS.webVitalsBeacon`, 300/hour), caps the body at 8 KiB, and validates
against a zod schema with a hard ceiling on every value. That ceiling is the one doing security
work: an unbounded number would let a stranger move a Core Web Vital's p75 to whatever they liked,
and an alarm anyone can fire is an alarm that gets muted. Everything it refuses gets the same 204 —
a beacon cannot read a response, and a distinguishable answer only tells an abuser where the ceiling
is.

**Both sit behind the existing single mount point**, `src/app/observability-client.tsx`, so the
capability redaction cannot be bypassed by adding a telemetry client somewhere else. RUM's SDK is
dynamically imported behind the idle-after-hydration gate the other two SDKs already wait for.
`<WebVitals />` is the one exception, mounted immediately: it is framework code with no bundle to
defer, and it has to observe the load it is measuring rather than arriving after it.

## Alternatives considered

**Keep Speed Insights only.** Free with the plan, zero code. Rejected on the grounds in Context:
the numbers cannot be graphed, alarmed, or joined with anything else this account owns. Speed
Insights is *kept* — it costs nothing extra and is a useful second opinion — but it is no longer the
only copy.

**CloudWatch RUM alone, for both jobs.** RUM does collect web vitals, so this looked like one
system instead of two. Rejected on three counts. RUM's vitals are visible in RUM's own console and
as a fixed set of metrics; the beacon's land in the same namespace as everything else, with
per-route breakdown available in Logs Insights for free. RUM is priced per event, so the numbers
would be sampled exactly when traffic made them interesting. And the vitals half then depends on a
Cognito identity pool, a 30 KB SDK, and an ad-blocker-visible third-party-shaped request — a lot of
moving parts between "the browser measured LCP" and "we know what LCP is".

**A metric per route.** The obvious next step for per-route alarms, and a cardinality trap: a
CloudWatch dimension per route is a custom metric per route, and this app has dozens. The per-route
breakdown stays in Logs Insights, which is free and can group by a field with no cardinality cost.

**The `web-vitals` package directly** instead of `useReportWebVitals`. Same library either way;
Next already bundles it, so a direct dependency would ship it twice.

**Emitting a log line per metric.** Simpler client, five times the ingest, and INP/CLS would be
recorded before they were final.

## Consequences

- **One new runtime dependency**, `aws-rum-web` (~30 KB gzipped). It is dynamically imported, behind
  the idle gate, and only when the four `NEXT_PUBLIC_RUM_*` values are set — so it never enters the
  first-load bundle and an unconfigured deployment never fetches it. The Core Web Vitals half adds
  no dependency at all.
- **Five new public environment variables.** `NEXT_PUBLIC_` because the browser is the only
  consumer; none is a secret, since the identity pool hands the same credential to every visitor.
  `NEXT_PUBLIC_RUM_SAMPLE_RATE` is the cost lever.
- **A new public unauthenticated endpoint**, `/api/vitals`. Bounded as described above, and now one
  of the surfaces [rate-limiting-runbook.md](../../engineering/rate-limiting-runbook.md) lists.
- **More AWS cost**: five more custom metrics (~$1.50/month), one log line per page view, and RUM at
  $1 per 100k events. RUM is the variable one and the reason the sample rate is configurable. This
  compounds the budget note in the previous ADR — the $5 default is now genuinely worth revisiting,
  and that remains a human's call rather than something the stack changes quietly.
- **A Cognito identity pool with unauthenticated identities** exists in the account, which is new
  and worth naming plainly: it is an anonymous-credential issuer. It is bounded to one action on one
  resource, and both trust-policy conditions are asserted by a test, but it is the first thing to
  look at if the RUM bill ever looks wrong.
- **Vital field names are a contract**, the same way event codes became one. `$.lcp` in a metric
  filter and `field: "lcp"` in `src/lib/observability/web-vitals.ts` must agree, and the infra test
  reads the source file to make sure they do.
- **Per-route attribution is per page *load*.** LCP, FCP and TTFB belong to the load; INP and CLS
  accumulate across any soft navigations that followed and are attributed to the entry route. A
  known simplification, documented in the component, and the reason the "slowest routes" query is a
  guide rather than a verdict.
