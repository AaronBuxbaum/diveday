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
  **The same cascade cancels a run.** A repeating trip's "Cancel every upcoming date" sends each of
  those dates through it (`trip_blowouts.cause` = `run_ended`), so the record, the refunds and the
  one message per diver are the blow-out's, and the message says the shop stopped running the trip
  rather than blaming the weather. Staff see that record as **Canceled with its run**, never as a
  weather call. A date blown out, reinstated and then cancelled with its run takes the newer cause,
  and is still refused while it is underway.
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
- **Saved trip-prep copy** — the last `/ready/<token>` page a diver's own browser rendered, kept on
  their phone for a marina with no signal. The one service-worker script, registered a second time
  from `/ready/` with that scope (`src/lib/ready-offline.ts`); the staff registration at `/` never
  keeps one. One copy under a key that names no token (saving a page deletes any other; the copy
  answers a path only by its hash), the page itself only (same origin, its exact path, no query, no
  redirect, HTML), network-first (served only when `fetch` fails), and kept only until the day
  after the boat is due back (two weeks at most). A load that is not the live page (a cancelled
  seat, a departure called off, an expired link) clears it. Read-only: offline the page says it is
  the saved copy and that changes need signal. Rules in `src/worker/ready-page-cache.ts`.
- **Dock rider** — a non-diving passenger a captain adds from the Boat tab while the boat is still
  at the dock (no stage recorded, or **boarding**): a name, an optional phone, an emergency
  contact, an optional date of birth (so a minor shows the minor badge at once), and whether they
  ride along or snorkel. It is a seat like any other, sold through the one seating path
  (`seatDiver` → `createBooking`), so the certificate ceiling and the hull's capacity refuse it
  exactly as they refuse a seat sold at the desk; it counts in the head count and roll call at once
  and writes the `rider_added_at_dock` activity line. **A seat is not boarding**: the rider still
  owes the release and medical statement (and payment, where the shop asks for it and names no
  rider price), the notice says so and hands over the release link, and the dock gate refuses
  **Boarded** until they are ready. There is no offline path: at a dock with no signal the rider
  goes on the paper manifest. Never onto a course session, a canceled or sailed departure, or beside
  somebody of the same name already aboard (`src/db/dock-rider.ts`).
- **Departure note** — one short operational message ("Marina lot closed, park at the Elks") sent
  once to every held seat on a departure by that diver's usual channel: email when they have an
  address, otherwise the shop's WhatsApp or SMS. Transactional, so it is held to that: at most
  200 characters on one line, no link of any kind except the diver's own `/ready` link DiveDay
  adds, at most three per departure, and never to a canceled or sailed departure. A multi-day
  course has sailed once its last day has, so the desk can reach students between days, and the
  note names the day still to come rather than day one (H-110, #2393). Sent as a
  **held send** with the same eight-second Undo every held send has; the checks run at the hold
  and again when it drains. Recorded in `departure_notes` and on the activity trail
  (`src/lib/departure-notes.ts`, `src/db/departure-notes.ts`).
- **Lost item** — something the crew found aboard after a departure, written down on its Boat tab
  ("Blue mask, seat 4"), optionally tied to the seat it was found at, and so to that diver. One
  tap tells the diver by their usual channel, once. It is **open** until it goes home
  (**returned**) or the shop gives up on it (**discarded**); open items across every departure
  are listed at Lost and found. Resolved items are pruned after 90 days, and an erasure deletes
  the diver's items outright (`src/db/lost-items.ts`).
- **Dock line** — the one sentence under a consented first-timer's "first time with us" on the
  arrivals roster: the first name to greet and the level they hold ("Say hello to Priya: Open
  Water."). It names a level only when a card at that level is **verified** (`verifiedLevel` on
  `listCertificationSummaries`, `src/db/self-declared-cards.ts`); any card nobody has verified,
  whether the diver typed it or a staffer did, is what the diver *says* ("says Open Water", es
  "dice Open Water"), and a stated "no card" is "Not certified yet". Either of those wears the
  warning tone the certification phrase wears everywhere (`welcomeDockLineUnchecked`,
  `src/i18n/welcome-cue-labels.ts`). **Nitrox is never on it**: a greeting is not a fill
  clearance, and enriched air is the fill station's question. It informs and gates nothing; the
  boarding gate is readiness. It may end with the diver's own **hello choice** (`welcome_hello`:
  first ocean dive, celebrating something, a little nervous), asked on `/ready` under the same
  yes as the cue, a fixed choice and never free text, cleared when the yes is taken back. A
  booking's free text never reaches the line.
