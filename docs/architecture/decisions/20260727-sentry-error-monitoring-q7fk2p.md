# 20260727-sentry-error-monitoring-q7fk2p — Sentry for error monitoring; Resend for new-account alerts

- **Status:** Accepted
- **Date:** 2026-07-27

## Context

The product owner asked for operational visibility with cost held down: know when someone creates
an account, and know when the app is throwing errors. Nothing in the codebase captured either
before this — `src/app/observability-client.tsx` only wires Vercel Analytics/Speed Insights
(page-view telemetry, not exceptions), and account creation (`src/app/onboard/actions.ts`) only
emailed the new owner, never the founder.

Two different problems, two different fits:

- **New account created** is a single, low-volume, structured event with a known recipient. The
  app already has a paid-for, working outbound-email path (Resend, `src/lib/notifications/`) that
  degrades to `not_configured` gracefully. Adding a second recipient to an existing pipeline is
  free; standing up a whole event pipeline (or a second vendor) for one event type is not.
- **Runtime errors** are unstructured, potentially high-volume, and need deduplication, stack
  traces, and a dashboard to be useful rather than an inbox someone has to triage by hand. That is
  what error-tracking vendors exist for, not something worth hand-rolling well.

## Decision

**New-account alerts ride the existing Resend pipeline.** A new `new_account_alert` notification
kind (`src/lib/notifications/index.ts`, email in `src/lib/notifications/email.ts`) fires once, from
the same post-commit `after()` block in `onboardAction` that already sends the owner's welcome
mail — independent of `APP_HOST` being configured, since it carries no link. It routes to
`alerts@dive.day` (`ALERT_EMAIL`, `src/lib/platform-mail.ts`), a new hosted mailbox alongside
`aaron@` and `legal@` (same pattern as
[20260726-hosted-mailboxes-for-platform-mail](20260726-hosted-mailboxes-for-platform-mail.md)).
Zero new dependency, zero new cost.

**Runtime errors go to Sentry, on its free tier, wired by hand rather than through the full
`@sentry/nextjs` wizard setup.** The wizard's deepest value — automatic source-map upload, the
Webpack/Turbopack build plugin, session replay, request tracing — comes from wrapping
`next.config.ts` in `withSentryConfig` and touching the build pipeline. This app runs a Next.js
*preview* major (16.3.0-preview.x; see the framework warning in `AGENTS.md`), so a build-time
plugin is exactly the kind of integration most likely to break silently on a version the SDK wasn't
tested against. Manual init carries none of that risk: it's the same `Sentry.init()` call Next's
own `instrumentation.js`/`instrumentation-client.js` docs show, using only the SDK's runtime API,
no build-config changes.

- `src/app/observability-sentry.ts` centralizes `initSentry()` (env-gated on `NEXT_PUBLIC_SENTRY_DSN`
  — a DSN is not secret, so one var covers both server and browser) and the capability-URL
  redaction, and is imported by both entry points below.
- `src/instrumentation.ts` (`register()`) calls it server-side and exports `onRequestError` as
  `Sentry.captureRequestError` — the SDK's purpose-built adapter for Next's
  `Instrumentation.onRequestError` hook, covering Server Components, Route Handlers, and Server
  Actions.
- `src/instrumentation-client.ts` calls it client-side; the SDK's default `GlobalHandlers`
  integration then covers uncaught exceptions and unhandled promise rejections without any manual
  listener code.
- `src/app/global-error.tsx` (new — none of `global-error`/`error`/`not-found` existed before this)
  catches a root-layout render crash, the one failure mode `onRequestError` doesn't see because it
  happens client-side after hydration, and reports it via `Sentry.captureException`.
- **`tracesSampleRate: 0`, no session replay.** Errors only. Performance tracing and replay each
  carry their own Sentry quota and their own client bundle weight; neither was asked for, and
  skipping them keeps usage well inside the free tier that motivated "external services, but keep
  costs down" in the first place.
- **Capability URLs are redacted before Sentry ever sees them**, reusing
  `redactCapabilityUrl` (`src/app/observability.ts`) exactly as
  `docs/engineering/capability-telemetry-runbook.md` already requires for Analytics/Speed
  Insights — a `beforeSend`/`beforeBreadcrumb` pair scrubs the event's request URL/referrer and
  navigation/xhr/fetch breadcrumbs. A waiver/ready/recap/verify/reset-password token must not leak
  into a third observability vendor any more than the first two.
- Sentry's own alert rules (configured on the Sentry project, not in this repo) are the actual
  "email me when something breaks" — the same division of labor as Resend's dashboard/webhook vs.
  this app's notification code. Point the Sentry project's alert email at `alerts@dive.day`.

## Alternatives considered

- **Full `@sentry/nextjs` wizard setup (`withSentryConfig`, source maps, tunneling).** More
  capability, but couples the build to a plugin whose compatibility with a Next preview major is
  unverified — the exact risk this decision is written to avoid. Revisit once Next 16 is stable and
  the SDK has caught up, or once stack-trace quality on minified bundles becomes a real problem
  without it.
- **Hand-rolled error alerting through Resend** (catch exceptions, email `alerts@dive.day`
  directly, no new dependency). Rejected for the errors half: no deduplication means one repeating
  bug floods the inbox, no stack-trace grouping, no dashboard, no history — the inbox becomes the
  triage tool, which is exactly the failure mode a real error tracker exists to prevent. Still the
  right call for the new-account event, which is genuinely one-shot and low-volume.
- **A single vendor for both signals** (e.g., Sentry's own event/alert API for the signup event
  too). Rejected as unnecessary indirection: the signup event already has a perfectly good delivery
  path, and routing it through Sentry would mean modeling a non-error as an "error" to get it there.

## Consequences

- Two new pieces of external setup, neither built by the app (same shape as the Resend/mailbox
  setup before this): a Sentry account + project (free tier) with `NEXT_PUBLIC_SENTRY_DSN` copied
  into the environment, and the `alerts@dive.day` mailbox created with the mail provider. Both are
  documented in `docs/engineering/monitoring-runbook.md`. Until `NEXT_PUBLIC_SENTRY_DSN` is set,
  every Sentry call is a no-client no-op — same "degrades to not configured" shape as every other
  optional integration in this app.
- No source maps means Sentry stack traces on a production build show minified frames until a
  source-map step is added deliberately (its own future decision, gated on Next 16 stabilizing).
- `edge` runtime code (`src/proxy.ts`) is not instrumented — `onRequestError` fires for Server
  Components/Route Handlers/Server Actions on the Node runtime this app actually runs on, but a
  throw inside the Auth.js edge middleware itself is not captured. Acceptable for now: that file is
  small, already carries its own header-integrity comments, and adding a third runtime's worth of
  Sentry init was judged not worth the risk for its current size.
- The founder alert inbox and the error-alert inbox are the same address (`alerts@dive.day`) today;
  splitting them is a mailbox-and-Sentry-project-settings change, not a code change, if volume ever
  makes that worth doing.
