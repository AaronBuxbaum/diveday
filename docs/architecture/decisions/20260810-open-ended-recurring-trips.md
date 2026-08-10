# 20260810-open-ended-recurring-trips — A repeating trip has no limit, and picks its own weekdays

- **Status:** Accepted
- **Date:** 2026-08-10
- **Amends:** [20260719-recurring-trip-series](20260719-recurring-trip-series.md)

## Context

[20260719-recurring-trip-series](20260719-recurring-trip-series.md) got the spine right and the
shape of the *run* wrong, and it said so at the time: "the horizon is finite, so a long-running
weekly charter is re-scheduled when it runs out", with "a rolling horizon is a scheduler plus
another `createTripSeries` window" left as a deferred follow-up.

Two limits fell out of that first slice, and a shop meets both in its first week.

**A run had to end.** A series counted out between 2 and 26 dates at creation, and the form asked
for the total up front ("Number of trips", next to a helper line reading "Counting the first, up to
26"). But a dive shop does not run a season of eight Saturdays; it runs *the Saturday charter*, and
it runs it until it stops. The honest answer to "how many?" was always "I don't know", and the form
made somebody invent a number, then come back six months later to invent another one.

**A run fired on exactly one weekday** — whichever one the first date happened to fall on. A shop
that dives Monday and Thursday had to build two series with two names, two "apply to the series"
buttons, and two places to remember to extend. A shop that dives *daily* had to build seven, or
give up and add departures by hand. The ADR anticipated this too, keeping the
`trip_recurrence_frequency` enum open "so a monthly or daily cadence is an additive migration."

Everything else in that ADR held up and is not in question here: a materialized instance is an
ordinary `trips` row, every safety- and money-critical consumer hangs off `trip_id`, and staff edit,
move, cancel, or delete a single date without touching its siblings. That independence is what
makes the rest of this decision safe to make.

## Decision

**A recurring trip is a cadence plus an optional last date, materialized into a rolling window.**

`trip_series` gains four things and loses nothing:

- `weekday_mask` — which days of a firing week the trip departs on, as a bitmask (bit 0 Sunday
  through bit 6 Saturday). "Monday and Thursday" is one series. "Every day" is all seven bits, which
  is why no `daily` enum value was added: a weekday set plus a week interval already expresses
  daily, weekly, and every-N-weeks, and a second way to say the same thing is a second thing to keep
  in step.
- `anchor_date` — the shop-local date the cadence's *weeks* are counted from. Stored rather than
  derived from the earliest instance, because that instance can be moved or deleted, and an
  every-other-week run whose phase drifts when a date is removed would silently start departing on
  the wrong weeks.
- `ends_on` — the last date the run may fire on, **or null for a run that simply keeps going**.
  Null is the default the form offers, and it is what "no limit" means.
- `trips.series_occurrence_date` — the cadence slot an instance was materialized for.

Occurrence dates come from one pure function, `seriesOccurrenceDates(anchor, pattern, window)` in
the framework-free `src/lib/recurrence.ts`. Its purity is load-bearing rather than stylistic: the
same window always proposes the same dates, so **filling the window is idempotent**. One function,
`rollSeriesForward`, proposes the cadence's dates for `[today, today + SERIES_HORIZON_DAYS]` and
creates only those that are not already spoken for. Creation, the trip page, and a nightly
`/api/cron/trip-series` pass are all that same call, and running it twice in a night is a no-op the
second time.

**A date is "spoken for" two ways, and the second one is the whole reason the ledger exists.** An
instance that carries the slot claims it — whatever its status, and wherever staff have since moved
it, because the slot travels with the row rather than being re-derived from `starts_at`. But a
*deleted* instance leaves nothing behind, so `deleteTrip` writes a `trip_series_skips` row inside
its own transaction. Without it, the next roll would helpfully re-create the very departure somebody
just removed — which is the failure mode that makes "unlimited" and "delete this one date"
incompatible in most schedulers.

"Cancel every upcoming date" also closes the run (`ends_on` = today). It has to: otherwise the
nightly roll would re-fill the horizon staff had just cleared, and the button would undo itself by
morning. Its counterpart, "Stop repeating" / "Start repeating again", is one switch with two
directions on the trip page — so stopping is never a door that only shuts, and a finite series
created before this change can simply be let go.

## Alternatives considered

- **Materialize every date up front, with a much larger cap.** Rejected: it does not answer the ask.
  There is no cap that is both "unlimited" and finite, and picking a large one (a year? five?) trades
  one arbitrary number for a bigger one plus thousands of rows a shop will never look at.
- **Expand occurrences on read (a rule plus overrides), keeping dates virtual until booked.**
  Rejected for the same reason 20260719 rejected it, and the reason is stronger now: every booking,
  manifest, waiver, and roll-call consumer needs a real trip row, and per-instance edits are the
  *normal* case here, not the exception. Two representations of "a departure" would put the
  authoritative-copy question directly onto the safety surfaces.
- **Soft-delete a series instance instead of a skip ledger.** Rejected: `deleteTrip` already means
  gone — it refuses outright once a trip has a roster or roll-call evidence, and what survives a
  delete today is nothing. A tombstone `trips` row would leak into every query that reads the
  schedule; a skip is four columns nothing else joins to.
- **A `daily` frequency enum value alongside `weekly`.** Rejected: `BYDAY=MO,TU,WE,TH,FR,SA,SU` is
  daily, and iCalendar has modelled it that way for thirty years. A separate value would mean two
  code paths agreeing about the same schedule.

## Consequences

A shop schedules its standing charter once, on the days it actually runs it, and the board holds the
next `SERIES_HORIZON_DAYS` (120) of it without anybody touching it again. Per-instance independence
is unchanged, and now genuinely durable: a deleted date stays deleted and a moved date stays moved,
across every future roll.

The trade-offs:

- **The horizon depends on a cron.** With `/api/cron/trip-series` unconfigured, a run stops
  extending once the board's far edge passes — visibly, four months out, and recoverable with the
  trip page's own "Start repeating again". It is a degradation, not a data loss.
- **"Add more dates" is gone from the trip page**, and its absence is the feature. There is nothing
  left to extend by hand.
- **New dates inherit the furthest-out instance's details.** That is deliberate — improving next
  month's charter should improve the dates after it — but it means an instance edited as a one-off
  exception becomes the template if it happens to be the last one. `applyDetailsToFutureSeries`
  remains the explicit way to push a change across the run.
- **Series created before this change are frozen where they are.** The migration back-fills
  `ends_on` to each one's own last date, so an upgraded shop's board does not silently grow
  overnight. One click on "Start repeating again" lets any of them keep going.


## Addendum, 2026-08-10 — editing a cadence, and what a narrower one may not do

The decision above left a run's cadence fixed at creation, and that gap closed in the same week: a
shop that adds Wednesday to its Monday-and-Thursday run should not have to build a second repeating
trip, or delete one that already has divers on it. `updateSeriesCadence` changes the weekday set,
the interval, and the end date of a running series, from a disclosure on the trip page.

**The anchor date never moves.** It is the cadence's phase, not its start: an every-other-week run
re-anchored on the day somebody edited it would silently swap which fortnight it sails in.

**Widening and narrowing are deliberately asymmetric, and this is the whole of the decision.**
Adding a weekday or pushing the end date out saves and rolls the horizon — the new dates appear and
nothing else moves. Dropping a weekday or pulling the end date in saves the cadence and **cancels
nothing**. The instances it orphans are ordinary trips with rosters, deposits and waivers on them,
so they are listed back to staff with their head counts and taken off the board only on a second,
explicit tap (`cancelOffCadenceSeriesTrips`, which cancels rather than deletes, so each stays
reinstatable). A cadence edit that quietly emptied a fortnight of the schedule is the one outcome
this two-step exists to prevent.

"No longer fits" is judged on the instance's cadence slot, never on where it currently departs: an
instance staff dragged to another day still fills the slot it was generated for, and reading its
moved date would report a perfectly good departure as orphaned.

Departure *times* are out of scope. Moving an instant divers were told to show up at is a
notification problem before it is a scheduling one, and `moveTrip` already handles it per date.

## Addendum, 2026-08-10 — what a security review changed

A `security-reviewer` pass over the merged change found no cross-tenant leak and no authorization
bypass, and three things worth fixing. All three are in the tree:

- **The horizon roll takes `FOR UPDATE` on its series row.** `materializeWindow` decides what to
  create by reading the instance set and then inserting, so under READ COMMITTED two overlapping
  passes both read the same empty slots and both fill them — a whole horizon of duplicate
  departures, publicly bookable. The nightly cron and a staff tap really can land together. The
  lock is on the *series*, because the trips whose absence is being read do not exist to lock.
- **The nightly sweep is bounded and least-recently-rolled first.** Ordered by creation date, one
  shop with many runs would put every later-created run permanently behind its own — starvation,
  not delay, and invisible to the starved shop. `trip_series.last_rolled_at` makes the queue a
  round robin; a pass that hits `SERIES_SWEEP_LIMIT` defers by a night and *says so* in its log
  line rather than capping silently.
- **A run whose cadence cannot generate is excluded from the sweep.** The migration's deploy-window
  sentinels (`weekday_mask = 0`, `anchor_date = ''`) would otherwise be counted as a failure every
  night forever — a permanently red monitor for a row that was never going to produce a date. The
  cadence editor above is now also the repair path for one.
