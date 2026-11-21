# trips

Departures and their day: the schedule and its series, the trip page and its fix list, what to
pack, what to tell guests, and recovering a cancelled day.

## Owns

- The schedule: `schedule-board-page.ts`, `schedule-move-result.ts`, `series-next.ts`,
  `weekday-pattern/`, `off-season.ts`, `departure-counts.ts`, `departure-picker-window.ts`,
  `thin-boats/`, `trip-calendar.ts` (the iCalendar writer for a trip).
- The trip page: `trip-page.ts`, `trip-overview.ts`, `trip-fix-list.ts`, `trip-guests/`,
  `trip-lenses.ts`, `trip-stages.ts`, `trip-stage-tone.ts`, `trip-shared-reads.ts`,
  `trip-paper-identity.ts`, `stable-packet.ts`, `trip-planned-sites.ts`, `day-profile.ts`.
- Preparing: `trip-prep/`, `dive-intent/`.
- Settings: `trip-defaults-page/`, `trip-tags-page.ts`.
- When a day is lost: `disruption-recovery.ts`, `recovery-activities/`.

## Does not own

The trip queries (the `@/db/trips` barrel), seating (`bookings`), boarding
(`boarding`) and the money a trip makes (`src/features/money/trip-money/`).

## Invariants

- Occurrence dates come from `seriesOccurrenceDates` in the shop's wall-clock time; filling the
  window is one idempotent `rollSeriesForward`; `series_id` is provenance, never a live link.
- The fix list's `blocking` is exactly the guests boarding readiness refuses; an advisory never
  blocks and a blocker never hides among advisories; every guest is on one line, with every
  reason, and every reason maps to one remedy (ADR 20261117-trip-page-clock).
- A course download uses each recorded meeting window and the recorded meeting point only; a
  charter download keeps the dock-call offset; day one keeps the trip's UID and every event
  carries the trip revision.
- Recovery follow-up on a cancellation is an explicit, idempotent staff record of codes and keys;
  it never creates or moves a booking, changes readiness, issues credit or touches a refund, and a
  replacement must already be an active booking for the same diver on another departure.
- The trip page's common manifest keeps every roster, readiness and permission read; fleet, lenses
  and conservation load only when the route resolves Details.
