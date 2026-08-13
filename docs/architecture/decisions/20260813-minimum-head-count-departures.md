# 20260813-minimum-head-count-departures — A departure can require a head count, and cancels itself if it does not get one

- **Status:** Accepted
- **Amended by:** [20260813-shop-cancellation-refunds-itself](20260813-shop-cancellation-refunds-itself.md) — the sweep refunds now, and its mail says so.
- **Date:** 2026-08-13

## Context

A large share of the trips a dive shop actually sells only run if enough people buy them. A
long-range charter, a night dive, a two-tank run to a site an hour offshore — the fuel, the boat and
the crew cost the same whether two divers turn up or ten, so below some number the shop loses money
by sailing. Every shop already has this rule. None of them had anywhere to put it.

What they did instead: wrote "minimum 4 divers to run" into the trip description, watched the seat
count by eye, and phoned around on the morning of. DiveDay's part in that was to render the sentence
and otherwise pretend the rule did not exist — the booking page said "3 spots left" about a
departure that might never happen, the schedule board showed it as scheduled, and the reminder cron
cheerfully told two divers to be at the dock at 07:00 for a boat the shop had already decided not to
run.

The cost lands on the diver, and it is the specific thing that makes people book somewhere else: a
"we'll confirm closer to the day" that never names a day. A diver who has taken a Friday off, or
booked a hotel, or flown somewhere, is not asking the shop to guarantee the trip. They are asking
**when they will know.**

## Decision

**A trip carries two numbers, and DiveDay keeps the promise they make.**

`trips` gains `minimum_bookings` and `minimum_decision_hours`, both nullable. Both null — every trip
that exists today, and the default for every new one — means the boat goes with whoever booked, and
nothing anywhere behaves differently. There is no migration of existing data and no new default
behaviour.

Set, they are a **published promise** rather than an internal setting:

- The public booking page states the minimum and the exact moment the answer arrives — "runs with at
  least 4 divers; if it hasn't got there by Thu 14 Aug, 7:30 AM, the shop cancels it and emails
  everyone booked". A diver reads that *before* they pay.
- An hourly sweep (`/api/cron/minimum-seats` → `cancelDeparturesBelowMinimum`) cancels every
  departure that is still short at its own moment, and emails every diver aboard with the numbers:
  what it needed, what it had.
- Staff see the shortfall and the deadline on the trip's Overview while there is still time to ring
  round — and, in the window between the deadline and the next pass, a red band saying the
  cancellation is about to happen.

`minimum_decision_hours` left null beside a set minimum reads as the default window
(`MINIMUM_SEATS_DECISION_HOURS_DEFAULT`, 48 hours), not as "no deadline". A shop can name a minimum
without having to have an opinion about the window, which is the common case.

### Why hourly, and why a deadline at all

The deadline is the product. A minimum with no stated moment is the sticky note the shop already
had; what a diver is buying is *knowing when they will know*. That means the sweep's resolution has
to match the resolution the promise is stated in — a shop that says "we decide 24 hours before"
needs the call made within the hour, not "some time tonight". The pass is an index scan over
scheduled trips inside a window and cancels nothing on the overwhelming majority of ticks, so hourly
is cheap.

### Why the shop always gets the last word

Two escape hatches, both ordinary existing acts rather than new controls:

- **Reinstating a swept departure clears its minimum** (`clearMinimumSeats`, called from
  `reinstateTripAction`). Putting a trip back *is* the shop saying "run it anyway", and without this
  the next tick would cancel it again inside the hour — the shop would be arguing with a cron job.
- **Clearing the minimum in Details** takes a departure off the sweep's list before its deadline.

### Why the minimum is clamped on read, not validated on write

`effectiveMinimum` clamps the stored minimum to the trip's capacity every time it is read, and there
is deliberately **no** `minimum_bookings <= capacity` check constraint. A shop that set a minimum of
6 and later moved the trip to a 4-seat RIB would otherwise be refused the capacity edit by a
constraint about something else entirely — and the honest reading of a minimum above capacity is
"every seat", not "this departure can never run". Same fail-open direction as the H-08 age gate.

### Why its own notification kind

`trip_minimum_not_met` is a sibling of `trip_blowout`, not a reuse of it. A blow-out is the weather
deciding on the morning of; this is a deadline the diver was told about before they paid, and the
message has to say so. "We needed 4 and had 2 by the moment we said we'd decide" reads as a promise
kept. The blow-out's wording would read as a shop that simply changed its mind.

*(Superseded 2026-08-13: the sweep refunds every active seat and the message states the outcome —
see [20260813-shop-cancellation-refunds-itself](20260813-shop-cancellation-refunds-itself.md).)*
The message deliberately says nothing about money. Refunds stay staff-initiated on the per-booking
path (H-07), and a template that promised a refund would be writing a policy this app does not
enforce.

## Alternatives considered

**A "provisional" trip status.** Model the rule as a third `trip_status` — `provisional` →
`scheduled` or `cancelled`. Rejected: every consumer of `trip_status` is safety- or money-critical
(readiness, the manifest, the reminder cron, the recap run, the schedule board, the public page),
and a third value means auditing all of them for a state that, from each one's point of view, is
just "scheduled". The two nullable columns leave `trip_status` a two-valued question and let each
surface opt in to the extra fact.

**Staff decide, DiveDay only reminds.** A Today row — "this departure is short and its deadline is
tomorrow" — and no automatic cancellation. Rejected: it rebuilds the sticky note in software. The
shop still has to remember to look, the diver still gets "we'll confirm closer to the day", and the
one thing the shop is actually buying — a promise it cannot forget to keep — is exactly what is
missing. The band on Overview is that reminder, and it exists *because* the cancellation is
automatic and staff need the window to overrule it.

**A stored `decides_at` timestamp instead of an hours offset.** Rejected: staff move departures, and
a stored instant would leave a trip slid two days later carrying a deadline that had already passed.
The window is genuinely "hours before this trip leaves", so it is stored that way and the moment is
computed — in SQL for the sweep, and in `minimumSeatsDecisionAt` for every surface, with the two
asserted against each other in `trips-minimum.test.ts` rather than merely written to look alike.

**Cancel the bookings too.** Rejected: a cancelled departure still needs to know who was on it — to
email them, and to be reinstatable. Flipping the trip's status alone is what makes both possible.

## Consequences

- Two nullable columns and two check constraints on `trips`; one value on the `notification_kind`
  enum. Nothing existing changes shape.
- One more `crons` entry, one more Sentry Cron Monitor
  (`diveday-minimum-seats-sweep`). A missed pass is its own incident: divers who were promised an
  answer at a stated hour do not get one, and by the time anybody notices they are at the dock.
- The sweep is the **only** thing that cancels for a minimum. Staff keep their ordinary cancel
  button, and nothing else in the app reads these columns as a gate — a diver can still book a
  departure that is short, which is the whole point of it being short.
- ~~Deferred, and genuinely open: **automatic refunds.**~~ **Decided 2026-08-13** — the sweep
  refunds every active seat on a departure it cancels, and the mail says what happened. The
  reasoning below stands as the reason it was a decision for the owner rather than a default:
  making it automatic was a money-movement decision, not an engineering one. See
  [20260813-shop-cancellation-refunds-itself](20260813-shop-cancellation-refunds-itself.md).
- Also deferred: **the wait list is not consulted.** A short departure with three people on another
  trip's wait list is not offered them. That is a good idea and a different feature (the last-minute
  deal blast is the existing tool), and wiring it into the sweep would make an automatic
  cancellation depend on an automatic invitation.
