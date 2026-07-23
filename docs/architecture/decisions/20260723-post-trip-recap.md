# 20260723-post-trip-recap — Deliver a post-trip recap on the departed-trip scan

- **Status:** Accepted
- **Date:** 2026-07-23

## Context

The [first-principles brainstorm C](../../product/brainstorm/first-principles-business.md) names the
hours after a great dive as the highest-leverage, entirely-unused marketing window a shop has. The
build is the post-trip recap: a shareable per-diver-per-trip page, delivered automatically once the
trip departs. The pre-trip reminders already established the machinery this rides on — a framework-free
due rule, one delivery row per `(booking, kind)`, the `notify()` seam, and an external daily cron with
no in-process timer ([20260721-scheduled-reminder-cadence](20260721-scheduled-reminder-cadence.md)).
The recap must not introduce a second scheduler or a new dedup mechanism.

## Decision

- **`trip_recap` is a new `notification_kind`, deduped per booking.** The existing
  one-row-per-`(booking, kind)` unique index makes each booking's recap send at most once with no new
  machinery; it routes through the same `notify()`/`recordNotificationDelivery` path as every other
  message.
- **A departed-trip scan, not a cadence bucket.** `sendDueRecaps(db, { now })` (`src/db/recap.ts`)
  selects active bookings on scheduled trips whose `endsAt` falls in `(now - 48h, now]` and sends the
  recap to any not already delivered. The 48h lookback is ≥ the daily cron interval with a full
  missed-run of slack; the delivery-row dedup means an overlapping window never double-sends.
- **One cron drives both pre- and post-trip.** `GET /api/cron/reminders` now calls `sendDueReminders`
  then `sendDueRecaps`, so a single daily tick covers a booking's whole run-up-and-after. No change to
  `vercel.json` or the `CRON_SECRET` fail-closed guard.
- **The page is public via a purpose-separated signed token.** `/recap/[token]` renders from the same
  source-of-truth trip and dive-site queries the staff and booking surfaces use. `src/lib/recap-links.ts`
  mirrors the readiness-link HMAC but folds a `recap:` purpose prefix into the signed payload, so a
  readiness token cannot be replayed as a recap token or vice versa. The link is the whole point of the
  send, so a run with no resolvable app origin records `not_configured` rather than mailing a dead end.

## Alternatives considered

- **A separate `/api/cron/recaps` endpoint and Vercel entry** — more moving parts and a second secret
  for a scan that shares the reminders' clock and dedup; folding it into the one daily tick is simpler.
- **Reuse the readiness token for the recap** — one fewer module, but it would make a prep-state link and
  a recap link interchangeable; purpose separation keeps the two capabilities distinct.
- **A durable job queue for "send hours after return"** — real infrastructure for a window the daily
  scan already covers idempotently; a queue can layer on if per-minute timing ever matters.

## Consequences

- Divers get an automatic, shareable recap that drives rebooking and referrals, with no new scheduler,
  dedup table, or dependency. With no email/SMS provider (or no app origin) configured, every recap
  records `not_configured` and surfaces on the staff dashboard, exactly like every other channel.
- The recap page shows what the shop already knows (sites, conditions, dive count); a crew-authored
  post-trip shout-out is intentionally out of scope for this slice — it needs a trip column and a staff
  editor, and is a clean follow-up.
- **Escape hatch:** if "within the hour of return" ever matters more than "within a day", move recaps to
  a shorter cron interval (paid plan) or the deferred job queue — both are additive; the due rule and
  dedup are unchanged.
