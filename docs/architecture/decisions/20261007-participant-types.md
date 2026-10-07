# 20261007-participant-types — Seat snorkelers and riders on a diver's departure

- **Status:** Accepted
- **Date:** 2026-10-07

## Context

A Florida day boat carries divers, snorkelers and people who ride along without getting in the
water, on the same departure, at different prices (market audit item 32;
`docs/product/features/participant-types.md`). Until now a `bookings` row was a diver's seat: it
counted against one capacity, was asked for a card, could be put on a buddy team, consumed a prepaid
dive and was charged the trip's one price. A shop either refused the family or seated the rider as a
diver and explained a red readiness row every morning. The paper list the boat then left with is the
failure that matters.

Two invariants are not negotiable. **Everyone aboard is counted**: the manifest, every roll-call
checkpoint, the offline copy and the head count include every type, and no surface filters
non-divers out of a count. **The capacity check stays inside the booking transaction**, under the
trip-row lock, never as a pre-check.

## Decision

- **A booking has a type.** `bookings.participant_type` is an enum (`diver`, `snorkeler`, `rider`),
  not null, default `diver`. US English, so "snorkeler" (H-95), not the feature doc's "snorkeller".
  `src/lib/participant-types.ts` is the one place the differences are stated and holds no words or
  database.
- **Two limits, one lock.** `trips.capacity` counts every person aboard. An optional
  `trips.diver_capacity` (1 to 60) limits divers alone, and a value at or above `capacity` binds
  nothing (`diverSeatLimit`). `seatRefusal` checks the boat first (`trip_full`), then divers
  (`divers_full`), from counts that `heldSeatCounts` reads in one query under the lock. That path
  covers the booking transaction, restoring a cancelled seat, undoing a no-show and changing a
  seat's type.
- **Prices per type, never borrowed.** `trips.snorkeler_price_cents` and `trips.rider_price_cents`
  are nullable and never fall back to the diver's price. A null price keeps that seat off the public
  form, while staff can still seat it. Zero is a stated free seat. Checkout charges each seat its
  own price, with the trip's deposit policy applied per seat (`seatCheckoutCharge`). Line items
  group by amount and type, and the per-seat ask lands on `booking_checkout_bookings.trip_cents`.
  `amount_per_diver_cents` stays the diver's charge. A stored session is retired when a non-diver
  seat's price moves.
- **Gates by type.** A snorkeler or rider is never asked for a certification, specialty or nitrox
  card (in `decideTripAdmission` and `calculateReadiness`). They get no depth advisory and consume
  no prepaid dive. **The waiver and medical gates stay for everyone**, the conservative default
  until a human answers H-01/H-03 for non-divers. The payment gate counts a non-diver seat priced at
  zero as settled. An unpriced seat stays blocked until staff record or waive payment, as a diver's
  would.
- **Divers only where it is diving.** A buddy team takes divers only (`not_a_diver`). Nitrox is a
  diver's (check constraint `bookings_nitrox_is_a_divers`). A course session takes divers only
  (`participant_type_unavailable`), since recording a student as a rider to get aboard would falsify
  the record the crew reads at the rail.
- **Gear by type.** A rider gets no rental step, packing line or tank. A snorkeler is offered and
  packed surface kit only (mask and fins, wetsuit, hood and gloves, camera), with no tank and no fit
  to chase.
- **Changing type.** Staff change a seat's type from the roster (`setBookingParticipantType`),
  under the trip lock and then the booking row's own lock, matched on shop, trip and booking. Any
  staffer may move a seat out of diving, because that is said at the dock to whoever holds the
  roster. Becoming a diver is checked against the diver limit and runs the booking-time card check
  (`tripAdmissionFor`) inside the transaction. A seat that would be refused comes back
  `cert_blocked`, naming the missing card, and goes through only on an explicit "Change anyway",
  which only an owner, manager or instructor is offered or allowed (`canOverrideCertBlock`). The
  boarding gate is not skipped by it: a seat the rail already recorded boarded at departure is
  re-checked as a diver inside the transaction, and the change rolls back (`boarded_not_ready`, no
  override) when the boarding gate would refuse it.
  Leaving diving while on a buddy team is refused, and staff dissolve the team first. A nitrox
  request leaves with the water. Prepaid dives are released when a seat stops diving and spent under
  the ordinary rules when it starts. Money stays where it is, since a refund is staff-initiated
  (H-07), but any unpaid checkout session for the seat is expired so it cannot charge the old price,
  and a paid seat whose new type lists higher is saved with a notice that the difference is owed
  and a `balance_owed` desk event. Leaving diving releases the seat's unclaimed gear-register
  reservations for the kinds the new type does not use. No change is accepted once the departure is
  home or cancelled, and joining the dive is refused from the departure time on (not the selling
  grace of `hasSailed`). Leaving it stays open between dives.
- **The original type is kept.** `bookings.booked_as` records the type the seat was booked as and
  never changes. Every writer states it; the column's default of diver is only the expand half of
  expand/contract, kept for the one release in which the previous code's inserts cannot name it, and
  dropped in the next (issue #2222). A seat whose type moved
  since it was sold carries a warning-tone note on the roster, the live roll call and the offline
  copy, either way: "Snorkeling, booked as diver" for a seat that left the dive, and "Diving, booked
  as snorkeler" for one that joined it, possibly past a missing card. The same transaction writes a
  `participant_type_changed` line to the trip's trail with the old type, the new one and the card
  checks it cleared or overrode, and a desk event named for the new type (`now_diving`,
  `now_snorkeling`, `now_riding`) for the manifest's catch-up strip ("Ana Ruiz is snorkeling
  now"). Moving a seat out of diving clears no medical blocker: a physician
  referral still blocks a snorkeler.
- **Where it shows.** A neutral word beside the name on the roster, the live roll call and the
  offline copy. The manifest's head count reads "Passengers" and states the split once anyone is
  not diving ("Passengers 12 (8 divers, 3 snorkelers, 1 rider)", leaving out a type nobody is), as do the incident export and the
  offline copy. The monthly report splits its seat count by type. Both CSV exports carry the type, and the
  trip export carries the two prices and the diver limit.

## Alternatives considered

- **A `kind` on order line items only** — prices the seat but leaves admission, readiness, buddy
  teams and the head count treating a rider as a diver.
- **A second capacity for non-divers (`rider_capacity`)** — the feature doc's first sketch. The
  legal limit is bodies, and the kit limit is divers, so the diver count is the number that needs
  its own cap.
- **Falling back to the diver's price** — puts a rider through checkout for two tanks.
- **Dropping the waiver for riders** — a legal question for a human (H-01/H-03), not an
  engineering default.
- **Two snorkeler types (guided and unguided)** — open question 3 in the feature doc. One type
  ships now, and a second is an additive enum value.

## Consequences

- Every seat-granting write must count with `heldSeatCounts` and refuse with `seatRefusal`. A new
  door that counts rows itself would miss the diver limit.
- Readiness still blocks an unsigned rider, which is deliberate. If a human rules that riders sign
  nothing, the change is one branch in `calculateReadiness`.
- **Riders are sent the dive medical, a known overreach** pending a human decision on which form a
  snorkeler and a rider get (issue #2212). It is the conservative default, not the answer. Vests
  for snorkelers (#2213) and snorkel-suitable sites (#2214) are filed and not built.
- Per-type prices are on the trip. When the boat entity of ADR 20260804-boat-resource-model lands,
  `diver_capacity` belongs to the boat or the boat-day, and moving it is a column move with no data
  to reconcile (H-49).
- Promo codes discount the whole session as before, and so discount every seat's line.
- "Apply to future departures" from the Details form does not carry the participant terms. A
  repeating series copies them onto each new instance, and duplicating a departure copies them too.
