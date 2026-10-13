# 20261012-rehearsal-departures — A rehearsal departure for training day, and every place that honors it

- **Status:** Accepted
- **Date:** 2026-10-12

## Context

Training day needs a departure to practice on. A private one still sends, charges, counts and
stays. "Never sends, never counts" spans dozens of reads and senders, true only while each new one
remembers it.

## Decision

- **`trips.is_rehearsal`, set once from the schedule builder's add flow.** Never a series.
- **Private by constraint** (`trips_rehearsal_is_private`), so every public read hides it.
- **Unpriced, and every money door refuses it:** checkout, invoices, last-minute deals, and
  prepaid package dives (a seat spends none).
- **Staff seat it; nobody else.** No public booking, wait list, page, preview card, calendar file,
  arrival card or URL.
- **Nothing sent.** Every email is held at the send chokepoint (`notificationHeldForRehearsal`,
  recorded `failed / rehearsal_departure`). Other paths close where they start: reminders, recaps,
  waiver links (hand-over only), crew news, manifest push.
- **Counted nowhere.** Reports, digest, metrics, calendar feed and public sightings read with
  `notRehearsal()`. The export drops it and its seats from every file by `trip_id` / `booking_id`
  after building (`withoutRehearsals`). Evidence stays with its trip and seat ids blanked: signed
  releases, course forms and the roll call.
- **Still a dive day** for the fly-safe advisory: a rehearsal in the water is real nitrogen.
- **Deleted by the nightly trip-series cron** (`clearFinishedRehearsals`, rule in
  `rehearsalMayClear`) once it was due home before yesterday began in the shop's zone,
  and the fly-safe look-back plus a day has passed, so no later boat counts its divers' day.
  Soft-deleted; seats cancelled silently; prepaid dives and unclaimed gear returned.
  **Never one with evidence**: a diver or crew boarding, an after-dive count, a logged dive or an
  incident report. That one stays live; its banner says why.
- **A warning panel** on every trip surface; "Rehearsal" printed beside souls on board.

### Where it is honored

`src/db/rehearsal-coverage.test.ts` is the list, and walks it: every `trips` read in an outward
module carries `notRehearsal()` or `diveday:allow-rehearsal: <why>`; each gate holds its line;
every sender is classified with its reason; and a real rehearsal is read back through those doors.

## Alternatives considered

- **A filter at every sender instead of the chokepoint.** More places to forget; the chokepoint
  covers senders not yet written.
- **Filtering each export read.** Forty files today and more later; filtering the finished tables
  by column covers files not yet written.
- **Hard delete after the day.** Breaks the rule that every delete is soft
  (20260820-every-delete-is-soft).

## Consequences

- Staff practice the whole boat side without a message leaving or a number moving.
- A message a staffer sends from a rehearsal's seat or departure (a resend, a hold, a blow-out)
  records as held. A reply from the inbox names no departure and goes.
- A rehearsal with evidence stays on the staff board until someone removes it by hand.
- Once a shop has held a rehearsal, the export settings page counts by reading the bundle.
