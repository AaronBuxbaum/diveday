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
- **Dock rider** — a non-diving passenger a captain adds from the Boat tab while the boat is still
  at the dock (no stage recorded, or **boarding**): a name, an optional phone and an emergency
  contact. It is a seat like any other, sold through the one seating path (`seatDiver` →
  `createBooking`), so the certificate ceiling and the hull's capacity refuse it exactly as they
  refuse a seat sold at the desk; it counts in the head count and roll call at once and writes
  the `rider_added_at_dock` activity line. Riders only, and never onto a course session, a
  canceled or sailed departure, or beside somebody of the same name already aboard
  (`src/db/dock-rider.ts`).
- **Departure note** — one short operational message ("Marina lot closed, park at the Elks") sent
  once to every held seat on a departure by that diver's usual channel: email when they have an
  address, otherwise the shop's WhatsApp or SMS. Transactional, so it is held to that: at most
  200 characters on one line, no link of any kind except the diver's own `/ready` link DiveDay
  adds, at most three per departure, and never to a canceled or sailed departure. Sent as a
  **held send** with the same eight-second Undo every held send has; the checks run at the hold
  and again when it drains. Recorded in `departure_notes` and on the activity trail
  (`src/lib/departure-notes.ts`, `src/db/departure-notes.ts`).
- **Lost item** — something the crew found aboard after a departure, written down on its Boat tab
  ("Blue mask, seat 4"), optionally tied to the seat it was found at, and so to that diver. One
  tap tells the diver by their usual channel, once. It is **open** until it goes home
  (**returned**) or the shop gives up on it (**discarded**); open items across every departure
  are listed at Lost and found. Resolved items are pruned after 90 days, and an erasure deletes
  the diver's items outright (`src/db/lost-items.ts`).
