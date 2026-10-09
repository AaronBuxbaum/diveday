# 20261009-crew-hear-about-their-boats — Crew hear about their boats, netted and batched

- **Status:** Accepted (2026-10-09)
- **Date:** 2026-10-09

## Context

A staffer put on a departure, taken off one, or answered on their own crew request heard nothing.
They found out by opening the calendar feed (`src/features/calendar-sync`) or the staffing week. The
product owner approved telling them by email on 2026-10-09, with three conditions: rapid edits are
coalesced, the staffer who made a change is never told about their own act, and the hook sits on
the one write path rather than on each surface.

Crew changes reach the database through three functions, and every surface calls one of them:

- `setTripCrew` (src/db/trips-crew.ts): a whole-crew replacement, used by the schedule builder for a
  new departure, a repeating series and the pattern's second boat.
- `changeTripCrewOutcome` / `changeTripCrew`: one person on or off, used by the departure's Crew panel,
  Today and an approved request.
- `decideCrewAssignmentRequest` (src/db/crew-requests.ts): an owner's answer to an ask.

## Decision

**A pending-news table, written in the change's own transaction, and an hourly pass that nets it.**

- `crew_notices` holds one row per real change: `assigned`, `removed`, `request_approved` or
  `request_declined`, with the person, the departure, the actor and a `seq`. The three write
  functions insert it inside their transaction, so a notice exists exactly when its change does. A
  refused change writes nothing, and a role change on somebody already aboard writes nothing.
- **The actor is never told.** `recordCrewNotices` drops a row whose person is its actor. Every staff
  surface passes its session's person as `actorPersonId`; a caller that passes none (a seed) tells
  everyone affected.
- **The coalescing rule** is `src/lib/crew-notices.ts`, and it is the whole of it:
  1. A person's notices wait until their crew has been still for two minutes
     (`CREW_NOTICE_SETTLE_MS`).
  2. The hourly pass (`/api/cron/crew-notices`, `0 * * * *`) claims everything that settled and nets
     it per departure by `seq`: the state before the first change against the state after the last.
     On then off, or off then on, is no news.
  3. An approval that put them aboard is said once, as the approval. An approval the boat then
     refused (ratio, course rules) says nothing, because they are not on it.
  4. A decline is said, unless an assignment on the same departure outranks it.
  5. What is left goes out as one `crew_schedule_change` email per person, one line per departure in
     date order, each linking to the staff departure page. A copied week is one email.
  6. A departure that has since been cancelled, deleted or has already left is dropped.
- **Staff mail in the staffer's own language**: `recipientLocale(people.locale, shops.default_locale)`,
  to their login address, or their person address when they have no login.
- **Never queued for retry** (`notificationIsQueueable`). A day-late retry could tell somebody they are
  on a boat they have since come off; the staffing week and the calendar feed carry the truth meanwhile.
- **Demo shops settle without sending**, as the Monday email decides for the same reason.
- Rows are pruned after 30 days (`RETENTION_DAYS.crew_notices`) and cascade with their shop, person
  and departure.

## Alternatives considered

- **Send inside the write path.** Nothing could be coalesced: an assign followed a minute later by an
  unassign would already be in the inbox.
- **A five-minute cron.** It would cut the worst-case delay from about an hour to about seven minutes,
  but it wakes the database twelve times an hour for a few rows (`src/lib/cron-schedule.test.ts`
  holds the hourly passes to `:00` for that reason). That trade is the product owner's call, and the
  route and rule do not change if it is made.
- **Web push.** `push_subscriptions` are per-departure manifest opt-ins: a device subscribed to one
  boat's roll call has not agreed to hear about a different boat. A crew push needs its own opt-in.
- **Netting against the live crew list.** A batch split by the settle window could then report a
  removal the person was never told the assignment for. Netting the rows alone keeps each message
  consistent with the ones before it.

## Consequences

Crew hear about their boats within the hour of the change settling, and a planning session reaches
them as one email. Moving a departure's time does not notify crew yet; nor does cancelling one (the
cancellation is not a crew change). Both are candidates for the same table and pass. Revisit the
cadence if shops say the hour is too slow for same-morning changes.
