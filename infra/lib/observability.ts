/**
 * What DiveDay counts in its own log stream, and what it wakes someone up for.
 *
 * One row per condition. A row is simultaneously a CloudWatch **metric filter**
 * (the count) and a **dashboard widget** (the picture); alarmed rows also have
 * an alarm and email. All are declared once here and expanded in S17 of
 * `infra-stack.ts`. Adding a signal is editing this array; there is deliberately
 * no way to add a graph without stating what it means and who answers it.
 *
 * Why a registry rather than a metric per event code, priced honestly:
 *
 * CloudWatch's *always free* tier -- not a 12-month one, and not dependent on
 * the account's age or plan -- is 10 custom metrics, 10 standard-resolution
 * alarms, 3 dashboards, and 5 GB of log ingestion/archive/Insights scan per
 * month. Past those it is $0.30 per metric, $0.10 per alarm, $3.00 per
 * dashboard, $0.50/GB ingested and $0.12/GB scanned.
 *
 * This registry currently declares 15 metrics (10 log signals + 5 web vitals)
 * and 11 alarms (8 + the 3 alarmed vitals), so it sits 5 metrics and 1 alarm
 * over the free allowance at about $1.60/month. A counted signal without an
 * alarm costs $0.30/month; an alarmed one costs $0.40/month. Those are the real
 * numbers to weigh, not zero and not the free-tier cliff it looks like from the
 * alarm count alone.
 *
 * The rationing still holds at those prices: this app emits ~40 distinct event
 * codes, so a filter per code would be ~$12/month plus ~$4 of alarms, for a set
 * of graphs nobody chose. So the metrics are the handful worth alarming on, and
 * every other code stays queryable through the Logs Insights queries below --
 * cheap rather than free, since a query scans the group it reads. See
 * docs/engineering/cloudwatch-observability-runbook.md.
 *
 * The `events` codes are the exact strings `log()` is called with in `src/`,
 * and `observability.test.ts` fails when one of them no longer appears there.
 * That is the guard the whole design rests on: a metric filter matching a
 * renamed event does not error, it just silently counts zero forever, and an
 * alarm that can never fire is worse than no alarm.
 */

/** Every metric this stack publishes lives here; nothing else writes to it. */
export const METRIC_NAMESPACE = "DiveDay/App";

export interface LogSignal {
  /** CDK construct id fragment and CloudWatch metric name. PascalCase, stable. */
  readonly metricName: string;
  /** Widget heading, and the alarm's own description. Operator-facing. */
  readonly title: string;
  /** Why this is worth a metric rather than a Logs Insights query. */
  readonly why: string;
  /**
   * The `$.event` codes that count. Mutually exclusive with `level` -- a signal
   * is either "these specific things happened" or "anything at this severity".
   */
  readonly events?: readonly string[];
  /** Counts every line at this `$.level`, whatever its event code. */
  readonly level?: "warn" | "error";
  /** Set false for a metric collected for evidence but not alarmed yet. */
  readonly alarm?: boolean;
  /** Datapoints at or above this value in one period raise the alarm. */
  readonly threshold: number;
  /** Alarm evaluation window. CloudWatch's own ceiling is one day. */
  readonly periodMinutes: number;
  /** The first thing to do when it fires. Rendered into the alarm description. */
  readonly response: string;
}

export const LOG_SIGNALS: readonly LogSignal[] = [
  {
    metricName: "AppErrors",
    title: "Handled errors",
    why:
      "Sentry sees thrown exceptions; these are the ones the app caught and decided about -- a refused " +
      "payment reconciliation, a send that gave up, a prune that failed a table. Nothing else counts them.",
    level: "error",
    threshold: 3,
    periodMinutes: 15,
    response:
      "Open the 'Errors, newest first' saved query and read the event codes. Three in a quarter hour is a pattern, not a blip.",
  },
  {
    metricName: "MoneyPathRefusals",
    title: "Money and records disagree",
    why:
      "Each of these means a payment arrived that the booking record cannot accept: a mismatched Connect " +
      "account, a disqualified checkout, a settled total above the asked amount, a paid-for cancelled seat. " +
      "Every one has a human consequence (a refund owed, a seat sold twice) and none of them throws.",
    events: [
      "checkout.paid_account_mismatch",
      "checkout.paid_disqualified",
      "checkout.settled_total_over_asked",
      "payment.refused_cancelled_booking",
      "payment.refused_final_status_regression",
      "stripe_webhook.claim_release_failed",
    ],
    threshold: 1,
    periodMinutes: 15,
    response:
      "Find the checkout or order id in the log line, then reconcile it against the Stripe dashboard by hand before the shop notices.",
  },
  {
    metricName: "NotificationSendFailures",
    title: "Notifications not sending",
    why:
      "A waiver link or a departure reminder that never left is invisible from inside DiveDay -- the booking " +
      "still looks fine. The send row records it; nothing was watching the rate.",
    events: [
      "notification.ses_send_failed",
      "notification.sns_sms_send_failed",
      "notification.whatsapp_send_failed",
    ],
    // One, not the five this used to ask for. Every outbound email failed for
    // an unknown stretch before issue #517 and this alarm stayed silent the
    // whole time: at DiveDay's volume a *total* outage produced about seven
    // failures in twenty-four hours, so a 100% failure rate never reached five
    // in any single hour. A raw count cannot see an outage on a low-traffic
    // deployment, and the smaller the shop base the blinder it gets.
    //
    // The cost of one is a page for a single terminal failure. That is
    // acceptable here in a way it would not be for most signals: the SDK
    // already retries throttling and 5xx itself, and a bounce arrives by
    // webhook rather than on this path, so what reaches this line is a send
    // that will never happen -- someone's waiver link -- not a transient blip.
    threshold: 1,
    periodMinutes: 60,
    response:
      "Read the error code on the log lines, then follow the matching provider runbook (ses-email, sms-delivery-receipts, whatsapp-cloud-api).",
  },
  {
    metricName: "CronPassFailures",
    title: "A scheduled pass failed",
    why:
      "Sentry's cron monitors answer 'did the tick run at all'. This answers the different question of " +
      "whether the pass that ran actually did its work -- a scan that failed halfway still checks in.",
    events: [
      "cron_reminders.tick_failed",
      "cron_reminders.scan_failed",
      "cron_recaps.scan_failed",
      "cron_retention.prune_failed",
      "cron_usage.scan_failed",
      "cron_backup_export.pass_failed",
      // Added to this signal rather than given its own: a new counted signal is
      // $0.40/month (see the pricing note at the top of this file), and "a
      // scheduled pass failed" is already exactly what this alarm means. The
      // *platform* backup's distinct failure mode -- passes that succeed while
      // nothing actually lands in the bucket -- is not visible from a log line
      // at all, and is watched from the AWS side instead (infra-stack.ts S19).
      "cron_platform_backup.pass_failed",
      "cron_trip_series.roll_failed",
      "cron_demo_refresh.pass_failed",
    ],
    threshold: 1,
    periodMinutes: 1_440,
    response:
      "The line names the scan. Every pass is idempotent, so re-running the route by hand is safe once the cause is understood.",
  },
  {
    metricName: "DatabaseUnavailable",
    title: "Health check could not reach the database",
    why:
      "Neon's free-tier compute suspends when its allowance is exhausted, which from inside DiveDay looks " +
      "exactly like the database going away mid-day. This is the log-side twin of the external uptime check.",
    events: ["health.db_unavailable"],
    threshold: 1,
    periodMinutes: 5,
    response:
      "Check the Neon console for a suspended endpoint first, then docs/engineering/incident-response-runbook.md.",
  },
  {
    metricName: "RateLimitStoreFailures",
    title: "Rate limiting is failing open",
    why:
      "`src/lib/rate-limit.ts` deliberately allows a request when its store is unreachable -- refusing real " +
      "divers is the worse failure. That decision is only safe while somebody is told it is happening.",
    events: ["rate_limit.store_failed"],
    threshold: 5,
    periodMinutes: 60,
    response:
      "Every guarded public write boundary is currently unguarded. See docs/engineering/rate-limiting-runbook.md.",
  },
  {
    metricName: "SignInRefusals",
    title: "Sign-ins being refused in bulk",
    why:
      "One refused sign-in is somebody mistyping a password, which is why it is a warn line and not an " +
      "error one. A hundred in a quarter hour is credential stuffing, and nothing else in the stack can " +
      "tell those two apart -- the per-IP and per-email rate limiters each see one slice of it and refuse " +
      "quietly. Alarms on rate, never on presence.",
    events: ["auth.sign_in_refused"],
    // A refusal is counted on *every* attempt, including the ones the rate
    // limiter turned away before it ever looked at the password -- so this
    // metric sees the whole flood rather than the slice that got through, which
    // is what makes it the right place to watch. 100 in a quarter hour is
    // ~7/minute sustained against a product whose real sign-in traffic is a few
    // dozen shop staff a day; one locked-out owner cannot reach it (the per-email
    // cap is 8 per 15 minutes, per src/lib/rate-limit.ts).
    threshold: 100,
    periodMinutes: 15,
    response:
      "Open the 'Event volume by code' saved query and read the surrounding window. Real stuffing shows as a flat, sustained rate; a shop locked out of its own account shows as a short burst that stops. docs/engineering/rate-limiting-runbook.md.",
  },
  {
    metricName: "ManifestStreamsRefused",
    title: "Manifest streams turned away at the ceiling",
    why:
      "Past the subscriber ceiling a captain's manifest stops updating live and falls back to polling. The " +
      "boat is fine; the screen is stale, which on a roll-call surface is worth knowing about.",
    events: ["manifest_events.stream_at_capacity"],
    threshold: 1,
    periodMinutes: 60,
    response:
      "docs/engineering/realtime-manifest-events-runbook.md -- check the connection ceiling against the number of boats out.",
  },
  {
    metricName: "OfflineRetractionSuperseded",
    title: "Offline retractions refused",
    why:
      "A boat device tried to retract a statement that another device or the live manifest had already replaced. " +
      "The device keeps the safety mark visible, but a rising count means crews are working from conflicting copies.",
    events: ["manifest.offline_retraction_superseded"],
    threshold: 1,
    periodMinutes: 60,
    alarm: false,
    response:
      "Read the shop and trip counts in Logs Insights, then compare the affected boat's devices and live manifest.",
  },
  {
    metricName: "OfflineRetractionUnnamed",
    title: "Legacy offline retractions",
    why:
      "A bare offline retraction preserves compatibility with a device that predates compare-and-set targets. " +
      "This counter should trend to zero before the compatibility decision is revisited.",
    events: ["manifest.offline_retraction_unnamed"],
    threshold: 1,
    periodMinutes: 1_440,
    alarm: false,
    response:
      "Read the daily count in Logs Insights; the target is zero, and no deadline is imposed by this metric.",
  },
  {
    metricName: "CspViolations",
    title: "Content-Security-Policy would have blocked something",
    why:
      "The full policy ships as report-only (issue #718), so every one of these is a thing that works " +
      "today and would stop working the day the policy is enforced. This count IS the enumeration the " +
      "promotion waits on -- a steady zero across a real week of traffic is the signal to enforce, and a " +
      "line naming a host nobody expected is the reason not to.",
    events: ["security.csp_violation"],
    threshold: 1,
    periodMinutes: 1_440,
    // Collected for evidence, not paged on. While the policy is report-only a
    // violation is information rather than an incident, and the promotion
    // decision is made by reading the daily counts rather than by being woken.
    // Flip this to true in the same change that enforces the policy: from then
    // on a report means the enforced policy blocked something real.
    alarm: false,
    response:
      "Read the directive and blocked origin off the lines, decide whether the host belongs in the policy, then either add it or fix what is loading it.",
  },
];

/**
 * The metric filter's pattern, in CloudWatch's JSON dialect.
 *
 * `$.level = "error"` and `$.event = "..."` read the fields `log()` writes, so
 * the pattern is only as stable as those key names -- which is exactly why
 * `src/lib/log.ts` documents the line shape as a contract rather than a detail.
 */
export function filterPatternFor(signal: LogSignal): string {
  if (signal.level) return `{ $.level = "${signal.level}" }`;
  const events = signal.events ?? [];
  return `{ ${events.map((event) => `$.event = "${event}"`).join(" || ")} }`;
}

/** The alarm's description: what fired, and the first thing to do about it. */
export function alarmDescriptionFor(signal: LogSignal): string {
  return `${signal.title}. ${signal.response}`;
}

/**
 * `AppErrors` -> `diveday-app-errors`. Named rather than left to CloudFormation
 * because an alarm's name is what arrives in the alert email's subject line,
 * and `DiveDay-AppErrorsAlarm3F2A1B` is not a subject line anyone wants at 6am.
 */
export function alarmNameFor(signal: LogSignal): string {
  const kebab = signal.metricName.replace(/(?<!^)([A-Z])/g, "-$1").toLowerCase();
  return `diveday-${kebab}`;
}

/**
 * Core Web Vitals, extracted from the `web_vital.reported` line the vitals
 * beacon writes (ADR 20260806-cloudwatch-rum-and-vitals).
 *
 * A different shape from `LogSignal` on purpose. Those count *occurrences* and
 * alarm when a count rises; these read a **value out of the line**
 * (`metricValue: "$.lcp"`) and alarm on its **75th percentile** -- the statistic
 * Google and Vercel both score Core Web Vitals with, because a median hides the
 * quarter of visits that were actually bad.
 *
 * `field` must match the key `src/lib/observability/web-vitals.ts` writes;
 * `observability.test.ts` reads that file and fails on drift, because a metric
 * filter naming a field the line no longer carries extracts nothing forever
 * without erroring.
 *
 * Only the three Core Web Vitals alarm. FCP and TTFB are collected and graphed
 * because they are how you tell *why* an LCP regressed -- a slow server versus a
 * slow render -- but neither is a thing to be woken up for on its own.
 */
export interface WebVitalSignal {
  readonly metricName: string;
  readonly title: string;
  /** The JSON field in the log line, and so the `$.field` the filter reads. */
  readonly field: string;
  /** Google's "good" boundary. A p75 above this is the alarm, where there is one. */
  readonly goodThreshold: number;
  readonly alarm: boolean;
  readonly response: string;
}

export const WEB_VITAL_SIGNALS: readonly WebVitalSignal[] = [
  {
    metricName: "WebVitalLcp",
    title: "Largest Contentful Paint (p75)",
    field: "lcp",
    goodThreshold: 2_500,
    alarm: true,
    response:
      "The main content is taking over 2.5s to appear for a quarter of visits. Compare against TTFB below: if that moved too it is the server, otherwise it is what the page renders.",
  },
  {
    metricName: "WebVitalInp",
    title: "Interaction to Next Paint (p75)",
    field: "inp",
    goodThreshold: 200,
    alarm: true,
    response:
      "Taps and clicks are taking over 200ms to show a response. Look for a heavy client component on the routes in the 'Slowest routes' saved query.",
  },
  {
    metricName: "WebVitalCls",
    title: "Cumulative Layout Shift (p75)",
    field: "cls",
    goodThreshold: 0.1,
    alarm: true,
    response:
      "The page is moving under people's fingers. Usually an image or embed without reserved space, or a loading.tsx whose shape does not match the body it replaces.",
  },
  {
    metricName: "WebVitalFcp",
    title: "First Contentful Paint (p75)",
    field: "fcp",
    goodThreshold: 1_800,
    alarm: false,
    response: "Context for LCP; not alarmed on its own.",
  },
  {
    metricName: "WebVitalTtfb",
    title: "Time to First Byte (p75)",
    field: "ttfb",
    goodThreshold: 800,
    alarm: false,
    response: "Context for LCP -- this is the half of it the server owns. Not alarmed on its own.",
  },
];

/** Matches a `web_vital.reported` line that actually carries this figure. */
export function webVitalFilterPatternFor(signal: WebVitalSignal): string {
  return `{ $.event = "web_vital.reported" && $.${signal.field} = * }`;
}

/** `WebVitalLcp` -> `diveday-web-vital-lcp`, same reasoning as `alarmNameFor`. */
export function webVitalAlarmNameFor(signal: WebVitalSignal): string {
  return `diveday-${signal.metricName.replace(/(?<!^)([A-Z])/g, "-$1").toLowerCase()}`;
}

/**
 * Saved Logs Insights queries -- the free half of this design, and where every
 * event code that did not earn a metric stays answerable.
 *
 * These are the questions the runbooks already ask in prose. Saving them means
 * an operator at 6am picks one from a list instead of writing query syntax
 * against a schema they have to remember.
 */
export interface SavedLogQuery {
  /** Appears in the Logs Insights query list, under a `DiveDay/` folder. */
  readonly name: string;
  readonly why: string;
  readonly queryString: string;
}

export const SAVED_LOG_QUERIES: readonly SavedLogQuery[] = [
  {
    name: "DiveDay/Errors, newest first",
    why: "The first query to run for any alarm. Every handled error, with its context fields.",
    queryString: [
      "fields @timestamp, event, @message",
      '| filter level = "error"',
      "| sort @timestamp desc",
      "| limit 200",
    ].join("\n"),
  },
  {
    name: "DiveDay/Event volume by code",
    why: "What this deployment is actually doing, ranked. The fastest way to spot a code that started or stopped.",
    queryString: [
      "fields event",
      "| stats count(*) as lines by event, level",
      "| sort lines desc",
      "| limit 100",
    ].join("\n"),
  },
  {
    name: "DiveDay/Money path, everything",
    why: "Every Stripe webhook and checkout decision in order, including the ones that succeeded -- for reconciling one order end to end.",
    queryString: [
      "fields @timestamp, event, @message",
      "| filter event like /^(stripe_webhook|checkout|payment)\\./",
      "| sort @timestamp desc",
      "| limit 200",
    ].join("\n"),
  },
  {
    name: "DiveDay/Notification failures by provider",
    why: "Whether a send problem is one provider or all of them -- the question that decides which runbook to open.",
    queryString: [
      "fields event",
      "| filter event like /^notification\\..*(failed|fell_back)/",
      "| stats count(*) as failures by event, bin(1h)",
      "| sort failures desc",
    ].join("\n"),
  },
  {
    name: "DiveDay/Slowest routes by LCP",
    why: "Which pages are actually slow for real visitors. The metrics give the app-wide p75; this is the per-route breakdown behind it.",
    queryString: [
      "fields route, lcp, inp, cls",
      '| filter event = "web_vital.reported" and ispresent(lcp)',
      "| stats pct(lcp, 75) as lcpP75, pct(inp, 75) as inpP75, pct(cls, 75) as clsP75, count(*) as views by route",
      "| sort lcpP75 desc",
      "| limit 40",
    ].join("\n"),
  },
  {
    name: "DiveDay/Core Web Vitals, rated",
    why: "How many visits landed in each of Google's good / needs-improvement / poor bands, which is the shape a score is actually reported in.",
    queryString: [
      "fields lcpRating, inpRating, clsRating",
      '| filter event = "web_vital.reported"',
      "| stats count(*) as visits by lcpRating, inpRating, clsRating",
      "| sort visits desc",
    ].join("\n"),
  },
  {
    name: "DiveDay/Scheduled passes",
    why: "Did every cron run, and what did it do? One row per pass, complete and failed alike.",
    queryString: [
      "fields @timestamp, event, @message",
      "| filter event like /^cron_/",
      "| sort @timestamp desc",
      "| limit 100",
    ].join("\n"),
  },
];

/** A construct id from a saved query's display name: `DiveDay/Errors, newest first` -> `ErrorsNewestFirst`. */
export function queryConstructIdFor(query: SavedLogQuery): string {
  return query.name
    .replace(/^DiveDay\//, "")
    .replace(/[^a-zA-Z0-9]+(.)?/g, (_match, next: string | undefined) =>
      next ? next.toUpperCase() : "",
    );
}
