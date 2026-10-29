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
  Only a caller with the refund right (owner or manager) sends the card refunds as it runs; anyone
  else who calls it off leaves them queued for one of those two to release
  ([H-139](../human-decisions/H-139-call-off-queues-refunds-for-a-refund-holder.md)).
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
- **Logbook suggestion** — the "Logbook" line on a diver's Bring list (`/ready`, the booking email
  and the printed pass), set by the shop's `packing_logbook` flag beside its packing list in
  Settings, never typed as a line of `packing_list`. It reads in the diver's language and is left
  off only for a try-dive (intro course) student with no certification card, who has no dives to
  log; a student on a course that logs training dives keeps it (`packsLogbook`, issue #2795). A
  suggestion, never a gate. A shop's typed "Logbook" line moved into the flag by a one-time
  migration.
- **Conditions hold** — a reversible crew call while weather or sea state is uncertain. Existing
  bookings remain valid, new bookings pause, and booked divers are notified. It is not a
  cancellation and never implies a refund.
- **Arrival card** — the place-to-go projection for one departure: meeting label and address,
  optional shop-authored landmark guidance, a map hand-off, public support contacts, and the
  departure time. The panel on the public trip page is public and non-sensitive. The **download**
  is not: it is the booked diver's own card, released only against their `/ready` capability. It
  contains no waiver, readiness or medical state, no credential, and no booking id.
- **Change ledger** — the chronological, diver-visible record of material meeting-point,
  conditions and site changes (a site change, `site_change`, is the day's run of sites as the
  diver reads it, by public name, written in the transaction that changed the dives; issue
  #3060). Each event stores before/after public-safe snapshots, a broad source
  (`shop` or `crew`), and a timestamp; it never names a staffer or carries private operational
  notes. Re-saving the same facts is not a new event.
- **Day-of help request** — one controlled, non-medical request a diver can make from `/ready`
  (`carry gear`, `first-timer orientation`, or `find my group`). It is scoped to one booking,
  expires from active Today work when the trip ends, and moves through `requested`,
  `acknowledged`, and `handled`. `Acknowledged` records the crew member who agreed after the desk
  spoke with them; a helper who leaves the crew, loses every staff role or is deleted sends the
  request back to `requested`. `Handled` preserves that helper, even after they leave the crew, and
  can be undone while the departure is live and the booking stands: back to the assigned state
  while the helper still serves the departure, otherwise back to `requested` with no helper. The
  diver's page names the helper only while the request is `acknowledged`.
  Staff actions apply only to the displayed request revision; replacing the request or changing
  its handoff invalidates older assignment, completion and undo forms.
  It is not a social feed, medical record, or free-text inbox.
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
  the saved copy, when the server generated it, and that details may have changed. A copy with no
  trusted generation time says so. The server time calibrates a stable device-clock offset for
  expiry. If the phone clock is detected moving backward, the page is replaced by a warning. An
  unobserved forward clock jump can expire a copy early because it cannot be separated from elapsed
  time offline. Even when its time is known, an offline copy is a snapshot, not live readiness.
  Rules in `src/worker/ready-page-cache.ts`.
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
  the diver's items outright (`src/db/lost-items.ts`). The Boat tab's "Left aboard" form opens
  at Heading in, Home, or once the departure is Back (`leftAboardOpen`; see **At sea**,
  [operations.md](operations.md)). Open items show in three more places (fifth loop, item 7): a
  Today row in The desk group ("2 things waiting to go home"), counting every open item tied to a
  diver and any unclaimed one from the last 30 days; and a found-item line on that diver's
  check-in row and under their record's header, so it goes home on the visit it can be handed
  over.
- **Dock line** — the one sentence under a consented first-timer's "First dive with us" on the
  arrivals roster ("First time with us" under a snorkeler or a rider, whose seat is not a dive, and
  a no-show or a non-diving seat never counts as a prior dive; `src/db/welcome-cues.ts`): the first name to greet and the level they hold ("Say hello to Priya: Open
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
- **Snag** — a problem a crew member wrote against one pre-departure checklist line on one boat
  ("VHF crackles on 16"), carried to that boat's next departures above their checklist until a
  crew says **Fixed**; **Still there** keeps it open and names who looked last. Today holds one
  row per open snag for the owner, manager and captain. A snag belongs to the boat, not the departure: a departure with no
  boat cannot hold one, and a fixed snag is never reopened (a recurring problem is a new note).
  Informs, never gates, like the checklist it hangs from (ADR
  [20260824-pre-departure-safety-check](../../architecture/decisions/20260824-pre-departure-safety-check.md)).
  Stored in `boat_snags`, never on the append-only `pre_departure_check_events`. The saved
  offline manifest carries the open ones read-only, and the departure log lists those open when
  the boat sailed (`snagsOpenWhenSailed`).
- **Day load-out** — tomorrow's cylinders and rental pieces added across every departure of one
  shop day, said on Today's evening as "Tomorrow from tonight" and on the printed packet
  (`/print?day=tomorrow`). Tanks are (divers + diving crew) × dives, one cylinder per diver per
  dive, with nitrox counted only for seats with a verified card. A count, never a fill log
  ([H-11](../human-decisions/H-11-nitrox-fill-station-procedure-ppo.md)): each cylinder is still analyzed and signed for at the
  fill station. It shows once today's boats are past their last scheduled return, or on a day
  with none (`loadOutDue`, `dayLoadOut` in `src/lib/closeout.ts`).
- **Back from the boat** — the Gear tab's list, once a departure is home, of every unit that went
  out on it and is still out, one row per unit: **Back**, or **Back with a problem** with words,
  which closes it as a service concern and can pull the unit to Needs service in the same act
  (ticked from the start for a regulator, BCD or cylinder). Keyed to the departure, unlike the
  register's due-back-by-date panel (`listTripUnitsToCheckIn`, `returnTripGearUnit`).
- **Last time line** — under each planned dive, the newest earlier visit to that site: the last
  live dive there in the crew's own words, or the last plan that moved elsewhere, whichever is
  later ("Molasses: last dived Mon, Oct 12 (Sal Moretti): visibility 40 ft"). Never the
  departure's own log; deleted dives and departures are left out. Informs, gates nothing
  (`lastAtSites`, `src/lib/site-history.ts`).

- **Today shop-day catch-up** — the staff member's view of new desk events across the shop's
  departures for one local day. Each reader has an independent first-view snapshot and acknowledges
  only the events shown; their own actions are not news to them. Today marks are separate from the
  per-reader, per-departure manifest catch-up marks, so acknowledging one does not clear the other.
