# Monitoring runbook

How DiveDay learns two things about itself in production: that someone just created an account,
and that the app is throwing errors. Decision and rationale:
[20260727-sentry-error-monitoring-q7fk2p](../architecture/decisions/20260727-sentry-error-monitoring-q7fk2p.md).

> **Sentry answers "what threw".** The different question — what the app *decided*, how often, and
> how fast it felt to a real visitor — is answered by CloudWatch, and lives in
> [cloudwatch-observability-runbook.md](cloudwatch-observability-runbook.md). Neither replaces the
> other: a refused payment reconciliation, a send that gave up, and a p75 LCP are all 200 responses
> that Sentry never sees, while a stack trace and a release attribution are things CloudWatch has no
> idea about.

Both degrade to "not configured" with none of this set — the app runs, sends nothing, throws no
error of its own for a missing key.

| Variable | Enables | Without it |
| --- | --- | --- |
| `NEXT_PUBLIC_SENTRY_DSN` | Sentry error capture, server and browser | No errors reported anywhere; `Sentry.init` is never called |
| `SENTRY_AUTH_TOKEN` | Source-map upload + release creation on the production build | Errors still report, but with minified stack traces and no release attached |
| `SES_AWS_REGION` / `SES_AWS_ACCESS_KEY_ID` / `SES_AWS_SECRET_ACCESS_KEY` / `SES_FROM_EMAIL` | The new-account alert (and every other outbound email) | Nothing sends — see `ses-email-runbook.md` |

## New-account alerts

Fires once per shop, from the same post-signup step that emails the new owner
(`onboardAction` in `src/app/onboard/actions.ts`). No setup beyond what
`ses-email-runbook.md` already covers — it rides the same SES credentials as every other
notification. The only new piece is the recipient:

`alerts@dive.day` exists as of 2026-08-06, set up the same way `aaron@dive.day` and
`legal@dive.day` were — see "DiveDay's own addresses" in `ses-email-runbook.md`. `ALERT_EMAIL` in
`src/lib/platform-mail.ts` already points there, so there is nothing left to wire in the app.

## Error monitoring (Sentry)

Wired with `withSentryConfig` in `next.config.ts` and runtime files (`src/app/observability.ts`, `src/instrumentation.ts`, `src/instrumentation-client.ts`, `src/app/global-error.tsx`). This handles automatic source-map uploads on production builds when `SENTRY_AUTH_TOKEN` is present. It does not use performance or replay features; it captures errors and nothing else.

The production build that matters for this is Vercel's own (`scripts/vercel-build.mjs` → `pnpm build`) on merge to `main` — that is the build that actually deploys and is what should upload source maps and create the release. Set `SENTRY_AUTH_TOKEN` as a **Vercel** project environment variable (Production), not a GitHub Actions secret: CI's `next build` (`build` job) always sets `DIVEDAY_E2E=1`, which `next.config.ts` reads to disable Sentry's source-map upload and telemetry outright — CI builds an ephemeral artifact for `perf:budget` and the e2e/visual suites, never something that deploys, so there is nothing for a CI-side Sentry token to usefully upload.

**Preview builds generate no source maps, as of 2026-09-04.** `SENTRY_AUTH_TOKEN` being
Production-only is not a detail of that sentence, it is the whole reason: a preview build has no
token, so it uploaded nothing and — because the delete pass in `next.config.ts`'s `sourcemaps` block
only runs after a successful upload — deleted nothing either. It generated the 1,680 files and
173 MB of server maps counted in that block, on every preview, and shipped them into a deployment
that would never be symbolicated. `isVercelPreviewBuild` (`VERCEL === "1"` and
`VERCEL_ENV !== "production"`) now disables source maps for exactly that build; production keeps
them, and a local `pnpm build` and CI's `e2e:build` are untouched. The observable change is none: an
unsymbolicated preview stack trace is what a preview already produced. `src/test/next-config.test.ts`
pins the narrowness.


1. **Create a free Sentry account and project** at [sentry.io](https://sentry.io) — platform
   "Next.js". The free Developer plan covers 5,000 errors/month, which is generous for a young
   product; watch it if a specific bug loops (Sentry will warn as the quota approaches).
2. **Copy the DSN** (Project Settings → Client Keys (DSN)) into `NEXT_PUBLIC_SENTRY_DSN`. A DSN is
   not a secret — Sentry expects it to ship in client-side bundles — so the same value is safe to
   set once and used for both the server and browser init.
3. **Point the project's alert rules at `alerts@dive.day`** (Project Settings → Alerts). Sentry's
   own email-on-new-issue default is the actual "tell me when something breaks" — this app doesn't
   send its own error-alert email, it only reports the error to Sentry.
4. **Test it**: with the DSN set, throw in a Server Component or Route Handler and confirm the
   issue appears in the Sentry project within a minute or two. A client-side throw (a button
   handler, for instance) should appear the same way via `instrumentation-client.ts`'s init.

### What's covered, what isn't

| Surface | Captured how |
| --- | --- |
| Server Components, Route Handlers, Server Actions | `onRequestError` in `src/instrumentation.ts` (`Sentry.captureRequestError`) |
| Client-side uncaught exceptions / unhandled promise rejections | Sentry's default `GlobalHandlers` integration, initialized in `src/instrumentation-client.ts` |
| A root-layout render crash | `src/app/global-error.tsx`, the one path `onRequestError` can't see (it's client-side, post-hydration) |
| `src/proxy.ts` (the Auth.js edge middleware) | **Not covered.** A third runtime's worth of Sentry init was judged not worth it for this file's current size — see the ADR's consequences |
| The daily cron tick (`/api/cron/reminders`) | Per-scan `Sentry.captureException` tagged `cron_scan`, plus a Sentry **Cron Monitor** check-in (`diveday-daily-tick`) that alerts when the tick never runs at all |
| The app being unreachable, or a deployment that never boots | **Not covered by Sentry** — there is no running app to report it. That is what the external uptime monitor over `/api/health` and the public schedule is for; see [incident-response-runbook.md](incident-response-runbook.md) |
| A decision the app handled and returned 200 for — a refused payment reconciliation, a send that gave up, a prune that failed a table | **Not covered by Sentry**, because nothing threw. Counted and alarmed in CloudWatch; see [cloudwatch-observability-runbook.md](cloudwatch-observability-runbook.md) |
| How fast a page felt to a real visitor | **Not covered by Sentry** (performance is off). Core Web Vitals go to CloudWatch as p75 metrics with alarms, and Vercel Speed Insights keeps its own copy — same runbook |

### Capability-URL redaction

Waiver/readiness/recap/verify/reset-password/invite links, and the staff calendar-feed URL, all
carry a bearer token in the URL itself. Sentry
must never receive one unredacted, same rule as Analytics/Speed Insights
(`docs/engineering/capability-telemetry-runbook.md`). `observability.ts`'s `beforeSend` and
`beforeBreadcrumb` hooks reuse the same `redactCapabilityUrl` those SDKs use, applied to the
event's request URL/referrer and to navigation/xhr/fetch breadcrumbs. If a new capability route or
query parameter is ever added, update `CAPABILITY_ROUTE_PREFIXES`/`CAPABILITY_QUERY_PARAMS` in
`src/app/observability.ts` once — every consumer (Analytics, Speed Insights, Sentry) picks it up
from that one place.

## When something doesn't arrive

| Symptom | Look at |
| --- | --- |
| No errors ever show up in Sentry | `NEXT_PUBLIC_SENTRY_DSN` unset, or set on the server but not exposed to the client build — it must be the exact env var name (the `NEXT_PUBLIC_` prefix is what makes Next inline it into the browser bundle) |
| Server errors appear but client ones don't (or vice versa) | Confirm both `src/instrumentation.ts` and `src/instrumentation-client.ts` are present at the `src/` root — Next silently no-ops a misplaced instrumentation file rather than erroring |
| A waiver/ready/recap/invite/calendar URL shows up unredacted in a Sentry event | A gap in `CAPABILITY_ROUTE_PREFIXES`/`CAPABILITY_QUERY_PARAMS` (`src/app/observability.ts`) — fix there, then treat the exposure per `capability-telemetry-runbook.md`'s rotation table |
| No new-account alert email | Same checklist as any other notification — see "When mail doesn't arrive" in `ses-email-runbook.md`. The mailbox itself is no longer a suspect: `alerts@dive.day` exists |
