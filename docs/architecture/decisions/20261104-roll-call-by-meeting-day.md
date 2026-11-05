# 20261104-roll-call-by-meeting-day — Roll call and "the boat is out" read a departure's meeting days

- **Status:** Accepted
- **Date:** 2026-11-04

## Context

A departure may meet on named dates (a course on two Saturdays a fortnight apart), but the
open-count detector, the stale-count alert, the manifest and "the boat is out" read the run's one
`starts_at`..`ends_at` window, and a checkpoint is keyed per booking (`after_dive_1`), not per day:
the first Saturday's "back aboard" closed the second's count (#2557). It amends
[20260804-day-closeout](20260804-day-closeout.md) and [20260803-per-person-crew-roll-call](20260803-per-person-crew-roll-call.md).

## Decision

- **A result belongs to the meeting day it was taken on**, by `occurred_at` (`rollCallDayOf`,
  `src/lib/trip-days.ts`). Day two's boundary is halfway from day one's end to its start, never
  after that start. A one-day trip reads as before.
- **Each begun day is its own head count** (`listRollCallGaps`), with its own diver, crew and dock
  rows, newest day first. A day has begun when its window opens, or when its boundary has passed
  and somebody was counted on it. A later day whose first count is at a later checkpoint numbers
  its dives on from the days before, so the checkpoints below it keep the earlier days' results.
  The board badges the newest day; the close-out reads one row per half (`oneRowPerHalf`).
- **Missing stays missing across days.** One fold (`src/lib/roll-call-days.ts`) serves the
  detector, the manifest and `listUnaccountedForByTrip`, which compares dive numbers within a day.
  An earlier day's stated missing person stays on the manifest past the boundary until counted
  again; a later `cleared` takes that "not back" back. Dock counts read the current day only
  (`currentMeetingDayMarks`).
- **The stale-count alert is per meeting day**: due when a day ends, the newest due day speaks, and
  a claim taken before a day ended does not hold it.
- **A counted meeting day stays put**: a save that moves or removes it, or re-files a result, is
  refused (`meeting_day_has_roll_call`).
- **A window may run past midnight**, ending the next morning, for nights up to twelve hours
  (`wallWindowEnd`).
- **Phase**: Aboard only inside a day and its return hour; Prep or Check-in between days.

## Alternatives considered

- **A `day_number` column on `roll_call_events`**: a schema, offline-sync and backfill change for
  what `occurred_at` already says.
- **Keep checkpoints run-wide**: leaves day two's count closed by day one's.

## Consequences

- The close-out, the recap and `src/db/divers.ts` see a later day's dock count only. The check-in
  queue, running late, `/ready`'s recap, help requests and the fly-safe line read the run's window;
  none raises a safety signal between days.
- A late count past the halfway point of two same-day windows belongs to the later day.
- An offline mark's newest-wins check compares only marks on the meeting day of its own
  `occurred_at` (`onSameMeetingDayAs`), so Saturday's queued tap is not refused by Sunday's count.
- Known limit: the offline manifest does not know the boundary (#3904).
