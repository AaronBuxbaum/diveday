# 20261104-roll-call-by-meeting-day — Roll call and "the boat is out" read a departure's meeting days

- **Status:** Accepted
- **Date:** 2026-11-04

## Context

A departure may meet on named dates (a course on Saturday and the Saturday two weeks on), but the
open-count detector, the stale-count alert, the manifest's count and "the boat is out" read the
run's one `starts_at`..`ends_at` window. The second Saturday read as a boat on the water for the
thirteen days between, and a roll-call checkpoint is keyed per booking (`after_dive_1`), not per
day, so the first Saturday's "back aboard" closed the second Saturday's count (#2557). It amends
[20260804-day-closeout](20260804-day-closeout.md) and [20260803-per-person-crew-roll-call](20260803-per-person-crew-roll-call.md); the rest of
both stands.

## Decision

- **A result belongs to the meeting day it was taken on.** Checkpoint results carry `occurred_at`,
  so each belongs to one day (`rollCallDayOf`, `src/lib/trip-days.ts`): day one owns everything
  before day two's boundary, which sits halfway between day one's end and day two's start and never
  after that start. A one-day trip has no boundary and reads exactly as before.
- **Each begun day is its own head count** (`listRollCallGaps`): underway inside its window and
  return hour, home after it, stale 48 hours after it ended. Between two days nobody is on the
  water and no gap opens. Still at most one diver row, one crew row and one dock row per trip: a
  stated missing person on any day first, then the newest day's open count.
- **Missing stays missing across days.** A person recorded not back aboard on day one stays
  missing until they are recorded `boarded` on a later day. The manifest, the desk's boarded list
  and Today's boats-out read only the current day (`currentMeetingDayMarks`, one correlated
  subquery), so day two starts empty; `listUnaccountedForByTrip` keeps the whole run.
- **The stale-count alert is per meeting day**: due when a day ends, and a claim taken before a day
  began does not hold that day.
- **Phase**: `tripPhaseOf` with meeting windows is Aboard only inside a day and its return hour,
  Prep or Check-in for the next day between; a crew tap still speaks until its own day is over.

## Alternatives considered

- **A `day_number` column on `roll_call_events`**: exact, but a schema change, an offline-sync
  change and a backfill, for what `occurred_at` already says.
- **Keep checkpoints run-wide and note the limit**: leaves day two's count closed by day one's.

## Consequences

- On a later day the manifest no longer shows a day-one missing diver; Today's row does, until they
  are counted again. The counter's check-in queue, running late, `/ready`'s recap state, help
  requests and the fly-safe line still read the run's window; none raises a safety signal between
  days.
- A result tapped near a boundary (a late count past the halfway point of two windows on the same
  day) belongs to the later day.
