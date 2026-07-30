# Monitoring runbook

How DiveDay learns two things about itself in production: that someone just created an account,
and that the app is throwing errors. Decision and rationale:
[20260727-sentry-error-monitoring-q7fk2p](../architecture/decisions/20260727-sentry-error-monitoring-q7fk2p.md).

Both degrade to "not configured" with none of this set — the app runs, sends nothing, throws no
error of its own for a missing key.

| Variable | Enables | Without it |
| --- | --- | --- |
| `NEXT_PUBLIC_SENTRY_DSN` | Sentry error capture, server and browser | No errors reported anywhere; `Sentry.init` is never called |
| `SENTRY_AUTH_TOKEN` | Source-map upload + release creation on the production build | Errors still report, but with minified stack traces and no release attached |
| `RESEND_API_KEY` / `RESEND_FROM_EMAIL` | The new-account alert (and every other outbound email) | Nothing sends — see `resend-email-runbook.md` |

## New-account alerts

Fires once per shop, from the same post-signup step that emails the new owner
(`onboardAction` in `src/app/onboard/actions.ts`). No setup beyond what
`resend-email-runbook.md` already covers — it rides the same Resend credentials as every other
notification. The only new piece is the recipient:

1. Create `alerts@dive.day` as a hosted mailbox (or a group/forwarding address), the same way
   `aaron@dive.day` and `legal@dive.day` were set up — see "DiveDay's own addresses" in
   `resend-email-runbook.md`.
2. That's it. `ALERT_EMAIL` in `src/lib/platform-mail.ts` already points there; nothing in the app
   needs to change to pick up a real mailbox once it exists.

## Error monitoring (Sentry)

Wired with `withSentryConfig` in `next.config.ts` and runtime files (`src/app/observability.ts`, `src/instrumentation.ts`, `src/instrumentation-client.ts`, `src/app/global-error.tsx`). This handles automatic source-map uploads on production builds when `SENTRY_AUTH_TOKEN` is present. It does not use performance or replay features; it captures errors and nothing else.

The production build that matters for this is Vercel's own (`scripts/vercel-build.mjs` → `pnpm build`) on merge to `main` — that is the build that actually deploys and is what should upload source maps and create the release. Set `SENTRY_AUTH_TOKEN` as a **Vercel** project environment variable (Production), not a GitHub Actions secret: CI's `next build` (`build` job) always sets `DIVEDAY_E2E=1`, which `next.config.ts` reads to disable Sentry's source-map upload and telemetry outright — CI builds an ephemeral artifact for `perf:budget` and the e2e/visual suites, never something that deploys, so there is nothing for a CI-side Sentry token to usefully upload.


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

### Capability-URL redaction

Waiver/readiness/recap/verify/reset-password links carry a bearer token in the URL itself. Sentry
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
| A waiver/ready/recap URL shows up unredacted in a Sentry event | A gap in `CAPABILITY_ROUTE_PREFIXES`/`CAPABILITY_QUERY_PARAMS` (`src/app/observability.ts`) — fix there, then treat the exposure per `capability-telemetry-runbook.md`'s rotation table |
| No new-account alert email | Same checklist as any other notification — see "When mail doesn't arrive" in `resend-email-runbook.md` — then confirm `alerts@dive.day` actually exists as a mailbox |
