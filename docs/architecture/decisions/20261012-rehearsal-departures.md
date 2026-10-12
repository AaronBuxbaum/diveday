# 20261012-rehearsal-departures — A rehearsal departure for training day, and every place that honors it

- **Status:** Accepted
- **Date:** 2026-10-12

## Context

Training day needs a departure to practice on. A private one still sends, charges, counts and
stays. "Never sends, never counts" spans dozens of reads and senders, true only while each new one
remembers it.

## Decision

- **`trips.is_rehearsal`, set at creation from the schedule builder's add flow, never changed.**
  One departure only: the builder refuses a cadence and a series refuses one. A copy stays one.
- **Private by constraint** (`trips_rehearsal_is_private`), so every public read that hides private
  departures hides it; creation and edits force it.
- **Unpriced, and every money door refuses it:** checkout, invoices, last-minute deals.
- **Staff seat it; nobody else.** No public booking, wait list, page, preview card or URL.
- **Nothing sent.** Every email is held at `sendNotification`, the batch and the retry drain
  (`notificationHeldForRehearsal`, recorded `failed / rehearsal_departure`, never queued). Paths
  outside that chokepoint close where they start: reminder and recap scans, waiver and course-forms
  links (hand-over only), crew news, manifest push.
- **Counted nowhere.** Reports, digest, metrics, calendar feed and public sightings read with
  `notRehearsal()`. The export drops it and its seats from every file by `trip_id` / `booking_id`
  after building (`withoutRehearsals`); a signed release stays, its seat blanked, because a
  signature is evidence.
- **Still a dive day** for the fly-safe advisory: a rehearsal in the water is real nitrogen.
- **Deleted the night after it comes home** by the nightly trip-series cron
  (`clearFinishedRehearsals`): soft-deleted, seats cancelled without telling anyone.
- **A warning panel** above Trip, Manifest and Prep.

### Where it is honored

`src/db/rehearsal-coverage.test.ts` is the list, and walks it: every read of `trips` in an outward
module (reporting, report-lines, season-scale, weekly-digest, founder-metrics, dive-sites,
trip-sightings, month-sightings, calendar-sync feed) carries `notRehearsal()` or
`diveday:allow-rehearsal: <why>`; each gate holds its line (schema check, trips-create,
trips-record, bookings, waitlist, public trip page and card, checkouts, orders,
integration-events, trip-promos, notifications, waiver-issue, reminders, recap, crew-notices,
push-subscriptions, export, the cron); every file that can hand a message to a provider is named
with its reason, so a new sender fails until classified. Then it reads a real rehearsal back through
those doors.

## Alternatives considered

- **A filter at every sender instead of the chokepoint.** More places to forget; the chokepoint
  covers senders not yet written.
- **Filtering each export read.** Forty files today and more later; filtering the finished tables
  by column covers files not yet written.
- **Hard delete after the day.** Breaks the rule that every delete is soft
  (20260820-every-delete-is-soft).

## Consequences

- Staff practice the whole boat side without a message leaving or a number moving.
- A message a staffer sends by hand on a rehearsal records as held, not sent.
- Once a shop has held a rehearsal, the export settings page counts by reading the bundle.
