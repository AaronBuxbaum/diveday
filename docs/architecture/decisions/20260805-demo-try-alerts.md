# 20260805-demo-try-alerts — Alert the founder on a demo try, on the same pipeline as a trial start

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

The product owner asked to "collect analytics for when someone starts a new trial or tries the live
demo, and add an alert for when that happens too." Half of that already existed and is worth stating
before adding anything:

- Both events are already typed and already fire. `trial_started` (`src/app/onboard/actions.ts`) and
  `demo_entered` (`src/app/actions/demo.ts`) are members of the `AnalyticsEvent` union in
  `src/lib/analytics.ts`, each carrying a `FunnelSource` tag from the closed registry in
  `src/lib/funnel.ts` (ADR 20260723-event-instrumentation).
- A trial start already alerts. `new_account_alert` mails `ALERT_EMAIL` from a deferred `after()`
  block in `onboardAction` (ADR 20260727-sentry-error-monitoring-q7fk2p).

What did **not** exist: any alert for a demo try, and any way to point either alert somewhere other
than DiveDay's own mailbox. There was also an accuracy defect in the demo event — it fired at the
very top of `enterDemoAction`, before the per-IP rate-limit check and before `createDemoShop`, so a
throttled visitor and a failed mint both counted as demo entries. That inflates the numerator of
every demo-to-trial ratio read off the pair, which is the one number these two events exist to
produce.

Constraint that shapes the rest: **a demo visitor is anonymous.** No session, no account, nothing
typed. Whatever leaves the process on this path is an outbound analytics/mail boundary carrying data
about a person who never identified themselves.

## Decision

**A new `demo_started_alert` notification kind, riding the existing SES pipeline** — the same
reasoning ADR 20260727 used for `new_account_alert`, applied to its other half. A single structured
low-volume event with one known recipient is an email, not a second vendor and not a dashboard. The
schema lives in `src/lib/notifications/kinds.ts`, the body in `src/lib/notifications/email.ts`
(English, like the other founder-only alert — there is no shop or diver recipient to speak to in
their own language), and the dispatch in `render.ts`.

**The alert carries the shop slug, the demo role, and the funnel tag. Nothing else.** No IP, no user
agent, no referrer beyond the `FunnelSource` registry, no generated demo-owner email. The `shopId`
field exists only because `notification_send_queue.shop_id` is a non-null FK; it points at the
throwaway demo shop, which the 7-day reaper deletes along with that table's rows
(`deleteDemoShopCascade`, guarded by `src/db/delete-path-coverage.test.ts`).

**Idempotency keys off the minted slug** — `demo-started-alert/<slug>`. Every entry mints its own
shop under a freshly generated identity, so the slug *is* the entry's identity; no timestamp is
needed and a double-submit converges on one send.

**Both the event and the alert move behind `after()`, after the mint succeeds.** `after` runs even
when the response ends in `redirect`, which this action always does. That fixes the accuracy defect
above and takes a telemetry round trip off the path a visitor is waiting on.

**`OPS_ALERT_EMAIL` overrides the destination**, resolved through `alertRecipient()` in
`src/lib/platform-mail.ts` and used by *both* alerts. Unset — the normal case for the deployment
that actually is DiveDay — it falls back to the compiled-in `ALERT_EMAIL`. It is an address, not a
credential, and is exempted from `check:env`'s required-key sweep for the same reason `PLACES_*` is:
absent is a supported state.

**Failure is swallowed at the alert, never at the flow.** `announceDemoEntry` catches everything and
logs; `onboardAction`'s alert block moved from a trailing `.catch()` to a `try`/`catch`, because it
awaits `getDb()` *as an argument* and a failed handle therefore rejected before any `.catch` was
attached — an unhandled rejection on the one path whose whole point is that a broken alert cannot
touch a signup.

**No-op in test and local dev falls out of the existing provider seam**, with nothing new to
configure: with no `SES_*` credentials `notificationProviderFromEnvironment` returns
`disabledNotificationProvider`, and `playwright.config.ts` blanks those keys fleet-wide for exactly
this reason. `DIVEDAY_DISABLE_EXTERNAL_HTTP=1` covers the analytics half.

**`announceDemoEntry` lives in `src/app/actions/demo-instrumentation.ts`, a plain module with no
`"use server"` directive, and must never gain one.** This is the security review of this change's
own diff, recorded because the mistake is invisible at the call site and easy to repeat. Every
exported async function in a `"use server"` module is a callable server-action endpoint, and
`demo.ts` is reachable with no session at all — the demo CTA is the whole point. Exported from
there, this function would have been an unauthenticated endpoint taking a caller-supplied `slug`,
`role`, and `source`, which is enough to spray unregistered tags into the funnel, mail the founder
about demo tries that never happened, and — by passing a **real** shop's slug — drive
`sendNotification` into `queueRetry` and write a poisoned payload row scoped to that tenant's
`shop_id`. TypeScript's `DemoRoleId`/`FunnelSource` parameter types are erased at runtime and stop
none of it. `seat-diver-surfaces.ts` is a plain sibling of `seat-diver.ts` for the same reason. A
test asserts the server-action module does not export it.

## Alternatives considered

- **A digest — batch demo tries into a daily cron mail.** Rejected for now: `RATE_LIMITS.demoCreate`
  is 10/hour/IP and real demo volume is currently single digits a day, so per-event mail is
  legible rather than noisy. This is the decision to revisit first (see Consequences).
- **Reuse `new_account_alert` for demo shops.** Rejected — its schema requires a `userAccountId` and
  an owner name/email, which for a demo would mean mailing the founder a generated
  `*.demo.invalid` identity that reads like a real person. Different event, different shape.
- **A second analytics vendor / dedicated event pipeline for the funnel.** Rejected: the typed
  `AnalyticsEvent` seam already exists and already carries both halves. Nothing was missing at the
  analytics layer except accuracy.
- **Fire the alert inline instead of in `after()`.** Rejected: it puts an SES round trip in front of
  a redirect the visitor is watching a spinner for, and the demo CTA has already been shown once to
  blow the e2e per-test budget on exactly this kind of stall.
- **Carry the visitor's IP or referrer to make the alert more useful.** Rejected outright. This is an
  outbound path about an unidentified person; the funnel tag answers "which page sent them" without
  it.

## Consequences

The founder learns about both halves of the funnel from one inbox, with no dashboard to watch, and
the demo number can now be trusted against the trial number because both count committed outcomes.
A fork or staging deploy no longer mails DiveDay about shops that aren't ours.

What it commits us to: one email per demo entry. **Revisit when that becomes noise** — the trigger is
sustained daily demo volume in the tens, and the migration is cheap and local: keep the
`demo_started_alert` kind and its body, stop calling `sendNotification` from `announceDemoEntry`,
and have a cron route under `src/app/api/cron/` roll the day's `demo_entered` events into one
digest. Nothing outside `announceDemoEntry` would move.

Adding a notification kind also costs what every kind costs: a schema, an idempotency case, and a
body, with the type checker enforcing the last two.
