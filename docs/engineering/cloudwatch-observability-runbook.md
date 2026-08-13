# CloudWatch observability runbook

Where DiveDay's own log lines go, what is counted, what raises an alarm, how fast the app is for
real visitors, and how to ask a question of any of it. Decisions and rationale:
[20260806-cloudwatch-log-shipping](../architecture/decisions/20260806-cloudwatch-log-shipping.md)
and
[20260806-cloudwatch-rum-and-vitals](../architecture/decisions/20260806-cloudwatch-rum-and-vitals.md).

This is the *what the app decided* and *how it felt to use* half of monitoring. The *what threw*
half is Sentry, and the *is it up* half is the external uptime check — see
[monitoring-runbook.md](monitoring-runbook.md) and
[incident-response-runbook.md](incident-response-runbook.md).

## The shape of it

```
src/lib/log.ts  ──►  console.log/warn/error          (unchanged, always, first)
                └─►  src/lib/observability/          (buffer, batch)
                       └─► PutLogEvents ─► /diveday/app  (CloudWatch Logs, 30 days)
                                             ├─► metric filters ─► alarms ─► SNS ─► alerts@dive.day
                                             ├─► dashboard "DiveDay"
                                             └─► saved Logs Insights queries

browser ──► useReportWebVitals ──► one sendBeacon per page view ──► /api/vitals ──► log() ──┘
        └─► aws-rum-web ─────────► PutRumEvents ────────────────► CloudWatch RUM "diveday"
```

Everything AWS-side is section 13 of [`infra/lib/infra-stack.ts`](../../infra/lib/infra-stack.ts);
the registries it expands are in [`infra/lib/observability.ts`](../../infra/lib/observability.ts).

## Switching it on

| Variables | Enable | Without them |
| --- | --- | --- |
| `CLOUDWATCH_AWS_REGION`, `CLOUDWATCH_AWS_ACCESS_KEY_ID`, `CLOUDWATCH_AWS_SECRET_ACCESS_KEY`, `CLOUDWATCH_LOG_GROUP` | Log shipping, and therefore every metric, alarm, dashboard widget and saved query below | `log()` writes its JSON line to stdout exactly as it always did; nothing is shipped, nothing throws |
| `NEXT_PUBLIC_RUM_APP_MONITOR_ID`, `NEXT_PUBLIC_RUM_IDENTITY_POOL_ID`, `NEXT_PUBLIC_RUM_GUEST_ROLE_ARN`, `NEXT_PUBLIC_RUM_REGION` | CloudWatch RUM: sessions, geography, devices | No SDK is fetched and the page is unchanged. Core Web Vitals keep working — they do not go through RUM |
| `NEXT_PUBLIC_RUM_SAMPLE_RATE` | The RUM cost lever, `0`–`1` | Defaults to `1` (every session), as does anything unparseable or out of range |

Each group is all-or-nothing: a partial set reads as unset, deliberately, because a half-configured
client looks configured and sends nothing. The Core Web Vitals half needs no configuration at all
beyond the log shipping — the beacon posts to DiveDay's own `/api/vitals`.

Everything is filled in by `pnpm infra:deploy` and lands in `.env.vercel` with the rest; see
[infrastructure-runbook.md](infrastructure-runbook.md). The shipping credentials belong to the
`diveday-cloudwatch-shipper` IAM user, which holds `logs:CreateLogStream` and `logs:PutLogEvents`
on `/diveday/app` and nothing else — it cannot create a log group, and it cannot read a single line
back. The `NEXT_PUBLIC_RUM_*` values are public by design: the Cognito identity pool hands the same
credential to every visitor, and it can do exactly one thing (`rum:PutRumEvents` on one app
monitor).

Locally, in the unit suite, and under the e2e fleet, none of this is configured — and the fleet also
blocks it outright with `DIVEDAY_DISABLE_EXTERNAL_HTTP=1`.

**One manual step remains after the first deploy**: click the SNS subscription-confirmation email
sent to the alert address. Until then every alarm transitions correctly and notifies nobody. It is
`confirm-observability-alarms` in [manual-actions.md](manual-actions.md).

## What is counted, and what to do when it fires

Seven signals. Each is simultaneously a metric filter, an alarm, and a dashboard widget, declared
once in `infra/lib/observability.ts`. Every other event code the app emits stays queryable — see
the saved queries below — it just does not have a metric.

| Alarm | Fires at | What it means | First move |
| --- | --- | --- | --- |
| `diveday-app-errors` | 3 in 15 min | Handled errors — the ones the app caught and decided about. Sentry never sees these. | Open the "Errors, newest first" saved query and read the codes. |
| `diveday-money-path-refusals` | 1 in 15 min | A payment arrived the booking record cannot accept: mismatched Connect account, disqualified checkout, settled total over the asked amount, a paid-for cancelled seat. | Find the checkout or order id in the line and reconcile against the Stripe dashboard by hand, before the shop notices. |
| `diveday-notification-send-failures` | 5 in 1 h | Waiver links and reminders are not leaving. Invisible from inside DiveDay — the booking still looks fine. | Read the error code, then the matching provider runbook (SES / SMS / WhatsApp). |
| `diveday-cron-pass-failures` | 1 in 24 h | A scheduled pass ran and did not do its work. Distinct from Sentry's cron monitors, which answer "did it run at all". | The line names the scan. Every pass is idempotent, so re-running the route by hand is safe. |
| `diveday-database-unavailable` | 1 in 5 min | The health check could not reach Postgres. | Neon console first — an exhausted free-tier compute allowance suspends the endpoint, which looks exactly like this. Then [incident-response-runbook.md](incident-response-runbook.md). |
| `diveday-rate-limit-store-failures` | 5 in 1 h | Rate limiting is failing open. It is *designed* to, but that trade is only safe while someone is told. | Every guarded public write boundary is currently unguarded — see [rate-limiting-runbook.md](rate-limiting-runbook.md). |
| `diveday-manifest-streams-refused` | 1 in 1 h | Manifest streams turned away at the subscriber ceiling; a captain's roll-call screen is stale rather than live. | [realtime-manifest-events-runbook.md](realtime-manifest-events-runbook.md) — check the ceiling against boats out. |

Alarms treat missing data as **not breaching**. A quiet app is a healthy app, and paging on a slow
Tuesday is how an alert channel gets muted.

## How fast the app is for real people

The browser reports Core Web Vitals to `/api/vitals` — one `sendBeacon` per page view, collected
and sent as the page is hidden, because INP and CLS keep getting worse until the visitor leaves.
Each figure becomes a CloudWatch metric scored at **p75**: the statistic Google and Vercel both use,
because a median lets a fast majority hide the slow quarter who are the ones giving up on a booking
form.

| Alarm | Boundary | Means | First move |
| --- | --- | --- | --- |
| `diveday-web-vital-lcp` | p75 > 2.5s for 3h | Largest Contentful Paint — the main content is slow to appear | Compare against TTFB on the same graph: if that moved too it is the server, otherwise it is what the page renders |
| `diveday-web-vital-inp` | p75 > 200ms for 3h | Interaction to Next Paint — taps and clicks feel laggy | Find the routes in the "Slowest routes by LCP" query, then look for a heavy client component on them |
| `diveday-web-vital-cls` | p75 > 0.1 for 3h | Cumulative Layout Shift — the page moves under people's fingers | Usually an image or embed with no reserved space, or a `loading.tsx` whose shape does not match the body it replaces |

**FCP and TTFB are collected and graphed but never alarmed.** They exist to tell you *why* an LCP
regressed, not to be woken up for on their own.

Three consecutive hours, not one: a single slow hour on a young product is one visitor on hotel
wifi.

### The context around the numbers: CloudWatch RUM

**CloudWatch → RUM → diveday** answers what a metric cannot — which countries, which browsers, which
devices, and how a session moved between pages. Three deliberate narrowings, and knowing them saves
a confused half hour in the console:

- **Performance telemetry only.** No JavaScript errors here — those are Sentry's, which has stack
  traces and release attribution. No HTTP telemetry either: it records request URLs, and this app's
  include bearer-capability paths.
- **No automatic page views.** RUM's own recorder would read `/waivers/<token>` verbatim. Page views
  are recorded by `src/app/rum-client.tsx` through the same `redactCapabilityUrl` every other
  telemetry client uses ([capability-telemetry-runbook.md](capability-telemetry-runbook.md)), so a
  capability page appears as `/waivers/[token]`.
- **No cookies.** A RUM session is therefore one page load rather than a journey. That is the trade
  taken to avoid asking a diver mid-booking for consent.

RUM only accepts events whose `Origin` matches the app monitor's configured domain, so a local run
could not report to it even with the variables set.

## Asking a question of the logs

The dashboard is **CloudWatch → Dashboards → DiveDay**: counts for the last seven days along the
top, a trend per signal underneath, then the raw error lines and an event-volume ranking at the
bottom, so a spike is one scroll from its cause rather than a separate console.

For anything narrower, **CloudWatch → Logs Insights → Queries → DiveDay/**:

| Saved query | Answers |
| --- | --- |
| Errors, newest first | The first thing to run for any alarm. Every handled error with its context fields. |
| Event volume by code | What this deployment is actually doing, ranked. The fastest way to spot a code that started or stopped. |
| Money path, everything | Every Stripe webhook and checkout decision in order, successes included — for reconciling one order end to end. |
| Notification failures by provider | Whether a send problem is one provider or all of them, which is what decides the next runbook. |
| Slowest routes by LCP | The per-route breakdown behind the app-wide vitals metrics. Free, because grouping by a field costs nothing where a metric dimension would. |
| Core Web Vitals, rated | How many visits landed in each of Google's good / needs-improvement / poor bands — the shape a score is actually reported in. |
| Scheduled passes | Did every cron run, and what did it do. |

Every line is the JSON `log()` wrote, so `event`, `level`, `time` and each context field are
first-class in a query. `filter event = "checkout.paid_disqualified"` works without a `parse`.

## Adding a signal

Edit `LOG_SIGNALS` in `infra/lib/observability.ts` and deploy. A row must state which event codes
(or which level) it counts, a threshold, a period, and — this is the part with no default — what an
operator should do when it fires. Then run `pnpm test infra --reporter=dot`.

Two things the tests will refuse:

- **An event code the app does not emit.** The suite reads the `log("…")` codes out of `src/` and
  fails on drift. This is the guard the whole design rests on: a metric filter that matches nothing
  does not error, it counts zero forever and the alarm above it reads healthy.
- **A signal with no response.** A graph without a stated first move is a graph nobody acts on.

Keep the set small on purpose. Past the free allowance a custom metric is $0.30/month and its alarm
another $0.10, and the app emits ~40 event codes; a metric per code would be ~$16/month for a set of
graphs nobody chose. Anything that does not need an *alarm* belongs in a saved query.

## What this costs

CloudWatch's free allowance here is **Always Free** — it does not expire after twelve months and
does not depend on the account's age or plan. What that covers, and what this stack actually uses:

| Always free, per month | Used | Billed |
| --- | --- | --- |
| 10 custom metrics | 13 (8 signals + 5 web vitals) | 3 × $0.30 = **$0.90** |
| 10 standard-resolution alarms | 11 (8 signals + 3 alarmed vitals) | 1 × $0.10 = **$0.10** |
| 3 dashboards | 1 | **$0.00** (a 4th would be $3.00) |
| 5 GB log ingestion + archive + Insights scan | well under | $0.50/GB ingested, $0.12/GB scanned beyond |
| 1 Contributor Insights rule | 0 | — |
| 1,800 minutes of Live Tail | 0 | — |

So the fixed monthly cost of everything in this runbook is about **$1.00**, and the next counted
signal added to the registry costs **$0.40** — $0.30 for the metric plus $0.10 for the alarm. The
alarm count read like a cliff while it sat exactly at ten and never was one; both halves are now
past the allowance and priced the same way.

**RUM is the exception and the one to watch.** Its 1,000,000 events is a one-time trial, *not* an
always-free allowance, and past it RUM is $1.00 per 100,000 events with no ceiling.
`NEXT_PUBLIC_RUM_SAMPLE_RATE` defaults to `1` — every session — so it is the only line here that can
grow without anything good happening. Against the $30 default in the stack's cost guardrail
([cost-guardrails-runbook.md](cost-guardrails-runbook.md)) the fixed part is noise and RUM is the
whole risk. Raising `--context monthlyBudgetLimit=…` is a human's call, deliberately not something
this stack does for you.

The two levers, in the order to reach for them:

1. **`NEXT_PUBLIC_RUM_SAMPLE_RATE`** — RUM is the only per-event line here and the only one that
   grows with traffic rather than with what the app does. `0.25` is a quarter of the sessions for a
   quarter of the cost, and geography/device breakdowns survive sampling perfectly well.
2. **`RetentionDays` on the log group** — 30 days is a choice, not a requirement.

Never sample the vitals beacon or the `log()` calls to save money: both feed metrics an alarm reads,
and a sampled count is a count that lies.

## When something doesn't arrive

| Symptom | Look at |
| --- | --- |
| No lines in `/diveday/app` at all | The four `CLOUDWATCH_*` variables in the *running* deployment. A partial set is treated as unset by design. Vercel's own log view will still show the console line, which is how you tell "the app isn't logging" from "the app isn't shipping". |
| A single `cloudwatch_shipper.flush_failed` line on stdout, then silence | Read its `error`/`status`. `AccessDeniedException`/403 is the IAM policy or a stale key; `ResourceNotFoundException` is a `CLOUDWATCH_LOG_GROUP` that does not match the deployed group. Only the first failure of a run is reported — a warning per flush is how a drain becomes noise. |
| `cloudwatch_shipper.disabled` on stdout | Five consecutive failures tripped the breaker for that instance. It is not retried until the instance is replaced (any deploy). Fix the cause first; the console lines were never lost. |
| `cloudwatch_shipper.buffer_overflow` | Lines were produced faster than they could ship and the oldest were dropped, with the count in `dropped`. Usually a slow `PutLogEvents` under a burst. The console still has every one of them. |
| `cloudwatch_shipper.line_truncated` | A single line exceeded CloudWatch's 256 KiB per-event ceiling and was replaced by this one, which carries `originalBytes` and the original's opening characters in `head`. The replacement is deliberately still valid JSON so the metric filters can read it. Nothing this app logs should come close — a line this big means a `log()` call is putting a payload in its context instead of ids and codes. The console has the original in full. |
| Lines arrive but an alarm never fires | Check the metric filter's pattern against a real line in Logs Insights. A pattern that matches nothing counts zero forever without erroring — and confirm the SNS email subscription is not `PendingConfirmation`. |
| An alarm sits at INSUFFICIENT_DATA | Expected on a group that has received nothing yet. Once the app logs anything, the filters publish a 0 for non-matching periods and the alarm settles to OK. |
| A cron's log line is missing but the pass ran | The four cron routes `await flushLogs()` in a `finally`, so this should not happen. If it does, look for an early `return` added above the `try`. |
| A preview deploy's lines are mixed in with production's | They are not — the stream name carries `VERCEL_ENV`. Filter by log stream. |
| No `web_vital.reported` lines | The beacon only fires when the page is *hidden*, so a tab left open reports nothing. Check with DevTools → Application → Background services, or just switch tabs. Also confirm the browser has `navigator.sendBeacon` (every current one does). |
| Vitals arrive but a p75 looks impossibly good | Check the metric filter has no `DefaultValue`. Publishing a 0 for page views that reported no INP would drag the percentile down until the metric flattered the app; the infra test asserts it is absent. |
| RUM records nothing | The app monitor's `domain` must match the origin the browser is on — RUM refuses events from anywhere else, and a preview URL is a different origin. Then check the four `NEXT_PUBLIC_RUM_*` values reached the *client* bundle (they must keep the prefix). |
| RUM's bill is larger than expected | `NEXT_PUBLIC_RUM_SAMPLE_RATE`. If it is already low, look at the Cognito identity pool: it issues anonymous credentials by design, so an unexpected volume of `PutRumEvents` from outside the app's own origin is worth ruling out. |
