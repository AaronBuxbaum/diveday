# 20261009-crew-hear-about-their-boats — Crew hear about their boats, netted and batched

- **Status:** Accepted (2026-10-09)
- **Date:** 2026-10-09

Amended the same day after a dive-domain review and a security review (see "Review amendments,
2026-10-09").

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

- `crew_notices` holds one row per real change, with the person, the departure, the actor and a
  `seq`. The changes are `assigned`, `removed`, `role_changed` (still aboard in a different role),
  `request_approved`, `request_declined`, `request_refused` (approved, then refused by the boat) and
  `called_off` (the departure was cancelled). The write functions insert it inside their transaction,
  so a notice exists exactly when its change does. A refused change writes nothing, and the same role
  again writes nothing.
- **Call-offs** are recorded for everyone on the crew by `setTripStatus` (blow-out, day call, plain
  cancel), the minimum-seats sweep and both series cancellations, inside the cancelling transaction.
- **Late news goes now.** After a change commits, `flushUrgentCrewNotices` sends at once for every
  call-off, and for any change on a departure leaving within 24 hours (`CREW_NOTICE_URGENT_MS`).
  Everything else waits for the hourly pass. The flush never throws: a mail failure must not read as
  the change failing, and rows it cannot send stay pending for the pass.
- **The actor is never told.** `recordCrewNotices` drops a row whose person is its actor. Every staff
  surface passes its session's person as `actorPersonId`; a caller that passes none (a seed) tells
  everyone affected.
- **The coalescing rule** is `src/lib/crew-notices.ts`, and it is the whole of it:
  1. A person's notices wait until their crew has been still for two minutes
     (`CREW_NOTICE_SETTLE_MS`).
  2. The hourly pass (`/api/cron/crew-notices`, `0 * * * *`) claims everything that settled and nets
     it per departure by `seq`: the state before the first change against the state after the last.
     On then off, or off then on, is no news.
  3. A call-off is said as that, whatever came before it, unless somebody was put back on after.
  4. An approval that put them aboard is said once, as the approval. An approval the boat then
     refused (ratio, course rules) is said as the refusal: they asked, and they are not on it.
  5. A decline is said, unless an assignment on the same departure outranks it.
  6. A role change is said only to somebody aboard before and after.
  7. What is left goes out as one `crew_schedule_change` email per person, one line per departure in
     date order. Each line names their role when they are aboard and links to the staff departure
     page. The shop's name leads the subject. A copied week is one email.
  8. **A row is never settled in silence.** Each claimed row gets an `outcome`: `sent`, `failed`,
     `netted`, `skipped` (the departure had started, or was deleted or no longer running, before
     the news went out; also logged), `no_recipient` or `demo`.
- **Staff mail in the staffer's own language**: `recipientLocale(people.locale, shops.default_locale)`,
  to their login address, or their person address when they have no login.
- **Only to current staff.** The recipient must still hold a staff role at the shop, and a login,
  when they have one, must be active. A person dismissed or disabled since the change hears nothing.
- **Never queued for retry** (`notificationIsQueueable`). A day-late retry could tell somebody they are
  on a boat they have since come off; the staffing week and the calendar feed carry the truth meanwhile.
- **Demo shops settle without sending**, as the Monday email decides for the same reason.
- Rows are pruned after 30 days (`RETENTION_DAYS.crew_notices`) and cascade with their shop, person
  and departure.

## Alternatives considered

- **Send inside the write path, always.** Nothing could be coalesced: an assign followed a minute
  later by an unassign would already be in the inbox. The 24-hour line takes that cost only where
  waiting is worse.
- **A five-minute cron.** It would cut the worst-case delay from about an hour to about seven minutes,
  but it wakes the database twelve times an hour for a few rows (`src/lib/cron-schedule.test.ts`
  holds the hourly passes to `:00` for that reason). That trade is the product owner's call, and the
  route and rule do not change if it is made.
- **Web push.** `push_subscriptions` are per-departure manifest opt-ins: a device subscribed to one
  boat's roll call has not agreed to hear about a different boat. A crew push needs its own opt-in.
- **Netting against the live crew list.** A batch split by the settle window could then report a
  removal the person was never told the assignment for. Netting the rows alone keeps each message
  consistent with the ones before it.

## Review amendments, 2026-10-09

- **Dive-domain review:** crew were never told their boat was called off, and a change at 06:10 for
  a 07:00 boat waited for the hour. Hence `called_off`, the immediate flush and the 24-hour line,
  and `skipped` outcomes instead of quietly settling news about a departure that had started. The
  mail now names the shop and the person's role, role changes are news, and an approval the boat
  refused is told to the asker. es-ES says "equipo", not "tripulación", for instructors and
  divemasters.
- **Security review:** the cron route uses the shared constant-time `requireCronSecret` (L1), and mail
  goes only to people who still hold a staff role and, if they have a login, an active one (L3).

## Consequences

Crew hear about their boats within the hour of a change settling. A planning session reaches them as
one email, and anything within the next day, or any call-off, reaches them at once. Moving a
departure's time does not notify crew yet; it is a candidate for the same table and pass.
