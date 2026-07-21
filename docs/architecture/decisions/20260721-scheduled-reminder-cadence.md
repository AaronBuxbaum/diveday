# 20260721-scheduled-reminder-cadence — Scheduled pre-trip reminder cadences

- **Status:** Accepted
- **Date:** 2026-07-21

## Context

The one-tap manual sends (booking confirmation, waiver link, wait-list invite) were built as the
manual bridge the [UX audit](../../product/ux-audit-20260721.md) said to ship ahead of the H-09
policy decision, which explicitly deferred *auto-notification cadences* until the policy row was
chosen and a cron/queue mechanism ADR existed — "no timer exists in the app today, by design."
H-09's owner has now chosen to automate the pre-trip reminder cadence. This ADR supplies both the
cadence rules and the missing scheduling mechanism.

## Decision

- **The cadence rule is a framework-free function.** `dueReminder({ startsAt, now, sentKinds })`
  (`src/lib/reminders.ts`) returns the single reminder due for a booking now, or null. Cadences
  partition the run-up to departure into half-open buckets — a 7-day reminder due from T-168h until
  T-24h, a 24-hour reminder from T-24h until departure — so `now` lands in at most one bucket. A
  booking made late (already inside 24h) gets only the accurate 24-hour text, never a stale "you sail
  in a week"; already-sent kinds are skipped; nothing fires after departure.
- **Each cadence is its own notification kind, deduped per booking.** `trip_reminder_7d` and
  `trip_reminder_24h` join the `notification_kind` enum, so the existing one-row-per-(booking, kind)
  `notification_deliveries` unique index makes each cadence send at most once with no new dedup
  machinery. Reminders route through the same `notify()` seam and delivery recording as every other
  email.
- **Sending is idempotent and multi-channel.** `sendDueReminders(db, { now })` (`src/db/reminders.ts`)
  scans active bookings on scheduled trips inside the widest cadence lead, computes the due reminder
  per booking from what has already been delivered, and sends it — email as the tracked channel, a
  courtesy SMS on top when the diver has a textable phone
  ([20260721-sms-whatsapp-notifications](20260721-sms-whatsapp-notifications.md)), or SMS as the
  tracked channel for a phone-only diver. Re-running only sends what is newly due.
- **An external scheduler drives the clock; the app still holds no timer.** `GET /api/cron/reminders`
  is the entry point, guarded by a required `CRON_SECRET` bearer token (503 when unset, so a
  deployment that forgot the secret can't be triggered). Vercel Cron (`vercel.json`) calls it once a
  day (14:00 UTC) — the Hobby plan caps crons at daily, and the cadence buckets are each ≥24h wide
  (7-day: 144h, 24-hour: 24h), so a daily run lands in each booking's active bucket exactly once and
  no reminder is missed. A shorter interval (on a paid plan) only makes the same idempotent scan more
  responsive; it never double-sends. This keeps the "no timer in-process" property: the mechanism is
  a stateless, idempotent endpoint plus an out-of-band caller.

## Alternatives considered

- **A durable job queue** (a `scheduled_notifications` table, a worker) — more control (per-send
  retry, backoff), but real infrastructure for a cadence that is fully derivable from trip dates plus
  the delivery rows we already keep. A stateless scan is simpler and idempotent by construction; a
  queue can layer on later if per-send scheduling is ever needed.
- **Fire every un-sent past cadence at once** — a late booking would get the stale weekly text as
  well as the accurate daily one. The half-open buckets send only the reminder that fits the moment.
- **An in-process interval/timer** — rejected on the same grounds the audit set out: serverless
  instances are ephemeral, a timer wouldn't survive, and it would couple sending to a running server.

## Consequences

- Divers now get automatic pre-trip reminders with a link to what's still outstanding, closing the
  scheduled-cadence half of H-09; the manual one-tap sends remain for anything off-cadence.
- The reminder scan is safe to over-call: the delivery-row dedup means an extra cron tick (or a
  manual hit of the endpoint) never double-sends.
- With no email or SMS provider configured every reminder records `not_configured` and surfaces on
  the staff notification dashboard, exactly like every other channel — the feature degrades instead
  of failing.
- The repo now depends on an external scheduler for reminders to fire; that dependency is explicit in
  `vercel.json` and the endpoint is inert without both the schedule and `CRON_SECRET`.
