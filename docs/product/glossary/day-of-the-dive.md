# Day of the dive

- **Blow-out** — the captain's call that weather or sea state makes a departure un-runnable: the
  trip is cancelled by the shop, not the diver. Distinct from a **conditions hold** (below), which
  is reversible and keeps bookings live. In DiveDay a blow-out is called per departure, or for
  several departures of one day at once (the day weather call, ADR
  [20261009-day-weather-call](../../architecture/decisions/20261009-day-weather-call.md), which never
  offers a diver a departure the same call cancels), and triggers the cancellation cascade: every
  booked diver gets one message with the cancellation, their money story, and rebooking options
  filtered to departures they qualify for, and staff work the cascade record until nobody is left
  unresolved (ADR [20260804-blowout-cascade](../../architecture/decisions/20260804-blowout-cascade.md)). A blow-out
  refunds each seat's card capture by itself as of 2026-08-13 (ADR
  [20260813-shop-cancellation-refunds-itself](../../architecture/decisions/20260813-shop-cancellation-refunds-itself.md));
  a counter payment, a disconnected account, or a Stripe refusal still leaves the refund to staff.
  A departure **underway** (past its start time, or with anybody recorded at roll call) cannot be
  blown out, and the day call is for owners, managers and captains only.
  **It cancels the *trip* and leaves every booking active**, and every reader downstream has to expect that
  shape: `bookings.status` says nothing about a blow-out, so a surface asking "was this seat
  cancelled" gets `false` for all twelve people who drove to the dock and were sent home. The
  diver's own thread therefore says the departure was cancelled on its own authority, the **dive
  day** count excludes the date, and there is no **after-state** for a day that never happened.
- **Conditions hold** — a reversible crew call while weather or sea state is uncertain. Existing
  bookings remain valid, new bookings pause, and booked divers are notified. It is not a
  cancellation and never implies a refund.
- **Arrival card** — the place-to-go projection for one departure: meeting label and address,
  optional shop-authored landmark guidance, a map hand-off, public support contacts, and the
  departure time. The panel on the public trip page is public and non-sensitive. The **download**
  is not: it is the booked diver's own card, released only against their `/ready` capability. It
  contains no waiver, readiness or medical state, no credential, and no booking id.
- **Change ledger** — the chronological, diver-visible record of material meeting-point and
  conditions changes. Each event stores before/after public-safe snapshots, a broad source
  (`shop` or `crew`), and a timestamp; it never names a staffer or carries private operational
  notes. Re-saving the same facts is not a new event.
- **Day-of help request** — one controlled, non-medical request a diver can make from `/ready`
  (`carry gear`, `first-timer orientation`, or `find my group`). It is scoped to one booking,
  expires from active Today work when the trip ends, and moves through `requested`,
  `acknowledged`, and `handled`; it is not a social feed, medical record, or free-text inbox.
- **Staff note** — shop-private operational context written for the next person on the team. A
  note has one general kind for now and attaches either to a **diver** (shared across that diver's
  record and the live boat manifest) or to one **booking** (departure-specific desk context). It is
  displayed with its author and timestamp, is exported with the shop's records, and is never
  evidence: readiness, trip admission, capacity, boarding, and roll-call completion do not read it.
  New note kinds must name their audience and retention before they are added; free text is not a
  license to put medical or boarding decisions into an unaudited gate.
